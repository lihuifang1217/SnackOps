const globalState = globalThis as typeof globalThis & {
  __snackopsRegistryLocks?: Map<string, Promise<void>>;
};

const locks = (globalState.__snackopsRegistryLocks ??= new Map());

/**
 * 注册中心跨 JSON 与 Skill 文件的变更使用独立的进程级锁。
 * 所有调用都使用同一个 globalThis 队列，避免热更新后出现两套锁。
 */
export async function withRegistryLock<T>(
  key: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => gate);
  locks.set(key, queued);

  await previous;

  try {
    return await task();
  } finally {
    release();
    if (locks.get(key) === queued) {
      locks.delete(key);
    }
  }
}
