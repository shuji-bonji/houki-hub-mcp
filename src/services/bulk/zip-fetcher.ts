/**
 * e-Gov bulk download zip fetcher — Phase 2-2
 *
 * file_section=1 (全件) / file_section=3 (差分) の zip を取得する共通レイヤ。
 *
 * 設計判断 (PHASE2-SPIKE.md §1-2 / FOLLOWUP §1):
 *  - HTTP Range / Accept-Ranges / Content-Length / ETag / Last-Modified の
 *    いずれもサーバが返さないため、resume / 304 conditional GET は不可
 *  - 失敗時は **0 から再取得** し、retry は exponential backoff で 3 回まで
 *  - 進捗は Content-Length が来ない前提で `expectedBytes` (前回成功時 or hardcoded
 *    推定値) ベースの線形 ETA。誤差は ±5% 程度を許容 (CLI のみのため)
 *  - 整合性 = zip マジックバイト `PK\x03\x04` (0x50 0x4B 0x03 0x04) で確認
 *  - `{dest}.partial` に書いてから rename することで部分ファイルを残さない
 *
 * 設計詳細: docs/PHASE2-DESIGN.md §5.1 / docs/PHASE2-SPIKE-FOLLOWUP.md §1-3
 */

import { createWriteStream } from 'node:fs';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

import { BULK_CONFIG, EGOV_BULK, HTTP_CONFIG } from '../../config.js';

/** zip 整合性 / fetch 失敗を識別するエラー */
export class BulkFetchError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'BulkFetchError';
  }
}

/** zip マジック (PK\x03\x04) 不一致 */
export class ZipFormatError extends BulkFetchError {
  constructor(message: string) {
    super(message);
    this.name = 'ZipFormatError';
  }
}

/** 進捗イベント */
export interface BulkProgress {
  /** これまでに書き込んだ byte 数 */
  bytesDownloaded: number;
  /** 推定の総 byte 数 (Content-Length が無いため近似値) */
  totalEstimated: number;
  /** 0.0〜1.0 の進捗率 (上限 1.0) */
  ratio: number;
}

/** downloadZip オプション */
export interface DownloadZipOptions {
  /** 取得 URL (file_section=1 / =3 / =2 のいずれか) */
  url: string;
  /** 保存先ファイルパス */
  dest: string;
  /** 推定サイズ (default 290_000_000、PHASE2-SPIKE 実測ベース) */
  expectedBytes?: number;
  /** 最大リトライ回数 (default `BULK_CONFIG.bulkRetry`) */
  maxRetries?: number;
  /** 進捗 callback (一定 byte 経過ごとに発火) */
  onProgress?: (event: BulkProgress) => void;
  /** progress 発火間隔 (byte, default 1 MB) */
  progressIntervalBytes?: number;
  /** fetch 差し替え (テスト用) */
  fetchImpl?: typeof fetch;
  /** AbortSignal (キャンセル用) */
  signal?: AbortSignal;
}

/** downloadZip の戻り値 */
export interface DownloadZipResult {
  /** 書き込んだ byte 数 (= 圧縮済み zip サイズ) */
  bytes: number;
  /** ダウンロード所要時間 (ミリ秒) */
  durationMs: number;
  /** 何回目の attempt で成功したか (1-indexed) */
  attempts: number;
}

/** PHASE2-SPIKE 2026-05-08 実測ベースの推定値 */
const DEFAULT_EXPECTED_BYTES = 290_000_000;
const DEFAULT_PROGRESS_INTERVAL_BYTES = 1_000_000;
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // 'PK\x03\x04'

/**
 * 任意の bulk DL URL から zip を取得し `dest` に保存する低レベル関数。
 *
 * リトライは exponential backoff (1s, 2s, 4s, ...) で `maxRetries` 回まで。
 * 各 attempt の失敗時は `{dest}.partial` を確実に削除する。
 */
export async function downloadZip(opts: DownloadZipOptions): Promise<DownloadZipResult> {
  const {
    url,
    dest,
    expectedBytes = DEFAULT_EXPECTED_BYTES,
    maxRetries = BULK_CONFIG.bulkRetry,
    onProgress,
    progressIntervalBytes = DEFAULT_PROGRESS_INTERVAL_BYTES,
    fetchImpl = fetch,
    signal,
  } = opts;

  await mkdir(dirname(dest), { recursive: true });

  const tempPath = `${dest}.partial`;
  let lastErr: unknown;
  const start = Date.now();

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const bytes = await streamToFile({
        url,
        tempPath,
        expectedBytes,
        onProgress,
        progressIntervalBytes,
        fetchImpl,
        signal,
      });
      await verifyZipMagic(tempPath);
      await rename(tempPath, dest);
      return {
        bytes,
        durationMs: Date.now() - start,
        attempts: attempt,
      };
    } catch (err) {
      lastErr = err;
      // partial ファイルを掃除
      await unlink(tempPath).catch(() => {});
      // ユーザ abort の場合はリトライしない
      if (signal?.aborted) {
        throw new BulkFetchError('aborted by signal', err);
      }
      if (attempt === maxRetries) break;
      const backoffMs = 1000 * Math.pow(2, attempt - 1);
      await sleep(backoffMs, signal);
    }
  }

  // ZipFormatError 等の BulkFetchError サブクラスはそのまま再 throw して型を保つ
  // (リトライ後でも ZipFormatError としての識別が可能になる)
  if (lastErr instanceof BulkFetchError) {
    throw lastErr;
  }
  throw new BulkFetchError(
    `bulk DL に ${maxRetries} 回失敗しました: ${(lastErr as Error)?.message ?? lastErr}`,
    lastErr
  );
}

/**
 * 全件 zip (file_section=1) を取得する高レベルラッパ。
 */
export async function downloadFullZip(
  opts: Omit<DownloadZipOptions, 'url'>
): Promise<DownloadZipResult> {
  return downloadZip({ ...opts, url: EGOV_BULK.fullDownloadUrl });
}

/**
 * 日次差分 zip (file_section=3) を取得する高レベルラッパ。
 *
 * @param yyyymmdd 'YYYYMMDD' 形式の日付 (例: '20260507')
 */
export async function downloadIncrementalZip(
  yyyymmdd: string,
  opts: Omit<DownloadZipOptions, 'url'>
): Promise<DownloadZipResult> {
  return downloadZip({ ...opts, url: EGOV_BULK.incrementalDownloadUrl(yyyymmdd) });
}

/** ストリームを ReadableStream → ファイルに書きながら進捗通知 */
async function streamToFile(args: {
  url: string;
  tempPath: string;
  expectedBytes: number;
  onProgress?: (event: BulkProgress) => void;
  progressIntervalBytes: number;
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
}): Promise<number> {
  const { url, tempPath, expectedBytes, onProgress, progressIntervalBytes, fetchImpl, signal } =
    args;

  const response = await fetchImpl(url, {
    headers: { 'User-Agent': HTTP_CONFIG.userAgent },
    signal,
  });

  if (!response.ok) {
    throw new BulkFetchError(`HTTP ${response.status} ${response.statusText} from ${url}`);
  }
  if (!response.body) {
    throw new BulkFetchError(`response.body が null (URL: ${url})`);
  }

  const fileStream = createWriteStream(tempPath);
  let bytesDownloaded = 0;
  let lastProgressAt = 0;

  const nodeStream = Readable.fromWeb(response.body as WebReadableStream<Uint8Array>);
  nodeStream.on('data', (chunk: Buffer) => {
    bytesDownloaded += chunk.length;
    if (onProgress && bytesDownloaded - lastProgressAt >= progressIntervalBytes) {
      lastProgressAt = bytesDownloaded;
      const ratio = expectedBytes > 0 ? Math.min(bytesDownloaded / expectedBytes, 1.0) : 0;
      onProgress({ bytesDownloaded, totalEstimated: expectedBytes, ratio });
    }
  });

  await pipeline(nodeStream, fileStream);

  // 最後に 1 回 progress を呼んで完了率を 100% にする
  if (onProgress) {
    const ratio = expectedBytes > 0 ? Math.min(bytesDownloaded / expectedBytes, 1.0) : 0;
    onProgress({ bytesDownloaded, totalEstimated: expectedBytes, ratio });
  }
  return bytesDownloaded;
}

/** 取得した zip の先頭 4 byte が PK\x03\x04 マジックであることを検証 */
async function verifyZipMagic(filePath: string): Promise<void> {
  const fh = await open(filePath, 'r');
  try {
    const buf = Buffer.alloc(4);
    const { bytesRead } = await fh.read(buf, 0, 4, 0);
    if (bytesRead < 4 || !buf.equals(ZIP_MAGIC)) {
      throw new ZipFormatError(
        `zip マジック (PK\\x03\\x04) と一致しません (先頭 4 byte: ${[...buf].map((b) => b.toString(16).padStart(2, '0')).join(' ')})`
      );
    }
  } finally {
    await fh.close();
  }
}

/** AbortSignal 対応 sleep */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new BulkFetchError('aborted by signal'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new BulkFetchError('aborted by signal'));
      },
      { once: true }
    );
  });
}
