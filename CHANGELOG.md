# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### In progress (Phase 2 — 残作業)

- Phase 2-13: API enrichment（`category` / `revisions_meta` / PreviousEnforced・Repeal の精緻化）
- Phase 2-8: 差分同期 (`--bulk-download-incremental`) の日次ループ

### Planned (Phase 1 磨き込み — 痛点ログ駆動 / Phase 2 着手前から残置)

- 漢数字対応（「第三十条」を 30 に変換）
- 大規模法令の応答サイズ対策の本格化（章/節単位での部分取得 API）

## [0.5.1] - 2026-09-07

**bug fix リリース — 編（Part）を持つ法令の本則が bulk DB に入っていなかった問題の修正**。v0.5.0 を plugin 経由で試用したところ、`search_fulltext("民法 不法行為")` が附則の条しか返さず、民法 709 条が出ませんでした。原因は XML パーサーが `MainProvision > Part > Chapter` の `Part`（編）を辿らず、民法・会社法・刑法・商法など編を持つ法令の本則の条をすべて落としていたことです。

**v0.5.0 で構築した DB は `houki-egov-mcp --bulk-download-everything` を再実行してください**（content_hash が変わるため全件が再 ingest されます。スキーマの初期化は不要）。

### Fixed

- `src/services/bulk/xml-parser.ts`: `Part` / `PartTitle` を階層走査に追加。`chapter_path` には `第三編　債権 第五章　不法行為` のように編から入る

### Changed

- `src/services/bulk/ingester.ts`: `content_hash` の入力に `INGEST_VERSION`（= 2）を混ぜる（`contentHashOf`）。パーサーや normalize を変えたときに定数を上げるだけで全件再 ingest を強制でき、`SCHEMA_VERSION` を上げて DROP する必要がなくなる
- テスト 2 件追加（合計 **256 tests**）
- README: 「SQLite と DB の置き場所（npx / plugin 経由で使う場合）」の節と Claude Code plugin の節を追加。family 表を現状（abbreviations v0.5.0 / nta v0.9.5 / research-skill）に更新、略称辞書の件数を 174 に修正、`search_fulltext` の使用例を追加

## [0.5.0] - 2026-09-07

**Phase 2-7 リリース — `search_fulltext` の FTS5 本実装**。`houki-egov-mcp --bulk-download-everything` で構築したローカル DB を引き、条文本文を横断検索します。bulk DB 未構築の環境では従来どおり `search_law` にフォールバックします（応答の `source` で区別できます）。

計画書: [docs/PHASE2-7-PLAN.md](docs/PHASE2-7-PLAN.md)

### Added

- **`search_fulltext` の bulk DB 経路** (`src/tools/handlers.ts`)
  - 応答: `{ keyword, expanded_keywords?, source: 'bulk', count, hits[], freshness, filters }`。各 hit は `match_type` (`article` / `law_meta`) / `law_id` / `law_revision_id` / `law_title` / `law_num` / `law_type` / `article_num`（`30の2` 表記）/ `caption` / `chapter_path` / `snippet`（`<b>` ハイライト）/ `rank` / `score` / `score_reasons` / `url`
  - `freshness` は `sync_state` 由来（`last_sync_date` / `staleness` / outdated 時の `warning`）。outdated でも DB の結果を返す（API に倒さない）
  - `law_type` で絞り込み可。`domain` は受け付けるが `filters.domain.applied: false` + note（`laws.category` が Phase 2-13 まで空のため）
  - `deps.dbPath` で DB パスを注入できる（テスト用）
- **新規 `src/services/law-search.ts`** — houki-nta-mcp `db-search.ts` の移植
  - `sanitizeFtsQuery`: `normalizeSearchQuery` → 条番号除去 → FTS5 メタ文字除去 → 3 文字未満トークン除去 → `"tok" AND "tok"`
  - `buildFtsQueryWithAbbreviation`: `resolveAbbreviation(kw, { normalize: true })` が `source_mcp_hint: 'houki-egov'` を返す語を `(main) OR (formal)` に展開。略称自体が 2 文字（`消法`）なら formal だけで検索
  - `searchArticleFts`（`articles_fts` + `snippet()`）と `searchLawMetaFts`（`laws_fts`）を `laws` と JOIN し、`current_revision_status = 'CurrentEnforced' OR remain_in_force = 1` で **同一法令の旧 revision の重複ヒットを排除**
  - `law_meta` 経路: 本文が `articles` に入らない法令（太政官布告 等）や法令名そのものを探すケースを捕捉。article 経路で捕捉済みの revision は捨てる
  - **2 文字トークンの補完**（trigram は 3 文字未満を索引しないため）: 3 文字以上の語と併用時は FTS ヒット本文の `includes` で AND 絞り込み、単独時は `laws.law_title` / `abbrev` の LIKE 照合（`searchLawMetaLike`）。1 文字は対象外
  - **法令スコープ**（`splitLawScope`）: 「民法 不法行為」「労基法 時間外」のように法令名・略称と語を並べたクエリは、法令名を検索対象の絞り込みに回し、残りの語で本文を検索する（応答の `law_scope` に解釈結果を返す）。辞書の `formal` / `abbr` と DB の `law_title` に一致するトークンだけが対象で、「インボイス」「適格請求書」のような通称（aliases）は従来どおり OR 展開に回す。スコープ内で 2 文字語だけのとき（「民法 契約」）は本文 LIKE で引く
  - 附則の条番号は `附則(137) 51の2`、別表は `別表(2)` の表示形式にする（`formatArticleNumForDisplay`）
  - `hasAnyArticle` / `hasAnyLaw`: bulk DL 未実行の判定
- **新規 `src/services/relevance-scoring.ts`** — nta 版から doc_type 重みを外した法令向け変種
  - `score = min(base(rank) + boosts, 1.0)`、`base = 1 / (1 + 10 / |rank|)`
  - boost: `title_exact_match` +0.3 / `abbrev_match` +0.2（XML Abbrev と辞書の abbr・aliases）/ `article_num_match` +0.3（クエリ中の「第N条」「第N条のM」。漢数字は未対応）/ `article_caption_match` +0.1 / `supplementary_provision` -0.15（附則の条。実データでは経過措置の条が本則より上に来やすいため）
  - FTS からは `min(limit×3, 150)` 件取って re-rank
- **新規 `src/test-helpers/law-db-fixture.ts`** — 消費税法（現行 + PreviousEnforced）/ 労働基準法（全角数字本文）/ 太政官布告（Article なし）を `:memory:` に投入する共通 fixture（dist には含めない）
- テスト 52 件追加（`law-search.test.ts` 33 / `relevance-scoring.test.ts` 14 / `handlers.test.ts` 4 / `ingester.test.ts` 1）。合計 **254 tests**

### Changed

- **ingester が `articles.body` と `laws_fts` の各列を `normalizeJpText` 済みで投入する**（Normalize-everywhere。`body_raw` / `laws.law_title` は原文のまま）。`articles_fts` は trigger 経由で normalize 済み本文を索引する
- **`SCHEMA_VERSION` を 1 → 2 に更新** — テーブル定義は同じだが、v1 の DB は content_hash が一致して再 ingest が no-op になるため、バージョン不一致で DROP & CREATE する。**v0.4.x 以前に構築した DB は次回起動時に初期化されるので `--bulk-download-everything` を再実行してください**
- `search_fulltext` の tool description と `keyword` / `domain` の説明を本実装に合わせて更新（`HOUKI_HUB_BULK_CACHE` への言及を削除）
- API フォールバック応答に `source: 'api-fallback'` と `next_actions`（`bulk_download_everything` / `search_law`）を追加。`note` / `fallback` キーは v0.3.x と同じ

### Removed

- `RUNTIME_FLAGS.bulkCache`（環境変数 `HOUKI_HUB_BULK_CACHE`）— フラグではなく「DB に条があるか」（`hasAnyArticle`）で経路を自動判定する。CLI の `--help` からも削除

## [0.4.0] - 2026-09-06

**MCP SDK v2 移行リリース** — MCP ツールの応答形式・ツール一覧は v0.3.1 から変わりません。`search_fulltext` は引き続き `search_law` へのフォールバックで、FTS5 バックエンドへの接続は次リリース（Phase 2-7、v0.5.0）で行います。

### Changed

- **MCP SDK を v2 に移行** — `@modelcontextprotocol/sdk ^1.29` → `@modelcontextprotocol/server ^2.0.0`（2026-07-28 公開、同日付の MCP 仕様改訂に対応）。
  - サーバー本体を `src/server.ts` の `createServer()`（factory）に切り出し、bin エントリ `src/index.ts` は `serveStdio(createServer)` で起動する。`serveStdio` が stdio transport を所有し、2025 系 / 2026-07-28 系クライアントの protocol version 交渉を行う
  - 低レベル `Server` を維持。`setRequestHandler` のキーは Zod スキーマからメソッド名文字列（`'tools/list'` / `'tools/call'`）に変更。tools/call の family error contract（`UNKNOWN_TOOL` / `INTERNAL_ERROR` の JSON 化 + `isError: true`）は変更なし
  - `Tool` 型の import 元を `@modelcontextprotocol/server` に変更（`inputSchema` は JSON Schema のまま）
  - SIGINT / SIGTERM で `handle.close()` を呼び、transport とサーバーを閉じてから終了する
- **Node.js の下限を 22 に引き上げ**（`engines.node >=22.0.0`。Node 20 は 2026-04-30 に EOL）。CI マトリクスは 22 / 24
- **TypeScript 7.0（tsgo）に更新** — `tsconfig.json` の変更なし。ビルドは従来どおり `tsc && chmod +x dist/index.js`
- **lint / フォーマットを ESLint + Prettier から Biome 2.5 に置き換え** — `eslint.config.js` / `.prettierrc` / `.prettierignore` を削除し `biome.json` を追加。フォーマット規則は従来の Prettier 設定（single quote / es5 / semi / width 100 / 2 space）と同一で、既存コードの再フォーマットは import 順の整列のみ。`complexity/useLiteralKeys` は日本語キー（`LAW_HIERARCHY['憲法']`）の可読性のため無効化
  - scripts: `lint` = `biome lint src`、`format` = `biome format --write src`、`format:check` = `biome format src`、`check` = `biome check --write src`
  - Biome 指摘の修正: `let db` / `let res` に型注釈（`noImplicitAnyLet`）、`import 'module'` → `'node:module'`、テストの文字列連結をテンプレートリテラルに
- `@types/node` を `^24` に更新

### Added

- **新規 `src/server.test.ts`**（9 ケース） — `@modelcontextprotocol/client` の `InMemoryTransport` で `createServer()` を in-process 起動し、initialize の name / version、`tools/list` の一覧と JSON Schema、`UNKNOWN_TOOL` / `LawServiceError` / handler 例外（`INTERNAL_ERROR`）の 3 経路が `isError: true` になることを MCP 経由で検証
- `docs/SDK-V2-MIGRATION-PLAN.md` — 移行計画と Phase 2-7 との順序判断

### Removed

- devDependencies: `eslint` / `@eslint/js` / `typescript-eslint` / `eslint-config-prettier` / `prettier`

## [0.3.1] - 2026-07-14

**Phase 2 基盤リリース** — bulk DL + SQLite FTS5 の取り込みパイプライン一式（schema / CSV parser / XML parser / zip fetcher / ingester / freshness / CLI）を実装。

MCP ツールの応答は本リリースでは変わりません（`search_fulltext` は引き続き `search_law` へのフォールバック）。FTS5 バックエンドへの接続は次リリース（Phase 2-7）で行います。ローカル DB は新 CLI `houki-egov-mcp --bulk-download-everything` で構築でき、`--status` で件数と鮮度を確認できます。

詳細は [docs/PHASE2-DESIGN.md](docs/PHASE2-DESIGN.md)。spike + follow-up 結果は [docs/PHASE2-SPIKE.md](docs/PHASE2-SPIKE.md) / [docs/PHASE2-SPIKE-FOLLOWUP.md](docs/PHASE2-SPIKE-FOLLOWUP.md)。

### Added

#### 2026-05-09 — Phase 2-1: schema migration v0→v1

- **新規 `src/db/schema.ts`** — Phase 2 の DB スキーマを構築する `initSchema()` を実装。
  - `laws` (1 行 = 1 revision、PK: `law_revision_id`) — `current_revision_status` × `repeal_status` 2 軸でステータス管理。`mission` は API 上常に `New` のため列にせず `revisions_meta.raw_revision_info_json` に保管
  - `articles` (1 行 = 1 条 or 別表) — `body` (normalized) と `body_raw` (original) を二重保存する Normalize-everywhere パターン
  - `revisions_meta` — 全履歴 (CurrentEnforced + UnEnforced + PreviousEnforced) の API レスポンスを raw JSON で保管
  - `sync_state` — single-row テーブル (`CHECK (id = 1)`) で bulk DL の同期状態を保持
  - `laws_fts` (standalone) — 法令名 / 略称 / 番号 / カテゴリの FTS5 検索
  - `articles_fts` (external content + triggers) — 条本文の FTS5 検索。articles_ai / articles_au / articles_ad で auto-sync
  - tokenizer は houki-nta-mcp と統一して **`trigram`** (SQLite ≥ 3.34 builtin)。日本語混在テキストの N-gram 部分一致を可能にする (`unicode61` は CJK を 1 トークンとして扱うため不可)
- **新規 `src/db/index.ts`** — `openDb()` / `closeDb()` / `defaultDbPath()`。デフォルトは `${XDG_CACHE_HOME:-~/.cache}/houki-egov-mcp/laws.db`
- **新規 `src/db/schema.test.ts`** (12 ケース) — テーブル / カラム / CHECK 制約 / trigger / CASCADE / sync_state single-row / 冪等性を検証
- **`src/config.ts`** に `BULK_CONFIG` を追加 (HOUKI_EGOV_DB_PATH / HOUKI_EGOV_BULK_RETRY / HOUKI_EGOV_INCREMENTAL_LIMIT_DAYS)

#### 2026-05-09 — Phase 2-4: CSV parser (all_law_list.csv)

- **新規 `src/services/bulk/csv-parser.ts`** — bulk zip 同梱の `all_law_list.csv` (UTF-8 BOM, CRLF, 14 列) を `AllLawListRow[]` に変換。差分 zip 内の `R{YY}{MM}{DD}.csv` も同形式なので両方で利用される。
  - `parseCsv()` — RFC 4180 互換の state-machine CSV パーサ。BOM 除去 / CRLF・LF 両対応 / クォート内コンマ・改行・エスケープ `""` を扱う
  - `extractLawRevisionId()` — 列 13「本文 URL」末尾セグメント (`{YYYYMMDD}_{amendmentLawId}`) を抽出して `law_revision_id = {law_id}_{enforcement_date}_{amendment_law_id}` を構成 (PK 候補)
  - `parseAllLawList()` — 列数チェック / `skipMalformed` オプション / 派生フィールド計算
  - 和暦テキスト (列 6/9/10) は raw 文字列として保持 (API v2 ISO 形式を ingester で採用するため、ここではパースしない)
- **新規 `src/services/bulk/csv-parser.test.ts`** (21 ケース) — BOM / CRLF / クォート / エスケープ / 旧法令名の CSV-in-CSV / 未施行フラグ / 列数不一致 / skipMalformed / Buffer 入力 / revision_id 抽出 を網羅

#### 2026-05-09 — Phase 2-10: freshness 計算

- **新規 `src/services/freshness.ts`** — houki-nta-mcp v0.9.3 と同パターンで `@shuji-bonji/houki-abbreviations` v0.4.1+ の `StalenessLevel` / `STALENESS_THRESHOLDS` / `judgeStaleness` / `computeDaysSince` を import。
  - `FreshnessInfo` インタフェース — sync_state.last_sync_date / last_full_dl_at と staleness / days_since_sync / warning を保持
  - `summarizeFreshness(db, hint?, nowMs?)` — sync_state テーブル (single-row) から FreshnessInfo を構築。sync_state がない (初回 DL 前) は null を返す
  - `buildWarning(staleness, daysSince, hint?)` — outdated 時のみ「`bulk-download-incremental` を実行」案内メッセージを生成 (MCP 固有の文言は本ファイルに残す)
  - 判定の主軸は **`last_sync_date`** (全件 DL でも incremental でも、最後の同期完了日基準)
- **新規 `src/services/freshness.test.ts`** (12 ケース) — buildWarning の各 staleness レベル / hint 上書き、sync_state 未設定時の null、閾値境界 (`fresh_days` 前後)、outdated 警告付与、レスポンス整形の sanity check を網羅

#### 2026-05-09 — Phase 2-3: XML parser

- **新規 `src/services/bulk/xml-parser.ts`** — e-Gov 法令標準 XML を `ParsedLaw` 構造に変換。bulk DL zip 内の各法令 XML を ingester で読み込んで articles テーブルに格納するためのパーサ。
  - **`parseLawXml(xml)`** — Law 属性 (Era / Year / Num / LawType / PromulgateMonth / PromulgateDay) + LawTitle (Kana / Abbrev / AbbrevKana) + LawNum + EnactStatement を抽出
  - **本則 (MainProvision)** — Chapter / Section / Subsection / Division を再帰的に降りて Article を抽出。`chapter_path` を Title スタックで構築 (例: `第二章　預金保険機構 第一節　総則`)
  - **附則 (SupplProvision)** — `article_num=Suppl{idx}_{原 Num}` で本則と同じ articles 配列に格納 (例: `Suppl1_1`)
  - **別表 (AppdxTable / AppdxNote / AppdxFig / AppdxStyle)** — `article_num=Appendix{連番}` で種別跨ぎの通し番号
  - **本文抽出** — Article 配下の Paragraph / Item / Subitem / Sentence を再帰的に flatten し、Paragraph 境界で改行を入れる。ArticleCaption / ArticleTitle / TOC は body に含めない
  - **`extractInlineText(node)`** — 任意ノードから全テキストを再帰的に取り出す純関数 (export 済み、テストでも利用)
  - **`XmlParseError`** — ルート不一致 / LawBody 欠落 / LawNum 空 / 不正 XML を識別する独自エラー型
- **新規 `src/services/bulk/xml-parser.test.ts`** (18 ケース) — 改暦ノ布告レベルの最小 XML / Chapter > Section 階層 / Item + Subitem / 附則 / 別表 / TOC 除外 / caption 分離 / エラー系 / メタデータ null 等を網羅
- **fast-xml-parser** は package.json に既存 (^4.5.0)。`isArray` で繰り返し要素を array 強制するオプションを採用

#### 2026-05-09 — Phase 2-2: bulk-downloader (file_section=1)

- **新規 `src/services/bulk/zip-fetcher.ts`** — e-Gov bulk DL zip を取得する低レベル fetcher。全件 (file_section=1) と差分 (file_section=3) で共通利用。
  - **`downloadZip(opts)`** — URL / dest / expectedBytes / maxRetries / onProgress / fetchImpl / signal を受ける汎用関数。`{dest}.partial` に書いてから rename する atomic 書き込み。エラー時は確実に部分ファイルを掃除
  - **`downloadFullZip(opts)`** — `EGOV_BULK.fullDownloadUrl` を埋めるラッパ
  - **`downloadIncrementalZip(yyyymmdd, opts)`** — `EGOV_BULK.incrementalDownloadUrl(yyyymmdd)` を埋めるラッパ
  - **retry 戦略**: exponential backoff (1s, 2s, 4s, ...) で `BULK_CONFIG.bulkRetry` (env `HOUKI_EGOV_BULK_RETRY`、default 3) 回まで。spike §1-2 で確認した通り **HTTP Range / Accept-Ranges / ETag / Last-Modified が一切来ない**ため resume / 304 conditional GET は実装せず、失敗時は 0 から再取得
  - **進捗通知**: `Content-Length` が来ないため `expectedBytes` (default 290 MB、PHASE2-SPIKE 実測ベース) を使った線形 ETA。`progressIntervalBytes` (default 1 MB) ごとに onProgress 発火
  - **整合性**: 取得完了時に zip マジックバイト `PK\x03\x04` を先頭で確認、不一致なら `ZipFormatError`
  - **AbortSignal 対応** — backoff sleep 中も即座にキャンセル可能
  - エラー型: `BulkFetchError` (ベース) / `ZipFormatError` (zip 形式不正)
- **`src/config.ts`** の `EGOV_BULK` に URL builder を追加: `fullDownloadUrl` / `categoryDownloadUrl(cd)` / `incrementalDownloadUrl(yyyymmdd)`
- **新規 `src/services/bulk/zip-fetcher.test.ts`** (11 ケース) — mock fetch で正常系 / zip マジック不一致 / fetch error retry / HTTP 5xx retry / maxRetries 連続失敗 / progress 発火 / ratio 頭打ち / AbortSignal キャンセル / URL builder ラッパを網羅。実 I/O は `os.tmpdir()` 配下の一時ディレクトリで実施し afterEach で掃除

#### 2026-05-09 — Phase 2-5: ingester (zip → DB)

- **新規 `src/services/bulk/zip-reader.ts`** — zip 展開を ingester から分離する `ZipReader` 抽象。
  - `openZipFile(path)` — production 用、`unzipper.Open.file()` で streaming 展開
  - `createMemoryZip(entries)` — テスト用 in-memory ZipReader ファクトリ
- **新規 `src/services/bulk/ingester.ts`** — `ingestZip(opts)` で CSV + XML を 1 transaction にまとめて laws / articles / laws_fts に upsert。
  - **`law_revision_id` を PK** にして 1 法令 = 1 revision で upsert
  - **content_hash (SHA-256) で no-op 判定** — 同じ revision_id で本文未変更なら skip して unchanged カウント
  - **`db.transaction()` の batch 化** (default 200 件) — 10K 法令でも 50 transaction 程度で完了
  - **promulgation_date 計算** — XML 属性 (Era + Year + PromulgateMonth + PromulgateDay) → 西暦 ISO date 変換 (Meiji 1=1868 / Showa 1=1926 等の元号オフセットテーブル内蔵)
  - **CSV unenforced フラグ → `current_revision_status='UnEnforced'`** に簡易マッピング (PreviousEnforced / Repeal は API 経由で精緻化、Phase 2-13 範囲)
  - **articles の全置換** — INSERT 前に DELETE で前 revision の本文を消す (articles_fts は trigger で自動同期)
  - **laws_fts の手動同期** — standalone 設計のため DELETE → INSERT で全置換
  - **sync_state の upsert** — source='all_xml' の時のみ last_full_dl_at を更新 / incremental の時は既存値を維持
  - エラー型: `IngestError` (CSV 不在 / XML パース失敗で onXmlError=throw 時)
  - 進捗: `onProgress({ processed, total, lastLawRevisionId })` callback
- **新規 `src/services/bulk/ingester.test.ts`** (16 ケース) — in-memory zip + in-memory DB で正常 ingest / articles_fts trigger / laws_fts 手動同期 / 未施行フラグ / content_hash no-op / content 変化で UPDATE / 複数法令 / CSV外 zip エントリの無視 / XML 不在の failed カウント / 壊れた XML の skip / onXmlError=throw / CSV 不在エラー / sync_state upsert / source 切替 (all_xml / incremental) / progress 発火を網羅
- **依存追加**: `unzipper@^0.12.3` (本体) + `@types/unzipper@^0.10.10` (型) — 285 MB zip でも streaming 展開できる
- **設計判断 (PHASE2-DESIGN.md §5.1 / FOLLOWUP §2 反映)**:
  - PreviousEnforced / Repeal の精緻化は本フェーズ範囲外 (API enrichment へ)
  - `revisions_meta` テーブルへの履歴挿入は本フェーズ範囲外 (`/api/2/law_revisions/{lawId}` 経由で Phase 2-13 で対応)
  - `category` は CSV 列に無く、API レスポンスにのみあるので Phase 2-13 で埋める

#### 2026-05-09 — Phase 2-6: CLI (`--bulk-download-everything` / `--status`)

- **新規 `src/cli/index.ts`** — `houki-egov-mcp` バイナリの CLI モード。引数なしで起動した場合は MCP server (既存挙動) で常駐、フラグ付きで起動した場合は CLI ハンドラを実行して exit する。
  - **`--bulk-download-everything`** — `downloadFullZip` → `openZipFile` → `ingestZip` の一連を実行。所要時間 / DL バイト / ingest 件数を stderr に表示
  - **`--bulk-download-by-date YYYYMMDD`** — 単日差分 zip の DL + ingest (デバッグ用)
  - **`--status`** — `defaultDbPath()` の DB を開いて laws / articles 件数 + `summarizeFreshness()` の結果を表示。DB 未作成なら案内メッセージ
  - **`--version` / `--help` / `-h` / `-v`** — 標準フラグ
  - 進捗は stderr に上書き表示 (DL 中の bytes / ratio、ingest 中の処理済み法令数)
  - 未知のフラグは exitCode=2 + ヘルプ表示
  - 引数なしは `__not_cli__` を返し、`src/index.ts` が MCP server へフォールバック
- **`src/index.ts`** に `runCli` の dispatch を追加。CLI コマンドが命中した場合は MCP server を起動せず CLI exit code で終了
- **新規 `src/cli/index.test.ts`** (9 ケース) — 引数解析の早期 exit パスを網羅 (--help / --version / 不正な --bulk-download-by-date / 未知フラグ / MCP fallback の真偽)。実 bulk DL は走らせない
- **`package.json` の build script に `chmod +x dist/index.js` を追加** — houki-nta-mcp と統一。これがないと `./dist/index.js --status` 等の直接実行で `permission denied` になる

### Dependencies

- **追加: `better-sqlite3 ^12.9.0`** + `@types/better-sqlite3 ^7.6.13` — Phase 2 SQLite FTS5
- **アップグレード: `@shuji-bonji/houki-abbreviations` を `^0.3.0` → `^0.4.1`** — freshness モジュール (StalenessLevel / 閾値定数 / 純関数) を Phase 2-10 で利用するため
- **追加: `unzipper ^0.12.3`** + `@types/unzipper ^0.10.10` — 285 MB の bulk zip を streaming 展開するため
- **追加: `fast-xml-parser ^4.5.0`** — 法令標準 XML のパースに使用

### Tests

- **50 tests → 193 tests (14 files)** — Phase 2 の各モジュール (schema / csv-parser / xml-parser / zip-fetcher / ingester / freshness / cli) を網羅

## [0.3.0] - 2026-05-08

houki-hub family の error contract に完全準拠するための磨き込みリリース。`code` 語彙を family 全体で揃え、別 MCP の管轄リソース要求に対する `OUT_OF_SCOPE` 検知を導入。

### Added

- **family 共通エラーコード `SOURCE_*` を採用** — `LawErrorCode` に `SOURCE_API_ERROR` / `SOURCE_TIMEOUT` / `SOURCE_RATE_LIMITED` / `SOURCE_UNAVAILABLE` を追加。`SOURCE_UNAVAILABLE` は ECONNREFUSED / ENOTFOUND / EAI_AGAIN 等のネットワーク到達不能を検知する新コード。
- **`OUT_OF_SCOPE` エラーコードと scope ガード** — 略称解決の結果が houki-egov 以外の管轄 (例: 通達は `houki-nta`、判例は `houki-court`) と判明した場合、新規 `checkAbbreviationScope()` が `get_law` / `get_toc` / `get_law_revisions` の入口で `OUT_OF_SCOPE` エラーを返す。`next_actions[0].example.mcp` で正しい MCP を指示するため、Skill 層が透過的にルーティングできる。
- **`NEXT_ACTIONS.delegateTo(mcpHint)` プリセット** — `OUT_OF_SCOPE` 時に他 MCP への切替を勧める next_action。

### Changed

- **`egovHttpErrorToLawError` が SOURCE_* を発行するように移行** — 内部実装を `EGOV_RATE_LIMITED` → `SOURCE_RATE_LIMITED` / `EGOV_TIMEOUT` → `SOURCE_TIMEOUT` / `EGOV_API_ERROR` → `SOURCE_API_ERROR` に切替。`SOURCE_UNAVAILABLE` の検知ロジックも追加。
- **エラーコード分類のドキュメンテーション** — `src/errors.ts` の `LawErrorCode` を「引数・入力 / リソース未発見 / 外部ソース由来 / 旧コード / システム」のカテゴリ別に整理。

### Deprecated

- **`EGOV_RATE_LIMITED` / `EGOV_TIMEOUT` / `EGOV_API_ERROR`** — `LawErrorCode` の型としては残置 (v0.2.x 前提のクライアントが破綻しないため) が、内部実装からはもう発行しない。新規実装では `SOURCE_*` を使うこと。次のメジャー (v1.0.0) で削除予定。

### Migration (v0.2.1 → v0.3.0)

- 後方互換: 構造化エラーの形 (`{ error, code, hint?, next_actions?, retryable?, detail? }`) は変わらない
- ただし以前 `EGOV_*` で来ていた `code` が `SOURCE_*` に変わる。client/Skill 側で `code` 文字列の比較をしている場合は両方を受け付けるようにするか、houki-research-skill の最新 `docs/ERROR-CODES.md` に従う
- `OUT_OF_SCOPE` を新たに受け取る可能性がある (例: 通達名で `get_law` を呼んだとき)。Skill 側は `resolved.source_mcp_hint` または `next_actions[0].example.mcp` を見て該当 MCP に切替

## [0.2.1] - 2026-05-03

外部レビューを反映した磨き込みリリース。破壊的変更なし、すべて後方互換。

### Added

- **エラーレスポンスの LLM 可読化** — `src/errors.ts` を新設
  - 統一形式 `{ error, code, hint?, next_actions?, retryable?, detail? }` を定義
  - `LawErrorCode`: `LAW_NOT_FOUND` / `ARTICLE_NOT_FOUND` / `INVALID_ARTICLE_NUM` / `EGOV_API_ERROR` / `EGOV_TIMEOUT` / `EGOV_RATE_LIMITED` / `INVALID_ARGUMENT` / `UNKNOWN_TOOL` / `INTERNAL_ERROR`
  - `next_actions` で「次に呼ぶべき tool」をプリセット（`resolve_abbreviation`, `search_law`, `get_toc`, `retry_later`, `visit_egov_site`）
  - LLM が自律的に次手を選びやすくなる
- **同時リクエスト数の制限** — `src/utils/concurrency.ts` を新設
  - 軽量な FIFO ベース limit 関数（30行、外部依存なし）
  - 既定 4 並列。環境変数 `HOUKI_EGOV_CONCURRENCY` で上書き可
  - retry/backoff と二重に守ることで 429 (Rate Limited) を予防
- **`get_toc` に `depth` パラメータ追加** — 大規模法令対策
  - 構造階層を上位 N 階層で打ち切る（`depth=1`: 編まで、`depth=2`: 章まで、`depth=3`: 節まで）
  - 民法・会社法のような大規模法令の概観把握でトークン節約
  - レスポンスに `node_count` / `truncated` を追加
- **`package.json`** — 現代的 ESM 互換性
  - `"sideEffects": false`
  - `"exports"` フィールドを追加

### Changed

- **MCP server 内部のエラー処理（`src/index.ts`）**
  - tool handler が `LawServiceError` を返した場合、自動的に `isError: true` をセット
  - 想定外例外は `INTERNAL_ERROR` コードに正規化
- **`law-service.ts`** — エラー返却を `makeError(code, msg, { hint, next_actions, ... })` 形式に統一
  - 既存の `error` / `hint` フィールドは互換性を維持（後方互換）
- **`egov-client.ts`** — すべての fetch を `limit()` でラップ

### Migration Notes

すべて後方互換のため、設定変更は不要。

エラーレスポンスを既存コードでパースしている場合、`error` / `hint` フィールドは互換性が保たれているが、新しい `code` / `next_actions` / `retryable` を活用するとより堅牢になる。

```ts
// 旧
if ('error' in res) console.error(res.error);

// 新（推奨）
if (res.code === 'EGOV_RATE_LIMITED' && res.retryable) {
  // 30秒待って再試行
}
```

## [0.2.0] - 2026-04-27

**Architecture E への転換**。`@shuji-bonji/houki-hub-mcp` を **`@shuji-bonji/houki-egov-mcp`** にリネームし、責務を「e-Gov 法令API v2 のクライアント」に絞り込む。略称辞書は別パッケージ `@shuji-bonji/houki-abbreviations` v0.1.0 として独立。

### ⚠️ Breaking Changes

- **パッケージ名変更**: `@shuji-bonji/houki-hub-mcp` → **`@shuji-bonji/houki-egov-mcp`**
- **bin 名変更**: `houki-hub-mcp` → **`houki-egov-mcp`**
- **リポジトリ移動**: `shuji-bonji/houki-hub-mcp` → `shuji-bonji/houki-egov-mcp`
- **ツール削除**: `explain_business_law_restriction` を削除
  - 業法独占規定（弁護士法72条等）は egov-mcp の責務外（「使う側の注意」）と整理
  - 後日 `.claude/skills/houki-research/` に Skill として再構築予定
- **拡張レイヤ I/F 削除**: `src/extensions/` と `examples/ext-template/` を削除
  - Architecture E では拡張は独立 npm パッケージ（`houki-nta-mcp` 等）として実現するため、hub 側に I/F を持つ必要がなくなった

### Added

- **`@shuji-bonji/houki-abbreviations` ^0.1.0 を dependency 化**
  - 略称辞書の Single Source of Truth を独立パッケージへ移管
  - 165 エントリの略称・通称・正式名称解決はそちら経由
  - エントリに `category` / `source_mcp_hint` が追加されたことで、将来の houki-nta-mcp 等との連携準備完了
- **Trusted Publisher (OIDC) で publish**
  - `.github/workflows/publish.yml` を追加。tag push (`v*`) で自動 publish
  - publish ジョブは Node 24（npm 11+ 同梱）を使用
  - `--provenance` で attestation 付き publish

### Changed

- **`src/abbreviations/` を削除** — `@shuji-bonji/houki-abbreviations` から import
- **`src/types/index.ts` の `AbbreviationEntry`** — houki-abbreviations から re-export（後方互換）
- **`src/constants.ts` の `LAW_TYPE_CODES` / `Domain` / `DOMAINS` / `LawTypeCode`** — houki-abbreviations から re-export
- **`scripts/copy-assets.mjs` 不要化** — JSON は houki-abbreviations 同梱物
- **`package.json`**
  - `name` / `bin` / `repository.url` を houki-egov-mcp に
  - `files` から `src/abbreviations/*.json` を削除（dist のみ同梱）
  - `publishConfig.access: public` を追加
  - `build` スクリプトを `tsc` のみに簡素化

### Removed

- ツール `explain_business_law_restriction` と関連ナレッジ `src/knowledge/business-law-restrictions.ts`
- 拡張レイヤ I/F `src/extensions/` 一式
- 拡張パッケージ雛形 `examples/ext-template/`

### Migration Guide

旧 `@shuji-bonji/houki-hub-mcp@0.1.x` を使っていた場合:

```diff
{
  "mcpServers": {
-   "houki-hub": {
-     "command": "npx",
-     "args": ["-y", "@shuji-bonji/houki-hub-mcp"]
-   }
+   "houki-egov": {
+     "command": "npx",
+     "args": ["-y", "@shuji-bonji/houki-egov-mcp"]
+   }
  }
}
```

`explain_business_law_restriction` を使っていた場合は、後日リリース予定の `houki-research` Skill か、各士業の業法を直接 `get_law` で参照する形に切り替えてください。

### Status

**Phase 1（e-Gov 法令API v2 コア）** + **Architecture E への移行**完了。次は:

- **アクション3**: `houki-knowledge-mcp`（法令階層・業法独占）切り出し or Skill 化
- **アクション4**: `@shuji-bonji/houki-hub` meta-package 作成
- **アクション5**: `houki-nta-mcp` 新規開発

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

[Unreleased]: https://github.com/shuji-bonji/houki-egov-mcp/compare/v0.5.1...HEAD
[0.5.1]: https://github.com/shuji-bonji/houki-egov-mcp/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/shuji-bonji/houki-egov-mcp/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/shuji-bonji/houki-egov-mcp/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/shuji-bonji/houki-egov-mcp/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/shuji-bonji/houki-egov-mcp/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/shuji-bonji/houki-egov-mcp/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/shuji-bonji/houki-egov-mcp/releases/tag/v0.2.0
[0.1.1]: https://github.com/shuji-bonji/houki-hub-mcp/releases/tag/v0.1.1
[0.1.0]: https://github.com/shuji-bonji/houki-hub-mcp/releases/tag/v0.1.0
[0.0.1]: https://github.com/shuji-bonji/houki-hub-mcp/releases/tag/v0.0.1
