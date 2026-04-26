/**
 * MCP Tool Definitions
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { DOMAINS, LIMITS, OUTPUT_FORMATS } from '../constants.js';

export const tools: Tool[] = [
  // ========================================
  // Phase 1: Core (e-Gov API v2)
  // ========================================
  {
    name: 'search_law',
    description:
      '日本の法令をキーワード・略称・分野で検索する。e-Gov法令API v2 を使用。略称辞書による正式名称への自動補完あり。',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description:
            '検索キーワード。例: "消費税", "労働基準", "育児休業"。略称も可（例: "消法", "労基法"）',
        },
        law_type: {
          type: 'string',
          enum: ['Act', 'CabinetOrder', 'ImperialOrdinance', 'MinisterialOrdinance', 'Rule'],
          description: '法令種別で絞り込み',
        },
        domain: {
          type: 'string',
          enum: [...DOMAINS],
          description: '分野タグで絞り込み（略称辞書ベース）',
        },
        limit: {
          type: 'number',
          description: `取得件数（デフォルト: ${LIMITS.searchDefault}、最大: ${LIMITS.searchMax}）`,
          default: LIMITS.searchDefault,
        },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'get_law',
    description:
      '日本の法令から条文を取得する。略称（消法・所法・労基法 等）対応。条/項/号レベル指定可能。',
    inputSchema: {
      type: 'object',
      properties: {
        law_name: {
          type: 'string',
          description: '法令名または略称。例: "消費税法", "消法", "労基法", "民法"',
        },
        article: {
          type: 'string',
          description: '条番号。例: "30", "30の2"。format="toc" の場合は省略可',
        },
        paragraph: {
          type: 'number',
          description: '項番号。省略時は条文全体',
        },
        item: {
          type: 'number',
          description: '号番号。省略時は項全体',
        },
        format: {
          type: 'string',
          enum: [...OUTPUT_FORMATS],
          description:
            '出力形式。"markdown"=条文全文（デフォルト）, "toc"=目次のみ（トークン節約）, "json"=構造化',
          default: 'markdown',
        },
        at: {
          type: 'string',
          description:
            '時点指定。YYYY-MM-DD 形式。例: "2024-04-01" でその時点の条文を取得（e-Gov v2 対応）',
        },
      },
      required: ['law_name'],
    },
  },
  {
    name: 'get_toc',
    description: '法令の目次（編・章・節・条の構造）のみを取得する。トークン節約用。',
    inputSchema: {
      type: 'object',
      properties: {
        law_name: {
          type: 'string',
          description: '法令名または略称',
        },
        at: {
          type: 'string',
          description: '時点指定（YYYY-MM-DD）',
        },
      },
      required: ['law_name'],
    },
  },
  {
    name: 'search_fulltext',
    description:
      '法令本文をキーワードで横断全文検索する。HOUKI_HUB_BULK_CACHE=1 環境時に SQLite FTS5 で動作。未有効時は API フォールバック。',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description: '検索キーワード。スペース区切りで AND 検索',
        },
        domain: {
          type: 'string',
          enum: [...DOMAINS],
          description: '分野タグで絞り込み',
        },
        law_type: {
          type: 'string',
          enum: ['Act', 'CabinetOrder', 'ImperialOrdinance', 'MinisterialOrdinance', 'Rule'],
          description: '法令種別で絞り込み',
        },
        limit: {
          type: 'number',
          description: `取得件数（デフォルト: ${LIMITS.fulltextDefault}、最大: ${LIMITS.fulltextMax}）`,
          default: LIMITS.fulltextDefault,
        },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'resolve_abbreviation',
    description:
      '略称・通称から正式な法令名と law_id を解決する。略称辞書の内容を確認するための診断ツール。',
    inputSchema: {
      type: 'object',
      properties: {
        abbr: {
          type: 'string',
          description: '略称。例: "消法", "所法", "労基法", "民"',
        },
      },
      required: ['abbr'],
    },
  },
  {
    name: 'get_law_revisions',
    description:
      '法令の改正履歴を取得する。e-Gov v2 /law_revisions を使用。各改正の公布日・施行日・改正法令番号・状態（現行/旧法/未施行）等を返す。',
    inputSchema: {
      type: 'object',
      properties: {
        law_name: {
          type: 'string',
          description: '法令名または略称。例: "消費税法", "消法", "民法"',
        },
        latest: {
          type: 'number',
          description: '最新N件のみ返却（省略時は全件）。例: 5',
        },
      },
      required: ['law_name'],
    },
  },
  {
    name: 'explain_law_type',
    description:
      '法令種別（憲法・法律・政令・省令・規則・条例・告示・通達 等）の制定主体・階層上の位置・国民への拘束力・実務上の注意点を解説する。法務専門家でない利用者が「政令と省令の違い」「通達は守らなくていいのか」等を確認するための知識ツール。',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            '法令種別の名前。例: "法律", "政令", "省令", "規則", "条例", "告示", "通達", "訓令", "憲法"。aliases も解決可（例: "施行令" → 政令、"施行規則" → 省令、"Act" → 法律）',
        },
      },
      required: ['name'],
    },
  },
];
