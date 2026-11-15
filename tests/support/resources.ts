import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { bounded } from './deadlines.ts';

export const cleanupPriority = { native: 0, peer: 1, directory: 2 } as const;
type Priority = typeof cleanupPriority[keyof typeof cleanupPriority];

export class ResourceOwner {
  #entries: { priority: Priority; cleanup: () => void | Promise<void>; ms: number }[] = [];
  #closing: Promise<void> | undefined;

  add(priority: Priority, cleanup: () => void | Promise<void>, ms = 5000): void {
    if (this.#closing) throw new Error('Cannot register a resource during cleanup');
    this.#entries.push({ priority, cleanup, ms });
  }

  close(): Promise<void> {
    return this.#closing ??= this.#drain();
  }

  async #drain(): Promise<void> {
    const errors: unknown[] = [];
    for (const entry of this.#entries.sort((a, b) => a.priority - b.priority)) {
      try { await bounded(Promise.resolve().then(entry.cleanup), entry.ms); }
      catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Test resource cleanup failed');
  }
}

const owners = new WeakMap<TestContext, ResourceOwner>();
export function resources(t: TestContext): ResourceOwner {
  let owner = owners.get(t);
  if (!owner) {
    const created = new ResourceOwner();
    owner = created;
    owners.set(t, created);
    t.after(() => created.close());
  }
  return owner;
}

export function assertGone(pid: number): void {
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
}

export function ownNative<T extends { pid: number; close(): Promise<void> }>(t: TestContext, native: T): T {
  resources(t).add(cleanupPriority.native, async () => {
    await bounded(native.close(), 5000);
    assertGone(native.pid);
  });
  return native;
}

export async function scratch(t: TestContext, prefix = 'bendflow-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  resources(t).add(cleanupPriority.directory, () => rm(dir, { recursive: true, force: true }));
  return dir;
}
