import 'server-only';

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { z } from 'zod';
import {
  collectionSchemas,
  type CollectionData,
  type CollectionName,
} from './schemas';

const globalState = globalThis as typeof globalThis & {
  __snackopsFileLocks?: Map<string, Promise<void>>;
};

const fileLocks = (globalState.__snackopsFileLocks ??= new Map());

const SAFE_JSON_FILE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.json$/;

export type StoreErrorCode =
  | 'INVALID_FILE_NAME'
  | 'NOT_FOUND'
  | 'READ_FAILED'
  | 'INVALID_JSON'
  | 'INVALID_DATA'
  | 'WRITE_FAILED';

export class StoreError extends Error {
  readonly code: StoreErrorCode;

  constructor(code: StoreErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'StoreError';
    this.code = code;
  }
}

function findProjectRoot(start = process.cwd()): string {
  let current = path.resolve(start);

  for (;;) {
    const packagePath = path.join(current, 'package.json');
    if (existsSync(packagePath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
          name?: string;
        };
        if (packageJson.name === 'snackops') return current;
      } catch {
        // 继续向上查找，由具体读取失败给出可诊断的错误。
      }
    }

    const parent = path.dirname(current);
    if (parent === current) return path.resolve(start);
    current = parent;
  }
}

export function getProjectRoot(): string {
  return findProjectRoot();
}

/**
 * 数据目录优先使用 SNACKOPS_DATA_DIR；相对路径基于项目根目录解析。
 * 默认始终指向项目根目录下的 data/，不依赖启动参数中的偶然当前目录。
 */
export function getDataDirectory(): string {
  const configured = process.env.SNACKOPS_DATA_DIR?.trim();
  if (!configured) return path.join(findProjectRoot(), 'data');
  if (path.isAbsolute(configured)) return path.normalize(configured);
  return path.resolve(findProjectRoot(), configured);
}

function resolveJsonFile(name: string): string {
  const fileName = name.endsWith('.json') ? name : `${name}.json`;
  if (
    !SAFE_JSON_FILE.test(fileName) ||
    path.basename(fileName) !== fileName ||
    fileName.includes('..')
  ) {
    throw new StoreError('INVALID_FILE_NAME', '数据文件名不合法');
  }

  const directory = path.resolve(getDataDirectory());
  const target = path.resolve(directory, fileName);
  if (path.dirname(target) !== directory) {
    throw new StoreError('INVALID_FILE_NAME', '数据文件必须位于数据目录内');
  }
  return target;
}

/**
 * 同一进程内按绝对文件路径串行化完整的读 → 改 → 写流程。
 * 锁队列保存在 globalThis，开发热更新后不会出现两套锁。
 */
async function withFileLock<T>(filePath: string, task: () => Promise<T>): Promise<T> {
  const previous = fileLocks.get(filePath) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => gate);
  fileLocks.set(filePath, queued);

  await previous;

  try {
    return await task();
  } finally {
    release();
    if (fileLocks.get(filePath) === queued) {
      fileLocks.delete(filePath);
    }
  }
}

async function readAndValidate<T>(filePath: string, schema: z.ZodType<T>): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new StoreError('NOT_FOUND', `数据文件 ${path.basename(filePath)} 不存在`, error);
    }
    throw new StoreError('READ_FAILED', `无法读取数据文件 ${path.basename(filePath)}`, error);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new StoreError('INVALID_JSON', `数据文件 ${path.basename(filePath)} 不是有效 JSON`, error);
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    throw new StoreError('INVALID_DATA', `数据文件 ${path.basename(filePath)} 未通过结构校验`, result.error);
  }
  return result.data;
}

async function writeAtomically<T>(
  filePath: string,
  value: T,
  schema: z.ZodType<T>,
): Promise<void> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new StoreError('INVALID_DATA', '待写入数据未通过结构校验', result.error);
  }

  const serialized = `${JSON.stringify(result.data, null, 2)}\n`;
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });

  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(serialized, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;

    // 同目录 rename 是原子提交点：成功前旧文件始终完整可读。
    await rename(temporaryPath, filePath);

    // 尽力同步目录项，提升异常掉电后的持久性；部分平台不支持时忽略。
    try {
      const directoryHandle = await open(directory, 'r');
      await directoryHandle.sync();
      await directoryHandle.close();
    } catch {
      // 读取目录项不是所有文件系统都支持，不影响同目录 rename 的原子性。
    }
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => undefined);
    }
    await unlink(temporaryPath).catch(() => undefined);
    throw new StoreError('WRITE_FAILED', '写入数据失败，已保留上一份有效数据', error);
  } finally {
    // rename 成功时临时文件已不存在，这里的清理是幂等的。
    await unlink(temporaryPath).catch(() => undefined);
  }
}

export async function readJson<T>(name: string, schema: z.ZodType<T>): Promise<T> {
  const filePath = resolveJsonFile(name);
  return withFileLock(filePath, () => readAndValidate(filePath, schema));
}

export async function writeJson<T>(name: string, schema: z.ZodType<T>, value: T): Promise<T> {
  const filePath = resolveJsonFile(name);
  return withFileLock(filePath, async () => {
    await writeAtomically(filePath, value, schema);
    return value;
  });
}

export async function updateJson<T>(
  name: string,
  schema: z.ZodType<T>,
  update: (current: T) => T | Promise<T>,
): Promise<T> {
  const filePath = resolveJsonFile(name);
  return withFileLock(filePath, async () => {
    const current = await readAndValidate(filePath, schema);
    const next = await update(current);
    await writeAtomically(filePath, next, schema);
    return next;
  });
}

export async function readCollection<K extends CollectionName>(
  name: K,
): Promise<CollectionData<K>> {
  return readJson(
    `${name}.json`,
    collectionSchemas[name] as unknown as z.ZodType<CollectionData<K>>,
  );
}

export async function writeCollection<K extends CollectionName>(
  name: K,
  value: CollectionData<K>,
): Promise<CollectionData<K>> {
  return writeJson(
    `${name}.json`,
    collectionSchemas[name] as unknown as z.ZodType<CollectionData<K>>,
    value,
  );
}

export async function updateCollection<K extends CollectionName>(
  name: K,
  update: (current: CollectionData<K>) => CollectionData<K> | Promise<CollectionData<K>>,
): Promise<CollectionData<K>> {
  return updateJson(
    `${name}.json`,
    collectionSchemas[name] as unknown as z.ZodType<CollectionData<K>>,
    update,
  );
}
