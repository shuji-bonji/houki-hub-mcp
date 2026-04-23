# @shuji-bonji/jp-houki-mcp

日本の法令（e-Gov法令検索 / 法令API v2）を LLM から扱うための MCP サーバ。

**設計の柱**: 薄いコア（条文取得・略称辞書）＋ プラガブルな拡張レイヤ（通達・裁決・判例）。

```
┌─────────────────────────────────────────┐
│   Skill 層（e-shiwake, 社労士, 会計）   │  ← 利用者がドメイン知識を積む
├─────────────────────────────────────────┤
│   拡張層（通達・裁決・下級裁 など）     │  ← 独立パッケージで差し替え可能
├─────────────────────────────────────────┤
│   コア層（条文取得・略称辞書・FTS）     │  ← このリポジトリが提供
├─────────────────────────────────────────┤
│   e-Gov 法令API v2 / XML一括DL          │  ← デジタル庁の公式ソース
└─────────────────────────────────────────┘
```

## 現状

**Phase 0（スケルトン整備中）** — 2026-04-23 開始

- [x] プロジェクト骨格（package.json / tsconfig / src/tools 等）
- [x] 略称辞書の初期版（6分野、約150語）
- [ ] e-Gov法令API v2 クライアント
- [ ] `get_law` / `search_law` / `get_toc` の実装
- [ ] `search_fulltext`（bulkDL + SQLite FTS5）
- [ ] 拡張レイヤ I/F の確定
- [ ] 2週間の痛点ログ → MVP機能スコープ確定

詳細は [`docs/DESIGN.md`](docs/DESIGN.md) と [`docs/PAIN-POINTS-TEMPLATE.md`](docs/PAIN-POINTS-TEMPLATE.md) を参照。

## なぜ作るのか

既存の日本法令 MCP（`ryoooo/e-gov-law-mcp`, `groundcobra009/hourei-mcp-server`, `kentaroajisaka/tax-law-mcp`, `kentaroajisaka/labor-law-mcp`）を比較検討した結果、

- 汎用の法令コアと、税務/労務などの専門レイヤが**分離されていない**
- 略称辞書が**分野限定**（税法だけ、労働だけ）
- bulkDL ベースの**オフライン全文検索**が無い
- 拡張（通達・裁決）が**パッケージ分離されていない**

という課題が見えた。これらを整理した汎用基盤を目指す。

## 想定される使い方

```json
// .mcp.json
{
  "mcpServers": {
    "jp-houki": {
      "command": "npx",
      "args": ["-y", "@shuji-bonji/jp-houki-mcp"],
      "env": {
        "JP_HOUKI_BULK_CACHE": "1",
        "JP_HOUKI_EXTENSIONS": "@jp-houki/ext-nta,@jp-houki/ext-mhlw"
      }
    }
  }
}
```

## デジタル庁公式 MCP との関係

デジタル庁は 2025年12月〜2026年3月の「法令×デジタル」ハッカソンで法令API / MCPのプロトタイプを試行提供した。将来一般公開された場合は、本MCPの**コア層を公式MCPに委譲**し、拡張層のみを独立npm化する方針でアダプタ層を設計している。

## ライセンス

MIT
