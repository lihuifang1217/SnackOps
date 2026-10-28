import 'server-only';

import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '@/lib/errors';
import { getProjectRoot } from '@/lib/store';
import type { Skill } from '@/lib/schemas';

const SKILL_ID_PATTERN = /^[\p{L}\p{N}_-]{1,80}$/u;

export function normalizePrompt(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();
}

export function getSkillsRoot(): string {
  const configured = process.env.SNACKOPS_SKILLS_DIR?.trim();
  if (!configured) return path.join(getProjectRoot(), 'skills');
  if (path.isAbsolute(configured)) return path.normalize(configured);
  return path.resolve(getProjectRoot(), configured);
}

export function validateSkillId(skillId: string): string {
  if (
    !SKILL_ID_PATTERN.test(skillId) ||
    skillId.includes('..') ||
    skillId.includes('/') ||
    skillId.includes('\\') ||
    skillId.includes('\0')
  ) {
    throw new AppError(400, 'INVALID_SKILL_ID', 'Skill id 不合法，不能包含路径分隔符或 ..');
  }
  return skillId;
}

export function canonicalSkillFilePath(skillId: string): string {
  validateSkillId(skillId);
  return `skills/${skillId}/SKILL.md`;
}

function assertInside(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AppError(400, 'UNSAFE_SKILL_PATH', 'Skill 文件路径必须位于 skills 目录内');
  }
}

async function assertSafeDirectory(directory: string): Promise<void> {
  try {
    const info = await lstat(directory);
    if (info.isSymbolicLink()) {
      throw new AppError(400, 'UNSAFE_SKILL_PATH', 'Skill 目录不能是符号链接');
    }
    if (!info.isDirectory()) {
      throw new AppError(400, 'UNSAFE_SKILL_PATH', 'Skill 目录类型不合法');
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return;
    throw error;
  }
}

export function resolveSkillPromptPath(skill: Pick<Skill, 'id' | 'filePath'>): string {
  validateSkillId(skill.id);
  const expected = canonicalSkillFilePath(skill.id);
  if (skill.filePath !== expected) {
    throw new AppError(
      400,
      'UNSAFE_SKILL_PATH',
      `Skill 文件路径与注册信息不一致，期望 ${expected}`,
    );
  }

  const root = path.resolve(getSkillsRoot());
  const target = path.resolve(root, skill.id, 'SKILL.md');
  assertInside(root, target);
  return target;
}

export async function readSkillPrompt(skill: Pick<Skill, 'id' | 'filePath'>): Promise<string> {
  const filePath = resolveSkillPromptPath(skill);
  let info;
  try {
    info = await lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new AppError(500, 'SKILL_FILE_MISSING', 'Skill 提示词文件不存在');
    }
    throw error;
  }

  if (info.isSymbolicLink()) {
    throw new AppError(400, 'UNSAFE_SKILL_PATH', 'Skill 提示词不能是符号链接');
  }
  if (!info.isFile()) {
    throw new AppError(500, 'SKILL_FILE_INVALID', 'Skill 提示词路径不是普通文件');
  }

  const content = normalizePrompt(await readFile(filePath, 'utf8'));
  if (!content) {
    throw new AppError(500, 'SKILL_FILE_EMPTY', 'Skill 提示词文件为空');
  }
  return content;
}

export async function writeSkillPrompt(
  skill: Pick<Skill, 'id' | 'filePath'>,
  content: string,
): Promise<void> {
  const filePath = resolveSkillPromptPath(skill);
  const normalized = normalizePrompt(content);
  if (!normalized) {
    throw new AppError(400, 'INVALID_SKILL_PROMPT', 'Skill 提示词不能为空');
  }

  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  await assertSafeDirectory(directory);

  const temporaryPath = path.join(
    directory,
    `.SKILL.md.${process.pid}.${randomUUID()}.tmp`,
  );

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(`${normalized}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, filePath);

    try {
      const directoryHandle = await open(directory, 'r');
      await directoryHandle.sync();
      await directoryHandle.close();
    } catch {
      // 目录 fsync 不是所有文件系统都支持，rename 仍是原子提交点。
    }
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => undefined);
    }
    await unlink(temporaryPath).catch(() => undefined);
    if (error instanceof AppError) throw error;
    throw new AppError(500, 'SKILL_FILE_WRITE_FAILED', 'Skill 提示词写入失败，旧文件保持不变');
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}
