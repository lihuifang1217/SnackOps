import { randomUUID } from 'node:crypto';
import { AppError } from '@/lib/errors';

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function assertSemver(version: string): string {
  if (!SEMVER_PATTERN.test(version)) {
    throw new AppError(400, 'INVALID_VERSION', '版本号必须符合 semver，例如 1.0.0');
  }
  return version;
}

export function nextPatchVersion(version: string): string {
  const [, major, minor, patch] = assertSemver(version).match(SEMVER_PATTERN) as RegExpMatchArray;
  return `${major}.${minor}.${Number(patch) + 1}`;
}

export function createVersionId(): string {
  return `ver-${Date.now()}-${randomUUID().slice(0, 8)}`;
}
