# 痛点ログ — 7日ミニトライアル（C案）

**期間**: 2026-05-09 〜 2026-05-16（7日間）
**目的**: e-shiwake / 既存 tax-law / labor-law / houki-nta / houki-egov MCP を実運用して、本当に必要な機能だけで houki-egov-mcp の MVP スコープを確定する
**振り返り**: 2026-05-16

## 経緯

DESIGN.md は **2 週間** の実運用痛点ログを Phase 2 着手の必須前提として定めている。
ただし以下の既往調査により、e-Gov 固有の痛点は既にかなり詰められている:

- [PHASE2-SPIKE.md](./PHASE2-SPIKE.md): API / bulk DL の同期実態、配信タイミング、HTTP 304 不可
- [PHASE2-SPIKE-FOLLOWUP.md](./PHASE2-SPIKE-FOLLOWUP.md): Range 不可、status フィールド分布、FTS5 粒度、件数差の謎解き
- [PHASE2-SPIKE-FOLLOWUP2.md](./PHASE2-SPIKE-FOLLOWUP2.md): AppdxTable 構造、Subitem 深度、法令種別差異、Ruby/attached_files

これに加えて houki-nta-mcp v0.8.0〜v0.9.2 で確立した family 参照実装パターン（`shuji-mcp-patterns` skill 参照）が一定の痛点ログ代替になる。

そこで折衷案として **「7 日ミニログ + 既往調査からの bootstrap」** で進める。
DESIGN.md §201-203 の正典精神（「実需で MVP を絞る」）は守りつつ、Phase 2 着手を 1 週間で開始可能にする。

## 使い方

1. e-shiwake での仕訳入力・消費税判定・確定申告準備や、フリーランス業務での法令検索のたびに、既存 MCP で **足りなかったこと / 遅かったこと / 不正確だったこと** を 1 行で追記
2. 7 日後、記録を見て「高頻度・高痛度」のものだけ Phase 1 MVP に入れる
3. 低頻度のものは Phase 2 以降に回す or 実装しない

## 記録フォーマット

```
YYYY-MM-DD | [頻度 H/M/L] | [痛度 H/M/L] | [主体 H/L/B] | 状況 | 今の回避策 | 求める機能
```

- **頻度**: H=ほぼ毎日, M=2-3 日に 1 回程度, L=1 週間に 1〜2 回
- **痛度**: H=作業中断, M=ストレス, L=軽い不便
- **主体**: **H=人間視点の痛点 / L=LLM 視点の痛点 / B=両方**
  - H 主体: クリックしやすい URL、文書化された安心感、見やすい文字列、絞り込みやすさ
  - L 主体: 戻り値のトークン量、error の structure、粒度、ルーティング、parser の安定性
  - サブエージェント化フェーズで再利用するときは **L と B だけ抽出**できるよう列を分ける

## 記録

### Bootstrap（既往調査から判明している痛点）

spike + followup × 2 で既に拾えた痛点を、ログのスタート時点で記入しておく。
これらは Phase 1 MVP の優先候補。

| 日付 | 頻度 | 痛度 | 主体 | 状況 | 今の回避策 | 求める機能 |
|---|---|---|---|---|---|---|
| 2026-05-08 | M | H | L | API /laws の `updated_from` が swagger に書いてあるが実際は無視される（パラメータ伝えても total_count 不変）| 諦めて全件取得 | houki-egov-mcp 側で `update_date` ベースの差分同期を実装 |
| 2026-05-08 | H | M | L | API /laws は CurrentEnforced のみ 1 法令 1 行で返す。施行履歴を取るには `/law_revisions/{lawId}` を別途叩く必要がある | 法令単位で 2 回 API call | get_law / search_law が `include_revisions: true` で履歴も返せるオプション |
| 2026-05-08 | L | H | B | 全件 zip ダウンロードに Content-Length なし（285〜289 MB と日々動的に変わる）| 進捗バーが「12 MB / ?」表示 | 前回成功サイズを `expectedBytes` として推定値ベース progress |
| 2026-05-08 | L | H | L | bulk DL は HTTP Range を完全無視（`bytes=0-1023` 要求しても 200 OK + 全件返る）| resume 不可、リトライは 0 から | houki-nta-mcp と同じ「全件再取得 + zip 整合性検証」リトライ戦略 |
| 2026-05-08 | L | M | L | API レスポンスの `mission` フィールドが全 9,490 件で常に `'New'`（事実上の定数）| 無視 | DB schema から `mission` 列を削除 |
| 2026-05-09 | M | H | L | 法令によっては `<Article>` タグがない（明治勅令など。`MainProvision > Paragraph > Sentence` 直結）| 取り込み時に skip しがち | extract で `articles.length === 0` なら MainProvision 全体を 1 article 扱いの fallback |
| 2026-05-09 | M | M | L | `<Ruby>綻<Rt>たん</Rt></Ruby>` の Rt（読み仮名）が FTS5 トークンに混入してノイズ | 検索でヒット率が下がる | extract 時に Rt を strip する標準処理 |
| 2026-05-09 | L | M | L | AppdxStyle (様式) は `<Fig src="./pict/x.pdf"/>` のみで本文ゼロ。FTS5 で hit させづらい | タイトルだけ別途検索 | AppdxStyleTitle と RelatedArticleNum のみ index、body 空文字運用 |
| 2026-05-08 | M | M | H | all_law_list.csv の公布日が和暦テキスト（「明治五年十一月九日」）。API は西暦 ISO 8601（「1872-11-09」）。混在で困る | 取り込み側で和暦パーサ自前実装 | 和暦↔西暦変換を houki-abbreviations 等の共通パッケージへ |
| 2026-05-08 | L | M | B | 略称（例: 預保法、改暦の布告）の解決が API では `abbrev` フィールド頼みで弱い | houki-abbreviations を別途叩く | houki-egov の resolve_abbreviation 流用 |
| 2026-05-08 | L | L | B | bulk zip と API で同じ法令を取った時に**最大 24 時間**乖離する瞬間がある（API のほうが zip より新しい）| asof クエリは API フォールバック | MCP レスポンスに `staleness_level` を付与（houki-abbreviations v0.4.1 と同じ） |

### 7 日間の追加記録（2026-05-09 〜 2026-05-16）

| 日付 | 頻度 | 痛度 | 主体 | 状況 | 今の回避策 | 求める機能 |
|---|---|---|---|---|---|---|
| | | | | | | |
| | | | | | | |

<!-- 例: -->
<!-- | 2026-05-10 | H | M | B | 「消法30条2項の課税仕入れ用途区分」を引きたいが tax-law.get_law は項全体を返してくる。号レベルが欲しい | 手で返却から号を抜き出す | get_law の item 指定サポート -->
<!-- | 2026-05-11 | L | H | H | 派遣法での 36 協定扱いを調べたい。labor-law.get_law で「派遣法」と書いたら条文取れなかった | 正式名称で投げ直し | 派遣法の略称対応 -->
<!-- | 2026-05-12 | M | L | L | インボイスの経過措置を通達で確認したい。tsutatsu の番号が分からないとヒットしない | list_tsutatsu で探索 | 通達のキーワード検索 -->

## 7 日後の振り返り（2026-05-16 追記予定）

### MVP に入れる機能（Phase 1）

頻度 H or 痛度 H、または主体 B のものを優先。

- [ ] （痛点ログから抽出）

### Phase 2 以降に回す機能

- [ ] （痛点ログから抽出）

### 実装しない機能

- [ ] （痛点ログから抽出）

### サブエージェント化フェーズ向けの伏線（L / B 痛点の抜粋）

houkiシリーズをサブエージェント化する別プロジェクトで、tool I/O 設計の入力として再利用する。

- [ ] L 主体の痛点リスト（後日抽出）
- [ ] B 主体の痛点リスト（後日抽出）

## 参考：痛点の見方

- **条文取得の粒度**: 条 / 項 / 号 / 本文のどこまで欲しい？
- **略称**: どの略称が足りなかった？
- **時点指定**: 過去の条文（PreviousEnforced）が必要になったか？
- **未施行**: 施行予定法令を引いた場面はあったか？
- **通達・裁決との連動**: 条文と同時に通達番号を知りたい場面は？
- **全文検索**: API 検索で「明治太政官布告」が並ぶ痛みは何回あった？
- **出典 URL**: 根拠提示で URL を貼る場面は週何回？
- **回答の長さ**: LLM コンテキストを圧迫した tool 戻り値はあったか？（L 主体）
- **error の語彙**: family 内で error code が揃っていなくて困った場面は？（L 主体）
