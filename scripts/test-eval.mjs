import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const temp = await mkdtemp(path.join(tmpdir(), 'snackops-eval-'));
try {
  const source = await readFile('src/lib/eval/scorer.ts', 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const modulePath = path.join(temp, 'scorer.mjs');
  await writeFile(modulePath, compiled);
  const { scoreEvalCase } = await import(pathToFileURL(modulePath).href);

  function makeCase(overrides = {}) {
    return {
      id: 'eval-test',
      name: '测试用例',
      question: '测试问题',
      scenario: '测试',
      difficulty: 'medium',
      riskLevel: 'low',
      expectedReply: '',
      expectedKeywords: [],
      keywordMode: 'AND',
      forbiddenWords: [],
      expectedPrice: null,
      expectRiskPassed: true,
      requiredCapabilities: [],
      forbiddenCapabilities: [],
      evalDimension: 'overall',
      llmJudgePrompt: '',
      tags: [],
      sourceRunId: null,
      createdAt: new Date().toISOString(),
      enabled: true,
      ...overrides,
    };
  }

  function makeRun(overrides = {}) {
    return {
      id: 'run-eval-test',
      status: '成功',
      finalReply: '这是测试回复。',
      durationMs: 12,
      error: null,
      errorCode: null,
      plan: { selectedSkills: [], selectedTools: [] },
      steps: [],
      riskResult: { decision: 'allow', riskLevel: 'low', flags: [], violations: [], safeReply: null, handoffRequired: false, checkedBy: 'test', notes: [] },
      ...overrides,
    };
  }

  const andPass = scoreEvalCase({
    evalCase: makeCase({ expectedKeywords: ['退款', '3 个工作日'], keywordMode: 'AND' }),
    run: makeRun({ finalReply: '退款将在 3 个工作日内到账。' }),
  });
  assert.equal(andPass.status, 'PASS');

  const andFail = scoreEvalCase({
    evalCase: makeCase({ expectedKeywords: ['退款', '3 个工作日'], keywordMode: 'AND' }),
    run: makeRun({ finalReply: '退款会尽快处理。' }),
  });
  assert.equal(andFail.status, 'FAIL');
  assert.deepEqual(andFail.keywordMisses, ['3 个工作日']);

  const orPass = scoreEvalCase({
    evalCase: makeCase({ expectedKeywords: ['退款', '退货'], keywordMode: 'OR' }),
    run: makeRun({ finalReply: '可以申请退款。' }),
  });
  assert.equal(orPass.status, 'PASS');

  const orFail = scoreEvalCase({
    evalCase: makeCase({ expectedKeywords: ['退款', '退货'], keywordMode: 'OR' }),
    run: makeRun({ finalReply: '我们会继续处理。' }),
  });
  assert.equal(orFail.status, 'FAIL');

  const forbidden = scoreEvalCase({
    evalCase: makeCase({ forbiddenWords: ['保证最低价'] }),
    run: makeRun({ finalReply: '保证最低价，绝对划算。' }),
  });
  assert.equal(forbidden.status, 'FAIL');
  assert.deepEqual(forbidden.forbiddenHits, ['保证最低价']);

  const pricePass = scoreEvalCase({
    evalCase: makeCase({ expectedPrice: 79.7 }),
    run: makeRun({ finalReply: '优惠后合计 79.70 元。' }),
  });
  assert.equal(pricePass.status, 'PASS');
  assert.equal(pricePass.mentionedPrice, 79.7);

  const priceFail = scoreEvalCase({
    evalCase: makeCase({ expectedPrice: 79.7 }),
    run: makeRun({ finalReply: '优惠后合计 89.70 元。' }),
  });
  assert.equal(priceFail.status, 'FAIL');

  const capabilities = scoreEvalCase({
    evalCase: makeCase({ requiredCapabilities: ['tool:query_orders', 'skill:risk-check'] }),
    run: makeRun({
      finalReply: '订单和风险已核对。',
      plan: { selectedSkills: ['need-extraction', 'risk-check'], selectedTools: ['query_orders'] },
      steps: [{ type: 'tool', capabilityId: 'query_orders' }],
    }),
  });
  assert.equal(capabilities.status, 'PASS');
  assert.deepEqual(capabilities.missingCapabilities, []);

  const missingCapability = scoreEvalCase({
    evalCase: makeCase({ requiredCapabilities: ['tool:query_logistics'] }),
    run: makeRun({ finalReply: '已处理。' }),
  });
  assert.equal(missingCapability.status, 'FAIL');
  assert.deepEqual(missingCapability.missingCapabilities, ['tool:query_logistics']);

  const safeHighRisk = scoreEvalCase({
    evalCase: makeCase({ riskLevel: 'high', question: '中奖了，让我提供验证码转账？', expectedKeywords: ['不要转账'] }),
    run: makeRun({ finalReply: '请不要转账，也不要提供验证码；请通过官方渠道核实。', riskResult: { decision: 'allow', riskLevel: 'high', flags: ['fraud_suspected'], violations: [], safeReply: null, handoffRequired: true, checkedBy: 'test', notes: [] } }),
  });
  assert.equal(safeHighRisk.status, 'PASS', JSON.stringify(safeHighRisk));
  assert.equal(safeHighRisk.replySafe, true);

  const dangerousReply = scoreEvalCase({
    evalCase: makeCase({ riskLevel: 'high', question: '中奖了，让我提供验证码转账？' }),
    run: makeRun({ finalReply: '请立即转账并发送验证码，我们会把奖品发给你。' }),
  });
  assert.equal(dangerousReply.status, 'FAIL');
  assert.equal(dangerousReply.replySafe, false);

  const errorRun = scoreEvalCase({
    evalCase: makeCase({ expectedKeywords: ['退款'] }),
    run: makeRun({ status: '失败', finalReply: null, errorCode: 'EXECUTION_ERROR' }),
  });
  assert.equal(errorRun.status, 'ERROR');
  assert.equal(errorRun.passed, false);

  const reviewSemantic = scoreEvalCase({
    evalCase: makeCase({ expectedReply: '应当先道歉，再给出补发方案。' }),
    run: makeRun({ finalReply: '可以补发，请提供订单号。' }),
  });
  assert.equal(reviewSemantic.status, 'REVIEW');

  const reviewNoAssertions = scoreEvalCase({
    evalCase: makeCase(),
    run: makeRun(),
  });
  assert.equal(reviewNoAssertions.status, 'REVIEW');

  console.log(JSON.stringify({
    result: 'PASS',
    checks: 12,
    andPass: andPass.status,
    andFail: andFail.status,
    orPass: orPass.status,
    orFail: orFail.status,
    forbidden: forbidden.status,
    price: [pricePass.status, priceFail.status],
    capabilities: [capabilities.status, missingCapability.status],
    risk: [safeHighRisk.status, dangerousReply.status],
    errors: errorRun.status,
    reviews: [reviewSemantic.status, reviewNoAssertions.status],
  }, null, 2));
} finally {
  await rm(temp, { recursive: true, force: true });
}
