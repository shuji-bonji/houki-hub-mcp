/**
 * 軽量な並行制限ヘルパー（p-limit 相当）
 *
 * e-Gov API の連打を防ぐため、同時実行数を制限する。
 * 外部依存を増やしたくないため自前実装（30行ほど）。
 *
 * 使い方:
 * ```ts
 * const limit = createLimit(2); // 同時 2 並列まで
 * const results = await Promise.all(
 *   urls.map((url) => limit(() => fetch(url)))
 * );
 * ```
 *
 * 設計メモ:
 * - LIFO ではなく FIFO（投入順に実行）
 * - 例外は呼び出し側に伝播
 * - キャンセル機構は意図的に持たない（必要なら AbortController を内部で）
 */

export type LimitFn = <T>(task: () => Promise<T>) => Promise<T>;

export function createLimit(concurrency: number): LimitFn {
  if (!Number.isFinite(concurrency) || concurrency < 1) {
    throw new Error(`createLimit: concurrency must be >= 1, got ${concurrency}`);
  }

  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    if (active >= concurrency) return;
    const run = queue.shift();
    if (run) {
      active++;
      run();
    }
  };

  return <T>(task: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const exec = () => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      };
      queue.push(exec);
      next();
    });
  };
}
