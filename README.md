# Houki Hub MCP Server

> **houki-egov** — 散らばる法令領域を1点に集約する、LLM時代の汎用法令リファレンス基盤。  
> エンジニアと開発者が **法令の壁を素早く越えて、プロダクトの品質に専念できる** ために。

日本の法令（e-Gov法令検索 / 法令API v2）を LLM から扱うための MCP サーバ。

**設計の柱**: 薄いコア（条文取得・略称辞書）＋ プラガブルな拡張レイヤ（通達・裁決・判例）。

## このMCPの立ち位置

**LLM 時代の汎用法令リファレンス基盤**。個人学習、フリーランス・個人事業主の実務、そして**プロダクト開発時の法令調査**まで、多岐の分野で使えるノンベンダー個人 OSS として設計しています。

狙いはシンプルで、**エンジニアが法令調査の壁で足止めされず、本来の専門であるプロダクトの品質に時間を使える状態** を作ることです。

### 想定利用シーン

- **エンジニア・プロダクト開発者**：「請求書を電子化して」「本人確認を入れて」「決済を実装して」といった**実装依頼の背後にある法令**（電帳法・電子署名法・犯収法・資金決済法等）の取っ掛かり調査。本来エンジニアの範囲外でも**丸投げされがちな領域**をLLMと併せて素早く越える
- **フリーランス・個人事業主**：消費税区分判定・インボイス・青色申告・社保加入要件・**フリーランス新法**対応などの自分の事業に関する調査
- **スタートアップ創業者**：新規事業に必要な業法・許認可の洗い出し
- **プロダクトマネージャ**：利用規約・プライバシーポリシーの叩き台作成、社内法務相談前の論点整理
- **学習者**：法令横断の自習、略称から正式名称への素早いアクセス
- **セカンドオピニオン**：既存の判断（士業・書籍・記事）に対する裏取り

### 権威ではなくセカンドオピニオン

```
┌──────────────────────┬──────────────────────┐
│ 権威レイヤ            │ セカンドオピニオン   │
│ デジタル庁公式 MCP    │ houki-egov-mcp         │
│ LegalOn / MNTSQ 等    │ 他の個人 OSS MCP     │
│ （正しさの基準）      │ （網羅性で補完）     │
└──────────────────────┴──────────────────────┘
               ↓           ↓
        ┌──────────────────────┐
        │ LLM 分析・論点整理   │
        └──────────────────────┘
                    ↓
        ┌──────────────────────┐
        │ 利用者 最終判断と責任 │
        └──────────────────────┘
```

本MCPは **一次情報の取得・提示のみ** を担います。分析は LLM、判断は利用者（または有資格者）の責任です。業としての法律事務・税務業務への利用は**想定外**です — 詳細は [DISCLAIMER.md](DISCLAIMER.md) 参照。

**拡張性**：辞書・拡張パッケージ・Skill の3経路でユーザが育てる OSS として設計しています — 詳細は [CONTRIBUTING.md](CONTRIBUTING.md) 参照。

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

[![CI](https://github.com/shuji-bonji/houki-egov-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/shuji-bonji/houki-egov-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%3E%3D20-brightgreen)](https://nodejs.org/)

**Phase 1（e-Gov 法令API v2 コア実装）完了** — 2026-04-25

- [x] プロジェクト骨格（package.json / tsconfig / ESLint / Prettier / Vitest）
- [x] 略称辞書（6分野・**165エントリ**）
- [x] ナレッジ層（法令種別10種・業法独占規定7職業）
- [x] **e-Gov 法令API v2 クライアント** + 4ツール本実装
  - `search_law` — タイトル検索（略称→正式名解決済み）
  - `get_law` — 条/項/号レベル本文取得（Markdown / JSON / TOC）
  - `get_toc` — 目次取得
  - `search_fulltext` — Phase 2 まで search_law にフォールバック
- [x] 法令ツリー走査・LRU cache・Markdown 整形
- [x] `explain_law_type` / `explain_business_law_restriction`（Phase 0 同梱）
- [x] 拡張レイヤ I/F 暫定版（`ExtensionFactory`）
- [x] DISCLAIMER / CONTRIBUTING / 業法との関係 / プロダクト開発ユースケース集
- [x] GitHub Actions CI（Node 20 / 22 マトリクス）
- [x] テストスイート（**74 tests**）
- [ ] Phase 2: `search_fulltext` 本実装（bulkDL + SQLite FTS5）
- [ ] Phase 3: 拡張レイヤ I/F 確定、公式拡張パッケージリリース（9パッケージ計画）

詳細は以下を参照：

- [`docs/DESIGN.md`](docs/DESIGN.md) — 設計原則・業法との関係・拡張ロードマップ
- [`docs/IMPLEMENTATION-PLAN.md`](docs/IMPLEMENTATION-PLAN.md) — Phase 1〜3 実装計画
- [`docs/LAW-HIERARCHY.md`](docs/LAW-HIERARCHY.md) — 法令種別の階層リファレンス（専門家でない利用者向け）
- [`docs/USE-CASES.md`](docs/USE-CASES.md) — プロダクト開発の典型ユースケース（電帳法・電子契約・個情法・e-KYC）
- [`docs/PAIN-POINTS-TEMPLATE.md`](docs/PAIN-POINTS-TEMPLATE.md) — 2週間痛点ログ
- [`CHANGELOG.md`](CHANGELOG.md) — リリースノート

## Quick Start

### ローカル開発

```bash
git clone git@github.com:shuji-bonji/houki-egov-mcp.git
cd houki-egov-mcp
npm install
npm run build
npm test
```

### ローカル開発中の動作確認（.mcp.json）

```json
{
  "mcpServers": {
    "houki-egov-local": {
      "command": "node",
      "args": ["/absolute/path/to/houki-egov-mcp/dist/index.js"]
    }
  }
}
```

現時点で**実際に動く**ツールは `resolve_abbreviation` のみです（略称→正式名称の解決）。他のツールは Phase 1 で実装されます。

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
    "houki-egov": {
      "command": "npx",
      "args": ["-y", "@shuji-bonji/houki-egov-mcp"],
      "env": {
        "HOUKI_HUB_BULK_CACHE": "1",
        "HOUKI_HUB_EXTENSIONS": "@houki-egov/ext-nta,@houki-egov/ext-mhlw"
      }
    }
  }
}
```

## デジタル庁公式 MCP との関係

デジタル庁は 2025年12月〜2026年3月の「法令×デジタル」ハッカソンで法令API / MCPのプロトタイプを試行提供した。将来一般公開された場合は、本MCPの**コア層を公式MCPに委譲**し、拡張層のみを独立npm化する方針でアダプタ層を設計している。

## ライセンス

MIT — 個人利用・学習用途のフォーク・改変・再配布を自由に許可します。

ただし、**業としての使用（弁護士法72条・税理士法52条・社労士法27条が定める独占業務）** については想定外であり、作者は一切の責任を負いません。[DISCLAIMER.md](DISCLAIMER.md) を必ずご確認ください。
