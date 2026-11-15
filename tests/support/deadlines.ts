import { setTimeout as delay } from 'node:timers/promises';

export async function bounded<T>(promise: Promise<T>, ms = 2000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Test deadline exceeded (${ms}ms)`)), ms);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function pollDiagnostic(read: () => string, pattern: RegExp, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (pattern.test(read())) return;
    await delay(Math.min(10, Math.max(1, deadline - Date.now())));
  }
  throw new Error(`Diagnostic deadline exceeded (${ms}ms): ${read()}`);
}
