# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned (Phase 1 磨き込み — 痛点ログ駆動)

- 漢数字対応（「第三十条」を 30 に変換）
- 大規模法令の応答サイズ対策（民法・会社法）
- エラーメッセージの LLM 可読化向上

## [0.1.1] - 2026-04-26

**e-Gov コア完成**。v0.1.0 で抜けていた `/law_revisions` エンドポイント対応を追加し、e-Gov 法令API v2 の主要機能をすべてカバーする。

### Added

- **新ツール `get_law_revisions`** — 法令の改正履歴を取得
  - e-Gov v2 `/law_revisions/{lawId}` エンドポイントを叩く
  - 各リビジョンの **公布日 / 施行日 / 改正法令番号 / 改正法令タイトル / 状態（現行・旧法・未施行）**を返す
  - `latest=N` で最新N件のみに絞れる（デフォルトは全件）
  - 略称辞書経由で law_name 解決（消法・民法等）
- **`getLawRevisions(lawId)` 関数** を `egov-client.ts` に追加
- **`RevisionInfo` / `EgovLawRevisionsResponse` 型** を追加

### Status

**v0.1.x 系列で e-Gov 法令API v2 のカバー完了**：
- `/laws` → search_law ✓
- `/law_data/{lawId}` → get_law / get_toc ✓
- `/law_revisions/{lawId}` → get_law_revisions ✓ **(NEW)**

これで houki-hub-mcp 単体で **e-Gov の法令系機能を全カバー**。次は v0.2.0 以降で通達系拡張パッケージ（`@houki-hub/ext-nta` 等）に進む。

## [0.1.0] - 2026-04-26

**Phase 1（e-Gov 法令API v2 コア実装）完了リリース**。条文・目次取得が実 API ベースで動作する最初の実用バージョン。

### Added — Phase 1 コア実装

- **e-Gov 法令API v2 クライアント** (`src/services/egov-client.ts`)
  - `searchLaws` / `getLawData` — snake_case パラメータで叩く
  - 指数バックオフ・タイムアウト・AbortController 対応
  - `EgovHttpError` 型でステータス保持
- **法令ツリー走査** (`src/services/law-tree.ts`)
  - JSON 化された XML ツリー（`{tag, attr, children}`）を走査
  - `findArticle` / `findParagraph` / `findItem` / `extractToc` など
- **法令サービス層** (`src/services/law-service.ts`)
  - 略称解決 → law_id 解決 → 本文取得 → 整形のオーケストレーション
  - LRU cache で `/law_data` 応答を保持（時点 `at` もキー）
- **Markdown 整形** (`src/formatters/markdown.ts`)
  - 条文・項・号レベルの粒度に応じた見出し
  - 出典 URL・取得日時を必ず添付
- **条番号の表記揺れ吸収** (`src/utils/article-num.ts`) — `第30条の2` ↔ `30_2`
- **LRU Cache** (`src/utils/cache.ts`)
- **4ツールの本実装**:
  - `search_law` — タイトル検索（略称→正式名解決済み）
  - `get_law` — 条/項/号レベルの本文取得（Markdown / JSON / TOC）
  - `get_toc` — 法令の目次のみ取得
  - `search_fulltext` — Phase 2 までは search_law にフォールバック

### Added — Phase 0 同梱（v0.1.0 で正式化）

- **法令種別ナレッジ** (`src/knowledge/law-hierarchy.ts`) — 10 種別（憲法・法律・政令・省令・規則・条例・告示・訓令・通達・通知）の制定主体・階層・拘束力・実務上の注意点を構造化
- **業法独占規定ナレッジ** (`src/knowledge/business-law-restrictions.ts`) — 7職業（弁護士・税理士・社労士・公認会計士・司法書士・行政書士・弁理士）の業務独占規定・違反要件・規制外の典型例を構造化
- **新ツール `explain_law_type`** — 法令種別ナレッジを LLM から引けるツール
- **新ツール `explain_business_law_restriction`** — 業法独占規定ナレッジを LLM から引けるツール
- **`docs/LAW-HIERARCHY.md`** — 専門家でない利用者向けの法令階層リファレンス
- **`docs/USE-CASES.md`** — プロダクト開発のユースケース集（電帳法・電子契約・個情法・e-KYC）
- **拡張パッケージ計画拡充** — `@houki-hub/ext-meti` / `ext-soumu` / `ext-moj` / `ext-ppc` を Phase 3 計画に追加（合計9パッケージ）
- **拡張ツールの統一インターフェース設計** — `{namespace}_search` / `_get` / `_list` + `type` パラメータでの絞り込み

### Tests

- **74 tests passed**（v0.0.1: 49 → v0.1.0: 74、+25）
  - law-tree: 14 / cache: 6 / article-num: 6 / handlers: 15 / abbreviations: 13 / law-hierarchy: 11 / business-law-restrictions: 9
- E2E 動作確認: 消法30条1項取得・労基法目次取得・消費税法検索（実 e-Gov API 経由）

### Internal

- リポジトリリネーム: `jp-houki-mcp` → `houki-hub-mcp`
- `.gitignore` に Vite/Vitest の timestamp 一時ファイルを追加

### Known Limitations

- 漢数字の条番号（「第三十条の二」など）は未対応 — アラビア数字でご指定ください
- `search_fulltext` は Phase 2（bulkDL + SQLite FTS5）まで本実装ではない（タイトル一致 search_law にフォールバック）
- 大規模法令（民法・会社法等）の本文一括取得時にレスポンスサイズが大きい

---

## [Future planning — 0.1.0 以降]

### Planned (Phase 2)

- XML 一括ダウンロード + SQLite FTS5 による横断全文検索（`search_fulltext`）

### Planned (Phase 3)

- 拡張レイヤ I/F 確定
- 公式拡張パッケージ（`@houki-hub/ext-nta`, `@houki-hub/ext-mhlw`, `@houki-hub/ext-jaish`, `@houki-hub/ext-saiketsu` 等）リリース

### Planned (`@houki-hub/ext-court` 段階実装)

判決検索拡張は外部データ提供状況に応じて3段階で実装する：

- **Stage A**: 裁判所サイト（`courts.go.jp/app/hanrei_jp/`）の公開判決スクレイピング
- **Stage B**: **民事判決オープンデータAPI（2026年度提供開始予定）対応** — 年間約20万件公開予定。日弁連法務研究財団／最高裁による API 仕様公開を待って実装
- **Stage C**: bulk 取得 + ローカル SQLite FTS5（コアと同じ分散型 ground truth 思想を判例まで拡張、将来構想）

## [0.0.1] - 2026-04-23

Phase 0（スケルトン整備）完了リリース。

### Added

- プロジェクト骨格（`package.json` / `tsconfig.json` / ESLint / Prettier / Vitest）
- MCP サーバエントリ（`src/index.ts`）— stdio トランスポート
- 5つの MCP ツール定義：
  - `search_law` — 法令キーワード検索（スタブ）
  - `get_law` — 条/項/号単位の条文取得（スタブ、略称解決のみ動作）
  - `get_toc` — 目次取得（スタブ、略称解決のみ動作）
  - `search_fulltext` — 横断全文検索（スタブ）
  - `resolve_abbreviation` — 略称→正式名称の解決（**実装済み**）
- **略称辞書 162 エントリ**（6分野 JSON に分割）
  - 税法（26）/ 労働・社会保険（28）/ 会計（9）/ 商事（31）/ 民事（23）/ 行政・刑事・情報通信（45）
  - プロダクト開発系法令（電子署名法・資金決済法・犯収法・プロ責法・電波法・電気通信事業法 等）を網羅
- 拡張レイヤ I/F 暫定版（`src/extensions/types.ts` — `ExtensionFactory`）
- テストスイート（vitest）
  - `src/abbreviations/abbreviations.test.ts` — 辞書整合性（必須フィールド・law_id 形式・略称重複）
  - `src/tools/handlers.test.ts` — ハンドラ疎通確認
- GitHub Actions CI（Node.js 20 / 22 マトリクス、lint + test + build）
- ドキュメント：
  - `README.md` — 立ち位置・想定利用シーン・インストール
  - `DISCLAIMER.md` — 3層責任分離・業法との関係・想定利用範囲
  - `CONTRIBUTING.md` — 辞書・拡張・Skill の3経路の貢献手順
  - `docs/DESIGN.md` — 設計原則・業法との関係・利用シーン
  - `docs/PAIN-POINTS-TEMPLATE.md` — 2週間トライアル記録テンプレ
  - `examples/ext-template/` — 拡張パッケージ最小雛形
- GitHub Issue / PR テンプレート

### Status

**Phase 0 完了**。Phase 1 本実装の前に、**2週間の実運用痛点ログ**（`docs/PAIN-POINTS-TEMPLATE.md`）を経由して MVP スコープを確定する。

[Unreleased]: https://github.com/shuji-bonji/houki-hub-mcp/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/shuji-bonji/houki-hub-mcp/releases/tag/v0.1.1
[0.1.0]: https://github.com/shuji-bonji/houki-hub-mcp/releases/tag/v0.1.0
[0.0.1]: https://github.com/shuji-bonji/houki-hub-mcp/releases/tag/v0.0.1
