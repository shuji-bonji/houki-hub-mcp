/**
 * MCP Tool Handlers
 *
 * NOTE: Phase 0 スケルトンのため、実装はスタブ。
 * Phase 1 で e-Gov API v2 クライアントと接続する。
 */

import { resolveAbbreviation } from '../abbreviations/index.js';
import type {
  SearchLawArgs,
  GetLawArgs,
  GetTocArgs,
  SearchFulltextArgs,
} from '../types/index.js';

const NOT_IMPLEMENTED = {
  status: 'not_implemented',
  phase: 'Phase 0 (skeleton)',
  note: 'この tool は Phase 1 で実装予定。現在は略称辞書のみ動作する。',
};

/**
 * search_law — 法令検索（スタブ）
 */
export async function handleSearchLaw(args: SearchLawArgs) {
  return {
    tool: 'search_law',
    args,
    ...NOT_IMPLEMENTED,
  };
}

/**
 * get_law — 条文取得（スタブ）
 *
 * 動作するのは略称解決のみ。実 API 呼び出しは Phase 1。
 */
export async function handleGetLaw(args: GetLawArgs) {
  const resolved = resolveAbbreviation(args.law_name);
  return {
    tool: 'get_law',
    args,
    resolved_abbreviation: resolved,
    ...NOT_IMPLEMENTED,
  };
}

/**
 * get_toc — 目次取得（スタブ）
 */
export async function handleGetToc(args: GetTocArgs) {
  const resolved = resolveAbbreviation(args.law_name);
  return {
    tool: 'get_toc',
    args,
    resolved_abbreviation: resolved,
    ...NOT_IMPLEMENTED,
  };
}

/**
 * search_fulltext — 全文検索（スタブ）
 */
export async function handleSearchFulltext(args: SearchFulltextArgs) {
  return {
    tool: 'search_fulltext',
    args,
    ...NOT_IMPLEMENTED,
  };
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
 * Tool handlers map
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const toolHandlers: Record<string, (args: any) => Promise<unknown>> = {
  search_law: handleSearchLaw,
  get_law: handleGetLaw,
  get_toc: handleGetToc,
  search_fulltext: handleSearchFulltext,
  resolve_abbreviation: handleResolveAbbreviation,
};
