/**
 * MCP Tool Handlers — houki-egov-mcp
 *
 * e-Gov 法令API v2 と接続する本実装。
 * search_fulltext は Phase 2-7 (v0.5.0) からローカル SQLite FTS5 (bulk DL 済み DB) を引く。
 * bulk DL 未実行のときは search_law (タイトル検索) にフォールバックする。
 */

import { resolveAbbreviation } from '@shuji-bonji/houki-abbreviations';
import { LIMITS } from '../constants.js';
import { closeDb, openDb } from '../db/index.js';
import { NEXT_ACTIONS } from '../errors.js';
import { findLawHierarchy, listLawHierarchyNames } from '../knowledge/law-hierarchy.js';
import { type FreshnessInfo, summarizeFreshness } from '../services/freshness.js';
import {
  hasAnyArticle,
  type LawScope,
  type LawSearchHit,
  searchLawsInDb,
} from '../services/law-search.js';
import {
  getLawArticle,
  getLawRevisionsByName,
  getLawToc,
  searchLawByKeyword,
} from '../services/law-service.js';
import type { GetLawArgs, GetTocArgs, SearchFulltextArgs, SearchLawArgs } from '../types/index.js';
import { logger } from '../utils/logger.js';

/**
 * search_law — 法令検索
 */
export async function handleSearchLaw(args: SearchLawArgs) {
  return searchLawByKeyword({
    keyword: args.keyword,
    law_type: args.law_type,
    limit: args.limit,
  });
}

/**
 * get_law — 条文取得
 *
 * - article 未指定 + format!="json" → TOC を返す
 * - article 指定 → 該当条文を Markdown で返す
 * - paragraph / item で粒度を指定可能
 */
export async function handleGetLaw(args: GetLawArgs) {
  return getLawArticle({
    law_name: args.law_name,
    article: args.article,
    paragraph: args.paragraph,
    item: args.item,
    format: (args.format as 'markdown' | 'json' | 'toc' | undefined) ?? 'markdown',
    at: args.at,
  });
}

/**
 * get_toc — 目次取得
 *
 * depth を指定すると上位 N 階層までで打ち切る。
 * 民法・会社法のような大規模法令で TOC が肥大化する場合のサイズ対策。
 */
export async function handleGetToc(args: GetTocArgs) {
  return getLawToc({
    law_name: args.law_name,
    at: args.at,
    depth: args.depth,
  });
}

/** search_fulltext の bulk DB 応答 */
export interface SearchFulltextBulkResponse {
  keyword: string;
  /** 略称辞書で OR 展開した場合の元と先 */
  expanded_keywords?: { from: string; to: string };
  /** クエリ中の法令名を検索対象の法令として解釈した結果 (「民法 不法行為」の「民法」) */
  law_scope?: LawScope[];
  source: 'bulk';
  count: number;
  hits: LawSearchHit[];
  /** bulk DB の鮮度 (sync_state 由来)。outdated なら warning 付き */
  freshness: FreshnessInfo | null;
  filters: {
    law_type: string | null;
    /** domain は laws.category が Phase 2-13 まで未投入のため受け付けるが絞り込みは行わない */
    domain: { requested: string | null; applied: false; note: string };
  };
}

/** search_fulltext の API フォールバック応答 (v0.3.x までと同じ `note` / `fallback` を保持) */
export interface SearchFulltextFallbackResponse {
  keyword: string;
  source: 'api-fallback';
  note: string;
  next_actions: Array<{ action: string; reason: string; example?: Record<string, unknown> }>;
  fallback: unknown;
}

const DOMAIN_NOT_APPLIED_NOTE =
  'domain 絞り込みは v0.5.0 では未実効です (bulk DB の category 列が Phase 2-13 の API enrichment まで空のため)';

/**
 * search_fulltext — 全文検索 (Phase 2-7 本実装)
 *
 * 1. bulk DB を開く (`deps.dbPath` 省略時は `defaultDbPath()`)
 * 2. `hasAnyArticle` が false (bulk DL 未実行) → search_law フォールバック + 誘導 note
 * 3. `searchLawsInDb` (articles_fts + laws_fts → JOIN laws → scoring → limit)
 * 4. freshness を付与 (outdated でも DB 結果を返す。API に倒さない)
 *
 * `deps.dbPath` はテスト用の注入口 (`:memory:` 等)。
 */
export async function handleSearchFulltext(
  args: SearchFulltextArgs,
  deps: { dbPath?: string } = {}
): Promise<SearchFulltextBulkResponse | SearchFulltextFallbackResponse> {
  const keyword = (args.keyword ?? '').trim();
  const limit = Math.min(Math.max(args.limit ?? LIMITS.fulltextDefault, 1), LIMITS.fulltextMax);

  let db: ReturnType<typeof openDb> | null = null;
  try {
    db = openDb(deps.dbPath);
  } catch (err) {
    // DB を開けない (権限・ディスク等) 場合も API フォールバックで応答する
    logger.warn('search_fulltext', `bulk DB open failed: ${(err as Error).message}`);
    return searchFulltextFallback(args, keyword, limit, 'bulk DB を開けなかったため');
  }

  try {
    if (!hasAnyArticle(db)) {
      return searchFulltextFallback(args, keyword, limit, 'bulk DL 未実行のため');
    }

    const result = searchLawsInDb(db, keyword, { limit, lawType: args.law_type });
    const freshness = summarizeFreshness(db);

    const response: SearchFulltextBulkResponse = {
      keyword,
      source: 'bulk',
      count: result.hits.length,
      hits: result.hits,
      freshness,
      filters: {
        law_type: args.law_type ?? null,
        domain: {
          requested: args.domain ?? null,
          applied: false,
          note: DOMAIN_NOT_APPLIED_NOTE,
        },
      },
    };
    if (result.expanded) response.expanded_keywords = result.expanded;
    if (result.law_scope) response.law_scope = result.law_scope;
    return response;
  } finally {
    closeDb(db);
  }
}

/** bulk DB が使えないときの search_law フォールバック */
async function searchFulltextFallback(
  args: SearchFulltextArgs,
  keyword: string,
  limit: number,
  why: string
): Promise<SearchFulltextFallbackResponse> {
  const fallback = await searchLawByKeyword({
    keyword,
    law_type: args.law_type,
    limit,
  });
  return {
    keyword,
    source: 'api-fallback',
    note: `${why}、search_law (法令名のタイトル一致) にフォールバックしています。条文本文の全文検索を有効にするには \`houki-egov-mcp --bulk-download-everything\` でローカル DB を構築してください`,
    next_actions: [
      {
        action: 'bulk_download_everything',
        reason: 'CLI でローカル bulk DB を構築すると search_fulltext が SQLite FTS5 で動作します',
        example: { command: 'houki-egov-mcp --bulk-download-everything' },
      },
      NEXT_ACTIONS.searchLaw(keyword),
    ],
    fallback,
  };
}

/**
 * get_law_revisions — 法令の改正履歴取得
 */
export async function handleGetLawRevisions(args: { law_name: string; latest?: number }) {
  return getLawRevisionsByName(args);
}

/**
 * resolve_abbreviation — 略称解決（@shuji-bonji/houki-abbreviations 経由）
 */
export async function handleResolveAbbreviation(args: { abbr: string }) {
  const result = resolveAbbreviation(args.abbr);
  if (!result) {
    // ABBREVIATION_NOT_FOUND は致命的ではないため、エラー応答ではなく
    // 既存の {abbr, resolved: null, note} 形を維持して後方互換を保つ。
    // ただし next_actions を付け、LLM が次に search_law を試せるようにする。
    return {
      abbr: args.abbr,
      resolved: null,
      note: '辞書に該当なし。フル法令名でお試しください',
      next_actions: [NEXT_ACTIONS.searchLaw(args.abbr)],
    };
  }
  return {
    abbr: args.abbr,
    resolved: result,
  };
}

/**
 * explain_law_type — 法令種別の解説
 *
 * 法務専門家でない利用者が「政令と省令の違い」「通達は守らなくていいのか」を
 * 確認するための知識ツール。
 */
export async function handleExplainLawType(args: { name: string }) {
  const entry = findLawHierarchy(args.name);
  if (!entry) {
    // 既存形を維持（テストとの後方互換）。next_actions のみ補足。
    return {
      name: args.name,
      found: false,
      hint: `知らない法令種別です。試せる名前: ${listLawHierarchyNames().join(', ')}`,
      see_also: 'docs/LAW-HIERARCHY.md',
      next_actions: [
        {
          action: 'list_known_law_types',
          reason: '知られている法令種別は次のとおり',
          example: { names: listLawHierarchyNames() },
        },
      ],
    };
  }
  return {
    name: args.name,
    found: true,
    info: entry,
    related_tools: ['search_law', 'get_law', 'get_toc'],
    see_also: 'docs/LAW-HIERARCHY.md',
  };
}

/**
 * Tool handlers map
 */
// biome-ignore lint/suspicious/noExplicitAny: 各 handler の引数型が異なるため、dispatch 表では any で受ける
export const toolHandlers: Record<string, (args: any) => Promise<unknown>> = {
  search_law: handleSearchLaw,
  get_law: handleGetLaw,
  get_toc: handleGetToc,
  get_law_revisions: handleGetLawRevisions,
  search_fulltext: handleSearchFulltext,
  resolve_abbreviation: handleResolveAbbreviation,
  explain_law_type: handleExplainLawType,
};
