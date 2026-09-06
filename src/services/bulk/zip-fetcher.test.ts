/**
 * Phase 2-2: zip-fetcher のテスト
 *
 * 実ネットワークは叩かず、`fetchImpl` を mock して挙動を検証する。
 * 一時ディレクトリ + 実ファイル I/O なので OS 依存。CI / macOS / Linux で動く。
 */

import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BulkFetchError,
  type BulkProgress,
  downloadFullZip,
  downloadIncrementalZip,
  downloadZip,
  ZipFormatError,
} from './zip-fetcher.js';

// PK\x03\x04 + ダミー本文
const VALID_ZIP_BYTES = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from('hello-zip-content', 'utf-8'),
]);

const NOT_A_ZIP_BYTES = Buffer.from('not-a-zip', 'utf-8');

/** ReadableStream<Uint8Array> として fetch Response を組み立てる mock */
function makeMockResponse(
  body: Buffer | null,
  init: { ok?: boolean; status?: number } = {}
): Response {
  const ok = init.ok ?? true;
  const status = init.status ?? (ok ? 200 : 500);
  if (body === null) {
    // body=null は rare ケース (404 等)
    return new Response(null, { status });
  }
  // ReadableStream を 1 chunk で返す
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(body));
      controller.close();
    },
  });
  return new Response(stream, { status });
}

/** 大きい payload を複数 chunk に分割した Response (progress 検証用) */
function makeChunkedResponse(totalBytes: number, chunkSize: number, magic = true): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // 先頭の chunk に zip magic を含める
      const head = magic
        ? new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(chunkSize - 4).fill(0)])
        : new Uint8Array(chunkSize);
      controller.enqueue(head);
      let written = chunkSize;
      while (written < totalBytes) {
        const remaining = totalBytes - written;
        const sz = Math.min(chunkSize, remaining);
        controller.enqueue(new Uint8Array(sz));
        written += sz;
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe('downloadZip', () => {
  let tempDir: string;
  let dest: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'zip-fetcher-test-'));
    dest = join(tempDir, 'all_xml.zip');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('正常な zip を取得して dest に保存する', async () => {
    const mockFetch = (async () => makeMockResponse(VALID_ZIP_BYTES)) as unknown as typeof fetch;

    const result = await downloadZip({
      url: 'https://example.com/zip',
      dest,
      fetchImpl: mockFetch,
      maxRetries: 1,
    });

    expect(result.bytes).toBe(VALID_ZIP_BYTES.length);
    expect(result.attempts).toBe(1);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // 内容確認
    const saved = await readFile(dest);
    expect(saved.equals(VALID_ZIP_BYTES)).toBe(true);
  });

  it('zip マジック不一致で ZipFormatError', async () => {
    const mockFetch = (async () => makeMockResponse(NOT_A_ZIP_BYTES)) as unknown as typeof fetch;

    await expect(
      downloadZip({
        url: 'https://example.com/zip',
        dest,
        fetchImpl: mockFetch,
        maxRetries: 1,
      })
    ).rejects.toThrow(BulkFetchError);

    // partial ファイルが残っていないこと
    await expect(access(`${dest}.partial`)).rejects.toBeDefined();
  });

  it('fetch error → retry → 成功', async () => {
    let calls = 0;
    const mockFetch = (async () => {
      calls++;
      if (calls === 1) throw new Error('network down');
      return makeMockResponse(VALID_ZIP_BYTES);
    }) as unknown as typeof fetch;

    const result = await downloadZip({
      url: 'https://example.com/zip',
      dest,
      fetchImpl: mockFetch,
      maxRetries: 3,
    });

    expect(calls).toBe(2);
    expect(result.attempts).toBe(2);
    const saved = await readFile(dest);
    expect(saved.equals(VALID_ZIP_BYTES)).toBe(true);
  });

  it('maxRetries 回連続失敗で BulkFetchError', async () => {
    let calls = 0;
    const mockFetch = (async () => {
      calls++;
      throw new Error('network always down');
    }) as unknown as typeof fetch;

    await expect(
      downloadZip({
        url: 'https://example.com/zip',
        dest,
        fetchImpl: mockFetch,
        maxRetries: 2,
      })
    ).rejects.toThrow(BulkFetchError);
    expect(calls).toBe(2);

    // dest も partial も残っていない
    await expect(access(dest)).rejects.toBeDefined();
    await expect(access(`${dest}.partial`)).rejects.toBeDefined();
  });

  it('HTTP 500 で BulkFetchError + retry', async () => {
    let calls = 0;
    const mockFetch = (async () => {
      calls++;
      if (calls < 3) return makeMockResponse(null, { ok: false, status: 503 });
      return makeMockResponse(VALID_ZIP_BYTES);
    }) as unknown as typeof fetch;

    const result = await downloadZip({
      url: 'https://example.com/zip',
      dest,
      fetchImpl: mockFetch,
      maxRetries: 5,
    });
    expect(result.attempts).toBe(3);
  });

  it('progress callback を発火する', async () => {
    // 5 MB の chunk を 1 つで返し、progress interval を 1 MB にすると 1 回呼ばれる + 完了
    // ただし pipeline 完了直前の最終フックで合計 2 回呼ばれることがあるため >= 1 とする
    const totalBytes = 5_000_000;
    const mockFetch = (async () =>
      makeChunkedResponse(totalBytes, totalBytes, true)) as unknown as typeof fetch;

    const events: BulkProgress[] = [];
    const result = await downloadZip({
      url: 'https://example.com/zip',
      dest,
      fetchImpl: mockFetch,
      maxRetries: 1,
      expectedBytes: totalBytes,
      progressIntervalBytes: 1_000_000,
      onProgress: (e) => events.push(e),
    });

    expect(result.bytes).toBe(totalBytes);
    expect(events.length).toBeGreaterThanOrEqual(1);
    // 最終 progress は ratio=1.0
    const last = events[events.length - 1];
    expect(last.ratio).toBeCloseTo(1.0, 5);
    expect(last.bytesDownloaded).toBe(totalBytes);
  });

  it('expectedBytes 超えても ratio は 1.0 で頭打ち', async () => {
    // expectedBytes(2 MB) より大きい 5 MB を返す
    const mockFetch = (async () =>
      makeChunkedResponse(5_000_000, 5_000_000, true)) as unknown as typeof fetch;

    const events: BulkProgress[] = [];
    await downloadZip({
      url: 'https://example.com/zip',
      dest,
      fetchImpl: mockFetch,
      maxRetries: 1,
      expectedBytes: 2_000_000,
      onProgress: (e) => events.push(e),
    });

    expect(events.every((e) => e.ratio <= 1.0)).toBe(true);
  });

  it('AbortSignal で途中キャンセル', async () => {
    const controller = new AbortController();
    const mockFetch = (async (_url: unknown, init?: { signal?: AbortSignal }) => {
      // signal 経由で abort が伝わったら fetch 自体が AbortError を throw する
      if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      // 直後に abort
      setTimeout(() => controller.abort(), 5);
      return makeMockResponse(VALID_ZIP_BYTES);
    }) as unknown as typeof fetch;

    controller.abort(); // 開始時点で abort
    await expect(
      downloadZip({
        url: 'https://example.com/zip',
        dest,
        fetchImpl: mockFetch,
        maxRetries: 1,
        signal: controller.signal,
      })
    ).rejects.toThrow(BulkFetchError);
  });
});

describe('downloadFullZip / downloadIncrementalZip (URL builder ラッパ)', () => {
  let tempDir: string;
  let dest: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'zip-fetcher-wrap-'));
    dest = join(tempDir, 'out.zip');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('downloadFullZip は file_section=1 の URL を fetch する', async () => {
    let capturedUrl = '';
    const mockFetch = (async (url: string) => {
      capturedUrl = url;
      return makeMockResponse(VALID_ZIP_BYTES);
    }) as unknown as typeof fetch;

    await downloadFullZip({ dest, fetchImpl: mockFetch, maxRetries: 1 });
    expect(capturedUrl).toContain('file_section=1');
    expect(capturedUrl).toContain('only_xml_flag=true');
  });

  it('downloadIncrementalZip は file_section=3 + update_date を含む URL を fetch する', async () => {
    let capturedUrl = '';
    const mockFetch = (async (url: string) => {
      capturedUrl = url;
      return makeMockResponse(VALID_ZIP_BYTES);
    }) as unknown as typeof fetch;

    await downloadIncrementalZip('20260507', { dest, fetchImpl: mockFetch, maxRetries: 1 });
    expect(capturedUrl).toContain('file_section=3');
    expect(capturedUrl).toContain('update_date=20260507');
  });
});

describe('verifyZipMagic (内部経由テスト)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'zip-verify-test-'));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('短すぎるファイル (3 byte 未満) は ZipFormatError', async () => {
    const dest = join(tempDir, 'short.zip');
    const mockFetch = (async () =>
      makeMockResponse(Buffer.from([0x50, 0x4b]))) as unknown as typeof fetch;

    await expect(
      downloadZip({
        url: 'https://example.com/zip',
        dest,
        fetchImpl: mockFetch,
        maxRetries: 1,
      })
    ).rejects.toBeInstanceOf(ZipFormatError);
  });
});
