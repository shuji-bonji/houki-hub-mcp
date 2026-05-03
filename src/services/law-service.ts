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
  limitTocDepth,
  countTocNodes,
  type TocNode,
  type LawNode,
} from './law-tree.js';
import { resolveAbbreviation } from '@shuji-bonji/houki-abbreviations';
import { formatArticleMarkdown, formatTocMarkdown } from '../formatters/markdown.js';
import { LRUCache } from '../utils/cache.js';
import { CACHE_CONFIG, EGOV_API } from '../config.js';
import { toEgovArticleNum } from '../utils/article-num.js';
import { logger } from '../utils/logger.js';
import {
  makeError,
  isLawServiceError as _isLawServiceError,
  NEXT_ACTIONS,
  type LawServiceError,
} from '../errors.js';

/**
 * EgovHttpError などの例外を、LLM 可読な LawServiceError に変換する。
 * code / hint / next_actions / retryable を含む統一形にすることで、
 * 呼び出し側 LLM が「次に何をすべきか」を判断しやすくする。
 */
function egovHttpErrorToLawError(err: unknown): LawServiceError {
  if (err instanceof EgovHttpError) {
    if (err.status === 429) {
      return makeError('EGOV_RATE_LIMITED', 'e-Gov API がレート制限を返しました（429）', {
        hint: '短時間に多数のリクエストを送るとレート制限が発動します',
        retryable: true,
        next_actions: [NEXT_ACTIONS.retryLater()],
        detail: { status: err.status, url: err.url },
      });
    }
    if (err.status === 0) {
      return makeError('EGOV_TIMEOUT', 'e-Gov API がタイムアウトしました', {
        hint: 'ネットワーク状態を確認するか、時間をおいて再試行してください',
        retryable: true,
        next_actions: [NEXT_ACTIONS.retryLater(), NEXT_ACTIONS.visitEgovSite()],
        detail: { url: err.url },
      });
    }
    if (err.status >= 500) {
      return makeError(
        'EGOV_API_ERROR',
        `e-Gov API がサーバーエラーを返しました（${err.status}）`,
        {
          hint: 'e-Gov 側の一時的障害の可能性があります',
          retryable: true,
          next_actions: [NEXT_ACTIONS.retryLater(), NEXT_ACTIONS.visitEgovSite()],
          detail: { status: err.status, url: err.url },
        }
      );
    }
    return makeError('EGOV_API_ERROR', `e-Gov API error: ${err.message}`, {
      retryable: false,
      detail: { status: err.status, url: err.url },
    });
  }
  const cause = err instanceof Error ? err.message : String(err);
  return makeError('EGOV_API_ERROR', `e-Gov API 呼び出しに失敗しました: ${cause}`, {
    retryable: true,
    next_actions: [NEXT_ACTIONS.retryLater()],
    detail: { cause },
  });
}

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

/** 共通エラー型 (re-export) — 詳細は src/errors.ts */
export type { LawServiceError } from '../errors.js';

export type LawServiceResult<T> = T | LawServiceError;

export function isError<T>(r: LawServiceResult<T>): r is LawServiceError {
  return _isLawServiceError(r);
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
  if (!trimmed) {
    return makeError('INVALID_ARGUMENT', 'keyword が空です', {
      hint: '検索したい法令名・略称・キーワード（例: "消費税", "労基"）を指定してください',
    });
  }

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
      return egovHttpErrorToLawError(err);
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
    return makeError('LAW_NOT_FOUND', `法令が見つかりません: ${opts.law_name}`, {
      hint: '略称辞書 / e-Gov 法令検索で該当なし。表記を確認してください',
      next_actions: [
        NEXT_ACTIONS.resolveAbbreviation(opts.law_name),
        NEXT_ACTIONS.searchLaw(opts.law_name),
      ],
    });
  }

  let lawData: EgovLawDataResponse;
  try {
    lawData = await fetchLawData(resolved.law_id, opts.at);
  } catch (err) {
    return egovHttpErrorToLawError(err);
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
    return makeError('INVALID_ARGUMENT', 'article（条番号）を指定してください', {
      hint: '目次が必要な場合は format: "toc" を、または get_toc ツールを使ってください',
      next_actions: [NEXT_ACTIONS.getToc(opts.law_name)],
    });
  }

  // article 指定あり: 該当条文を取得
  let articleNum: string;
  try {
    articleNum = toEgovArticleNum(opts.article);
  } catch (err) {
    return makeError('INVALID_ARTICLE_NUM', (err as Error).message, {
      hint: '条番号は半角数字（例: "30"）または "30の2" 形式で指定してください',
    });
  }

  const article = findArticle(lawData.law_full_text, articleNum);
  if (!article) {
    return makeError(
      'ARTICLE_NOT_FOUND',
      `条文が見つかりません: 第${opts.article}条 in ${resolved.title}`,
      {
        hint: '法令名・条番号を確認してください。format: "toc" で目次を確認できます',
        next_actions: [NEXT_ACTIONS.getToc(opts.law_name)],
      }
    );
  }

  let paragraph: LawNode | null = null;
  let item: LawNode | null = null;
  if (opts.paragraph !== undefined) {
    paragraph = findParagraph(article, opts.paragraph);
    if (!paragraph) {
      return makeError(
        'ARTICLE_NOT_FOUND',
        `項が見つかりません: 第${opts.paragraph}項 (Article ${opts.article})`,
        {
          hint: '項番号は 1 始まりで指定してください。条文全体が必要なら paragraph を省略してください',
        }
      );
    }
    if (opts.item !== undefined) {
      item = findItem(paragraph, opts.item);
      if (!item) {
        return makeError(
          'ARTICLE_NOT_FOUND',
          `号が見つかりません: 第${opts.item}号 (Paragraph ${opts.paragraph})`,
          {
            hint: '号番号は 1 始まりで指定してください。項全体が必要なら item を省略してください',
          }
        );
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
 *
 * - depth を指定すると上位 N 階層までで打ち切る（民法・会社法のような
 *   大規模法令でレスポンスサイズを抑える用途）
 * - depth=undefined で全階層
 */
export async function getLawToc(opts: { law_name: string; at?: string; depth?: number }): Promise<
  LawServiceResult<{
    markdown: string;
    toc: TocNode[];
    meta: ArticleMeta;
    /** TOC ノード総数。トリミング前/後どちらの値かは truncated を見て判断 */
    node_count: number;
    /** depth 指定で枝を刈ったかどうか */
    truncated: boolean;
  }>
> {
  const resolved = await resolveLawId(opts.law_name);
  if (!resolved) {
    return makeError('LAW_NOT_FOUND', `法令が見つかりません: ${opts.law_name}`, {
      hint: '略称辞書 / e-Gov 法令検索で該当なし。表記を確認してください',
      next_actions: [
        NEXT_ACTIONS.resolveAbbreviation(opts.law_name),
        NEXT_ACTIONS.searchLaw(opts.law_name),
      ],
    });
  }
  let lawData: EgovLawDataResponse;
  try {
    lawData = await fetchLawData(resolved.law_id, opts.at);
  } catch (err) {
    return egovHttpErrorToLawError(err);
  }
  const retrievedAt = new Date().toISOString();
  const fullToc = extractToc(lawData.law_full_text);
  const fullCount = countTocNodes(fullToc);
  const toc = opts.depth && opts.depth > 0 ? limitTocDepth(fullToc, opts.depth) : fullToc;
  const truncated = toc !== fullToc;
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
    node_count: truncated ? countTocNodes(toc) : fullCount,
    truncated,
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
    return makeError('LAW_NOT_FOUND', `法令が見つかりません: ${opts.law_name}`, {
      hint: '略称辞書 / e-Gov 法令検索で該当なし。表記を確認してください',
      next_actions: [
        NEXT_ACTIONS.resolveAbbreviation(opts.law_name),
        NEXT_ACTIONS.searchLaw(opts.law_name),
      ],
    });
  }
  let res;
  try {
    res = await getLawRevisions(resolved.law_id);
  } catch (err) {
    return egovHttpErrorToLawError(err);
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
