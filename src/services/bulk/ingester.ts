/**
 * Bulk zip → SQLite ingester — Phase 2-5
 *
 * `ZipReader` から CSV (法令一覧) と各 XML を読み出し、laws / articles / laws_fts
 * テーブルに upsert する。articles_fts は trigger で自動同期される。
 *
 * 設計判断 (PHASE2-DESIGN.md §3 + §5.1, FOLLOWUP §2):
 *  - PK は `law_revision_id` (= `{lawId}_{enforcementDate}_{amendmentLawId}`)
 *  - bulk zip は 1 法令 = 1 revision を持つので、同じ revision_id が来たら content_hash
 *    比較で no-op 判定 (transaction を無駄にしない)
 *  - `current_revision_status` は CSV の `unenforced` フラグから簡易判定
 *    (`unenforced=true` → `UnEnforced`、それ以外 → `CurrentEnforced`)
 *    ※ これは "近似" — 正確には API /law_revisions/{lawId} で `PreviousEnforced` /
 *       `Repeal` を区別すべきだが、Phase 2-5 の範囲外。Phase 2-13 (API enrichment)
 *       で精緻化する
 *  - `repeal_status` は `'None'` 固定 (API 拡張で更新)
 *  - `updated` は ingester 実行時刻 (`fetched_at` と同じ) を proxy として入れる
 *  - `promulgation_date` は XML 属性 (Era + Year + PromulgateMonth + PromulgateDay) から
 *    西暦 ISO date を構築。Era → Gregorian 変換テーブルを内蔵
 *  - `db.transaction()` で 100 件単位の batch 化 (大量法令でも spike なくこなす)
 *  - 既存 articles は INSERT 前に DELETE で全置換 (revision の本文差し替え用)
 *  - laws_fts は standalone なので INSERT/UPDATE 時に手動で同期する
 *  - Phase 2-7 (v0.5.0): `articles.body` と `laws_fts` の各列は
 *    `@shuji-bonji/houki-abbreviations` の `normalizeJpText` を通して投入する
 *    (Normalize-everywhere — 検索側 `law-search.ts` も同じ関数で query を正規化する)。
 *    `body_raw` / `laws.law_title` 等の表示用列は原文のまま
 */

import { createHash } from 'node:crypto';
import { normalizeJpText } from '@shuji-bonji/houki-abbreviations';
import type DatabaseT from 'better-sqlite3';

import { type AllLawListRow, parseAllLawList } from './csv-parser.js';
import { type ParsedLaw, parseLawXml } from './xml-parser.js';
import type { ZipReader } from './zip-reader.js';

/** ingester オプション */
export interface IngestZipOptions {
  /** SQLite DB (initSchema 済み) */
  db: DatabaseT.Database;
  /** zip エントリ (production: openZipFile, test: createMemoryZip) */
  zip: ZipReader;
  /** sync_state.bulk_source に書き込む値 (default `'all_xml'`) */
  source?: 'all_xml' | 'incremental';
  /** ingester 実行時刻 (default `new Date().toISOString()`)。テスト deterministic 化用 */
  nowIso?: string;
  /** 進捗 callback */
  onProgress?: (event: IngestProgress) => void;
  /** XML パース失敗時の挙動 (default `'skip'`)。`'throw'` で全停止 */
  onXmlError?: 'skip' | 'throw';
  /** 1 transaction で commit する law 件数 (default 200) */
  batchSize?: number;
}

/** 進捗イベント */
export interface IngestProgress {
  /** これまで処理した法令数 */
  processed: number;
  /** 全体の予定件数 (CSV から推定) */
  total: number;
  /** 今 commit した直前の law_revision_id (デバッグ用) */
  lastLawRevisionId?: string;
}

/** ingester 結果サマリ */
export interface IngestResult {
  /** CSV 行数 (= 期待値) */
  csvRows: number;
  /** XML を読み込めた件数 */
  xmlSeen: number;
  /** content_hash 一致で no-op skip した件数 */
  unchanged: number;
  /** INSERT or UPDATE した件数 */
  upserted: number;
  /** XML パース失敗で skip した件数 (`onXmlError='skip'` 時) */
  failed: number;
  /** ingester 全体の所要時間 ms */
  durationMs: number;
}

/** zip 内 CSV ファイル名候補 (full / incremental どちらでも拾える) */
const CSV_PATTERN = /(?:^|\/)([^/]*\.csv)$/i;

/** 西暦変換用の元号オフセット */
const ERA_OFFSETS: Record<string, number> = {
  Meiji: 1867, // Meiji 1 = 1868
  Taisho: 1911, // Taisho 1 = 1912
  Showa: 1925, // Showa 1 = 1926
  Heisei: 1988, // Heisei 1 = 1989
  Reiwa: 2018, // Reiwa 1 = 2019
};

/**
 * ZipReader から CSV + XML を読んで DB に ingest する。
 *
 * @returns 各種カウンタを含む `IngestResult`
 * @throws `onXmlError='throw'` 時 / CSV が見つからない / DB 失敗
 */
export async function ingestZip(opts: IngestZipOptions): Promise<IngestResult> {
  const {
    db,
    zip,
    source = 'all_xml',
    nowIso = new Date().toISOString(),
    onProgress,
    onXmlError = 'skip',
    batchSize = 200,
  } = opts;

  const start = Date.now();

  // 1) zip 内のエントリを一旦 path → buffer の遅延参照に集める。
  //    streaming のためメモリには載せず、buffer() 関数だけ取る。
  let csvBuffer: Buffer | undefined;
  const xmlEntries = new Map<string, () => Promise<Buffer>>(); // basename(.xml) → reader

  for await (const entry of zip) {
    if (entry.isDirectory) continue;
    if (entry.path.toLowerCase().endsWith('.csv')) {
      // 最初に見つかった CSV を採用 (full / incremental 共に top-level に 1 つだけ)
      if (!csvBuffer) {
        csvBuffer = await entry.read();
      }
      continue;
    }
    if (entry.path.toLowerCase().endsWith('.xml')) {
      // 重複防止のため basename 単位で記録
      const fileName = baseName(entry.path);
      xmlEntries.set(fileName, () => entry.read());
    }
  }

  if (!csvBuffer) {
    throw new IngestError('zip 内に CSV (法令一覧) が見つかりません');
  }

  // 2) CSV を完全に parse する。skipMalformed=true で部分的破損を許容。
  const csvRows = parseAllLawList(csvBuffer, { skipMalformed: true });
  if (csvRows.length === 0) {
    throw new IngestError('CSV を parse した結果 0 行でした');
  }

  // 3) law_revision_id でインデックス
  const csvByRevisionId = new Map<string, AllLawListRow>();
  for (const row of csvRows) {
    csvByRevisionId.set(row.law_revision_id, row);
  }

  // 4) statements の事前準備
  const upsertLaw = db.prepare(`
    INSERT INTO laws (
      law_revision_id, law_id, law_type, law_num, law_title, law_title_kana,
      abbrev, category, promulgation_date, amendment_promulgate_date,
      amendment_enforcement_date, amendment_scheduled_enforcement_date,
      current_revision_status, repeal_status, repeal_date, remain_in_force,
      amendment_type, updated, fetched_at, content_hash
    ) VALUES (
      @law_revision_id, @law_id, @law_type, @law_num, @law_title, @law_title_kana,
      @abbrev, @category, @promulgation_date, @amendment_promulgate_date,
      @amendment_enforcement_date, @amendment_scheduled_enforcement_date,
      @current_revision_status, @repeal_status, @repeal_date, @remain_in_force,
      @amendment_type, @updated, @fetched_at, @content_hash
    )
    ON CONFLICT(law_revision_id) DO UPDATE SET
      law_title = excluded.law_title,
      law_title_kana = excluded.law_title_kana,
      abbrev = excluded.abbrev,
      category = excluded.category,
      promulgation_date = excluded.promulgation_date,
      amendment_promulgate_date = excluded.amendment_promulgate_date,
      amendment_enforcement_date = excluded.amendment_enforcement_date,
      amendment_scheduled_enforcement_date = excluded.amendment_scheduled_enforcement_date,
      current_revision_status = excluded.current_revision_status,
      repeal_status = excluded.repeal_status,
      remain_in_force = excluded.remain_in_force,
      amendment_type = excluded.amendment_type,
      updated = excluded.updated,
      fetched_at = excluded.fetched_at,
      content_hash = excluded.content_hash
  `);

  const deleteArticles = db.prepare('DELETE FROM articles WHERE law_revision_id = ?');
  const insertArticle = db.prepare(`
    INSERT INTO articles (law_revision_id, article_num, caption, chapter_path, ord, body, body_raw)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const deleteLawsFts = db.prepare('DELETE FROM laws_fts WHERE law_revision_id = ?');
  const insertLawsFts = db.prepare(`
    INSERT INTO laws_fts (law_revision_id, law_title, law_title_kana, abbrev, law_num, category)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const selectExistingHash = db.prepare('SELECT content_hash FROM laws WHERE law_revision_id = ?');

  // 5) batch transaction
  const ingestBatch = db.transaction((items: PreparedItem[]) => {
    for (const item of items) {
      upsertLaw.run(item.lawRow);
      // articles 全置換
      deleteArticles.run(item.lawRow.law_revision_id);
      let ord = 1;
      for (const a of item.parsed.articles) {
        insertArticle.run(
          item.lawRow.law_revision_id,
          a.article_num,
          a.caption,
          a.chapter_path,
          ord++,
          normalizeJpText(a.body_raw), // body: 検索用 (normalize 済み)
          a.body_raw // body_raw: 表示用 (原文)
        );
      }
      // laws_fts 全置換
      deleteLawsFts.run(item.lawRow.law_revision_id);
      insertLawsFts.run(
        item.lawRow.law_revision_id,
        normalizeJpText(item.lawRow.law_title),
        normalizeNullable(item.lawRow.law_title_kana),
        normalizeNullable(item.lawRow.abbrev),
        normalizeJpText(item.lawRow.law_num),
        normalizeNullable(item.lawRow.category)
      );
    }
  });

  // 6) ループ本体
  let xmlSeen = 0;
  let unchanged = 0;
  let upserted = 0;
  let failed = 0;
  let lastRevisionId: string | undefined;
  let batch: PreparedItem[] = [];

  for (const csvRow of csvRows) {
    const revisionId = csvRow.law_revision_id;
    const xmlReader = findXmlReader(xmlEntries, revisionId);
    if (!xmlReader) {
      // XML ファイルが zip に存在しない (空フォルダ等) → skip
      failed++;
      continue;
    }

    let xmlContent: Buffer;
    let parsed: ParsedLaw;
    try {
      xmlContent = await xmlReader();
      parsed = parseLawXml(xmlContent.toString('utf-8'));
    } catch (err) {
      if (onXmlError === 'throw') {
        throw new IngestError(`XML parse failed for ${revisionId}: ${(err as Error).message}`, err);
      }
      failed++;
      continue;
    }
    xmlSeen++;
    const contentHash = sha256(xmlContent);

    // content_hash 比較で no-op 判定
    const existing = selectExistingHash.get(revisionId) as { content_hash: string } | undefined;
    if (existing && existing.content_hash === contentHash) {
      unchanged++;
      continue;
    }

    const lawRow = buildLawRow({
      csvRow,
      parsed,
      contentHash,
      nowIso,
    });
    batch.push({ lawRow, parsed });
    upserted++;
    lastRevisionId = revisionId;

    if (batch.length >= batchSize) {
      ingestBatch(batch);
      batch = [];
      onProgress?.({
        processed: xmlSeen,
        total: csvRows.length,
        lastLawRevisionId: lastRevisionId,
      });
    }
  }

  if (batch.length > 0) {
    ingestBatch(batch);
    onProgress?.({
      processed: xmlSeen,
      total: csvRows.length,
      lastLawRevisionId: lastRevisionId,
    });
  }

  // 7) sync_state を更新
  upsertSyncState(db, {
    last_sync_date: isoDateOnly(nowIso),
    last_full_dl_at: source === 'all_xml' ? nowIso : null,
    total_laws: csvRows.length,
    bulk_source: source,
  });

  await zip.close();

  return {
    csvRows: csvRows.length,
    xmlSeen,
    unchanged,
    upserted,
    failed,
    durationMs: Date.now() - start,
  };
}

/** ingester 専用エラー */
export class IngestError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'IngestError';
  }
}

/** 内部: 1 法令 ingest に必要な前処理済データ */
interface PreparedItem {
  lawRow: LawRow;
  parsed: ParsedLaw;
}

/** laws テーブル 1 行分。INSERT 用に named parameter として使う */
interface LawRow {
  law_revision_id: string;
  law_id: string;
  law_type: string;
  law_num: string;
  law_title: string;
  law_title_kana: string | null;
  abbrev: string | null;
  category: string | null;
  promulgation_date: string;
  amendment_promulgate_date: string | null;
  amendment_enforcement_date: string | null;
  amendment_scheduled_enforcement_date: string | null;
  current_revision_status: 'CurrentEnforced' | 'UnEnforced' | 'PreviousEnforced' | 'Repeal';
  repeal_status: 'None' | 'Repeal' | 'LossOfEffectiveness' | 'Expire';
  repeal_date: string | null;
  remain_in_force: 0 | 1;
  amendment_type: string | null;
  updated: string;
  fetched_at: string;
  content_hash: string;
}

/** CSV row + parsed XML から laws テーブル row を構築 */
function buildLawRow(args: {
  csvRow: AllLawListRow;
  parsed: ParsedLaw;
  contentHash: string;
  nowIso: string;
}): LawRow {
  const { csvRow, parsed, contentHash, nowIso } = args;
  const promulgation_date = buildPromulgationDate(parsed) ?? '0001-01-01'; // 失敗時 fallback
  const amendment_enforcement_date = formatYyyymmddToIso(csvRow.enforcement_date);

  return {
    law_revision_id: csvRow.law_revision_id,
    law_id: csvRow.law_id,
    law_type: parsed.law_type || guessLawTypeFromLabel(csvRow.law_type_label),
    law_num: parsed.law_num,
    law_title: parsed.law_title,
    law_title_kana: parsed.law_title_kana,
    abbrev: parsed.abbrev,
    category: null, // CSV にカテゴリ列はないため Phase 2-13 の API enrichment で埋める
    promulgation_date,
    amendment_promulgate_date: null, // 和暦テキストのみで ISO 化困難 → 後で API 拡張
    amendment_enforcement_date,
    amendment_scheduled_enforcement_date: null,
    current_revision_status: csvRow.unenforced ? 'UnEnforced' : 'CurrentEnforced',
    repeal_status: 'None',
    repeal_date: null,
    remain_in_force: 0,
    amendment_type: null,
    updated: nowIso,
    fetched_at: nowIso,
    content_hash: contentHash,
  };
}

/** XML 属性 (Era + Year + PromulgateMonth + PromulgateDay) → ISO date */
function buildPromulgationDate(parsed: ParsedLaw): string | null {
  if (!parsed.era || !parsed.year || !parsed.promulgate_month || !parsed.promulgate_day) {
    return null;
  }
  const offset = ERA_OFFSETS[parsed.era];
  if (offset == null) return null;
  const eraYear = parseInt(parsed.year, 10);
  if (!Number.isFinite(eraYear) || eraYear < 1) return null;
  const gregorianYear = offset + eraYear;
  const m = parsed.promulgate_month.padStart(2, '0');
  const d = parsed.promulgate_day.padStart(2, '0');
  return `${gregorianYear}-${m}-${d}`;
}

/** YYYYMMDD → YYYY-MM-DD */
function formatYyyymmddToIso(yyyymmdd: string): string | null {
  if (!/^\d{8}$/.test(yyyymmdd)) return null;
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

/** 和文ラベル (政令 / 法律 / 府省令 等) → API v2 LawType (CabinetOrder / Act / 等) */
function guessLawTypeFromLabel(label: string): string {
  const map: Record<string, string> = {
    法律: 'Act',
    政令: 'CabinetOrder',
    勅令: 'ImperialOrder',
    府省令: 'MinisterialOrdinance',
    規則: 'Rule',
    閣令: 'CabinetOrder',
    省令: 'MinisterialOrdinance',
  };
  return map[label] ?? 'Act'; // 不明時は Act にフォールバック
}

/** sync_state を upsert (single-row, id=1) */
function upsertSyncState(
  db: DatabaseT.Database,
  args: {
    last_sync_date: string;
    last_full_dl_at: string | null;
    total_laws: number;
    bulk_source: string;
  }
): void {
  const existing = db.prepare('SELECT last_full_dl_at FROM sync_state WHERE id = 1').get() as
    | { last_full_dl_at: string }
    | undefined;
  const last_full_dl_at = args.last_full_dl_at ?? existing?.last_full_dl_at ?? args.last_sync_date;

  db.prepare(
    `INSERT INTO sync_state (id, last_sync_date, last_full_dl_at, total_laws, bulk_source)
     VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       last_sync_date = excluded.last_sync_date,
       last_full_dl_at = excluded.last_full_dl_at,
       total_laws = excluded.total_laws,
       bulk_source = excluded.bulk_source`
  ).run(args.last_sync_date, last_full_dl_at, args.total_laws, args.bulk_source);
}

/** revisionId 完全一致で xmlEntries から reader を引く */
function findXmlReader(
  xmlEntries: Map<string, () => Promise<Buffer>>,
  revisionId: string
): (() => Promise<Buffer>) | undefined {
  // ファイル名は `{revisionId}.xml` 形式
  const expected = `${revisionId}.xml`;
  return xmlEntries.get(expected);
}

/** path から basename を取り出す (\\ / 両対応) */
function baseName(p: string): string {
  const n = p.replace(/\\/g, '/');
  const idx = n.lastIndexOf('/');
  return idx >= 0 ? n.slice(idx + 1) : n;
}

/** null 許容列向けの normalizeJpText (null はそのまま) */
function normalizeNullable(v: string | null): string | null {
  return v == null ? null : normalizeJpText(v);
}

/** Buffer の SHA-256 hex */
function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** ISO 8601 timestamp → YYYY-MM-DD */
function isoDateOnly(iso: string): string {
  return iso.slice(0, 10);
}

// CSV_PATTERN は将来的に多 csv 検出が必要な場合に使う。現時点では不使用だが
// API/将来拡張のための remnant として保持する (lint 回避のため明示的に void)
void CSV_PATTERN;
