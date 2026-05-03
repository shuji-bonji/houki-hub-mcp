/**
 * MCP Tool Handlers — houki-egov-mcp
 *
 * e-Gov 法令API v2 と接続する本実装。
 * search_fulltext のみ Phase 2 まではコア機能のフォールバックを返す。
 */

import { resolveAbbreviation } from '@shuji-bonji/houki-abbreviations';
import { findLawHierarchy, listLawHierarchyNames } from '../knowledge/law-hierarchy.js';
import {
  searchLawByKeyword,
  getLawArticle,
  getLawToc,
  getLawRevisionsByName,
} from '../services/law-service.js';
import type { SearchLawArgs, GetLawArgs, GetTocArgs, SearchFulltextArgs } from '../types/index.js';
import { NEXT_ACTIONS } from '../errors.js';

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

/**
 * search_fulltext — 全文検索
 *
 * Phase 2 で SQLite FTS5 によるローカル全文検索を実装予定。
 * 現状は search_law にフォールバック（タイトル検索）して旨を返す。
 */
export async function handleSearchFulltext(args: SearchFulltextArgs) {
  const fallback = await searchLawByKeyword({
    keyword: args.keyword,
    law_type: args.law_type,
    limit: args.limit,
  });
  return {
    note: 'search_fulltext の本実装は Phase 2（bulkDL + SQLite FTS5）。現状は search_law（タイトル一致）にフォールバックしています',
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const toolHandlers: Record<string, (args: any) => Promise<unknown>> = {
  search_law: handleSearchLaw,
  get_law: handleGetLaw,
  get_toc: handleGetToc,
  get_law_revisions: handleGetLawRevisions,
  search_fulltext: handleSearchFulltext,
  resolve_abbreviation: handleResolveAbbreviation,
  explain_law_type: handleExplainLawType,
};
