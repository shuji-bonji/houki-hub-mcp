import { describe, it, expect } from 'vitest';
import { createLimit } from './concurrency.js';

describe('createLimit', () => {
  it('throws when concurrency is < 1', () => {
    expect(() => createLimit(0)).toThrow();
    expect(() => createLimit(-1)).toThrow();
  });

  it('runs tasks but never exceeds the concurrency cap', async () => {
    const limit = createLimit(2);
    let active = 0;
    let maxObserved = 0;

    const task = async () => {
      active++;
      maxObserved = Math.max(maxObserved, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    };

    await Promise.all(Array.from({ length: 10 }, () => limit(task)));

    expect(maxObserved).toBeLessThanOrEqual(2);
    expect(active).toBe(0);
  });

  it('preserves task return values and order semantics', async () => {
    const limit = createLimit(3);
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => limit(async () => n * 2)));
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it('propagates errors to the caller', async () => {
    const limit = createLimit(1);
    await expect(
      limit(async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    // 1つ失敗しても次のタスクは走る
    const ok = await limit(async () => 'ok');
    expect(ok).toBe('ok');
  });

  it('runs queued tasks after earlier ones resolve', async () => {
    const limit = createLimit(1);
    const order: number[] = [];
    await Promise.all([
      limit(async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push(1);
      }),
      limit(async () => {
        order.push(2);
      }),
    ]);
    expect(order).toEqual([1, 2]);
  });
});
