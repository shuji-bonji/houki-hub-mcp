/**
 * CLI ハンドラ — Phase 2-6
 *
 * `houki-egov-mcp` バイナリを引数なしで起動すると MCP server として常駐するが、
 * 以下のフラグ付きで起動すると bulk DL / status を実行して exit する。
 *
 *   --bulk-download-everything       file_section=1 で全件 DL + DB ingest
 *   --bulk-download-by-date YYYYMMDD file_section=3 で 1 日分の差分 DL + ingest (デバッグ用)
 *   --status                          sync_state + DB 件数 + freshness を表示
 *   --help / -h                       使い方
 *
 * 設計詳細: docs/PHASE2-DESIGN.md §4
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PACKAGE_INFO } from '../config.js';
import { closeDb, defaultDbPath, openDb } from '../db/index.js';
import { type IngestResult, ingestZip } from '../services/bulk/ingester.js';
import {
  type BulkProgress,
  downloadFullZip,
  downloadIncrementalZip,
} from '../services/bulk/zip-fetcher.js';
import { openZipFile } from '../services/bulk/zip-reader.js';
import { summarizeFreshness } from '../services/freshness.js';

/** CLI ハンドラの戻り値 */
export interface CliResult {
  /** プロセス exit code */
  exitCode: number;
  /** どの command を処理したか (default = `'mcp-server'` で MCP fallback) */
  command: string;
}

/** 引数なし or 認識できないフラグなら MCP fallback として呼び出し元に委ねる */
const NOT_A_COMMAND = '__not_cli__';

/**
 * CLI を実行する。CLI コマンドにマッチしなかった場合は `'__not_cli__'` を返し、
 * 呼び出し側 (index.ts) が MCP server 起動にフォールバックする。
 */
export async function runCli(argv: string[]): Promise<CliResult> {
  // argv は process.argv をそのまま受ける想定 (argv[0] = node, argv[1] = script)
  const args = argv.slice(2);

  if (args.length === 0) {
    return { exitCode: 0, command: NOT_A_COMMAND };
  }

  const cmd = args[0];

  if (cmd === '--help' || cmd === '-h') {
    printHelp();
    return { exitCode: 0, command: 'help' };
  }

  if (cmd === '--version' || cmd === '-v') {
    console.log(`${PACKAGE_INFO.name} v${PACKAGE_INFO.version}`);
    return { exitCode: 0, command: 'version' };
  }

  if (cmd === '--bulk-download-everything') {
    return await runBulkDownloadEverything();
  }

  if (cmd === '--bulk-download-by-date') {
    const date = args[1];
    if (!date || !/^\d{8}$/.test(date)) {
      console.error(
        'ERROR: --bulk-download-by-date は YYYYMMDD 形式の日付を必要とします (例: 20260507)'
      );
      return { exitCode: 2, command: 'bulk-download-by-date' };
    }
    return await runBulkDownloadByDate(date);
  }

  if (cmd === '--status') {
    return await runStatus();
  }

  // 認識できないフラグ — MCP server に委ねる前にエラー (誤入力検知)
  if (cmd.startsWith('--') || cmd.startsWith('-')) {
    console.error(`ERROR: 未知のフラグ: ${cmd}`);
    printHelp();
    return { exitCode: 2, command: 'unknown' };
  }

  // それ以外 (位置引数のみ) は MCP fallback
  return { exitCode: 0, command: NOT_A_COMMAND };
}

/** `runCli` の結果が MCP fallback を意味するかを判定 */
export function shouldFallbackToMcp(result: CliResult): boolean {
  return result.command === NOT_A_COMMAND;
}

/** 全件 bulk DL + ingest */
async function runBulkDownloadEverything(): Promise<CliResult> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'houki-egov-bulk-'));
  const zipPath = join(tmpDir, 'all_xml.zip');
  const dbPath = defaultDbPath();
  const startedAt = Date.now();

  console.error(`[bulk-download-everything] 全件 zip を取得します`);
  console.error(`  保存先 zip: ${zipPath}`);
  console.error(`  DB:         ${dbPath}`);

  try {
    // 1) Download
    console.error(`[1/2] zip ダウンロード中...`);
    const dl = await downloadFullZip({
      dest: zipPath,
      onProgress: (p) => printProgress(p, 'DL'),
    });
    console.error(
      `\n  DL 完了: ${formatBytes(dl.bytes)} / ${formatDuration(dl.durationMs)} / attempts=${dl.attempts}`
    );

    // 2) Ingest
    console.error(`[2/2] DB に ingest 中...`);
    const db = openDb(dbPath);
    let result: IngestResult;
    try {
      const zip = await openZipFile(zipPath);
      result = await ingestZip({
        db,
        zip,
        source: 'all_xml',
        onProgress: (p) =>
          process.stderr.write(
            `\r  ingest: ${p.processed.toString().padStart(6)} / ${p.total} laws`
          ),
      });
    } finally {
      closeDb(db);
    }
    console.error('');
    console.error(`  ingest 完了: ${formatIngestResult(result)}`);

    const totalMs = Date.now() - startedAt;
    console.error(`[完了] 全体 ${formatDuration(totalMs)}`);
    return { exitCode: 0, command: 'bulk-download-everything' };
  } catch (err) {
    console.error(`[ERROR] ${(err as Error).message ?? err}`);
    return { exitCode: 1, command: 'bulk-download-everything' };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** 単日差分 bulk DL + ingest (デバッグ用) */
async function runBulkDownloadByDate(yyyymmdd: string): Promise<CliResult> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'houki-egov-diff-'));
  const zipPath = join(tmpDir, `R${yyyymmdd.slice(2)}.zip`);
  const dbPath = defaultDbPath();

  console.error(`[bulk-download-by-date] update_date=${yyyymmdd} の差分 zip を取得します`);
  console.error(`  保存先 zip: ${zipPath}`);
  console.error(`  DB:         ${dbPath}`);

  try {
    console.error(`[1/2] 差分 zip ダウンロード中...`);
    const dl = await downloadIncrementalZip(yyyymmdd, {
      dest: zipPath,
      // 差分は数 MB なので expectedBytes を小さく
      expectedBytes: 5_000_000,
      onProgress: (p) => printProgress(p, 'DL'),
    });
    console.error(`\n  DL 完了: ${formatBytes(dl.bytes)} / ${formatDuration(dl.durationMs)}`);

    console.error(`[2/2] DB に ingest 中...`);
    const db = openDb(dbPath);
    let result: IngestResult;
    try {
      const zip = await openZipFile(zipPath);
      result = await ingestZip({ db, zip, source: 'incremental' });
    } finally {
      closeDb(db);
    }
    console.error(`  ingest 完了: ${formatIngestResult(result)}`);
    return { exitCode: 0, command: 'bulk-download-by-date' };
  } catch (err) {
    console.error(`[ERROR] ${(err as Error).message ?? err}`);
    return { exitCode: 1, command: 'bulk-download-by-date' };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** sync_state + 件数 + freshness をターミナルに表示 */
async function runStatus(): Promise<CliResult> {
  const dbPath = defaultDbPath();
  console.log(`[status] ${PACKAGE_INFO.name} v${PACKAGE_INFO.version}`);
  console.log(`  DB: ${dbPath}`);

  let db: ReturnType<typeof openDb>;
  try {
    db = openDb(dbPath);
  } catch (err) {
    console.error(`[ERROR] DB を開けません: ${(err as Error).message}`);
    return { exitCode: 1, command: 'status' };
  }

  try {
    const lawsCount = (db.prepare('SELECT count(*) as c FROM laws').get() as { c: number }).c;
    const articlesCount = (db.prepare('SELECT count(*) as c FROM articles').get() as { c: number })
      .c;
    const fresh = summarizeFreshness(db);

    console.log(`  laws:     ${lawsCount.toLocaleString()}`);
    console.log(`  articles: ${articlesCount.toLocaleString()}`);
    if (!fresh) {
      console.log(`  sync:     (まだ bulk DL されていません — --bulk-download-everything を実行)`);
    } else {
      console.log(`  sync:`);
      console.log(`    last_sync_date:  ${fresh.last_sync_date}`);
      console.log(`    last_full_dl_at: ${fresh.last_full_dl_at}`);
      console.log(`    days_since_sync: ${fresh.days_since_sync}`);
      console.log(`    staleness:       ${fresh.staleness}`);
      if (fresh.warning) {
        console.log(`  ⚠ ${fresh.warning}`);
      }
    }
    return { exitCode: 0, command: 'status' };
  } finally {
    closeDb(db);
  }
}

/** ヘルプ */
function printHelp(): void {
  console.log(`${PACKAGE_INFO.name} v${PACKAGE_INFO.version}

USAGE:
  houki-egov-mcp                                 MCP server を起動 (default)
  houki-egov-mcp --bulk-download-everything      全件 zip を DL + DB に ingest
  houki-egov-mcp --bulk-download-by-date YYYYMMDD  単日差分を DL + ingest (デバッグ用)
  houki-egov-mcp --status                         同期状態と DB 件数を表示
  houki-egov-mcp --version                        バージョン表示
  houki-egov-mcp --help                           この使い方を表示

ENVIRONMENT:
  HOUKI_EGOV_DB_PATH=/path/to.db    DB ファイルパスを上書き
                                     (default: \${XDG_CACHE_HOME:-~/.cache}/houki-egov-mcp/laws.db)
  HOUKI_EGOV_BULK_RETRY=3           bulk DL 失敗時のリトライ回数

DOCS:
  docs/PHASE2-DESIGN.md             設計詳細
  docs/PHASE2-SPIKE.md              e-Gov bulk DL 仕様
`);
}

/** progress を 1 行に上書き表示 */
function printProgress(p: BulkProgress, prefix: string): void {
  const pct = (p.ratio * 100).toFixed(1).padStart(5);
  process.stderr.write(
    `\r  ${prefix}: ${formatBytes(p.bytesDownloaded)} / ~${formatBytes(p.totalEstimated)} (${pct}%)`
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}

function formatIngestResult(r: IngestResult): string {
  const parts: string[] = [];
  parts.push(`${r.upserted} 件 upsert`);
  if (r.unchanged > 0) parts.push(`${r.unchanged} 件 unchanged`);
  if (r.failed > 0) parts.push(`${r.failed} 件 failed`);
  parts.push(`(${formatDuration(r.durationMs)})`);
  return parts.join(', ');
}
