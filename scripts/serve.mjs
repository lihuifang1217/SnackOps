import { spawn } from 'node:child_process';

const mode = process.argv[2];
const port = process.env.DEPLOY_RUN_PORT || '5000';
const numericPort = Number(port);

if (!['dev', 'start'].includes(mode)) {
  console.error('用法：node scripts/serve.mjs <dev|start>');
  process.exit(1);
}

if (!/^\d+$/.test(port) || !Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
  console.error('DEPLOY_RUN_PORT 必须是 1–65535 之间的整数');
  process.exit(1);
}

const nextBin = 'node_modules/next/dist/bin/next';
const args = [
  nextBin,
  mode,
  ...(mode === 'dev' ? ['--webpack'] : []),
  '--hostname',
  '0.0.0.0',
  '--port',
  port,
];

console.log(`SnackOps ${mode} 启动中，端口 ${port}${mode === 'start' ? '（生产模式）' : ''}`);

const child = spawn(process.execPath, args, {
  stdio: 'inherit',
  env: process.env,
});

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
  console.error('无法启动 Next.js 进程：', error.message);
  process.exit(1);
});
