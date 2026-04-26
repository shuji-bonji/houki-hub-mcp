/**
 * 法令操作の高レベル API。
 *
 * - 略称解決 → law_id 解決 → 本文取得 → 整形
 * - LRU cache で /law_data の応答を保持（時点指定 at もキーに含む）
 * - HTTP / parse / 該当なし のエラーを統一形で返す
 */

import {
  searchLaws,
  getLawData,
  getLawRevisions,
  EgovHttpError,
  type EgovLawDataResponse,
  type LawListItem,
  type RevisionInfo,
} from './egov-client.js';
import {
  findArticle,
  findItem,
  findParagraph,
  extractToc,
  type TocNode,
  type LawNode,
} from './law-tree.js';
import { resolveAbbreviation } from '@shuji-bonji/houki-abbreviations';
import { formatArticleMarkdown, formatTocMarkdown } from '../formatters/markdown.js';
import { LRUCache } from '../utils/cache.js';
import { CACHE_CONFIG, EGOV_API } from '../config.js';
import { toEgovArticleNum } from '../utils/article-num.js';
import { logger } from '../utils/logger.js';

/** 法令本文（パース済み）のキャッシュ。キーは `${law_id}:${at ?? 'current'}` */
const lawDataCache = new LRUCache<string, EgovLawDataResponse>(
  CACHE_CONFIG.parsed.maxSize,
  CACHE_CONFIG.parsed.name
);

/** 検索結果のキャッシュ。キーは検索パラメータの正規化文字列 */
const searchCache = new LRUCache<string, LawListItem[]>(
  CACHE_CONFIG.searchResults.maxSize,
  CACHE_CONFIG.searchResults.name
);

/** 共通エラー型 */
export interface LawServiceError {
  error: string;
  hint?: string;
}

export type LawServiceResult<T> = T | LawServiceError;

export function isError<T>(r: LawServiceResult<T>): r is LawServiceError {
  return typeof r === 'object' && r !== null && 'error' in r;
}

/**
 * 略称または法令名から law_id を解決する。
 *
 * 1. 略称辞書で law_id が直接取れる場合はそれを返す
 * 2. 取れない場合、formal で検索 API を叩く
 * 3. 完全一致を最優先、なければ先頭結果
 */
export async function resolveLawId(
  lawName: string
): Promise<{ law_id: string; title: string; law_num?: string } | null> {
  const trimmed = lawName.trim();
  if (!trimmed) return null;

  const abbr = resolveAbbreviation(trimmed);
  if (abbr?.law_id) {
    return { law_id: abbr.law_id, title: abbr.formal, law_num: abbr.law_num };
  }

  const searchTitle = abbr?.formal ?? trimmed;
  try {
    const res = await searchLaws({ law_title: searchTitle, limit: 5 });
    if (res.laws.length === 0) return null;
    // 完全一致を優先
    const exact = res.laws.find((l) => l.revision_info.law_title === searchTitle);
    const top = exact ?? res.laws[0];
    return {
      law_id: top.law_info.law_id,
      title: top.revision_info.law_title,
      law_num: top.law_info.law_num,
    };
  } catch (err) {
    logger.warn('law-service', `resolveLawId failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * 法令本文を取得（キャッシュ経由）
 */
async function fetchLawData(lawId: string, at?: string): Promise<EgovLawDataResponse> {
  const cacheKey = `${lawId}:${at ?? 'current'}`;
  const cached = lawDataCache.get(cacheKey);
  if (cached) return cached;
  const fresh = await getLawData(lawId, { at });
  lawDataCache.set(cacheKey, fresh);
  return fresh;
}

/**
 * search_law ツールの本実装
 */
export async function searchLawByKeyword(opts: {
  keyword: string;
  law_type?: string;
  limit?: number;
}): Promise<
  LawServiceResult<{
    query: { keyword: string; law_type?: string; resolved?: string };
    total_count: number;
    results: Array<{
      law_id: string;
      title: string;
      law_num: string;
      law_type: string;
      promulgation_date?: string;
      url: string;
    }>;
  }>
> {
  const trimmed = opts.keyword.trim();
  if (!trimmed) return { error: 'keyword が空です' };

  // 略称が当たれば formal を使って検索
  const abbr = resolveAbbreviation(trimmed);
  const searchTitle = abbr?.formal ?? trimmed;

  const cacheKey = `${searchTitle}|${opts.law_type ?? ''}|${opts.limit ?? 10}`;
  let laws = searchCache.get(cacheKey);

  if (!laws) {
    try {
      const res = await searchLaws({
        law_title: searchTitle,
        law_type: opts.law_type,
        limit: opts.limit ?? 10,
      });
      laws = res.laws;
      searchCache.set(cacheKey, laws);
    } catch (err) {
      const msg =
        err instanceof EgovHttpError ? `e-Gov API error: ${err.message}` : (err as Error).message;
      return { error: msg };
    }
  }

  return {
    query: {
      keyword: opts.keyword,
      law_type: opts.law_type,
      resolved: abbr ? abbr.formal : undefined,
    },
    total_count: laws.length,
    results: laws.map((l) => ({
      law_id: l.law_info.law_id,
      title: l.revision_info.law_title,
      law_num: l.law_info.law_num,
      law_type: l.law_info.law_type,
      promulgation_date: l.law_info.promulgation_date,
      url: EGOV_API.publicLawUrl(l.law_info.law_id),
    })),
  };
}

/**
 * get_law ツールの本実装
 */
export async function getLawArticle(opts: {
  law_name: string;
  article?: string;
  paragraph?: number;
  item?: number;
  format?: 'markdown' | 'json' | 'toc';
  at?: string;
}): Promise<
  LawServiceResult<
    | { format: 'markdown'; markdown: string; meta: ArticleMeta }
    | { format: 'json'; data: ArticleJson; meta: ArticleMeta }
    | { format: 'toc'; markdown: string; meta: ArticleMeta }
  >
> {
  const resolved = await resolveLawId(opts.law_name);
  if (!resolved) {
    return {
      error: `法令が見つかりません: ${opts.law_name}`,
      hint: '略称辞書 / e-Gov 法令検索で該当なし。表記を確認してください',
    };
  }

  let lawData: EgovLawDataResponse;
  try {
    lawData = await fetchLawData(resolved.law_id, opts.at);
  } catch (err) {
    return {
      error: `e-Gov API error: ${(err as Error).message}`,
      hint: '時間をおいて再試行するか、e-Gov サイトで直接ご確認ください',
    };
  }

  const retrievedAt = new Date().toISOString();

  // toc モード: 目次のみ
  if (opts.format === 'toc' || (!opts.article && opts.format !== 'json')) {
    const toc = extractToc(lawData.law_full_text);
    const markdown = formatTocMarkdown({
      lawTitle: resolved.title,
      lawId: resolved.law_id,
      toc,
      retrievedAt,
      at: opts.at,
    });
    return {
      format: 'toc',
      markdown,
      meta: {
        law_id: resolved.law_id,
        title: resolved.title,
        law_num: resolved.law_num,
        retrieved_at: retrievedAt,
        url: EGOV_API.publicLawUrl(resolved.law_id),
      },
    };
  }

  // article 指定なし & json モード: メタ情報のみ
  if (!opts.article) {
    return {
      error: 'article（条番号）を指定してください',
      hint: '目次が必要な場合は format: "toc" を、または get_toc ツールを使ってください',
    };
  }

  // article 指定あり: 該当条文を取得
  let articleNum: string;
  try {
    articleNum = toEgovArticleNum(opts.article);
  } catch (err) {
    return { error: (err as Error).message };
  }

  const article = findArticle(lawData.law_full_text, articleNum);
  if (!article) {
    return {
      error: `条文が見つかりません: 第${opts.article}条 in ${resolved.title}`,
      hint: '法令名・条番号を確認してください。format: "toc" で目次を確認できます',
    };
  }

  let paragraph: LawNode | null = null;
  let item: LawNode | null = null;
  if (opts.paragraph !== undefined) {
    paragraph = findParagraph(article, opts.paragraph);
    if (!paragraph) {
      return { error: `項が見つかりません: 第${opts.paragraph}項 (Article ${opts.article})` };
    }
    if (opts.item !== undefined) {
      item = findItem(paragraph, opts.item);
      if (!item) {
        return { error: `号が見つかりません: 第${opts.item}号 (Paragraph ${opts.paragraph})` };
      }
    }
  }

  const meta: ArticleMeta = {
    law_id: resolved.law_id,
    title: resolved.title,
    law_num: resolved.law_num,
    retrieved_at: retrievedAt,
    url: EGOV_API.publicLawUrl(resolved.law_id),
    at: opts.at,
  };

  if (opts.format === 'json') {
    return {
      format: 'json',
      data: {
        article_num: articleNum,
        paragraph_num: opts.paragraph,
        item_num: opts.item,
        node: item ?? paragraph ?? article,
      },
      meta,
    };
  }

  const markdown = formatArticleMarkdown({
    lawTitle: resolved.title,
    lawId: resolved.law_id,
    article,
    paragraph: paragraph ?? undefined,
    item: item ?? undefined,
    retrievedAt,
    at: opts.at,
  });
  return { format: 'markdown', markdown, meta };
}

/**
 * get_toc ツールの本実装
 */
export async function getLawToc(opts: { law_name: string; at?: string }): Promise<
  LawServiceResult<{
    markdown: string;
    toc: TocNode[];
    meta: ArticleMeta;
  }>
> {
  const resolved = await resolveLawId(opts.law_name);
  if (!resolved) {
    return {
      error: `法令が見つかりません: ${opts.law_name}`,
    };
  }
  let lawData: EgovLawDataResponse;
  try {
    lawData = await fetchLawData(resolved.law_id, opts.at);
  } catch (err) {
    return { error: `e-Gov API error: ${(err as Error).message}` };
  }
  const retrievedAt = new Date().toISOString();
  const toc = extractToc(lawData.law_full_text);
  const markdown = formatTocMarkdown({
    lawTitle: resolved.title,
    lawId: resolved.law_id,
    toc,
    retrievedAt,
    at: opts.at,
  });
  return {
    markdown,
    toc,
    meta: {
      law_id: resolved.law_id,
      title: resolved.title,
      law_num: resolved.law_num,
      retrieved_at: retrievedAt,
      url: EGOV_API.publicLawUrl(resolved.law_id),
      at: opts.at,
    },
  };
}

/** ツールが返すメタ情報 */
export interface ArticleMeta {
  law_id: string;
  title: string;
  law_num?: string;
  retrieved_at: string;
  url: string;
  at?: string;
}

/** JSON 出力時の構造化データ */
export interface ArticleJson {
  article_num: string;
  paragraph_num?: number;
  item_num?: number;
  node: LawNode;
}

/**
 * get_law_revisions ツールの本実装
 *
 * 法令の改正履歴を取得する。
 * - 略称→正式名解決→law_id 解決を経由
 * - latest=N で最新N件のみ返却（デフォルトは全件）
 */
export async function getLawRevisionsByName(opts: { law_name: string; latest?: number }): Promise<
  LawServiceResult<{
    meta: ArticleMeta;
    total: number;
    revisions: Array<{
      law_revision_id: string;
      amendment_promulgate_date?: string;
      amendment_enforcement_date?: string;
      amendment_enforcement_comment?: string | null;
      amendment_law_num?: string | null;
      amendment_law_title?: string | null;
      amendment_law_id?: string | null;
      current_revision_status?: string;
    }>;
  }>
> {
  const resolved = await resolveLawId(opts.law_name);
  if (!resolved) {
    return { error: `法令が見つかりません: ${opts.law_name}` };
  }
  let res;
  try {
    res = await getLawRevisions(resolved.law_id);
  } catch (err) {
    const msg =
      err instanceof EgovHttpError ? `e-Gov API error: ${err.message}` : (err as Error).message;
    return { error: msg };
  }
  const all = res.revisions ?? [];
  const trimmed = opts.latest && opts.latest > 0 ? all.slice(0, opts.latest) : all;
  const retrievedAt = new Date().toISOString();
  return {
    meta: {
      law_id: resolved.law_id,
      title: resolved.title,
      law_num: resolved.law_num,
      retrieved_at: retrievedAt,
      url: EGOV_API.publicLawUrl(resolved.law_id),
    },
    total: all.length,
    revisions: trimmed.map((r: RevisionInfo) => ({
      law_revision_id: r.law_revision_id,
      amendment_promulgate_date: r.amendment_promulgate_date,
      amendment_enforcement_date: r.amendment_enforcement_date,
      amendment_enforcement_comment: r.amendment_enforcement_comment,
      amendment_law_num: r.amendment_law_num,
      amendment_law_title: r.amendment_law_title,
      amendment_law_id: r.amendment_law_id,
      current_revision_status: r.current_revision_status,
    })),
  };
}

/** テスト用にキャッシュをクリアする */
export function _resetCachesForTest(): void {
  lawDataCache.clear();
  searchCache.clear();
}
