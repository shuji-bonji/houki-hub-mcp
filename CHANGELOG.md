# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned (Phase 1)

- e-Gov 法令API v2 クライアント実装
- `get_law` / `search_law` / `get_toc` 本実装（現状はスタブ）
- 略称辞書に `law_id` を埋めるバッチ検証スクリプト

### Planned (Phase 2)

- XML 一括ダウンロード + SQLite FTS5 による横断全文検索（`search_fulltext`）

### Planned (Phase 3)

- 拡張レイヤ I/F 確定
- 公式拡張パッケージ（`@houki-hub/ext-nta`, `@houki-hub/ext-mhlw` 等）リリース

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

[Unreleased]: https://github.com/shuji-bonji/houki-hub-mcp/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/shuji-bonji/houki-hub-mcp/releases/tag/v0.0.1
