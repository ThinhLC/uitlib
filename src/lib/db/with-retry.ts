import { isNil } from '@/lib/utils';

const RETRYABLE = new Set([1213, 1205]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True for deadlock (1213) and lock wait timeout (1205), the only errors worth retrying. */
export function isRetryable(err: unknown): boolean {
  const errno = (err as { errno?: number })?.errno;
  return !isNil(errno) && RETRYABLE.has(errno);
}

/**
 * Run `fn`, retrying only deadlock / lock wait timeout with a 50–200 ms random back-off
 * (spec 001 Calling rules). Business rejections and every other error are thrown at once.
 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (isRetryable(err) && attempt < attempts) {
        await sleep(50 + Math.random() * 150);
        continue;
      }
      throw err;
    }
  }
}
