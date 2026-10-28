#!/usr/bin/env node
/**
 * 托管部署启动脚本：缺少生产构建时先构建，再以单端口对外提供服务。
 *
 * 用于 WorkBuddy 应用发布等只注入 PORT 的环境；本地开发仍使用
 * `pnpm dev` / `pnpm start`，行为不受影响。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const nextBin = path.join('node_modules', 'next', 'dist', 'bin', 'next');
const rawPort = process.env.PORT || process.env.DEPLOY_RUN_PORT || '3000';
const numericPort = Number(rawPort);

if (!/^\d+$/.test(rawPort) || !Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
  console.error('PORT / DEPLOY_RUN_PORT 必须是 1–65535 之间的整数');
  process.exit(1);
}

if (!existsSync('node_modules/next/dist/bin/next')) {
  console.error('未找到 next 依赖，请先执行 pnpm install');
  process.exit(1);
}

if (!existsSync('.next/BUILD_ID')) {
  console.log('[deploy-start] 未检测到生产构建，开始执行 next build…');
  const build = spawnSync(process.execPath, [nextBin, 'build', '--webpack'], {
    stdio: 'inherit',
    env: process.env,
  });
  if (build.status !== 0) {
    console.error('[deploy-start] 构建失败，终止启动');
    process.exit(build.status ?? 1);
  }
}

console.log(`[deploy-start] 启动生产服务，端口 ${rawPort}`);
const child = spawn(
  process.execPath,
  [nextBin, 'start', '--hostname', '0.0.0.0', '--port', rawPort],
  { stdio: 'inherit', env: process.env },
);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error('[deploy-start] 无法启动 Next.js 进程：', error.message);
  process.exit(1);
});
