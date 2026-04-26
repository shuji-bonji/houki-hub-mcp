/**
 * MCP Tool Handlers
 *
 * Phase 1: e-Gov 法令API v2 と接続する本実装。
 * search_fulltext のみ Phase 2 まではコア機能のフォールバックを返す。
 */

import { resolveAbbreviation } from '../abbreviations/index.js';
import { findLawHierarchy, listLawHierarchyNames } from '../knowledge/law-hierarchy.js';
import {
  findBusinessLawRestriction,
  listBusinessLawProfessions,
} from '../knowledge/business-law-restrictions.js';
import {
  searchLawByKeyword,
  getLawArticle,
  getLawToc,
  getLawRevisionsByName,
} from '../services/law-service.js';
import type { SearchLawArgs, GetLawArgs, GetTocArgs, SearchFulltextArgs } from '../types/index.js';

/**
 * search_law — 法令検索（Phase 1 実装）
 */
export async function handleSearchLaw(args: SearchLawArgs) {
  return searchLawByKeyword({
    keyword: args.keyword,
    law_type: args.law_type,
    limit: args.limit,
  });
}

/**
 * get_law — 条文取得（Phase 1 実装）
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
 * get_toc — 目次取得（Phase 1 実装）
 */
export async function handleGetToc(args: GetTocArgs) {
  return getLawToc({
    law_name: args.law_name,
    at: args.at,
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
 * get_law_revisions — 法令の改正履歴取得（v0.1.1 で追加、e-Gov コア完成）
 */
export async function handleGetLawRevisions(args: { law_name: string; latest?: number }) {
  return getLawRevisionsByName(args);
}

/**
 * resolve_abbreviation — 略称解決（Phase 0 で動作）
 */
export async function handleResolveAbbreviation(args: { abbr: string }) {
  const result = resolveAbbreviation(args.abbr);
  if (!result) {
    return {
      abbr: args.abbr,
      resolved: null,
      note: '辞書に該当なし。フル法令名でお試しください',
    };
  }
  return {
    abbr: args.abbr,
    resolved: result,
  };
}

/**
 * explain_law_type — 法令種別の解説（Phase 0 で動作）
 *
 * 法務専門家でない利用者が「政令と省令の違い」「通達は守らなくていいのか」を
 * 確認するための知識ツール。
 */
export async function handleExplainLawType(args: { name: string }) {
  const entry = findLawHierarchy(args.name);
  if (!entry) {
    return {
      name: args.name,
      found: false,
      hint: `知らない法令種別です。試せる名前: ${listLawHierarchyNames().join(', ')}`,
      see_also: 'docs/LAW-HIERARCHY.md',
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
 * explain_business_law_restriction — 士業独占規定の解説（Phase 0 で動作）
 *
 * 利用者が「houki-hub-mcp + LLM の活用が業法に抵触しないか」を判断するための知識ツール。
 */
export async function handleExplainBusinessLawRestriction(args: { name: string }) {
  const entry = findBusinessLawRestriction(args.name);
  if (!entry) {
    return {
      name: args.name,
      found: false,
      hint: `知らない士業／業法です。試せる名前: ${listBusinessLawProfessions().join(', ')}`,
      see_also: 'DISCLAIMER.md',
    };
  }
  return {
    name: args.name,
    found: true,
    info: entry,
    related_tools: ['explain_law_type', 'get_law'],
    see_also: 'DISCLAIMER.md',
    disclaimer:
      '本データは法令の概要を示すものであり、個別事案の判断は有資格者に相談してください。境界事例は判例・通達でも解釈が分かれることがあります。',
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
  explain_business_law_restriction: handleExplainBusinessLawRestriction,
};
