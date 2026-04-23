/**
 * Extension Layer Interface
 *
 * 通達・裁決・下級裁判例などの周辺データソースを、
 * 独立 npm パッケージ（例: @jp-houki/ext-nta）として追加できるようにするための共通 I/F。
 *
 * Phase 1 以降で確定させる。ここは暫定 I/F なので Breaking Change あり。
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * 拡張パッケージのメタデータ
 */
export interface ExtensionManifest {
  /** 名前空間（ツール名のプレフィックスに使う）。例: "nta", "mhlw", "jaish" */
  namespace: string;
  /** 表示名。例: "国税庁通達" */
  label: string;
  /** バージョン */
  version: string;
  /** 情報源の説明・URL */
  source: {
    label: string;
    url: string;
  };
}

/**
 * 拡張が公開するツールセット
 */
export interface ExtensionModule {
  manifest: ExtensionManifest;
  /** MCP Tool 定義（inputSchema 含む） */
  tools: Tool[];
  /** ツール名 → ハンドラ */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handlers: Record<string, (args: any) => Promise<unknown>>;
}

/**
 * 拡張パッケージが default export として提供すべき関数の型。
 *
 * 実装例：
 *
 *     // @jp-houki/ext-nta/src/index.ts
 *     import type { ExtensionFactory } from '@shuji-bonji/jp-houki-mcp/extensions';
 *     const factory: ExtensionFactory = () => ({
 *       manifest: { namespace: 'nta', label: '国税庁通達', ... },
 *       tools: [...],
 *       handlers: { 'nta_list_tsutatsu': ..., 'nta_get_tsutatsu': ... },
 *     });
 *     export default factory;
 */
export type ExtensionFactory = () => ExtensionModule | Promise<ExtensionModule>;
