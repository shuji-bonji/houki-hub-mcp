/**
 * Relevance Scoring — Phase 2-7 (v0.5.0)
 *
 * `search_fulltext` の FTS5 ヒットに正規化された `score` と `score_reasons` を付与する。
 * houki-nta-mcp v0.8.0 の `relevance-scoring.ts` を法令向けに変えたもの。
 *
 * ## スコア計算式
 *
 * ```
 * score = min(base(rank) + boosts, 1.0)
 * ```
 *
 * - **base(rank)**: FTS5 rank (BM25 ベースの負値) を `1 / (1 + 10 / |rank|)` で 0〜1 に正規化
 * - **boosts** (docs/PHASE2-DESIGN.md §6.2):
 *   - `title_exact_match`     +0.3 — 法令名がクエリと完全一致
 *   - `abbrev_match`          +0.2 — 略称 (XML の Abbrev / houki-abbreviations の abbr・aliases) がクエリと一致
 *   - `article_num_match`     +0.3 — クエリ中の「第N条」がヒットの条番号と一致
 *   - `article_caption_match` +0.1 — 条見出し (caption) にクエリが含まれる
 *
 * nta 版にあった **doc_type 重みは使わない**。法令の間に拘束力の階層差はなく、
 * 種別 (法律 / 政令 / 省令) で並び順を歪めるべきではないため (PHASE2-DESIGN.md §6.2)。
 *
 * ## 設計の前提
 *
 * - 純関数。SQL には触れない
 * - FTS5 から要求 limit より多めに取り、JS で re-rank してから limit 件に絞る
 *   (呼び出し側 `law-search.ts` の責務)
 */

import { normalizeSearchQuery } from '@shuji-bonji/houki-abbreviations';
import { toEgovArticleNum } from '../utils/article-num.js';

/** boost 値 (PHASE2-DESIGN.md §6.2) */
export const BOOST = {
  titleExact: 0.3,
  abbrev: 0.2,
  articleNum: 0.3,
  caption: 0.1,
} as const;

/** スコアの上限 */
export const SCORE_MAX = 1.0;

/**
 * FTS5 の rank (BM25 ベースの負値) を 0〜1 の base score に正規化する。
 *
 * - rank が 0 (= マッチ無し) → 0
 * - |rank| が大きいほど 1 に漸近: `1 / (1 + 10 / |rank|)`
 */
export function rankToBaseScore(rank: number): number {
  if (!Number.isFinite(rank)) return 0;
  if (rank === 0) return 0;
  const magnitude = Math.abs(rank);
  return 1 / (1 + 10 / magnitude);
}

/**
 * クエリ中の「第N条」「第N条のM」をヒット比較用の e-Gov 形式 (`30` / `30_2`) に変換する。
 *
 * 漢数字 (「第三十条」) は v0.5.0 では未対応で null を返す
 * (`toEgovArticleNum` が throw するため握りつぶす)。
 *
 * @returns 条番号が含まれていなければ null
 */
export function extractArticleNumFromQuery(query: string): string | null {
  if (!query) return null;
  const normalized = normalizeSearchQuery(query);
  const m = normalized.match(/第\s*(\d+(?:の\d+)*)\s*条(?:の(\d+))?/);
  if (!m) return null;
  const text = m[2] ? `第${m[1]}条の${m[2]}` : `第${m[1]}条`;
  try {
    return toEgovArticleNum(text);
  } catch {
    return null;
  }
}

/** スコア計算の入力 */
export interface LawScoringInput {
  /** FTS5 rank (BM25 negative score) */
  rank: number;
  /** ユーザー入力のクエリ (略称展開前) */
  query: string;
  /** ヒットした法令の正式名称 (laws.law_title) */
  lawTitle: string;
  /**
   * ヒットした法令の略称候補。XML の Abbrev (laws.abbrev) と、
   * houki-abbreviations で query を解決したときの abbr / aliases (formal が lawTitle と一致する場合)
   */
  abbrevs?: ReadonlyArray<string | null | undefined>;
  /** ヒットの条番号 (e-Gov 形式。`30` / `30_2`)。law_meta ヒットでは undefined */
  articleNum?: string;
  /** ヒットの条見出し (articles.caption) */
  caption?: string | null;
}

/** スコア計算の出力 */
export interface LawScoringOutput {
  /** 0.0〜1.0 の正規化スコア */
  score: number;
  /** スコア決定の理由 (人間可読な短文) */
  score_reasons: string[];
}

/** 比較用に query / title を同じ規則で正規化する (幅・大小文字・空白) */
function foldForCompare(s: string): string {
  return normalizeSearchQuery(s).replace(/\s+/g, '');
}

/**
 * 1 ヒット分の relevance score を計算する (純関数)。
 */
export function computeLawRelevance(input: LawScoringInput): LawScoringOutput {
  const reasons: string[] = [];
  let score = rankToBaseScore(input.rank);
  reasons.push(`fts rank ${input.rank.toFixed(2)} → base ${score.toFixed(3)}`);

  const q = foldForCompare(input.query);
  const title = foldForCompare(input.lawTitle);

  if (q.length > 0 && q === title) {
    score += BOOST.titleExact;
    reasons.push('title_exact_match');
  }

  if (q.length > 0 && input.abbrevs) {
    const hit = input.abbrevs.some((a) => a != null && a.length > 0 && foldForCompare(a) === q);
    if (hit) {
      score += BOOST.abbrev;
      reasons.push('abbrev_match');
    }
  }

  if (input.articleNum) {
    const queryArticle = extractArticleNumFromQuery(input.query);
    if (queryArticle && queryArticle === input.articleNum) {
      score += BOOST.articleNum;
      reasons.push('article_num_match');
    }
  }

  if (input.caption && q.length > 0) {
    // 「第30条」のような条番号だけのクエリは caption 一致の対象外
    const qForCaption = foldForCompare(
      input.query.replace(/第\s*\d+(?:の\d+)*\s*条(?:の\d+)?/g, ' ')
    );
    if (qForCaption.length >= 2 && foldForCompare(input.caption).includes(qForCaption)) {
      score += BOOST.caption;
      reasons.push('article_caption_match');
    }
  }

  return { score: Math.min(score, SCORE_MAX), score_reasons: reasons };
}

/**
 * ヒットの配列を score 降順でソートする (新配列を返す)。
 * 同点時は元の rank の昇順 (FTS5 順) で安定ソートする。
 */
export function sortByScoreDesc<T extends { score?: number; rank: number }>(hits: T[]): T[] {
  return [...hits].sort((a, b) => {
    const sa = a.score ?? 0;
    const sb = b.score ?? 0;
    if (sa !== sb) return sb - sa;
    return a.rank - b.rank;
  });
}
