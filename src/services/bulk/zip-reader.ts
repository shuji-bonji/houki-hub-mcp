/**
 * ZipReader 抽象 — Phase 2-5 ingester から zip 実装を切り離すための薄いインタフェース。
 *
 * テストでは in-memory な mock ZipReader を渡せるようにし、本番では `unzipper` で
 * 実 zip ファイルを streaming 展開する。
 *
 * 設計判断:
 *  - all_xml.zip は 285 MB / 展開後 3.2 GB / 20,411 ファイル → メモリ上に全部
 *    展開しない streaming が必須。`unzipper.Open.file()` は `.files` プロパティで
 *    各 entry を遅延 buffer 化できる
 *  - エントリの順序は保証しない (zip ファイル内での出現順)
 */

import { Open as UnzipperOpen } from 'unzipper';

/** zip 内の 1 ファイル */
export interface ZipEntry {
  /** zip 内の相対パス (例: `all_law_list.csv` / `105DF0000000337_18721109_000000000000000/...xml`) */
  path: string;
  /** ディレクトリエントリかどうか */
  isDirectory: boolean;
  /** ファイル本体を Buffer で読み出す (lazy) */
  read(): Promise<Buffer>;
}

/** zip 全体の reader (async iterable) */
export interface ZipReader {
  [Symbol.asyncIterator](): AsyncIterableIterator<ZipEntry>;
  close(): Promise<void>;
}

/**
 * 実 zip ファイルを開く (production 用)。
 *
 * 内部で `unzipper.Open.file()` を使い、各 entry を遅延 buffer 化する。
 * 285 MB zip でも全部メモリには載せず、エントリ単位でストリーミング展開する。
 */
export async function openZipFile(zipPath: string): Promise<ZipReader> {
  const directory = await UnzipperOpen.file(zipPath);
  const files = directory.files;

  return {
    async *[Symbol.asyncIterator](): AsyncIterableIterator<ZipEntry> {
      for (const file of files) {
        yield {
          path: file.path,
          isDirectory: file.type === 'Directory',
          read: async () => file.buffer(),
        };
      }
    },
    async close() {
      // unzipper.Open.file の戻り値には明示的な close API がないため no-op
      // ファイルディスクリプタは buffer() を呼ぶたびに開閉される (内部実装)
    },
  };
}

/**
 * テスト / 中間処理用の in-memory ZipReader ファクトリ。
 *
 * @example
 * ```ts
 * const zip = createMemoryZip([
 *   { path: 'all_law_list.csv', content: '...' },
 *   { path: 'foo/foo.xml', content: '<?xml...' },
 * ]);
 * ```
 */
export function createMemoryZip(
  entries: Array<{ path: string; content: string | Buffer; isDirectory?: boolean }>
): ZipReader {
  return {
    async *[Symbol.asyncIterator](): AsyncIterableIterator<ZipEntry> {
      for (const e of entries) {
        const buf = typeof e.content === 'string' ? Buffer.from(e.content, 'utf-8') : e.content;
        yield {
          path: e.path,
          isDirectory: e.isDirectory ?? false,
          read: async () => buf,
        };
      }
    },
    async close() {
      // no-op
    },
  };
}
