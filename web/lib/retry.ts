// One request per photo with retry: a drop on photo seven keeps one through six.

export type RetryOptions = {
  attempts?: number; // total tries, including the first
  baseMs?: number; // first wait; doubles after
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, err: unknown) => void;
};

export function waitFor(attempt: number, baseMs: number): number {
  return baseMs * 2 ** (attempt - 1);
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseMs = opts.baseMs ?? 600;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      last = err;
      if (err instanceof NoRetry || attempt === attempts) break;
      opts.onRetry?.(attempt, err);
      await sleep(waitFor(attempt, baseMs));
    }
  }
  throw last;
}

/** Throw this from fn for a failure that retrying cannot fix (a 4xx). */
export class NoRetry extends Error {}
