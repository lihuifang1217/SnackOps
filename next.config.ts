import type { NextConfig } from 'next';

const storeTestBuild = process.env.SNACKOPS_STORE_TEST_BUILD === '1';
const isolatedTestBuild = process.env.SNACKOPS_TEST_DIST_DIR?.trim();
const allowedTestBuildDirs = new Set([
  '.next-store-test',
  '.next-registry-test',
  '.next-agent-test',
  '.next-admin-test',
]);

if (isolatedTestBuild && !allowedTestBuildDirs.has(isolatedTestBuild)) {
  throw new Error('SNACKOPS_TEST_DIST_DIR 只支持已登记的隔离构建目录');
}

const distDir = isolatedTestBuild || (storeTestBuild ? '.next-store-test' : undefined);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  serverExternalPackages: ['coze-coding-dev-sdk'],
  // 隔离测试使用独立构建目录，避免测试期间的路由类型污染正式构建。
  ...(distDir ? { distDir } : {}),
};

export default nextConfig;
