/**
 * 法令を Markdown に整形する。
 *
 * 出力規約:
 * - 見出しは `# 法令名 第X条第Y項第Z号`（指定された粒度に応じて）
 * - 末尾に必ず出典 URL と取得日時を付ける
 * - 本MCPは事実情報の提示に徹し、判断・解釈は加えない
 */

import { EGOV_API } from '../config.js';
import type { LawNode } from '../services/egov-client.js';
import {
  extractText,
  findChildByTag,
  findChildrenByTag,
  getArticleCaption,
  type TocNode,
} from '../services/law-tree.js';
import { fromEgovArticleNum } from '../utils/article-num.js';

export interface FormatArticleOptions {
  lawTitle: string;
  lawId: string;
  article: LawNode;
  /** 項を指定して取得する場合 */
  paragraph?: LawNode;
  /** 号を指定して取得する場合 */
  item?: LawNode;
  retrievedAt: string;
  at?: string;
}

/**
 * 条文を Markdown に整形する。
 * paragraph / item 指定があればその範囲だけ出力。
 */
export function formatArticleMarkdown(opts: FormatArticleOptions): string {
  const { lawTitle, lawId, article, paragraph, item, retrievedAt, at } = opts;
  const articleNum = article.attr?.Num ?? '';
  const articleNumDisplay = fromEgovArticleNum(articleNum);
  const caption = getArticleCaption(article);

  // 見出し
  let header: string;
  if (item && paragraph) {
    header = `# ${lawTitle} 第${articleNumDisplay}条第${paragraph.attr?.Num}項第${item.attr?.Num}号`;
  } else if (paragraph) {
    header = `# ${lawTitle} 第${articleNumDisplay}条第${paragraph.attr?.Num}項`;
  } else {
    header = `# ${lawTitle} 第${articleNumDisplay}条`;
  }

  // 本文
  let body: string;
  if (item) {
    body = extractText(item).trim();
  } else if (paragraph) {
    body = formatParagraph(paragraph);
  } else {
    body = formatArticleBody(article);
  }

  const url = EGOV_API.publicLawUrl(lawId);
  const lines = [header];
  if (caption) lines.push(caption);
  lines.push('', body, '', '---', '出典：e-Gov法令検索（デジタル庁）', `URL: ${url}`);
  if (at) lines.push(`時点: ${at}`);
  lines.push(`取得日時: ${retrievedAt}`);
  return lines.join('\n');
}

/**
 * Article 全体を Markdown に整形（全項・全号を含む）。
 */
function formatArticleBody(article: LawNode): string {
  const paragraphs = findChildrenByTag(article, 'Paragraph');
  return paragraphs.map(formatParagraph).join('\n\n');
}

/**
 * Paragraph を整形。
 * - 1項のみ → "（項本文）"
 * - 号があれば箇条書きでぶら下げ
 */
function formatParagraph(paragraph: LawNode): string {
  const paragraphNum = paragraph.attr?.Num ?? '';
  const sentenceNode = findChildByTag(paragraph, 'ParagraphSentence');
  const sentenceText = sentenceNode ? extractText(sentenceNode).trim() : '';
  const items = findChildrenByTag(paragraph, 'Item');

  const lines: string[] = [];
  // 項番号は 1 のみのとき表示しない（条文単独の場合）
  if (paragraphNum && paragraphNum !== '1') {
    lines.push(`**第${paragraphNum}項**`);
  }
  if (sentenceText) lines.push(sentenceText);

  for (const item of items) {
    const itemNum = item.attr?.Num ?? '';
    const itemText = extractText(item).trim();
    lines.push(`${itemNum} ${itemText.replace(/^[一二三四五六七八九十百\d]+\s*/, '')}`);
  }
  return lines.join('\n');
}

/**
 * TOC を Markdown に整形。
 */
export function formatTocMarkdown(opts: {
  lawTitle: string;
  lawId: string;
  toc: TocNode[];
  retrievedAt: string;
  at?: string;
}): string {
  const { lawTitle, lawId, toc, retrievedAt, at } = opts;
  const lines = [`# ${lawTitle} — 目次`, ''];
  for (const node of toc) {
    appendTocLines(lines, node, 0);
  }
  lines.push('', '---', '出典：e-Gov法令検索（デジタル庁）');
  lines.push(`URL: ${EGOV_API.publicLawUrl(lawId)}`);
  if (at) lines.push(`時点: ${at}`);
  lines.push(`取得日時: ${retrievedAt}`);
  return lines.join('\n');
}

function appendTocLines(lines: string[], node: TocNode, depth: number): void {
  const indent = '  '.repeat(depth);
  if (node.tag === 'Article') {
    const numDisplay = node.num ? fromEgovArticleNum(node.num) : '';
    const captionPart = node.caption ? ` ${node.caption}` : '';
    lines.push(`${indent}- 第${numDisplay}条${captionPart}`);
  } else {
    lines.push(`${indent}- ${node.title}`);
    for (const c of node.children) {
      appendTocLines(lines, c, depth + 1);
    }
  }
}
