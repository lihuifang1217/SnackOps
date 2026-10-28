import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const port = process.env.AGENT_TEST_PORT || '5431';
const token = randomUUID();
const tempRoot = await mkdtemp(path.join(tmpdir(), 'snackops-agent-'));
const dataDir = path.join(tempRoot, 'data');
const skillsDir = path.join(tempRoot, 'skills');
const routeDirectory = path.resolve('src/app/api/agent-planner-probe');
const routeFile = path.join(routeDirectory, 'route.ts');
const baseUrl = `http://127.0.0.1:${port}`;

let server;
let serverLog = '';
let routeCreated = false;

function collectServerOutput(stream) {
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    serverLog += chunk;
    if (serverLog.length > 40000) serverLog = serverLog.slice(-40000);
  });
}

async function startServer(extraEnv = {}) {
  server = spawn(process.execPath, ['scripts/serve.mjs', 'dev'], {
    env: {
      ...process.env,
      DEPLOY_RUN_PORT: port,
      SNACKOPS_DATA_DIR: dataDir,
      SNACKOPS_SKILLS_DIR: skillsDir,
      SNACKOPS_TEST_DIST_DIR: '.next-agent-test',
      SNACKOPS_AGENT_TEST_TOKEN: token,
      NEXT_TELEMETRY_DISABLED: '1',
      // 隔离宿主 .env.local 中的真实 Provider 配置，确保缺配置测试可重复。
      OPENAI_API_KEY: '',
      OPENAI_BASE_URL: '',
      LLM_MODEL: '',
      LLM_PROVIDER: 'classroom-fixture',
      COZE_API_TOKEN: '',
      COZE_WORKLOAD_IDENTITY_API_KEY: '',
      COZE_CODING_API_KEY: '',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  collectServerOutput(server.stdout);
  collectServerOutput(server.stderr);

  for (let attempt = 0; attempt < 180; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`测试服务提前退出（${server.exitCode}）\n${serverLog}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (response.status === 200) return;
    } catch {
      // 等待 dev 编译。
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`测试服务未能启动\n${serverLog}`);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => server.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 8000)),
  ]);
  if (server.exitCode === null) server.kill('SIGKILL');
}

async function requestJson(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(options.headers || {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(30000),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { response, payload };
}

async function runAgent(userInput, provider = 'classroom-fixture', source = 'api') {
  const response = await fetch(`${baseUrl}/api/agent/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ userInput, provider, source }),
    signal: AbortSignal.timeout(120000),
  });
  assert.equal(response.status, 200, `Agent 运行 HTTP ${response.status}`);
  const text = await response.text();
  const events = text
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const line = block.split('\n').find((item) => item.startsWith('data: '));
      if (!line) return null;
      try {
        return JSON.parse(line.slice(6));
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const run = events.find((event) => event.type === 'done')?.run;
  assert.ok(run, 'SSE 必须包含 done.run');
  assert.ok(events.some((event) => event.type === 'run'));
  assert.ok(events.some((event) => event.type === 'plan'));
  assert.ok(events.some((event) => event.type === 'final'));
  return {
    events,
    run,
    plan: events.find((event) => event.type === 'plan')?.plan,
    validation: events.find((event) => event.type === 'plan')?.validation,
    final: events.find((event) => event.type === 'final'),
  };
}

function stepOf(run, capabilityId) {
  return run.steps.find((step) => step.capabilityId === capabilityId);
}

try {
  await cp(path.resolve('data'), dataDir, { recursive: true });
  await cp(path.resolve('skills'), skillsDir, { recursive: true });
  // 隔离宿主当前 managed Provider，确保测试和缺配置断言可重复。
  await writeFile(
    path.join(dataDir, 'llm-config.json'),
    `${JSON.stringify({
      provider: 'fixture',
      model: 'snackops-fixture-v1',
      temperature: 0.2,
      maxTokens: 1200,
      configured: false,
      managed: false,
      updatedAt: '2026-10-18T09:00:00+08:00',
    }, null, 2)}\n`,
  );
  await mkdir(routeDirectory);
  routeCreated = true;
  await writeFile(
    routeFile,
    await readFile('scripts/fixtures/agent-planner-probe-route.txt', 'utf8'),
  );

  await startServer();

  // 1. 正常推荐：完整 Planner / Tool / Skill / risk-check / 评分链路
  const recommendation = await runAgent('给同事买点不辣的办公室零食，预算 100 元以内。');
  assert.equal(recommendation.run.status, '成功');
  assert.ok(recommendation.run.finalReply?.trim());
  assert.ok(recommendation.plan.selectedSkills.includes('response-generator'));
  assert.ok(recommendation.plan.selectedSkills.includes('risk-check'));
  assert.equal(recommendation.validation.valid, true);
  assert.equal(stepOf(recommendation.run, 'query_products')?.status, 'SUCCESS');
  assert.equal(recommendation.final.riskResult.decision, 'allow');
  assert.equal(recommendation.run.evaluation.status, 'PASS');
  assert.ok(recommendation.run.steps.length >= 5);

  // 2. 价格场景：必须调用 calculate_price
  const price = await runAgent(
    '我买 3 份每日混合坚果，叠加满 99 减 20 和 SNACK20 优惠券，最后多少钱？',
  );
  const priceStep = stepOf(price.run, 'calculate_price');
  assert.equal(priceStep?.status, 'SUCCESS', '价格场景必须成功调用 calculate_price');
  assert.equal(priceStep.output.total, 79.7);
  assert.ok(price.run.finalReply.includes('79.70'));
  assert.equal(price.run.status, '成功');

  // 3. 订单 / 物流场景：必须调用对应 Tool
  const logistics = await runAgent('帮我查一下订单 SN202610170014 的物流到哪了？');
  assert.equal(stepOf(logistics.run, 'query_orders')?.status, 'SUCCESS');
  assert.equal(stepOf(logistics.run, 'query_logistics')?.status, 'SUCCESS');
  assert.ok(logistics.run.finalReply.includes('运输中'));
  assert.equal(logistics.run.status, '成功');

  // 4. 疑似中奖诈骗：风险识别与安全回复
  const fraud = await runAgent('收到短信说我中奖了，让我提供验证码并转账保证金，是真的吗？', 'classroom-fixture', 'workbench');
  assert.ok(fraud.final.riskResult.flags.includes('fraud_suspected'));
  assert.ok(fraud.final.finalReply.includes('不要转账'));
  assert.ok(fraud.final.finalReply.includes('官方渠道'));
  assert.equal(fraud.final.riskResult.handoffRequired, true);
  assert.equal(fraud.run.status, '转人工');

  // 4.1 否定过敏表达不能被 Planner 风险信号误判为必须转人工
  const noAllergy = await runAgent('无过敏');
  assert.notEqual(noAllergy.run.status, '转人工');
  assert.ok(!noAllergy.final.riskResult.handoffRequired);
  const noAllergyExplicit = await runAgent('我对花生不过敏');
  assert.notEqual(noAllergyExplicit.run.status, '转人工');
  assert.ok(!noAllergyExplicit.final.riskResult.handoffRequired);
  assert.ok(fraud.run.ticketId, '工作台转人工应自动生成工单');
  const ticketsAfterAuto = await requestJson('/api/tickets');
  assert.equal(ticketsAfterAuto.response.status, 200);
  const autoTicket = ticketsAfterAuto.payload.tickets.find((ticket) => ticket.id === fraud.run.ticketId);
  assert.ok(autoTicket, '自动工单必须存在');
  assert.equal(autoTicket.runId, fraud.run.id);
  assert.equal(autoTicket.source, 'workbench');
  assert.equal(autoTicket.priority, '紧急');
  assert.equal(autoTicket.reasonCode, 'fraud_suspected');
  assert.equal(autoTicket.suggestedQueue, '安全核验');
  assert.ok(autoTicket.userMessage.includes('中奖'));
  assert.ok(Array.isArray(autoTicket.knownFacts) && autoTicket.knownFacts.length > 0);
  assert.ok(Array.isArray(autoTicket.missingInfo));
  assert.ok(autoTicket.conversationHistory.some((item) => item.role === 'user' && item.content.includes('中奖')));
  assert.ok(autoTicket.conversationHistory.some((item) => item.role === 'assistant' && item.content.includes('不要转账')));

  // 5. 记录持久化
  const detail = await requestJson(`/api/runs/${recommendation.run.id}`);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.payload.run.status, '成功');
  assert.equal(detail.payload.run.id, recommendation.run.id);
  assert.ok(Array.isArray(detail.payload.annotations));

  // 6. 禁用必需 Skill 后不能伪装成功
  const disableRisk = await requestJson('/api/skills/risk-check', {
    method: 'PATCH',
    body: { enabled: false },
  });
  assert.equal(disableRisk.response.status, 200);
  const disabledRun = await runAgent('推荐一款低糖零食');
  assert.notEqual(disabledRun.run.status, '成功');
  assert.equal(disabledRun.run.errorCode, 'PLAN_VALIDATION_FAILED');
  assert.ok(
    disabledRun.validation.errors.some(
      (issue) =>
        issue.code === 'CAPABILITY_UNAVAILABLE' || issue.code === 'MANDATORY_SKILL_MISSING',
    ),
  );
  assert.equal(disabledRun.run.steps.length, 0);
  const restoreRisk = await requestJson('/api/skills/risk-check', {
    method: 'PATCH',
    body: { enabled: true },
  });
  assert.equal(restoreRisk.response.status, 200);

  // 7. Tool 错误必须进入 RunRecord ERROR Trace
  const toolError = await runAgent('查一下订单 SN999999999999 的物流状态。');
  assert.equal(toolError.run.status, '失败');
  assert.equal(toolError.run.errorCode, 'EXECUTION_ERROR');
  const errorSteps = toolError.run.steps.filter((step) => step.status === 'ERROR');
  assert.ok(errorSteps.length >= 2);
  assert.ok(errorSteps.some((step) => step.error?.includes('ORDER_NOT_FOUND')));
  assert.equal(toolError.run.evaluation.status, 'FAIL');

  const badCaseEvaluations = await requestJson('/api/annotations?status=evaluating');
  assert.equal(badCaseEvaluations.response.status, 200);
  assert.ok(
    badCaseEvaluations.payload.annotations.some(
      (item) => item.origin === 'bad-case' && item.runId === toolError.run.id,
    ),
    '失败 Run 必须进入人工评估队列',
  );

  // 7b. 失败 Tool 步骤可独立重试，重试结果写入同一 Trace；原 Run 状态不伪造成功
  const stepRetry = await requestJson(
    `/api/runs/${toolError.run.id}/steps/${encodeURIComponent(errorSteps[0].id)}/retry`,
    { method: 'POST' },
  );
  assert.equal(stepRetry.response.status, 200, JSON.stringify(stepRetry.payload));
  assert.equal(stepRetry.payload.step.status, 'ERROR');
  assert.equal(stepRetry.payload.run.steps.length, toolError.run.steps.length + 1);
  assert.equal(stepRetry.payload.run.status, '失败');

  // 7c. Agent 判断收尾，并保存评分；1 分进入改进队列
  const closing = await runAgent('谢谢，已经解决了。');
  assert.equal(closing.run.conversationEnded, true);
  assert.ok(closing.events.some((event) => event.type === 'final' && event.conversationEnded === true));
  const rating = await requestJson('/api/ratings', {
    method: 'POST',
    body: {
      runId: closing.run.id,
      conversationId: closing.run.conversationId,
      score: 1,
      question: '谢谢，已经解决了。',
    },
  });
  assert.equal(rating.response.status, 201, JSON.stringify(rating.payload));
  assert.equal(rating.payload.rating.score, 1);
  assert.ok(rating.payload.improvement);
  assert.equal(rating.payload.improvement.status, '待处理');
  const ratings = await requestJson('/api/ratings');
  assert.equal(ratings.response.status, 200);
  assert.ok(ratings.payload.ratings.some((item) => item.runId === closing.run.id));

  // 8. 真实 Provider 缺少配置时返回结构化错误，不降级
  const missingProvider = await requestJson('/api/agent/run', {
    method: 'POST',
    body: { userInput: '推荐一款零食', provider: 'openai-compatible', source: 'api' },
  });
  assert.equal(missingProvider.response.status, 503);
  assert.equal(missingProvider.payload.code, 'LLM_CONFIG_MISSING');
  assert.ok(missingProvider.payload.error.includes('classroom-fixture'));

  // 9. Planner 非法 JSON fallback 与独立 Validator 的价格 Tool 校验
  const probe = await requestJson('/api/agent-planner-probe', {
    method: 'POST',
    headers: { 'x-snackops-probe': token },
  });
  assert.equal(probe.response.status, 200);
  assert.ok(probe.payload.parseError);
  assert.equal(probe.payload.fallbackRequired, true);
  assert.ok(probe.payload.validatorCodes.includes('MISSING_PRICE_TOOL'));

  // 10. Retry / handoff / annotate / explain
  const retried = await requestJson('/api/run/retry', {
    method: 'POST',
    body: { runId: price.run.id, provider: 'classroom-fixture' },
  });
  assert.equal(retried.response.status, 200);
  assert.equal(retried.payload.run.retryOf, price.run.id);
  assert.equal(retried.payload.run.status, '成功');

  const annotation = await requestJson(`/api/runs/${retried.payload.run.id}/annotate`, {
    method: 'POST',
    body: { label: '验收标注', note: 'Agent 主链路端到端验收', annotator: '验收脚本' },
  });
  assert.equal(annotation.response.status, 200);
  assert.equal(annotation.payload.annotation.label, '验收标注');

  const handoff = await requestJson(`/api/runs/${retried.payload.run.id}/handoff`, {
    method: 'POST',
    body: { reason: '验收人工接管', by: '验收脚本' },
  });
  assert.equal(handoff.response.status, 200);
  assert.equal(handoff.payload.run.handoff.status, '已接管');
  assert.equal(handoff.payload.run.status, '转人工');
  assert.ok(handoff.payload.ticket, '人工接管必须返回工单');
  assert.equal(handoff.payload.ticket.runId, retried.payload.run.id);
  assert.equal(handoff.payload.ticket.reason, '验收人工接管');
  assert.ok(handoff.payload.ticket.conversationHistory.some((item) => item.role === 'user'));

  const explain = await requestJson('/api/explain', {
    method: 'POST',
    body: { runId: retried.payload.run.id },
  });
  assert.equal(explain.response.status, 200);
  assert.equal(explain.payload.runId, retried.payload.run.id);
  assert.ok(explain.payload.riskExplanation.length > 10);
  assert.ok(Array.isArray(explain.payload.evidence));

  const afterActions = await requestJson(`/api/runs/${retried.payload.run.id}`);
  assert.equal(afterActions.payload.annotations.length, 1);
  assert.equal(afterActions.payload.run.handoff.status, '已接管');

  // 11. 运营中心：低分评分、标注、导出、规则聚类、Prompt 草案与回滚
  const lowRating = await requestJson('/api/ratings', {
    method: 'POST',
    body: {
      runId: price.run.id,
      score: 1,
      comment: '运营中心验收低分',
      questionType: '价格优惠',
      source: 'ops',
    },
  });
  assert.equal(lowRating.response.status, 201, JSON.stringify(lowRating.payload));
  assert.equal(lowRating.payload.rating.score, 1);
  assert.equal(lowRating.payload.rating.question, price.run.question);
  assert.ok(lowRating.payload.rating.answer.length > 0);
  assert.ok(lowRating.payload.improvement);
  const lowImprovementId = lowRating.payload.improvement.id;
  const filteredRatings = await requestJson('/api/ratings?minScore=1&maxScore=1&questionType=' + encodeURIComponent('价格优惠'));
  assert.equal(filteredRatings.response.status, 200);
  assert.ok(filteredRatings.payload.ratings.some((item) => item.id === lowRating.payload.rating.id));

  const opsAnnotation = await requestJson('/api/annotations', {
    method: 'POST',
    body: {
      runId: price.run.id,
      target: 'reply',
      label: '运营验收标注',
      status: 'pending',
      correctness: 2,
      relevance: 4,
      completeness: 3,
      safety: 5,
      tone: 4,
      overall: 2,
      note: '价格解释需要更清楚',
      annotator: '验收脚本',
    },
  });
  assert.equal(opsAnnotation.response.status, 201, JSON.stringify(opsAnnotation.payload));
  const opsAnnotationId = opsAnnotation.payload.annotation.id;
  const annotationsAfterCreate = await requestJson('/api/annotations');
  assert.ok(annotationsAfterCreate.payload.annotations.some((item) => item.id === opsAnnotationId));
  const autoQueueItem = annotationsAfterCreate.payload.annotations.find(
    (item) => item.origin === 'low-rating' && item.sourceId === lowRating.payload.rating.id,
  );
  assert.ok(autoQueueItem, '低评分必须自动进入人工评估队列');
  assert.equal(autoQueueItem.status, 'evaluating');
  assert.equal(autoQueueItem.question, price.run.question);
  assert.ok(autoQueueItem.answer.length > 0);
  assert.equal(autoQueueItem.expectedReply, '');
  assert.ok(autoQueueItem.requiredCapabilities.length > 0);

  const savedEvaluation = await requestJson(`/api/annotations/${autoQueueItem.id}`, {
    method: 'PATCH',
    body: { status: 'pending', origin: 'low-rating-evaluation' },
  });
  assert.equal(savedEvaluation.response.status, 200);
  assert.equal(savedEvaluation.payload.annotation.status, 'pending');
  assert.equal(savedEvaluation.payload.annotation.origin, 'low-rating-evaluation');

  const enrichedAnnotation = await requestJson(`/api/annotations/${opsAnnotationId}`, {
    method: 'PATCH',
    body: {
      expectedReply: '应说明坚果单价、活动减免和优惠券减免，并提示以结算页为准。',
      intent: '价格优惠',
      riskLevel: 'low',
      qualityTags: ['价格不一致', '事实缺失'],
      requiredCapabilities: ['tool:query_products', 'tool:calculate_price'],
      expectedFacts: ['每日混合坚果 39.90 元', '合计 79.70 元'],
      forbiddenPhrases: ['保证最低价', '百分百'],
      failureReason: '模型没有把优惠明细说清楚',
      note: '人工复核价格解释',
      dimensionNotes: { correctness: '金额口径需统一', relevance: '问题相关', completeness: '缺少优惠明细' },
      correctness: 2,
      relevance: 4,
      completeness: 2,
      safety: 5,
      tone: 4,
      overall: 2,
    },
  });
  assert.equal(enrichedAnnotation.response.status, 200);
  assert.equal(enrichedAnnotation.payload.annotation.expectedReply.includes('结算页'), true);
  assert.deepEqual(enrichedAnnotation.payload.annotation.qualityTags, ['价格不一致', '事实缺失']);
  assert.equal(enrichedAnnotation.payload.annotation.dimensionNotes.completeness, '缺少优惠明细');

  const exportResponse = await fetch(`${baseUrl}/api/annotations/export`);
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get('content-type') || '', /text\/csv/);
  const csv = await exportResponse.text();
  assert.ok(csv.includes('correctness,relevance,completeness,safety,tone,overall'));
  assert.ok(csv.includes('运营验收标注'));
  assert.ok(csv.includes('验收脚本'));

  const jsonlResponse = await fetch(`${baseUrl}/api/annotations/export?format=jsonl&scope=review`);
  assert.equal(jsonlResponse.status, 200);
  assert.match(jsonlResponse.headers.get('content-type') || '', /ndjson/);
  const jsonl = await jsonlResponse.text();
  const jsonlLines = jsonl.trim().split('\n').filter(Boolean);
  assert.ok(jsonlLines.length > 0);
  const jsonlRecord = JSON.parse(jsonlLines[0]);
  assert.ok(jsonlRecord.runId);
  assert.ok(jsonlRecord.question);
  assert.ok('expectedReply' in jsonlRecord);
  assert.ok('qualityTags' in jsonlRecord);

  const imported = await requestJson('/api/annotations/import', {
    method: 'POST',
    body: {
      items: [
        {
          runId: price.run.id,
          question: price.run.question,
          answer: price.run.finalReply,
          expectedReply: '导入的期望回复：先核对价格明细，再提示以结算页为准。',
          qualityTags: ['导入'],
          requiredSkills: ['skill:need-extraction'],
          expectedToolFacts: ['计算后金额 79.70 元'],
          forbiddenPhrases: ['保证最低价'],
          failureReason: '导入 Bad Case 验收',
        },
      ],
    },
  });
  assert.equal(imported.response.status, 201);
  assert.equal(imported.payload.created, 1);
  const afterImport = await requestJson('/api/annotations?status=pending');
  assert.ok(afterImport.payload.annotations.some((item) => item.origin === 'bad-case-evaluation'));

  const prematurePromotion = await requestJson(`/api/annotations/${opsAnnotationId}/promote`, {
    method: 'POST',
    body: { target: 'improvement' },
  });
  assert.equal(prematurePromotion.response.status, 409);
  assert.equal(prematurePromotion.payload.code, 'ANNOTATION_NOT_ACCEPTED');
  const acceptedAnnotation = await requestJson(`/api/annotations/${opsAnnotationId}`, {
    method: 'PATCH',
    body: { status: 'accepted' },
  });
  assert.equal(acceptedAnnotation.response.status, 200);
  const promotedImprovement = await requestJson(`/api/annotations/${opsAnnotationId}/promote`, {
    method: 'POST',
    body: { target: 'improvement' },
  });
  assert.equal(promotedImprovement.response.status, 200);
  assert.equal(promotedImprovement.payload.annotation.status, 'accepted');
  const promotedEval = await requestJson(`/api/annotations/${opsAnnotationId}/promote`, {
    method: 'POST',
    body: { target: 'eval' },
  });
  assert.equal(promotedEval.response.status, 200);
  assert.ok(promotedEval.payload.evalCase.id.startsWith('eval-'));

  const improvementCenter = await requestJson('/api/improvements');
  assert.equal(improvementCenter.response.status, 200);
  assert.ok(improvementCenter.payload.clusters.some((cluster) => cluster.sourceType === 'low-rating' && cluster.ruleCluster === true));
  assert.ok(improvementCenter.payload.records.some((record) => record.id === lowImprovementId));

  const skillBefore = await requestJson('/api/skills/response-generator');
  assert.equal(skillBefore.response.status, 200);
  const originalHash = skillBefore.payload.skill.hash;
  const originalVersionId = (await requestJson('/api/skills/response-generator/versions')).payload.versions.find(
    (version) => version.status === '当前',
  ).id;

  const draft = await requestJson('/api/improvements/generate-prompt', {
    method: 'POST',
    body: { improvementId: lowImprovementId, skillId: 'response-generator' },
  });
  assert.equal(draft.response.status, 200, JSON.stringify(draft.payload));
  assert.equal(draft.payload.ruleBased, true);
  assert.ok(draft.payload.draftPrompt.includes('运营改进草案'));
  assert.ok(draft.payload.diff.some((line) => line.type === 'added'));
  const afterDraft = await requestJson('/api/skills/response-generator');
  assert.equal(afterDraft.payload.skill.hash, originalHash, '生成草案不得覆盖生产 Prompt');

  const applied = await requestJson('/api/improvements/apply-prompt', {
    method: 'POST',
    body: {
      improvementId: lowImprovementId,
      skillId: 'response-generator',
      draftPrompt: draft.payload.draftPrompt,
      changeNote: '运营验收：应用价格解释草案',
      expectedHash: draft.payload.currentHash,
    },
  });
  assert.equal(applied.response.status, 200, JSON.stringify(applied.payload));
  assert.notEqual(applied.payload.skill.hash, originalHash);
  assert.equal(applied.payload.improvement.status, '已完成');
  const versionsAfterApply = await requestJson('/api/skills/response-generator/versions');
  assert.ok(versionsAfterApply.payload.versions.some((version) => version.id === originalVersionId && version.status === '历史'));
  assert.ok(versionsAfterApply.payload.versions.some((version) => version.status === '当前' && version.version !== skillBefore.payload.skill.version));

  const rolledBack = await requestJson('/api/skills/response-generator/rollback', {
    method: 'POST',
    body: { versionId: originalVersionId, changeNote: '运营验收：恢复原正文' },
  });
  assert.equal(rolledBack.response.status, 200, JSON.stringify(rolledBack.payload));
  const afterRollback = await requestJson('/api/skills/response-generator');
  assert.equal(afterRollback.payload.skill.hash, originalHash);
  assert.equal(afterRollback.payload.skill.systemPrompt, skillBefore.payload.skill.systemPrompt);

  const abTest = await requestJson('/api/ab-tests', {
    method: 'POST',
    body: {
      name: '验收 A/B',
      skillId: 'response-generator',
      promptA: 'A 版本：先确认需求，再给出简洁推荐。',
      promptB: 'B 版本：先共情，再给出两条推荐理由。',
      trafficA: 30,
      trafficB: 70,
      enabledA: true,
      enabledB: true,
    },
  });
  assert.equal(abTest.response.status, 201);
  assert.equal(abTest.payload.abTest.status, '草稿');
  assert.equal(abTest.payload.abTest.skillId, 'response-generator');
  assert.ok(abTest.payload.abTest.promptB?.includes('共情'));
  assert.equal(abTest.payload.abTest.trafficA, 30);
  const abUpdated = await requestJson(`/api/ab-tests/${abTest.payload.abTest.id}`, {
    method: 'PATCH',
    body: { status: '运行中', trafficA: 40, trafficB: 60, enabledA: true, enabledB: false, promptB: 'B 版本：更新后的安抚式 Prompt。' },
  });
  assert.equal(abUpdated.response.status, 200);
  assert.equal(abUpdated.payload.abTest.status, '运行中');
  assert.equal(abUpdated.payload.abTest.enabledB, false);
  assert.equal(abUpdated.payload.abTest.trafficB, 60);
  assert.ok(abUpdated.payload.abTest.promptB?.includes('更新后'));

  // 12. Eval API：CRUD、从 Run 加入、真实 Run 评分、ERROR 与删除
  const evalOverview = await requestJson('/api/eval');
  assert.equal(evalOverview.response.status, 200);
  assert.ok(Array.isArray(evalOverview.payload.cases));
  assert.ok(Array.isArray(evalOverview.payload.batches));
  assert.ok(evalOverview.payload.skills.length > 0);
  assert.ok(evalOverview.payload.tools.length > 0);

  const evalCreated = await requestJson('/api/eval/cases', {
    method: 'POST',
    body: {
      name: '验收 Eval 价格用例',
      question: '我买 3 份每日混合坚果，叠加满 99 减 20 和 SNACK20 优惠券，最后多少钱？',
      scenario: '价格优惠',
      difficulty: 'hard',
      riskLevel: 'low',
      expectedKeywords: ['79.70'],
      keywordMode: 'AND',
      forbiddenWords: ['保证最低价'],
      expectedPrice: 79.7,
      requiredCapabilities: ['tool:calculate_price'],
      evalDimension: 'correctness',
      tags: ['验收'],
      enabled: true,
    },
  });
  assert.equal(evalCreated.response.status, 201, JSON.stringify(evalCreated.payload));
  const evalCaseId = evalCreated.payload.case.id;
  const evalScorePass = await requestJson('/api/eval/score', {
    method: 'POST',
    body: { caseId: evalCaseId, runId: price.run.id },
  });
  assert.equal(evalScorePass.response.status, 200, JSON.stringify(evalScorePass.payload));
  assert.equal(evalScorePass.payload.score.status, 'PASS');
  assert.equal(evalScorePass.payload.score.runId, price.run.id);
  assert.ok(evalScorePass.payload.score.keywordHits.includes('79.70'));

  await requestJson(`/api/eval/cases/${evalCaseId}`, {
    method: 'PATCH',
    body: { expectedKeywords: ['89.70'] },
  });
  const evalScoreFail = await requestJson('/api/eval/score', {
    method: 'POST',
    body: { caseId: evalCaseId, runId: price.run.id },
  });
  assert.equal(evalScoreFail.response.status, 200);
  assert.equal(evalScoreFail.payload.score.status, 'FAIL');
  assert.ok(evalScoreFail.payload.score.keywordMisses.includes('89.70'));

  const evalErrorScore = await requestJson('/api/eval/score', {
    method: 'POST',
    body: { caseId: evalCaseId, runId: toolError.run.id },
  });
  assert.equal(evalErrorScore.response.status, 200);
  assert.equal(evalErrorScore.payload.score.status, 'ERROR');
  assert.notEqual(evalErrorScore.payload.score.status, 'FAIL');

  const evalCopied = await requestJson(`/api/eval/cases/${evalCaseId}/copy`, { method: 'POST' });
  assert.equal(evalCopied.response.status, 201);
  assert.equal(evalCopied.payload.case.enabled, false);
  const evalFromRun = await requestJson('/api/eval/from-run', {
    method: 'POST',
    body: { runId: recommendation.run.id },
  });
  assert.equal(evalFromRun.response.status, 201);
  assert.equal(evalFromRun.payload.case.sourceRunId, recommendation.run.id);
  const evalDisabled = await requestJson(`/api/eval/cases/${evalCaseId}`, {
    method: 'PATCH',
    body: { enabled: false },
  });
  assert.equal(evalDisabled.response.status, 200);
  assert.equal(evalDisabled.payload.case.enabled, false);
  const evalDeleted = await requestJson(`/api/eval/cases/${evalCaseId}`, { method: 'DELETE' });
  assert.equal(evalDeleted.response.status, 200);
  const evalAfterDelete = await requestJson('/api/eval');
  assert.ok(!evalAfterDelete.payload.cases.some((item) => item.id === evalCaseId));

  // 13. 批量评测：实际 Agent 执行、轮询终态、caseIds 限制、错误校验
  const batchCreate = await requestJson('/api/eval/batch/run', {
    method: 'POST',
    body: {
      caseIds: ['eval-001', 'eval-003', 'eval-005'],
      name: '验收批量评测',
      versionLabel: 'baseline-v1',
      changeNote: '三用例真实 Agent 批次',
    },
  });
  assert.equal(batchCreate.response.status, 202, JSON.stringify(batchCreate.payload));
  assert.equal(batchCreate.payload.batch.total, 3);
  assert.deepEqual(batchCreate.payload.batch.caseIds.sort(), ['eval-001', 'eval-003', 'eval-005']);
  let batchView = batchCreate.payload.batch;
  for (let index = 0; index < 80; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const current = await requestJson(`/api/eval/batch/${batchCreate.payload.batchId}`);
    assert.equal(current.response.status, 200);
    batchView = current.payload.batch;
    if (['done', 'error', 'cancelled'].includes(batchView.status)) break;
  }
  assert.equal(batchView.status, 'done', JSON.stringify(batchView));
  assert.equal(batchView.total, 3);
  assert.equal(batchView.caseResults.length, 3);
  assert.deepEqual(
    batchView.caseResults.map((item) => item.caseId).sort(),
    ['eval-001', 'eval-003', 'eval-005'],
  );
  assert.equal(
    batchView.passed + batchView.failed + batchView.review + batchView.errors,
    batchView.total,
  );
  assert.ok(batchView.caseResults.every((item) => item.runId));
  assert.ok(batchView.caseSetHash);
  assert.ok(batchView.evaluatorHash);

  const emptyBatch = await requestJson('/api/eval/batch/run', {
    method: 'POST',
    body: { caseIds: [] },
  });
  assert.equal(emptyBatch.response.status, 400);
  assert.equal(emptyBatch.payload.code, 'EMPTY_CASE_IDS');
  const invalidBatch = await requestJson('/api/eval/batch/run', {
    method: 'POST',
    body: { caseIds: ['eval-001', 'not-real'] },
  });
  assert.equal(invalidBatch.response.status, 400);
  assert.equal(invalidBatch.payload.code, 'INVALID_CASE_IDS');
  const missingBatch = await requestJson('/api/eval/batch/not-real');
  assert.equal(missingBatch.response.status, 404);
  assert.equal(missingBatch.payload.code, 'EVAL_BATCH_NOT_FOUND');

  // 14. 重启后 RunRecord 仍存在
  await stopServer();
  await startServer();
  const afterRestart = await requestJson(`/api/runs/${recommendation.run.id}`);
  assert.equal(afterRestart.response.status, 200);
  assert.equal(afterRestart.payload.run.question, recommendation.run.question);

  console.log(
    JSON.stringify(
      {
        result: 'PASS',
        recommendationStatus: recommendation.run.status,
        recommendationSteps: recommendation.run.steps.length,
        priceToolStatus: priceStep.status,
        priceTotal: priceStep.output.total,
        logisticsTools: ['query_orders', 'query_logistics'],
        fraudRiskFlags: fraud.final.riskResult.flags,
        fraudHandoffRequired: fraud.final.riskResult.handoffRequired,
        disabledSkillStatus: disabledRun.run.status,
        disabledSkillErrors: disabledRun.validation.errors.map((issue) => issue.code),
        toolErrorStatus: toolError.run.status,
        toolErrorSteps: errorSteps.map((step) => step.capabilityId),
        stepRetryStatus: stepRetry.payload.step.status,
        stepRetryTraceAdded: stepRetry.payload.run.steps.length > toolError.run.steps.length,
        conversationEnded: closing.run.conversationEnded,
        ratingSaved: true,
        badCaseQueued: Boolean(rating.payload.improvement),
        badCaseEvaluationQueued: badCaseEvaluations.payload.annotations.some((item) => item.origin === 'bad-case' && item.runId === toolError.run.id),
        providerConfigError: missingProvider.payload.code,
        plannerFallback: probe.payload.fallbackRequired,
        validatorPriceCode: probe.payload.validatorCodes.includes('MISSING_PRICE_TOOL'),
        retryOf: retried.payload.run.retryOf,
        annotationSaved: true,
        handoffSaved: handoff.payload.run.handoff.status,
        explainEvidenceCount: explain.payload.evidence.length,
        lowRatingImprovement: Boolean(lowImprovementId),
        annotationExportBytes: csv.length,
        autoAnnotationQueue: Boolean(autoQueueItem),
        annotationFieldsSaved: enrichedAnnotation.payload.annotation.qualityTags.length === 2,
        evaluationSavedAsAnnotation: savedEvaluation.payload.annotation.status === 'pending',
        jsonlExportLines: jsonlLines.length,
        importedBadCases: imported.payload.created,
        promoteRequiresAccepted: prematurePromotion.response.status === 409,
        annotationPromoted: promotedEval.payload.evalCase.id,
        ruleClusters: improvementCenter.payload.clusters.length,
        promptDraftRuleBased: draft.payload.ruleBased,
        promptUnchangedUntilApply: afterDraft.payload.skill.hash === originalHash,
        versionSnapshotCreated: versionsAfterApply.payload.versions.length > 1,
        rollbackRestoredPrompt: afterRollback.payload.skill.hash === originalHash,
        abTestStatus: abUpdated.payload.abTest.status,
        abSkillBound: abTest.payload.abTest.skillId === 'response-generator',
        abTrafficUpdated: abUpdated.payload.abTest.trafficB === 60,
        evalScorePass: evalScorePass.payload.score.status,
        evalScoreChangesAfterKeywords: evalScoreFail.payload.score.status === 'FAIL',
        evalErrorStatus: evalErrorScore.payload.score.status,
        evalFromRunSource: evalFromRun.payload.case.sourceRunId === recommendation.run.id,
        evalDeleted: !evalAfterDelete.payload.cases.some((item) => item.id === evalCaseId),
        autoTicketCreated: Boolean(fraud.run.ticketId),
        autoTicketReason: autoTicket.reasonCode,
        autoTicketConversation: autoTicket.conversationHistory.length,
        manualTicketCreated: Boolean(handoff.payload.ticket),
        batchStatus: batchView.status,
        batchTotal: batchView.total,
        batchCaseCount: batchView.caseResults.length,
        batchCountSum: batchView.passed + batchView.failed + batchView.review + batchView.errors,
        persistedAfterRestart: true,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error('\n--- Agent 测试服务日志（末尾）---\n');
  console.error(serverLog);
  throw error;
} finally {
  await stopServer();
  if (routeCreated) {
    await rm(routeDirectory, { recursive: true, force: true });
  }
  await rm('.next-agent-test', { recursive: true, force: true });
  await rm(tempRoot, { recursive: true, force: true });
}
