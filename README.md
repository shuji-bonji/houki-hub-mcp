# Houki e-Gov MCP Server

[![CI](https://github.com/shuji-bonji/houki-egov-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/shuji-bonji/houki-egov-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@shuji-bonji/houki-egov-mcp.svg)](https://www.npmjs.com/package/@shuji-bonji/houki-egov-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%3E%3D22-brightgreen)](https://nodejs.org/)

日本の法令（憲法・法律・政令・省令・規則）を **e-Gov 法令API v2** 経由で取得する MCP サーバ。

LLM が条文をキーワード・略称・分野で検索したり、特定の条項を Markdown / JSON で取得したり、改正履歴を引いたりできるようにする。

## 提供ツール

| Tool | 用途 |
|---|---|
| `search_law` | 法令タイトルでキーワード検索（略称→正式名解決済み） |
| `get_law` | 条/項/号レベルで本文取得（Markdown / JSON / TOC） |
| `get_toc` | 目次のみ取得（トークン節約） |
| `get_law_revisions` | 改正履歴を取得（公布日・施行日・状態） |
| `search_fulltext` | 条文本文の横断全文検索（ローカル SQLite FTS5。bulk DB 未構築時は `search_law` にフォールバック） |
| `resolve_abbreviation` | 略称→正式名解決の診断 |
| `explain_law_type` | 法令種別（憲法・法律・政令・省令・通達 等）の解説 |

略称辞書（174 エントリ・6 分野）は [`@shuji-bonji/houki-abbreviations`](https://github.com/shuji-bonji/houki-abbreviations) を内部で利用しています。

## インストール

### Claude Desktop で使う

```json
// claude_desktop_config.json
{
  "mcpServers": {
    "houki-egov": {
      "command": "npx",
      "args": ["-y", "@shuji-bonji/houki-egov-mcp"]
    }
  }
}
```

### Claude Code plugin で使う

リポジトリ同梱の [`.claude-plugin/plugin.json`](.claude-plugin/plugin.json) が MCP server として `npx -y @shuji-bonji/houki-egov-mcp@latest` を登録します。plugin として入れた場合も、下の「Claude Desktop で使う」も、起動されるのは npm に公開された同じパッケージです。

### ローカル開発

```bash
git clone git@github.com:shuji-bonji/houki-egov-mcp.git
cd houki-egov-mcp
npm install
npm run build
npm test
```

```json
// 開発中の動作確認 (.mcp.json)
{
  "mcpServers": {
    "houki-egov-local": {
      "command": "node",
      "args": ["/absolute/path/to/houki-egov-mcp/dist/index.js"]
    }
  }
}
```

## 使用例

```
# LLM への問いかけ → MCP ツール呼び出し

「消費税法30条1項を見せて」
  → get_law(law_name="消法", article="30", paragraph=1)

「労働基準法の目次を取得」
  → get_toc(law_name="労基法")

「個人情報保護法の改正履歴を最新5件」
  → get_law_revisions(law_name="個情法", latest=5)

「電帳法って正式名称なに？」
  → resolve_abbreviation(abbr="電帳法")
  → 電子計算機を使用して作成する国税関係帳簿書類の保存方法等の特例に関する法律

「政令と省令の違いは？」
  → explain_law_type(name="政令")

「民法で不法行為について定めている条文は？」（bulk DB 構築後）
  → search_fulltext(keyword="民法 不法行為")
  → law_scope=[民法] に絞って本文検索。724 条・719 条・509 条 などが snippet 付きで返る

「民法 第709条」（法令名 + 条番号だけ）
  → search_fulltext(keyword="民法 第709条")
  → 本文検索をせず、民法 709 条を直接返す
```

## CLI（ローカル DB の構築 — v0.3.1+）

全文検索用のローカル DB（SQLite FTS5）は、e-Gov の bulk ダウンロード zip から構築します。MCP server として常駐する通常起動とは別に、フラグ付きで起動すると CLI モードで動作します。

```bash
# 全法令 zip (約 290 MB) を DL して DB に取り込む
npx @shuji-bonji/houki-egov-mcp --bulk-download-everything

# DB の件数と鮮度 (freshness) を表示
npx @shuji-bonji/houki-egov-mcp --status
```

DB のデフォルト配置は `${XDG_CACHE_HOME:-~/.cache}/houki-egov-mcp/laws.db`（`HOUKI_EGOV_DB_PATH` で変更可）。

### SQLite と DB の置き場所（npx / plugin 経由で使う場合）

SQLite は本パッケージが依存する `better-sqlite3` に同梱されています（SQLite 3.53 系の amalgamation。OS の sqlite3 は使いません）。`npx` や plugin で初めて起動したときに npm が `better-sqlite3` を取り込み、実行中の Node.js と OS に合ったビルド済みバイナリ（`prebuild-install`）を GitHub Releases から取得します。対応する prebuilt がない Node.js の場合は `node-gyp` でその場でコンパイルするため、Python と C++ ビルドツール（macOS なら Xcode Command Line Tools）が必要になります。Node 22 / 24 の LTS では prebuilt が用意されているので、通常はコンパイルは走りません。

DB ファイルはパッケージの中ではなく、上記のユーザーのキャッシュディレクトリに置かれます。したがって次の 3 つは **同じ 1 つの DB** を読み書きします。

| 起動方法 | 実行されるコード | 読む DB |
|---|---|---|
| `npx @shuji-bonji/houki-egov-mcp --bulk-download-everything`（CLI） | npx のキャッシュ内のパッケージ | `~/.cache/houki-egov-mcp/laws.db` |
| Claude Desktop / Claude Code plugin（`npx -y …`） | 同上（`@latest` 指定なら起動ごとにレジストリを確認） | 同上 |
| ローカル開発（`node dist/index.js`） | リポジトリの `dist` | 同上 |

このため、DB の構築は一度 CLI で行えば、plugin 経由の `search_fulltext` からもそのまま使えます。`--bulk-download-everything` のあとに MCP server を再起動する必要はありません（`search_fulltext` は呼び出しごとに DB を開いて閉じます）。書き込みは CLI だけが行い、MCP server は読むだけです（journal は WAL なので、取り込み中に検索しても壊れません）。

DB が存在しない、または条が 1 件も入っていないときは、`search_fulltext` は `source: "api-fallback"` で `search_law` の結果を返し、`next_actions` に `--bulk-download-everything` の実行を案内します。パッケージを更新しても DB は消えません（バージョン間の互換は上の注記のとおり、必要なときだけ再構築を案内します）。

DB を構築すると `search_fulltext` が条文本文を SQLite FTS5 で検索します（v0.5.0〜）。略称は正式名称に OR 展開され（`消法` → `消費税法`）、「民法 不法行為」「労基法 時間外」のように法令名と語を並べるとその法令の条に絞って本文を検索します。各ヒットに条番号・snippet・score・DB の鮮度（`freshness`）が付きます。DB が未構築のときは従来どおり `search_law`（法令名のタイトル一致）にフォールバックし、`note` でその旨を返します。

> **v0.5.0 以前に構築した DB について**: v0.5.0 で本文の正規化を投入時に行うようになり（スキーマバージョン 2、旧 DB は起動時に自動初期化）、v0.5.1 で編（Part）を持つ法令の本則が取り込まれていなかった不具合を直しました。いずれの場合も `--bulk-download-everything` を再実行してください（v0.5.1 では全件が再 ingest されます）。
>
> **検索語の制約**: 索引が trigram のため、条文本文は 3 文字以上の語で引きます。2 文字の語（「保存」「民法」等）は、3 文字以上の語と組み合わせたときは本文の AND 絞り込みに、単独のときは法令名・略称の照合にだけ使われます。「第30条」のような条番号は本文検索には使わず、該当条を上位に寄せる加点にだけ使います（漢数字は未対応）。

## 状態

**v0.5.3 (2026-09-07)**

- [x] e-Gov 法令API v2 クライアント（`searchLaws` / `getLawData` / `getLawRevisions`）
- [x] 法令ツリー走査（条/項/号、目次抽出）+ LRU cache
- [x] 7ツール本実装
- [x] 略称辞書を [`@shuji-bonji/houki-abbreviations`](https://github.com/shuji-bonji/houki-abbreviations) ^0.4.1 に分離
- [x] 法令階層ナレッジ（憲法・法律・政令・省令・規則・条例・告示・訓令・通達・通知 の10種別）
- [x] houki-hub family 共通の error contract（`SOURCE_*` / `OUT_OF_SCOPE`）に準拠
- [x] Phase 2 基盤：bulk DL → SQLite FTS5 の取り込みパイプライン（schema / CSV・XML parser / zip fetcher / ingester / freshness / CLI）
- [x] Phase 2-7: `search_fulltext` の FTS5 本実装（略称 OR 展開 / revision 重複排除 / relevance scoring / freshness）
- [x] MCP SDK v2（`@modelcontextprotocol/server`）/ Node 22・24 / TypeScript 7 / Biome
- [x] Trusted Publisher (OIDC) で publish
- [x] テストスイート（**258 tests**）

### 計画中

- [ ] Phase 2-8: 差分同期（`--bulk-download-incremental`）
- [ ] Phase 2-13: API enrichment（`category` / 改正履歴 / 廃止ステータスの精緻化）
- [ ] 漢数字対応（「第三十条」を 30 に変換）
- [ ] 大規模法令の応答サイズ対策（民法・会社法）

## houki-hub MCP family

houki-egov-mcp は **単体で利用可能**ですが、houki-hub MCP family の一員でもあります。同じ family 内の他 MCP と組み合わせると、通達・判例等まで横断的に扱えます。

| パッケージ | 役割 | 状態 |
|---|---|---|
| [`@shuji-bonji/houki-abbreviations`](https://github.com/shuji-bonji/houki-abbreviations) | 略称辞書・正規化・freshness 判定（共有ライブラリ） | ✅ v0.5.0 |
| **`@shuji-bonji/houki-egov-mcp`** | **e-Gov 法令API クライアント + ローカル全文検索（このリポジトリ）** | ✅ v0.5.1 |
| [`@shuji-bonji/houki-nta-mcp`](https://github.com/shuji-bonji/houki-nta-mcp) | 国税庁通達・Q&A・タックスアンサー・文書回答事例 | ✅ v0.9.5 |
| [`houki-research-skill`](https://github.com/shuji-bonji/houki-research-skill) | family を横断する Claude Skill（error contract の正典） | ✅ |
| `@shuji-bonji/houki-mhlw-mcp` | 厚労省通達・通知 | 計画中 |
| `@shuji-bonji/houki-court-mcp` | 判例（裁判所サイト） | 構想中 |
| `@shuji-bonji/houki-saiketsu-mcp` | 国税不服審判所裁決 | 構想中 |

family 全体の設計思想・想定利用シーン・業法との関係は [`docs/DESIGN.md`](docs/DESIGN.md) を参照。

## エラー応答 (houki-hub family contract)

**v0.3.0** より、本 MCP のエラー応答は **houki-hub family 共通契約**に完全準拠します。`code` 文字列は family 全体で統一された語彙を使用するため、複数の MCP を併用しても LLM・Skill 層は一貫したロジックで解釈できます。

- [`docs/ERROR-CODES.md`](https://github.com/shuji-bonji/houki-research-skill/blob/main/docs/ERROR-CODES.md) — 共通エラーコード語彙の正典 (houki-research-skill)
- [`docs/ERROR-HANDLING.md`](https://github.com/shuji-bonji/houki-research-skill/blob/main/docs/ERROR-HANDLING.md) — 解釈ポリシー / next_actions テンプレ

houki-egov-mcp の [`src/errors.ts`](src/errors.ts) は family 全体の **リファレンス実装**として位置付けられています。他 MCP は同じ `code` 語彙を共有しつつ、共通パッケージへの依存は持たずに独立実装します。

```json
{
  "error": "法令『消費税法』第3000条は存在しません",
  "code": "ARTICLE_NOT_FOUND",
  "hint": "条番号を get_toc で確認してください",
  "next_actions": [
    { "action": "get_toc", "reason": "目次で正しい条番号を特定", "example": { "law_name": "消費税法" } }
  ],
  "retryable": false
}
```

### 本 MCP で使用するコード

| code | 用途 | retryable |
|---|---|---|
| `INVALID_ARGUMENT` | 引数が `tools/list` の `inputSchema` に合わない（型・必須・enum。`detail.issues[]` に内訳）、キーワード未指定 等 | `false` |
| `INVALID_ARTICLE_NUM` | 条番号フォーマットが不正 (例: 未対応の漢数字) | `false` |
| `OUT_OF_SCOPE` | 通達名で `get_law` を呼んだ等、別 MCP の管轄リソースが要求された | `false` |
| `LAW_NOT_FOUND` | 略称解決・検索のいずれでも法令が見つからない | `false` |
| `ARTICLE_NOT_FOUND` | 指定された条/項/号が見つからない | `false` |
| `SOURCE_API_ERROR` | e-Gov API がエラー応答 (4xx/5xx) | 状況による |
| `SOURCE_TIMEOUT` | e-Gov API がタイムアウト | `true` |
| `SOURCE_RATE_LIMITED` | e-Gov API がレート制限 (HTTP 429) | `true` |
| `SOURCE_UNAVAILABLE` | DNS 失敗 / ECONNREFUSED 等で e-Gov に到達不能 | `true` |
| `INTERNAL_ERROR` | 内部エラー (バグ・予期せぬ例外) | `false` |
| `UNKNOWN_TOOL` | 存在しない tool 名が呼ばれた | `false` |

### Migration (v0.2.x → v0.3.0)

- v0.2.x までは `EGOV_API_ERROR` / `EGOV_TIMEOUT` / `EGOV_RATE_LIMITED` を返していました。v0.3.0 からは family 共通の `SOURCE_API_ERROR` / `SOURCE_TIMEOUT` / `SOURCE_RATE_LIMITED` に切替。
- `EGOV_*` は `LawErrorCode` の型としては残置していますが、本 MCP からはもう発行しません。次のメジャー (v1.0.0) で削除予定。
- 構造化エラーの形 (`{ error, code, hint?, next_actions?, retryable?, detail? }`) は不変。クライアント側で `code` 文字列の比較をしている場合は `SOURCE_*` を受け付けるよう更新してください。
- `OUT_OF_SCOPE` を新たに受け取る可能性があります。例えば「消基通」(消費税法基本通達 / 国税庁の通達) を `get_law` の `law_name` に渡すと、`next_actions[0].example.mcp = "houki-nta"` を含む `OUT_OF_SCOPE` が返されるので、Skill 層は houki-nta-mcp に切り替えてください。

## ドキュメント

- [`docs/LAW-HIERARCHY.md`](docs/LAW-HIERARCHY.md) — 法令種別の階層リファレンス（専門家でない利用者向け）
- [`docs/USE-CASES.md`](docs/USE-CASES.md) — プロダクト開発の典型ユースケース（電帳法・電子契約・個情法・e-KYC）
- [`docs/DESIGN.md`](docs/DESIGN.md) — 設計原則・houki-hub family のロードマップ・業法との関係
- [`DISCLAIMER.md`](DISCLAIMER.md) — 利用上の注意（業法との関係）
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — 貢献方法
- [`CHANGELOG.md`](CHANGELOG.md) — リリースノート

## 業法との関係

本MCPは **一次情報の取得・提示のみ** を担います。分析は LLM、判断は利用者（または有資格者）の責任です。**業としての法律事務・税務業務への利用は想定外**です — 詳細は [DISCLAIMER.md](DISCLAIMER.md) 参照。

## デジタル庁公式 MCP との関係

デジタル庁は 2025年12月〜2026年3月の「法令×デジタル」ハッカソンで法令API / MCP のプロトタイプを試行提供した。将来一般公開された場合は、本 MCP のコアを公式 MCP に委譲し、houki-hub family 全体は **公式が手を出さないレイヤ（通達・裁決・判例の横断インデックス、業法対応 Skill 等）** に注力する方針。

## ライセンス

MIT — 個人利用・学習用途のフォーク・改変・再配布を自由に許可します。

ただし、**業としての使用（弁護士法72条・税理士法52条・社労士法27条が定める独占業務）** については想定外であり、作者は一切の責任を負いません。[DISCLAIMER.md](DISCLAIMER.md) を必ずご確認ください。
