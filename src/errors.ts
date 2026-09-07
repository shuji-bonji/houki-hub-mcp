/**
 * MCP 共通エラー応答 — LLM 可読性を最重視した構造
 *
 * すべての tool handler はエラー時に {@link LawServiceError} を返すか、
 * MCP Server レベルで {@link toLlmError} 経由で本構造に正規化される。
 *
 * 設計指針:
 * - error: 1文の人間可読メッセージ（LLM もここを読む）
 * - code:  プログラム判定用の安定したコード（LLM の分岐学習用）
 * - hint:  追加情報（任意）
 * - next_actions: LLM が次に呼ぶべき tool / 取るべき手段の候補（最重要）
 * - retryable: 一時的エラーかどうか（true なら時間をおいて再試行可）
 */

/**
 * エラーコード — 安定した識別子。LLM の分岐用に用途別に分けてある。
 *
 * v0.3.0 で houki-hub family の共通語彙 (`SOURCE_*` / `OUT_OF_SCOPE`) を採用。
 * 既存の `EGOV_*` 系は **後方互換のため残置**しているが、新規実装では `SOURCE_*` を使うこと。
 *
 * @see https://github.com/shuji-bonji/houki-research-skill/blob/main/docs/ERROR-CODES.md
 */
export type LawErrorCode =
  // --- 引数・入力 (クライアント側責任) ---
  /** 引数バリデーション失敗 */
  | 'INVALID_ARGUMENT'
  /** 条番号フォーマットが不正（例: "三十" のような未対応の漢数字） */
  | 'INVALID_ARTICLE_NUM'
  /** 別 MCP の管轄リソースが要求された（略称解決の結果、houki-egov 以外と判明） */
  | 'OUT_OF_SCOPE'
  // --- リソース未発見 ---
  /** 法令名が解決できなかった */
  | 'LAW_NOT_FOUND'
  /** 条/項/号が見つからなかった */
  | 'ARTICLE_NOT_FOUND'
  /** 略称辞書に該当なし */
  | 'ABBREVIATION_NOT_FOUND'
  // --- 外部ソース由来 (family 共通) ---
  /** 外部 API (e-Gov) がエラー応答 */
  | 'SOURCE_API_ERROR'
  /** 外部 API がタイムアウト */
  | 'SOURCE_TIMEOUT'
  /** 外部 API がレート制限を返した（HTTP 429） */
  | 'SOURCE_RATE_LIMITED'
  /** 外部リソースに接続不能（DNS 失敗・ネットワーク断） */
  | 'SOURCE_UNAVAILABLE'
  // --- 旧コード (v0.2.x までの後方互換、新規実装では使わない) ---
  /** @deprecated v0.3.0+ では `SOURCE_API_ERROR` を使う */
  | 'EGOV_API_ERROR'
  /** @deprecated v0.3.0+ では `SOURCE_TIMEOUT` を使う */
  | 'EGOV_TIMEOUT'
  /** @deprecated v0.3.0+ では `SOURCE_RATE_LIMITED` を使う */
  | 'EGOV_RATE_LIMITED'
  // --- システム ---
  /** 未知のツール */
  | 'UNKNOWN_TOOL'
  /** 内部エラー（バグ） */
  | 'INTERNAL_ERROR';

/**
 * 次に取るべきアクションの提案。
 * LLM がこれを読んで自律的に次のツールを呼ぶことを想定。
 */
export interface NextAction {
  /** 推奨アクション（tool 名 or 自然言語） */
  action: string;
  /** どんなときに有効か */
  reason: string;
  /** 具体的な引数例（任意） */
  example?: Record<string, unknown>;
}

/** 共通エラー応答 */
export interface LawServiceError {
  error: string;
  code: LawErrorCode;
  hint?: string;
  next_actions?: NextAction[];
  /** 一時的エラーで時間をおけば成功する可能性があるか */
  retryable?: boolean;
  /** 元のエラー詳細（debug 用、LLM はあまり読まない想定） */
  detail?: {
    status?: number;
    url?: string;
    cause?: string;
    /** INVALID_ARGUMENT: inputSchema 違反の一覧 (path は `limit` / `filters.domain` のようなドット区切り) */
    issues?: Array<{ path: string; message: string }>;
  };
}

/**
 * エラーレスポンスを構築するヘルパー。
 * 必須フィールド (error, code) と任意フィールドを安全に組み立てる。
 */
export function makeError(
  code: LawErrorCode,
  message: string,
  options: {
    hint?: string;
    next_actions?: NextAction[];
    retryable?: boolean;
    detail?: LawServiceError['detail'];
  } = {}
): LawServiceError {
  const err: LawServiceError = { error: message, code };
  if (options.hint) err.hint = options.hint;
  if (options.next_actions && options.next_actions.length > 0) {
    err.next_actions = options.next_actions;
  }
  if (options.retryable !== undefined) err.retryable = options.retryable;
  if (options.detail) err.detail = options.detail;
  return err;
}

/** オブジェクトが LawServiceError かどうかの type guard */
export function isLawServiceError(value: unknown): value is LawServiceError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    'code' in value &&
    typeof (value as { error: unknown }).error === 'string' &&
    typeof (value as { code: unknown }).code === 'string'
  );
}

/** よく使う next_actions のプリセット */
export const NEXT_ACTIONS = {
  resolveAbbreviation: (abbr: string): NextAction => ({
    action: 'resolve_abbreviation',
    reason: '略称辞書で正式名称を確認できます',
    example: { abbr },
  }),
  searchLaw: (keyword: string): NextAction => ({
    action: 'search_law',
    reason: '部分一致で法令を検索できます',
    example: { keyword },
  }),
  getToc: (law_name: string): NextAction => ({
    action: 'get_toc',
    reason: '目次を確認して正しい条番号を特定できます',
    example: { law_name },
  }),
  retryLater: (): NextAction => ({
    action: 'retry_later',
    reason: '一時的な API エラーの可能性があります。30秒〜数分後に再試行してください',
  }),
  visitEgovSite: (lawId?: string): NextAction => ({
    action: 'visit_egov_site',
    reason: 'API 障害時は e-Gov サイトで直接ご確認ください',
    example: lawId
      ? { url: `https://laws.e-gov.go.jp/law/${lawId}` }
      : { url: 'https://laws.e-gov.go.jp/' },
  }),
  delegateTo: (mcpHint: string): NextAction => ({
    action: 'delegate_to_mcp',
    reason: `${mcpHint} の管轄リソースです。該当 MCP に切り替えてください`,
    example: { mcp: mcpHint },
  }),
} as const;
