import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmod,
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

const port = process.env.STORE_TEST_PORT || '5321';
const token = randomUUID();
const isolatedData = await mkdtemp(path.join(tmpdir(), 'snackops-store-'));
const routeDirectory = path.resolve('src/app/api/store-probe');
const routeFile = path.join(routeDirectory, 'route.ts');
const probeFile = path.join(isolatedData, 'probe.json');
const baseUrl = `http://127.0.0.1:${port}/api/store-probe`;

let server;
let serverLog = '';
let routeCreated = false;

function collectServerOutput(stream) {
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    serverLog += chunk;
    if (serverLog.length > 20000) serverLog = serverLog.slice(-20000);
  });
}

async function request(method, body, options = {}) {
  const headers = {
    Accept: 'application/json',
    ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    ...(options.authorized === false ? {} : { 'x-snackops-probe': token }),
  };
  const response = await fetch(baseUrl, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { response, payload };
}

async function waitUntilReady() {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`测试服务提前退出（退出码 ${server.exitCode}）\n${serverLog}`);
    }

    try {
      const { response } = await request('POST', { action: 'ping' });
      if (response.status === 200) return;
    } catch {
      // 开发服务器仍在启动或编译路由。
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`临时测试服务未能启动\n${serverLog}`);
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

try {
  await cp(path.resolve('data'), isolatedData, { recursive: true });
  await mkdir(routeDirectory);
  routeCreated = true;
  await writeFile(
    routeFile,
    await readFile('scripts/fixtures/store-probe-route.txt', 'utf8'),
  );

  server = spawn(process.execPath, ['scripts/serve.mjs', 'dev'], {
    env: {
      ...process.env,
      DEPLOY_RUN_PORT: port,
      SNACKOPS_DATA_DIR: isolatedData,
      SNACKOPS_STORE_TEST_TOKEN: token,
      SNACKOPS_STORE_TEST_BUILD: '1',
      SNACKOPS_TEST_DIST_DIR: '.next-store-test',
      NEXT_TELEMETRY_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  collectServerOutput(server.stdout);
  collectServerOutput(server.stderr);

  await waitUntilReady();

  const unauthorized = await request('GET', undefined, { authorized: false });
  assert.equal(unauthorized.response.status, 404, '缺少测试令牌时必须返回 404');

  const seeds = await request('POST', { action: 'validate-seeds' });
  assert.equal(seeds.response.status, 200, '预置数据应全部通过 schema 校验');
  assert.equal(seeds.payload.validated, 25, '应校验 25 份数据集合');

  const initialized = await request('POST', { action: 'init' });
  assert.equal(initialized.response.status, 200);

  const before = await request('GET');
  assert.equal(before.response.status, 200);
  assert.equal(before.payload.size, 32768);
  assert.equal(before.payload.count, 0);

  let reading = true;
  let snapshots = 0;
  const reader = (async () => {
    while (reading) {
      const { response, payload } = await request('GET');
      assert.equal(response.status, 200);
      assert.equal(payload.size, 32768, '并发读取不得看到半截 JSON');
      assert.ok(Number.isInteger(payload.count));
      snapshots += 1;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  })();

  try {
    const updates = await Promise.all(
      Array.from({ length: 40 }, () => request('POST', { action: 'increment' })),
    );
    assert.ok(updates.every(({ response }) => response.status === 200));
    const counts = updates.map(({ payload }) => payload.count);
    assert.equal(new Set(counts).size, 40, '40 次并发更新必须逐次递增，不能丢失');
  } finally {
    reading = false;
    await reader;
  }

  const after = await request('GET');
  assert.equal(after.payload.count, 40);
  assert.notEqual(after.payload.inode, before.payload.inode, '写入必须通过 rename 替换文件');
  assert.deepEqual(after.payload.temporaryFiles, []);

  const stableBytes = await readFile(probeFile, 'utf8');
  const invalid = await request('POST', { action: 'invalid' });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.payload.code, 'INVALID_DATA');
  assert.equal(await readFile(probeFile, 'utf8'), stableBytes, '校验失败不得改动旧数据');

  await chmod(isolatedData, 0o500);
  let writeFailure;
  try {
    writeFailure = await request('POST', { action: 'increment' });
  } finally {
    await chmod(isolatedData, 0o700);
  }
  assert.equal(writeFailure.response.status, 500);
  assert.equal(writeFailure.payload.code, 'WRITE_FAILED');
  assert.equal(await readFile(probeFile, 'utf8'), stableBytes, '真实写入失败后旧文件必须完整保留');

  const afterFailure = await request('GET');
  assert.equal(afterFailure.payload.count, 40);
  assert.deepEqual(afterFailure.payload.temporaryFiles, [], '写入失败后不得遗留临时文件');

  const incrementAfterFailure = await request('POST', { action: 'increment' });
  assert.equal(incrementAfterFailure.response.status, 200);
  assert.equal(incrementAfterFailure.payload.count, 41, '写入失败后必须释放文件锁');

  const final = await request('GET');
  assert.deepEqual(final.payload.temporaryFiles, []);
  assert.equal((await stat(probeFile)).size > 0, true);

  console.log(
    JSON.stringify(
      {
        result: 'PASS',
        validatedSeedFiles: seeds.payload.validated,        concurrentUpdates: 40,
        finalCount: final.payload.count,
        concurrentReadSnapshots: snapshots,
        atomicRenameInodeChanged: true,
        validationRollbackPreservedBytes: true,
        filesystemWriteFailureRollback: true,
        lockReleasedAfterFailure: true,
        temporaryFilesLeft: 0,
        unauthorizedStatus: 404,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error('\n--- 临时测试服务日志（末尾）---\n');
  console.error(serverLog);
  throw error;
} finally {
  await stopServer();
  if (routeCreated) {
    await rm(routeDirectory, { recursive: true, force: true });
  }
  await chmod(isolatedData, 0o700).catch(() => undefined);
  await rm(isolatedData, { recursive: true, force: true });
  await rm('.next-store-test', { recursive: true, force: true });
}
