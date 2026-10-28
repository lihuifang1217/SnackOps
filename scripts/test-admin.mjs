import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  cp,
  mkdtemp,
  rm,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const port = process.env.ADMIN_TEST_PORT || '5332';
const tempRoot = await mkdtemp(path.join(tmpdir(), 'snackops-admin-'));
const dataDir = path.join(tempRoot, 'data');
const skillsDir = path.join(tempRoot, 'skills');
const baseUrl = `http://127.0.0.1:${port}`;
const testDist = path.resolve('.next-admin-test');
const suffix = randomUUID().slice(0, 7);

let server;
let serverLog = '';

function collectServerOutput(stream) {
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    serverLog += chunk;
    if (serverLog.length > 40000) serverLog = serverLog.slice(-40000);
  });
}

async function startServer() {
  server = spawn(process.execPath, ['scripts/serve.mjs', 'dev'], {
    env: {
      ...process.env,
      DEPLOY_RUN_PORT: port,
      SNACKOPS_DATA_DIR: dataDir,
      SNACKOPS_SKILLS_DIR: skillsDir,
      SNACKOPS_TEST_DIST_DIR: '.next-admin-test',
      NEXT_TELEMETRY_DISABLED: '1',
      // 用不可达的假 Provider 验证真实失败路径，不接触外部网络或真实密钥。
      OPENAI_API_KEY: 'test-smoke-key-not-real',
      OPENAI_BASE_URL: 'http://127.0.0.1:9/v1',
      LLM_MODEL: '',
      LLM_PROVIDER: '',
      COZE_API_TOKEN: '',
      COZE_WORKLOAD_IDENTITY_API_KEY: '',
      COZE_CODING_API_KEY: '',
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
      // 服务仍在启动或编译。
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

async function api(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(120000),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { response, payload };
}

async function fileExists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function runAgentRaw(userInput, provider = 'auto') {
  const response = await fetch(`${baseUrl}/api/agent/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ userInput, provider, source: 'api' }),
    signal: AbortSignal.timeout(120000),
  });
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
  return {
    status: response.status,
    events,
    run: events.find((event) => event.type === 'done')?.run ?? null,
    errorEvent: events.find((event) => event.type === 'error') ?? null,
  };
}

const skillId = `admin-skill-${suffix}`;
const skillName = `管理验收技能 ${suffix}`;
const draftSkillId = `ai-draft-${suffix}`;

try {
  await cp(path.resolve('data'), dataDir, { recursive: true });
  await cp(path.resolve('skills'), skillsDir, { recursive: true });
  await startServer();

  const health = await api('/api/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.payload.datasetCount, 25);

  // 业务数据目录：物流移除，卡片数据带原始记录
  const overview = await api('/api/catalog');
  assert.equal(overview.response.status, 200);
  assert.equal(overview.payload.types.length, 9);
  assert.equal(overview.payload.types.some((item) => item.type === 'logistics'), false);
  assert.equal(
    overview.payload.types.filter((item) => item.editable).length,
    6,
  );
  assert.equal(await fileExists(path.join(dataDir, 'logistics.json')), false);

  const productId = `prod-admin-${suffix}`;
  const productPayload = {
    id: productId,
    name: '验收测试坚果',
    description: '由管理验收脚本创建的测试商品。',
    category: '坚果',
    flavor: '原味',
    price: 19.9,
    stock: 10,
    status: '在售',
    tags: ['验收'],
    ingredients: ['核桃仁'],
    allergens: ['核桃'],
    mayContain: ['花生'],
    nutrition: {
      basis: '每100g',
      energyKcal: 500,
      proteinG: 16,
      fatG: 42,
      carbohydrateG: 20,
      sugarG: 4,
      sodiumMg: 12,
    },
    shelfLifeDays: 180,
  };

  const createdProduct = await api('/api/catalog/products', {
    method: 'POST',
    body: productPayload,
  });
  assert.equal(createdProduct.response.status, 201);
  assert.equal(createdProduct.payload.record.name, '验收测试坚果');

  const duplicateProduct = await api('/api/catalog/products', {
    method: 'POST',
    body: productPayload,
  });
  assert.equal(duplicateProduct.response.status, 409);

  const productsAfterCreate = await api('/api/catalog/products');
  const createdSummary = productsAfterCreate.payload.records.find((item) => item.id === productId);
  assert.ok(createdSummary);
  assert.ok(createdSummary.data && createdSummary.data.id === productId);

  const updatedProduct = await api(`/api/catalog/products/${encodeURIComponent(productId)}`, {
    method: 'PUT',
    body: { ...productPayload, name: '验收测试坚果（已编辑）' },
  });
  assert.equal(updatedProduct.response.status, 200);
  assert.equal(updatedProduct.payload.record.name, '验收测试坚果（已编辑）');

  const deleteProduct = await api(`/api/catalog/products/${encodeURIComponent(productId)}`, {
    method: 'DELETE',
  });
  assert.equal(deleteProduct.response.status, 200);
  const productsAfterDelete = await api('/api/catalog/products');
  assert.equal(productsAfterDelete.payload.records.some((item) => item.id === productId), false);

  const readOnlyOrder = await api('/api/catalog/orders', {
    method: 'POST',
    body: {},
  });
  assert.equal(readOnlyOrder.response.status, 403);

  // Tool 元数据、名称/描述修改、完整配置和真实数据测试
  const toolsBefore = await api('/api/tools');
  assert.equal(toolsBefore.response.status, 200);
  const queryProducts = toolsBefore.payload.tools.find((tool) => tool.id === 'query_products');
  assert.ok(queryProducts.executionMode.includes('只读'));
  assert.ok(queryProducts.implementationPath.includes('tools/implementations.ts'));
  assert.ok(queryProducts.dataSources.includes('data/products.json'));
  assert.ok(queryProducts.fullConfig);
  assert.equal(queryProducts.readOnly, true);

  const updatedTool = await api('/api/tools/query_products', {
    method: 'PATCH',
    body: {
      name: `商品查询（验收 ${suffix}）`,
      description: '验收脚本修改后的工具能力描述。',
    },
  });
  assert.equal(updatedTool.response.status, 200);
  assert.equal(updatedTool.payload.tool.fullConfig.name, `商品查询（验收 ${suffix}）`);

  const registryAfterToolUpdate = await api('/api/registry');
  const registryTool = registryAfterToolUpdate.payload.tools.find((tool) => tool.id === 'query_products');
  assert.equal(registryTool.name, `商品查询（验收 ${suffix}）`);
  assert.equal(registryTool.description, '验收脚本修改后的工具能力描述。');

  const toolTest = await api('/api/tools/query_products/test', {
    method: 'POST',
    body: { keyword: '坚果', onlyInStock: true, limit: 5 },
  });
  assert.equal(toolTest.response.status, 200);
  assert.ok(toolTest.payload.output.items.length > 0);

  // AI 草案：不保存，返回结构、触发场景和校验结果
  const skillsBeforeDraft = await api('/api/skills');
  const draftResponse = await api('/api/skills/draft', {
    method: 'POST',
    body: {
      description: '当用户询问订单缺件或破损时，判断是否符合补发条件，并给出安全处理建议。',
    },
  });
  assert.equal(draftResponse.response.status, 200, JSON.stringify(draftResponse.payload));
  assert.ok(draftResponse.payload.draft.systemPrompt.includes('## 触发场景'));
  assert.ok(draftResponse.payload.draft.triggerScenarios.length > 0);
  assert.equal(draftResponse.payload.validation.valid, true, JSON.stringify(draftResponse.payload.validation));
  assert.equal(draftResponse.payload.isDemo, true);
  const skillsAfterDraft = await api('/api/skills');
  assert.equal(skillsAfterDraft.payload.total, skillsBeforeDraft.payload.total);
  assert.ok(
    draftResponse.payload.draft.requiredTools.includes('query_orders'),
    `AI 草案应推断订单工具：${draftResponse.payload.draft.requiredTools}`,
  );

  const draft = draftResponse.payload.draft;
  const createFromDraft = await api(`/api/skills`, {
    method: 'POST',
    body: {
      id: draftSkillId,
      name: `AI 缺件处理 ${suffix}`,
      description: draft.description,
      category: draft.category,
      model: draft.model,
      temperature: draft.temperature,
      maxTokens: draft.maxTokens,
      requiredTools: draft.requiredTools,
      systemPrompt: draft.systemPrompt,
      enabled: true,
    },
  });
  assert.equal(createFromDraft.response.status, 201, JSON.stringify(createFromDraft.payload));
  assert.equal(createFromDraft.payload.skill.version, '1.0.0');

  // 手动创建 Skill：文件、初始快照、名称修改、diff、启用列表
  const skillPrompt = `# ${skillName}

## 触发场景
- 管理验收脚本触发的自定义技能。

## 指令
1. 阅读用户输入。
2. 输出一段结构化的验收结果。

## 输出要求
- 只输出验收结果。

## 安全边界
- 不编造订单或价格。`;
  const createSkill = await api('/api/skills', {
    method: 'POST',
    body: {
      id: skillId,
      name: skillName,
      description: '用于验证 Skill 创建、快照和单项测试的管理验收技能。',
      category: '验收',
      model: 'snackops-fixture-v1',
      temperature: 0.2,
      maxTokens: 1200,
      requiredTools: [],
      systemPrompt: skillPrompt,
      enabled: true,
    },
  });
  assert.equal(createSkill.response.status, 201, JSON.stringify(createSkill.payload));
  assert.equal(createSkill.payload.skill.name, skillName);
  assert.equal(createSkill.payload.skill.version, '1.0.0');
  assert.equal(await fileExists(path.join(skillsDir, skillId, 'SKILL.md')), true);

  const initialVersions = await api(`/api/skills/${encodeURIComponent(skillId)}/versions`);
  assert.equal(initialVersions.payload.versions.length, 1);
  assert.equal(initialVersions.payload.versions[0].status, '当前');

  const enabledBeforeDisable = await api('/api/skills?enabled=true');
  assert.ok(enabledBeforeDisable.payload.skills.some((skill) => skill.id === skillId));

  const fileResponse = await api(`/api/skills/${encodeURIComponent(skillId)}/file`);
  assert.equal(fileResponse.response.status, 200);
  assert.ok(fileResponse.payload.content.includes('## 触发场景'));

  const updatedSkill = await api(`/api/skills/${encodeURIComponent(skillId)}`, {
    method: 'PUT',
    body: {
      name: `${skillName}（改名）`,
      description: '名称和提示词已更新的管理验收技能。',
      model: 'snackops-fixture-v1',
      temperature: 0.3,
      maxTokens: 1400,
      requiredTools: [],
      systemPrompt: `${skillPrompt}\n\n## 修订\n- 管理验收脚本追加一行，用于产生 diff。`,
      changeNote: '验收：修改名称和提示词',
      expectedHash: createSkill.payload.skill.hash,
    },
  });
  assert.equal(updatedSkill.response.status, 200, JSON.stringify(updatedSkill.payload));
  assert.equal(updatedSkill.payload.skill.version, '1.0.1');

  const versionsAfterUpdate = await api(`/api/skills/${encodeURIComponent(skillId)}/versions`);
  assert.equal(versionsAfterUpdate.payload.versions.length, 2);
  assert.ok(versionsAfterUpdate.payload.versions.some((version) => version.status === '当前'));
  assert.ok(versionsAfterUpdate.payload.versions.some((version) => version.status === '历史'));

  const oldVersion = versionsAfterUpdate.payload.versions.find((version) => version.status === '历史');
  const diff = await api(
    `/api/skills/${encodeURIComponent(skillId)}/diff?from=${encodeURIComponent(oldVersion.id)}&to=current`,
  );
  assert.equal(diff.response.status, 200);
  assert.ok(diff.payload.stats.added > 0);
  const versionSnapshot = await api(
    `/api/skills/${encodeURIComponent(skillId)}/versions/${encodeURIComponent(oldVersion.id)}`,
  );
  assert.equal(versionSnapshot.response.status, 200);
  assert.ok(versionSnapshot.payload.version.systemPrompt.includes('## 触发场景'));

  const registryAfterSkill = await api('/api/registry');
  const registrySkill = registryAfterSkill.payload.skills.find((skill) => skill.id === skillId);
  assert.equal(registrySkill.name, `${skillName}（改名）`);

  const pathTraversal = await api('/api/skills', {
    method: 'POST',
    body: {
      id: '../../evil',
      name: `非法路径 ${suffix}`,
      description: '路径穿越测试',
      category: '验收',
      model: 'snackops-fixture-v1',
      temperature: 0.2,
      maxTokens: 1000,
      requiredTools: [],
      systemPrompt: '# 非法\n\n## 指令\n- 不应写入。',
    },
  });
  assert.equal(pathTraversal.response.status, 400);

  await api(`/api/skills/${encodeURIComponent(skillId)}`, {
    method: 'PATCH',
    body: { enabled: false },
  });
  const enabledAfterDisable = await api('/api/skills?enabled=true');
  assert.equal(enabledAfterDisable.payload.skills.some((skill) => skill.id === skillId), false);

  // 单项 Skill 测试：无依赖成功，有依赖成功，依赖停用时明确 ERROR
  const manualTest = await api(`/api/skills/${encodeURIComponent(skillId)}/test`, {
    method: 'POST',
    body: { sampleInput: '请执行一次管理验收。' },
  });
  assert.equal(manualTest.response.status, 200, JSON.stringify(manualTest.payload));
  assert.equal(manualTest.payload.test.status, 'SUCCESS', JSON.stringify(manualTest.payload.test));
  assert.equal(manualTest.payload.test.provider, 'classroom-fixture');

  const recommendationTest = await api('/api/skills/recommendation-decision/test', {
    method: 'POST',
    body: { sampleInput: '给同事买点不辣的办公室零食，预算 100 元以内。' },
  });
  assert.equal(recommendationTest.response.status, 200, JSON.stringify(recommendationTest.payload));
  assert.equal(recommendationTest.payload.test.status, 'SUCCESS', JSON.stringify(recommendationTest.payload.test));
  assert.equal(recommendationTest.payload.test.toolRuns.length, 3);
  assert.ok(recommendationTest.payload.test.toolRuns.every((run) => run.status === 'SUCCESS'));

  await api('/api/tools/query_orders', {
    method: 'PATCH',
    body: { enabled: false },
  });
  const missingDependency = await api('/api/skills/after-sales-classification/test', {
    method: 'POST',
    body: { sampleInput: '我的订单 SN202610170014 少发了一件。' },
  });
  assert.equal(missingDependency.response.status, 200);
  assert.equal(missingDependency.payload.test.status, 'ERROR');
  assert.ok(missingDependency.payload.test.error.includes('已停用'), JSON.stringify(missingDependency.payload.test));
  assert.equal(missingDependency.payload.config.valid, false);
  assert.ok(
    missingDependency.payload.test.dependencies.some(
      (dependency) => dependency.toolId === 'query_orders' && dependency.status === 'DISABLED',
    ),
  );
  await api('/api/tools/query_orders', {
    method: 'PATCH',
    body: { enabled: true },
  });

  const testHistory = await api(`/api/skills/${encodeURIComponent(skillId)}/test`);
  assert.equal(testHistory.response.status, 200);
  assert.ok(testHistory.payload.tests.length >= 1);
  assert.ok(testHistory.payload.tests[0].input.includes('管理验收'));

  // Planner 管理与预览：真实读取配置，预览不创建 RunRecord
  const plannerOverview = await api('/api/planner');
  assert.equal(plannerOverview.response.status, 200, JSON.stringify(plannerOverview.payload));
  assert.ok(plannerOverview.payload.plannerVersion);
  assert.ok(plannerOverview.payload.prompt.includes('你是 SnackOps'));
  assert.ok(plannerOverview.payload.skills.length >= 14);
  assert.ok(plannerOverview.payload.tools.length >= 6);

  const configuredPrompt = `${plannerOverview.payload.config.systemPrompt}\n\n## 管理验收配置\n- 这条内容证明 Planner System Prompt 来自管理配置。`;
  const configuredRequiredSkills = [
    ...plannerOverview.payload.config.requiredSkills,
    'conversation-summary',
  ];
  const savedPlannerConfig = await api('/api/planner', {
    method: 'PUT',
    body: {
      model: 'provider-default',
      temperature: 0.23,
      maxTokens: 2000,
      systemPrompt: configuredPrompt,
      requiredSkills: configuredRequiredSkills,
      baseTools: plannerOverview.payload.config.baseTools,
      priceTools: plannerOverview.payload.config.priceTools,
    },
  });
  assert.equal(savedPlannerConfig.response.status, 200, JSON.stringify(savedPlannerConfig.payload));
  assert.equal(savedPlannerConfig.payload.config.temperature, 0.23);
  assert.ok(savedPlannerConfig.payload.config.systemPrompt.includes('管理验收配置'));
  assert.ok(savedPlannerConfig.payload.config.requiredSkills.includes('conversation-summary'));
  assert.equal(savedPlannerConfig.payload.config.model, 'provider-default');
  const plannerAfterConfig = await api('/api/planner');
  assert.equal(plannerAfterConfig.payload.config.maxTokens, 2000);
  assert.ok(plannerAfterConfig.payload.config.systemPrompt.includes('管理验收配置'));
  assert.ok(plannerAfterConfig.payload.prompt.includes('管理验收配置'));

  const enabledSkillIds = plannerOverview.payload.skills
    .filter((skill) => skill.enabled)
    .map((skill) => skill.id);
  const enabledToolIds = plannerOverview.payload.tools
    .filter((tool) => tool.enabled)
    .map((tool) => tool.id);
  const runsBeforePlanner = await api('/api/runs');
  const plannerPreview = await api('/api/planner/preview', {
    method: 'POST',
    body: {
      userInput: '给同事买点不辣的办公室零食，预算 100 元以内。',
      skillIds: enabledSkillIds,
      toolIds: enabledToolIds,
      mandatoryCapabilities: [],
    },
  });
  assert.equal(plannerPreview.response.status, 200, JSON.stringify(plannerPreview.payload));
  assert.equal(plannerPreview.payload.validation.valid, true, JSON.stringify(plannerPreview.payload.validation));
  assert.ok(plannerPreview.payload.plan.selectedSkills.includes('recommendation-decision'));
  assert.ok(plannerPreview.payload.plan.selectedSkills.includes('conversation-summary'));
  assert.ok(plannerPreview.payload.plan.selectedTools.includes('query_products'));
  assert.ok(plannerPreview.payload.plan.reasoning.length > 0);
  assert.equal(plannerPreview.payload.provider, 'classroom-fixture');
  const runsAfterPlanner = await api('/api/runs');
  assert.equal(runsAfterPlanner.payload.total, runsBeforePlanner.payload.total);

  await api('/api/skills/recommendation-decision', {
    method: 'PATCH',
    body: { enabled: false },
  });
  const disabledPlannerOverview = await api('/api/planner');
  assert.equal(
    disabledPlannerOverview.payload.skills.find((skill) => skill.id === 'recommendation-decision').enabled,
    false,
  );
  const disabledPreview = await api('/api/planner/preview', {
    method: 'POST',
    body: { userInput: '给同事买点不辣的办公室零食，预算 100 元以内。' },
  });
  assert.equal(disabledPreview.response.status, 200);
  assert.equal(disabledPreview.payload.validation.valid, false);
  assert.ok(
    disabledPreview.payload.validation.errors.some(
      (issue) => issue.code === 'CAPABILITY_UNAVAILABLE' || issue.code === 'MANDATORY_SKILL_MISSING',
    ),
    JSON.stringify(disabledPreview.payload.validation),
  );
  await api('/api/skills/recommendation-decision', {
    method: 'PATCH',
    body: { enabled: true },
  });

  const invalidMandatoryPreview = await api('/api/planner/preview', {
    method: 'POST',
    body: {
      userInput: '给同事买点不辣的办公室零食，预算 100 元以内。',
      mandatoryCapabilities: ['skill:does-not-exist'],
    },
  });
  assert.equal(invalidMandatoryPreview.response.status, 200);
  assert.equal(invalidMandatoryPreview.payload.validation.valid, false);
  assert.ok(
    invalidMandatoryPreview.payload.validation.errors.some(
      (issue) => issue.code === 'CAPABILITY_UNAVAILABLE',
    ),
  );

  // Planner 价格 Tool 配置真实影响预览可用 Tool
  const reducedPriceTools = plannerAfterConfig.payload.config.priceTools.filter(
    (id) => id !== 'query_activities',
  );
  await api('/api/planner', {
    method: 'PUT',
    body: {
      model: plannerAfterConfig.payload.config.model,
      temperature: plannerAfterConfig.payload.config.temperature,
      maxTokens: plannerAfterConfig.payload.config.maxTokens,
      systemPrompt: plannerAfterConfig.payload.config.systemPrompt,
      requiredSkills: plannerAfterConfig.payload.config.requiredSkills,
      baseTools: plannerAfterConfig.payload.config.baseTools,
      priceTools: reducedPriceTools,
    },
  });
  const restrictedToolPreview = await api('/api/planner/preview', {
    method: 'POST',
    body: {
      userInput: '我买 3 份每日混合坚果，叠加满 99 减 20 和 SNACK20 优惠券，最后多少钱？',
    },
  });
  assert.equal(restrictedToolPreview.response.status, 200);
  assert.equal(restrictedToolPreview.payload.validation.valid, false);
  assert.ok(
    restrictedToolPreview.payload.validation.errors.some(
      (issue) => issue.code === 'CAPABILITY_UNAVAILABLE' || issue.code === 'MANDATORY_TOOL_MISSING',
    ),
    JSON.stringify(restrictedToolPreview.payload.validation),
  );
  await api('/api/planner', {
    method: 'PUT',
    body: {
      model: plannerAfterConfig.payload.config.model,
      temperature: plannerAfterConfig.payload.config.temperature,
      maxTokens: plannerAfterConfig.payload.config.maxTokens,
      systemPrompt: plannerAfterConfig.payload.config.systemPrompt,
      requiredSkills: plannerAfterConfig.payload.config.requiredSkills,
      baseTools: plannerAfterConfig.payload.config.baseTools,
      priceTools: plannerAfterConfig.payload.config.priceTools,
    },
  });

  // 模型管理：测试、切换、缺配置失败、密钥不回显
  const llmBefore = await api('/api/llm-config');
  assert.equal(llmBefore.response.status, 200, JSON.stringify(llmBefore.payload));
  assert.equal(llmBefore.payload.providers.length, 3);
  assert.equal(llmBefore.payload.current.provider, 'classroom-fixture');
  assert.equal(llmBefore.payload.mode, 'demo');
  assert.equal(JSON.stringify(llmBefore.payload).includes('test-smoke-key-not-real'), false);
  const openAiProvider = llmBefore.payload.providers.find((item) => item.id === 'openai-compatible');
  assert.ok(openAiProvider.env.some((item) => item.key === 'OPENAI_API_KEY' && item.configured));

  const fixtureConnection = await api('/api/llm-config/test', {
    method: 'POST',
    body: { provider: 'classroom-fixture' },
  });
  assert.equal(fixtureConnection.response.status, 200, JSON.stringify(fixtureConnection.payload));
  assert.equal(fixtureConnection.payload.isDemo, true);
  const openAiConnection = await api('/api/llm-config/test', {
    method: 'POST',
    body: { provider: 'openai-compatible', model: 'gpt-4o-mini' },
  });
  assert.equal(openAiConnection.response.status, 502, JSON.stringify(openAiConnection.payload));
  assert.ok(['LLM_UPSTREAM_ERROR', 'LLM_TIMEOUT'].includes(openAiConnection.payload.code));
  assert.equal(JSON.stringify(openAiConnection.payload).includes('test-smoke-key-not-real'), false);

  const cozeSwitch = await api('/api/llm-config/switch', {
    method: 'POST',
    body: { provider: 'coze' },
  });
  assert.equal(cozeSwitch.response.status, 503, JSON.stringify(cozeSwitch.payload));
  assert.equal(cozeSwitch.payload.code, 'LLM_CONFIG_MISSING');

  const switchFixture = await api('/api/llm-config/switch', {
    method: 'POST',
    body: { provider: 'classroom-fixture' },
  });
  assert.equal(switchFixture.response.status, 200, JSON.stringify(switchFixture.payload));
  assert.equal(switchFixture.payload.config.managed, true);
  assert.equal(switchFixture.payload.current.provider, 'classroom-fixture');

  const putLlmConfig = await api('/api/llm-config', {
    method: 'PUT',
    body: { temperature: 0.25, maxTokens: 1500 },
  });
  assert.equal(putLlmConfig.response.status, 200, JSON.stringify(putLlmConfig.payload));
  assert.equal(putLlmConfig.payload.config.temperature, 0.25);
  assert.equal(putLlmConfig.payload.config.maxTokens, 1500);

  const switchOpenAi = await api('/api/llm-config/switch', {
    method: 'POST',
    body: { provider: 'openai-compatible', model: 'gpt-4o-mini' },
  });
  assert.equal(switchOpenAi.response.status, 200, JSON.stringify(switchOpenAi.payload));
  assert.equal(switchOpenAi.payload.current.provider, 'openai-compatible');

  const failedProviderRun = await runAgentRaw('用不可达的 Provider 运行失败路径。', 'auto');
  assert.equal(failedProviderRun.status, 200, JSON.stringify(failedProviderRun.errorEvent));
  assert.ok(failedProviderRun.run);
  assert.equal(failedProviderRun.run.provider, 'openai-compatible');
  assert.equal(failedProviderRun.run.status, '失败');

  const switchBackFixture = await api('/api/llm-config/switch', {
    method: 'POST',
    body: { provider: 'classroom-fixture' },
  });
  assert.equal(switchBackFixture.response.status, 200);
  const fixtureRun = await runAgentRaw('给同事买点不辣的办公室零食，预算 100 元以内。', 'auto');
  assert.equal(fixtureRun.status, 200, JSON.stringify(fixtureRun.errorEvent));
  assert.ok(fixtureRun.run);
  assert.equal(fixtureRun.run.provider, 'classroom-fixture');
  assert.equal(fixtureRun.run.status, '成功');

  console.log(JSON.stringify({
    result: 'PASS',
    catalogTypes: overview.payload.types.length,
    editableCatalogTypes: overview.payload.types.filter((item) => item.editable).length,
    catalogCrud: true,
    logisticsRemoved: true,
    aiDraftValid: draftResponse.payload.validation.valid,
    aiDraftTools: draftResponse.payload.draft.requiredTools,
    createdDraftSkill: createFromDraft.payload.skill.id,
    createdSkill: skillId,
    initialVersion: createSkill.payload.skill.version,
    updatedVersion: updatedSkill.payload.skill.version,
    versionCount: versionsAfterUpdate.payload.versions.length,
    diffAdded: diff.payload.stats.added,
    skillFileRead: true,
    skillTestStatus: manualTest.payload.test.status,
    dependencyTestStatus: missingDependency.payload.test.status,
    toolMetadataUpdated: true,
    toolTestItems: toolTest.payload.output.items.length,
    pathTraversalRejected: pathTraversal.response.status,
    enabledListExcludesDisabled: true,
    plannerVersion: plannerOverview.payload.plannerVersion,
    plannerPromptConfigurable: plannerAfterConfig.payload.config.systemPrompt.includes('管理验收配置'),
    plannerRequiredSkillApplied: plannerPreview.payload.plan.selectedSkills.includes('conversation-summary'),
    plannerModelConfig: plannerAfterConfig.payload.config.model,
    plannerPreviewValid: plannerPreview.payload.validation.valid,
    plannerDisabledValidation: disabledPreview.payload.validation.valid,
    plannerNoRunCreated: runsAfterPlanner.payload.total === runsBeforePlanner.payload.total,
    plannerToolScopeAffectsPreview: restrictedToolPreview.payload.validation.valid === false,
    modelProviders: llmBefore.payload.providers.length,
    modelFixtureTest: fixtureConnection.payload.isDemo,
    modelRealFailureCode: openAiConnection.payload.code,
    modelMissingCode: cozeSwitch.payload.code,
    providerSwitchAffectsRun: failedProviderRun.run.provider,
    providerSwitchBack: fixtureRun.run.provider,
  }, null, 2));
} catch (error) {
  console.error(error);
  console.error('\n--- 测试服务日志（末尾）---\n');
  console.error(serverLog.slice(-12000));
  process.exitCode = 1;
} finally {
  await stopServer();
  await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  await rm(testDist, { recursive: true, force: true }).catch(() => undefined);
  if (server?.exitCode === null) server.kill('SIGKILL');
}
