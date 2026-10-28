import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const port = process.env.REGISTRY_TEST_PORT || '5331';
const token = randomUUID();
const tempRoot = await mkdtemp(path.join(tmpdir(), 'snackops-registry-'));
const dataDir = path.join(tempRoot, 'data');
const skillsDir = path.join(tempRoot, 'skills');
const routeDirectory = path.resolve('src/app/api/registry-probe');
const routeFile = path.join(routeDirectory, 'route.ts');
const baseUrl = `http://127.0.0.1:${port}`;

let server;
let serverLog = '';
let routeCreated = false;

function collectServerOutput(stream) {
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    serverLog += chunk;
    if (serverLog.length > 30000) serverLog = serverLog.slice(-30000);
  });
}

async function startServer() {
  server = spawn(process.execPath, ['scripts/serve.mjs', 'dev'], {
    env: {
      ...process.env,
      DEPLOY_RUN_PORT: port,
      SNACKOPS_DATA_DIR: dataDir,
      SNACKOPS_SKILLS_DIR: skillsDir,
      SNACKOPS_TEST_DIST_DIR: '.next-registry-test',
      SNACKOPS_REGISTRY_TEST_TOKEN: token,
      NEXT_TELEMETRY_DISABLED: '1',
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
      // 开发服务器仍在启动或编译。
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
      ...(options.headers || {}),
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

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

try {
  await cp(path.resolve('data'), dataDir, { recursive: true });
  await cp(path.resolve('skills'), skillsDir, { recursive: true });
  await mkdir(routeDirectory);
  routeCreated = true;
  await writeFile(
    routeFile,
    await readFile('scripts/fixtures/registry-probe-route.txt', 'utf8'),
  );

  await startServer();

  // 启用能力入口
  const registry = await api('/api/registry');
  assert.equal(registry.response.status, 200);
  assert.equal(registry.payload.skills.length, 14, '注册中心应返回 14 个启用 Skill');
  assert.equal(registry.payload.tools.length, 6, '注册中心应返回 6 个启用 Tool');
  assert.ok(registry.payload.skills.every((skill) => skill.systemPrompt.length > 100));
  assert.ok(
    registry.payload.tools.every(
      (tool) => tool.inputSchema.type === 'object' && tool.outputSchema.type === 'object',
    ),
  );

  const list = await api('/api/skills?enabled=true');
  assert.equal(list.response.status, 200);
  assert.equal(list.payload.skills.length, 14);

  // 禁用 Skill 后从启用列表和 Planner 能力入口消失
  const disabled = await api('/api/skills/need-extraction', {
    method: 'PATCH',
    body: { enabled: false },
  });
  assert.equal(disabled.response.status, 200);
  assert.equal(disabled.payload.skill.enabled, false);

  const disabledRegistry = await api('/api/registry');
  assert.equal(disabledRegistry.payload.skills.length, 13);
  assert.ok(!disabledRegistry.payload.skills.some((skill) => skill.id === 'need-extraction'));
  const disabledList = await api('/api/skills?enabled=true');
  assert.ok(!disabledList.payload.skills.some((skill) => skill.id === 'need-extraction'));

  const enabledAgain = await api('/api/skills/need-extraction', {
    method: 'PATCH',
    body: { enabled: true },
  });
  assert.equal(enabledAgain.response.status, 200);
  assert.equal(enabledAgain.payload.skill.enabled, true);

  // Tool 真实数据测试
  const products = await api('/api/tools/query_products/test', {
    method: 'POST',
    body: { keyword: '坚果', onlyInStock: true, limit: 5 },
  });
  assert.equal(products.response.status, 200);
  assert.ok(products.payload.output.items.some((product) => product.id === 'prod-01'));
  assert.ok(products.payload.output.items[0].nutrition.sugarG >= 0);

  const pricing = await api('/api/tools/calculate_price/test', {
    method: 'POST',
    body: {
      items: [{ productId: 'prod-01', quantity: 3 }],
      activityId: 'act-01',
      couponCode: 'SNACK20',
      userId: 'user-01',
    },
  });
  assert.equal(pricing.response.status, 200);
  assert.equal(pricing.payload.output.subtotal, 119.7);
  assert.equal(pricing.payload.output.activityDiscount, 20);
  assert.equal(pricing.payload.output.couponDiscount, 20);
  assert.equal(pricing.payload.output.total, 79.7);

  const orders = await api('/api/tools/query_orders/test', {
    method: 'POST',
    body: { orderNo: 'SN202610180001' },
  });
  assert.equal(orders.response.status, 200);
  assert.equal(orders.payload.output.items[0].userName, '林小满');

  const logistics = await api('/api/tools/query_logistics/test', {
    method: 'POST',
    body: { orderNo: 'SN202610170014' },
  });
  assert.equal(logistics.response.status, 200);
  assert.equal(logistics.payload.output.items[0].carrier, '顺丰速运');
  assert.equal(logistics.payload.output.items[0].status, '运输中');

  const activities = await api('/api/tools/query_activities/test', {
    method: 'POST',
    body: { activeOnly: true, limit: 10 },
  });
  assert.equal(activities.response.status, 200);
  assert.ok(activities.payload.output.items.some((activity) => activity.id === 'act-01'));

  const coupons = await api('/api/tools/query_coupons/test', {
    method: 'POST',
    body: { subtotal: 119.7, userId: 'user-04', onlyApplicable: true },
  });
  assert.equal(coupons.response.status, 200);
  assert.ok(coupons.payload.output.items.some((coupon) => coupon.code === 'HELLO10'));

  // 停用 Tool 后不可执行，并恢复
  const toolDisabled = await api('/api/tools/query_products', {
    method: 'PATCH',
    body: { enabled: false },
  });
  assert.equal(toolDisabled.response.status, 200);
  const toolDisabledRegistry = await api('/api/registry');
  assert.ok(!toolDisabledRegistry.payload.tools.some((tool) => tool.id === 'query_products'));
  const blockedTool = await api('/api/tools/query_products/test', {
    method: 'POST',
    body: { keyword: '坚果' },
  });
  assert.equal(blockedTool.response.status, 409);
  assert.equal(blockedTool.payload.code, 'TOOL_DISABLED');
  const toolRestored = await api('/api/tools/query_products', {
    method: 'PATCH',
    body: { enabled: true },
  });
  assert.equal(toolRestored.response.status, 200);
  assert.equal(toolRestored.payload.tool.enabled, true);

  // 保存 Skill 版本、自动快照与 diff
  const detailBefore = await api('/api/skills/need-extraction');
  assert.equal(detailBefore.response.status, 200);
  const before = detailBefore.payload.skill;
  const initialVersions = await api('/api/skills/need-extraction/versions');
  assert.ok(initialVersions.payload.versions.length >= 1);
  const oldSnapshot = initialVersions.payload.versions.find(
    (version) => version.version === before.version && version.hash === before.hash,
  );
  assert.ok(oldSnapshot, '初始化版本快照应存在');

  const marker = `\n\n## 验收追加 ${Date.now()}\n这是版本保存验收追加的安全提示行。\n`;
  const saved = await api('/api/skills/need-extraction', {
    method: 'PUT',
    body: {
      description: before.description,
      model: before.model,
      temperature: before.temperature,
      maxTokens: before.maxTokens,
      requiredTools: before.requiredTools,
      systemPrompt: `${before.systemPrompt}${marker}`,
      changeNote: '验收：追加安全提示行',
      expectedHash: before.hash,
    },
  });
  assert.equal(saved.response.status, 200);
  assert.notEqual(saved.payload.skill.version, before.version);
  assert.notEqual(saved.payload.skill.hash, before.hash);

  const detailAfter = await api('/api/skills/need-extraction');
  assert.equal(detailAfter.payload.skill.version, saved.payload.skill.version);
  assert.ok(detailAfter.payload.skill.systemPrompt.includes('验收追加'));

  const versionsAfter = await api('/api/skills/need-extraction/versions');
  const currentSnapshot = versionsAfter.payload.versions.find(
    (version) => version.status === '当前' && version.version === saved.payload.skill.version,
  );
  const oldHistorical = versionsAfter.payload.versions.find(
    (version) => version.id === oldSnapshot.id,
  );
  assert.ok(currentSnapshot, '保存后应生成当前版本快照');
  assert.ok(oldHistorical, '修改前快照应继续保留');
  assert.equal(oldHistorical.status, '历史', '修改前快照应被标记为历史');

  const oldVersionContent = await api(
    `/api/skills/need-extraction/versions/${oldSnapshot.id}`,
  );
  assert.equal(oldVersionContent.response.status, 200);
  assert.ok(!oldVersionContent.payload.version.systemPrompt.includes('验收追加'));

  const diff = await api(
    `/api/skills/need-extraction/diff?from=${oldSnapshot.id}&to=current`,
  );
  assert.equal(diff.response.status, 200);
  assert.ok(diff.payload.stats.added > 0, 'diff 应包含新增行');

  const skillFile = await readFile(
    path.join(skillsDir, 'need-extraction', 'SKILL.md'),
    'utf8',
  );
  assert.ok(skillFile.includes('验收追加'));
  const persistedVersions = JSON.parse(
    await readFile(path.join(dataDir, 'skill-versions.json'), 'utf8'),
  );
  assert.ok(
    persistedVersions.some(
      (version) =>
        version.skillId === 'need-extraction' &&
        version.status === '当前' &&
        version.version === saved.payload.skill.version,
    ),
  );

  // 旧 expectedHash 必须拒绝覆盖
  const staleSave = await api('/api/skills/need-extraction', {
    method: 'PUT',
    body: {
      description: before.description,
      model: before.model,
      temperature: before.temperature,
      maxTokens: before.maxTokens,
      requiredTools: before.requiredTools,
      systemPrompt: `${before.systemPrompt}\n并发覆盖测试`,
      changeNote: '并发覆盖测试',
      expectedHash: before.hash,
    },
  });
  assert.equal(staleSave.response.status, 409);
  assert.equal(staleSave.payload.code, 'REVISION_CONFLICT');

  // 路径穿越必须被服务层拒绝
  const traversal = await api('/api/registry-probe', {
    method: 'POST',
    headers: { 'x-snackops-probe': token },
  });
  assert.equal(traversal.response.status, 400);
  assert.equal(traversal.payload.rejected, true);
  assert.equal(traversal.payload.code, 'INVALID_SKILL_ID');
  assert.equal(await exists(path.join(tempRoot, 'outside')), false);

  const encodedTraversal = await api(
    `/api/skills/${encodeURIComponent('../../outside')}`,
    {
      method: 'PATCH',
      body: { enabled: false },
    },
  );
  assert.ok(encodedTraversal.response.status >= 400);

  const injectedPath = await api('/api/skills/need-extraction', {
    method: 'PUT',
    body: {
      description: before.description,
      model: before.model,
      temperature: before.temperature,
      maxTokens: before.maxTokens,
      requiredTools: before.requiredTools,
      systemPrompt: `${before.systemPrompt}\n路径字段注入测试`,
      changeNote: '路径字段注入测试',
      expectedHash: saved.payload.skill.hash,
      filePath: '../../outside/SKILL.md',
    },
  });
  assert.equal(injectedPath.response.status, 400);
  assert.equal(injectedPath.payload.code, 'VALIDATION_FAILED');
  assert.equal(await exists(path.join(tempRoot, 'outside')), false);

  // 业务目录
  const catalog = await api('/api/catalog');
  assert.equal(catalog.response.status, 200);
  assert.equal(catalog.payload.types.length, 9);
  const catalogProducts = await api('/api/catalog/products');
  assert.equal(catalogProducts.response.status, 200);
  assert.equal(catalogProducts.payload.records.length, 6);
  assert.ok(catalogProducts.payload.records[0].meta.some((item) => item.label === '糖分'));

  // 重启服务后数据仍然存在，模拟刷新/重启后的持久性
  await stopServer();
  await startServer();
  const afterRestart = await api('/api/skills/need-extraction');
  assert.equal(afterRestart.response.status, 200);
  assert.equal(afterRestart.payload.skill.version, saved.payload.skill.version);
  assert.ok(afterRestart.payload.skill.systemPrompt.includes('验收追加'));

  console.log(
    JSON.stringify(
      {
        result: 'PASS',
        enabledSkills: registry.payload.skills.length,
        enabledTools: registry.payload.tools.length,
        skillDisableRemovedFromRegistry: true,
        toolRealDataResults: {
          query_products: products.payload.output.total,
          calculate_price_total: pricing.payload.output.total,
          query_orders: orders.payload.output.total,
          query_logistics: logistics.payload.output.total,
          query_activities: activities.payload.output.total,
          query_coupons: coupons.payload.output.total,
        },
        toolDisableBlockedExecution: true,
        savedVersion: saved.payload.skill.version,
        historicalSnapshot: oldHistorical.version,
        diffAddedLines: diff.payload.stats.added,
        staleRevisionRejected: true,
        pathTraversalRejected: traversal.payload.code,
        filePathInjectionRejected: injectedPath.payload.code,
        catalogTypes: catalog.payload.types.length,
        persistedAfterRestart: true,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error('\n--- 测试服务日志（末尾）---\n');
  console.error(serverLog);
  throw error;
} finally {
  await stopServer();
  if (routeCreated) {
    await rm(routeDirectory, { recursive: true, force: true });
  }
  await rm('.next-registry-test', { recursive: true, force: true });
  await rm(tempRoot, { recursive: true, force: true });
}
