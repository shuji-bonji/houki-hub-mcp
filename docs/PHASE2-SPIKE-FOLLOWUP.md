# Phase 2 Spike Follow-up — オープン課題追加調査

**実施日:** 2026-05-09
**前提:** [PHASE2-SPIKE.md](./PHASE2-SPIKE.md) §7 で残ったオープン課題のうち、以下 3 項目をサンプリング実測で詰める

- §7-2 FTS5 粒度（条/項/号 vs 法令単位）
- §7-3 未施行 / 廃止法令の扱い
- §7-4 all_xml.zip の resume / Range 戦略

## 結論サマリ

| オープン課題 | 結論 |
|---|---|
| HTTP Range / resume | **使えない**。`Range:` ヘッダは完全に無視され `200 OK + 全件 289 MB` が返る。`Content-Length` も `Accept-Ranges` もなし |
| 進捗表示 | **不可能**。`Content-Length` がないため、ダウンロード完了率は計算不能。バイト数累積のみ表示可 |
| 未施行法令フラグ | API v2 の `revision_info.current_revision_status = 'UnEnforced'` が正典。全 9,490 件中 16 件のみ |
| 廃止法令フラグ | `repeal_status` は 4 値: `None` / `Repeal` / `LossOfEffectiveness` / `Expire`。`current_revision_status='Repeal'` も併用判定 |
| 経過措置効力残 | `remain_in_force=true` は廃止後も部分的効力ありの法令（全 9,490 件中 14 件）|
| `mission` フィールド | **常に `New` (100%)**。事実上使えない |
| API vs bulk zip 件数差 (9,490 vs 10,205 = 715 件) | bulk zip は **CurrentEnforced + UnEnforced + 一部 PreviousEnforced** を含む。API /laws は **CurrentEnforced のみ 1 件返す**（履歴は `/law_revisions/{lawId}` で別途取得）|
| FTS5 取り込み単位 | **Article 単位を主、Paragraph 単位を従** で 2 階層 FTS5。法令メタは別テーブル。全件想定 ~230 万 Article × 平均 2 文＝ 500 万 Sentence 規模 |
| XML スキーマの安定性 | **明治5年布告から令和の省令まで同一 XSD**。`Law > LawBody > MainProvision > Article > Paragraph > Sentence` が全法令で再現される |

## 1. HTTP Range / resume 戦略（§7-4）

### 1-1. HEAD レスポンスの再確認

```http
HTTP/2 200
content-type: application/octet-stream
content-disposition: attachment; filename="all_xml.zip"
server: Apache/2.4.62 (AlmaLinux)
x-powered-by: PHP/8.4.19
cache-control: max-age=0, no-cache, no-store
```

**観察:**

- `Content-Length` なし — bulk zip サイズが 285〜289 MB と日々動的に変動するためでもある
- `Accept-Ranges` なし — Range サポート宣言なし
- `Last-Modified` / `ETag` なし — 動的 PHP レスポンス（spike §1-2 と同じ）

### 1-2. Range リクエストの実測

```bash
$ curl -s -D - -o range_test.bin -H "Range: bytes=0-1023" \
    "https://laws.e-gov.go.jp/bulkdownload?file_section=1&only_xml_flag=true"

HTTP/2 200    # ← 206 Partial Content ではない
content-type: application/octet-stream
(Accept-Ranges/Content-Range なし)

$ ls -la range_test.bin
-rw-r--r-- ... 289143282 May  8 ... range_test.bin   # ← 289 MB 全件
```

**`bytes=0-1023` を要求しても 289 MB が返る** = サーバ側で Range ヘッダを完全に無視している。CloudFront 経由だが `cache-control: no-cache, no-store` でエッジキャッシュに載らない構成のため、CloudFront の Range サポートも効かない。

### 1-3. 進捗表示の現実的な選択肢

`Content-Length` が来ない以上、`progress.percentDone()` は計算できない。実装としては以下のいずれか:

| 方式 | 実装 | UX |
|---|---|---|
| バイト数カウンタのみ | `node-progress` で `total: null` モード相当 | 「12 MB / ?」表示。終了時刻は予測不能 |
| 推定値ベース | spike 実測値 ~285 MB を hardcode、ETA は単純線形 | 「12 MB / ~285 MB (12%)」表示。誤差 ±5% |
| 取得後にサイズ判定 | tmpfile に書き終わってから `Content-Length: actual` でログ | 進捗表示なし、ダウンロード完了後に確定値を出すだけ |

**推奨:** 推定値ベース。spike の `285,803,544` byte（または前回成功時のサイズ）を `expectedBytes` として使い、`ProgressEmitter` で `bytesDownloaded / expectedBytes` を表示する。誤差が出ても許容（CLI のみのため）。

### 1-4. resume / 中断復旧戦略

Range が効かない以上、**HTTP レベルの resume は不可能**。実装方針は houki-nta-mcp と同じく「リトライ全件再取得」になる。

```ts
async function downloadAllXmlZip(opts: { dest: string; maxRetries?: number }) {
  const { dest, maxRetries = 3 } = opts;
  const tempPath = `${dest}.partial`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // 全件取得（Range 不可なので 1 リクエスト）
      await streamToFile(url, tempPath);
      // CRC32 / SHA256 でファイル整合性確認
      await verifyZipIntegrity(tempPath);
      await fs.rename(tempPath, dest);
      return;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      await fs.unlink(tempPath).catch(() => {});
      await sleep(exponentialBackoff(attempt));
    }
  }
}
```

**含意:**

- ダウンロード中に切れたら **0 から再取得**。途中までのファイルは破棄
- 経済的には **差分 zip (`file_section=3`) を多用** し、全件 zip を引くのは初回 + 3 ヶ月超の catch-up 時のみ
- 285 MB を 1 リクエストで完結させる前提でタイムアウト設計（観測上の所要時間: 数十秒〜数分、回線次第）

## 2. 未施行 / 廃止法令の扱い（§7-3）

### 2-1. API v2 全 9,490 件の値分布

10 ページ × 1,000 件で全件サンプリング:

```
-- repeal_status --
  'None'                : 8,967  (94.49%)
  'Repeal'              :   400  ( 4.21%)  廃止
  'LossOfEffectiveness' :    86  ( 0.91%)  失効
  'Expire'              :    37  ( 0.39%)  期間満了

-- current_revision_status --
  'CurrentEnforced'     : 8,875  (93.52%)  現行
  'Repeal'              :   523  ( 5.51%)  廃止
  'PreviousEnforced'    :    76  ( 0.80%)  旧版
  'UnEnforced'          :    16  ( 0.17%)  未施行 ★

-- remain_in_force --
  False : 9,476  (99.85%)
  True  :    14  ( 0.15%)  廃止後も部分効力残

-- mission --
  'New' : 9,490  (100.00%)  ★ 事実上使えない

-- amendment_type --
  '3' : 7,321  (77.14%)
  '1' : 1,659  (17.48%)
  '8' :   510  ( 5.37%)
```

### 2-2. 「未施行」16 件の実例（2026-05-09 時点）

```
507CO0000000243  事業性融資の推進等に関する法律施行令
507CO0000000423  出入国管理及び難民認定法等の一部を改正する法律の施行に伴う関係政令...
508CO0000000047  重要電子計算機に対する不正な行為による被害の防止に関する法律施行令
508CO0000000106  防衛特別所得税に関する政令
... (合計 16 件)
```

すべて令和 7-8 年 (2025-2026) 公布の最新政令 / 省令で、`amendment_scheduled_enforcement_date` が `null` のものが多い（公布済みだが施行日未定）。

### 2-3. `remain_in_force=true` 14 件の実例

```
324AC0000000068  簡易生命保険法                              repeal_date=2020-04-01
333AC0000000099  農林漁業団体職員共済組合法                    repeal_date=2022-04-01
411M50000100041  指定介護療養型医療施設の人員、設備及び運営に関する基準  repeal_date=2012-04-01
420AC0000000025  地方法人特別税等に関する暫定措置法              repeal_date=2026-04-01
```

廃止済みだが経過措置で部分的に効力が残っている法令。**FTS5 検索で hit させるべきだが、結果には「廃止（部分効力存続）」のラベルを付ける**運用が望ましい。

### 2-4. mission フィールドが使えない件

サンプル全件で `mission='New'` のみ。これは API レスポンスの `revision_info.mission` が「**新規制定法令**かどうか」を示すフィールドだが、e-Gov 法令検索が `New` の法令しかインデックスしていないため事実上の定数。spike §6.1 の DB schema 案からは **削除**する。

### 2-5. bulk zip vs API の件数差（10,205 vs 9,490 = 715 件）

`/api/2/law_revisions/{lawId}` で履歴を取ると、1 法令あたり複数 revision が存在する。

**例: 預金保険法 (346AC0000000034) の全 18 revisions:**

| `current_revision_status` | 件数 | 備考 |
|---|---|---|
| `CurrentEnforced` | 1 | 2026-05-07 施行 |
| `UnEnforced` | 3 | 2026-08-06 / 2027-12-05 / 2028-06-13 施行予定 |
| `PreviousEnforced` | 14 | 2016〜2026 までの過去版 |

差分 zip (R080507) には CurrentEnforced + UnEnforced 3 件 = 4 directories が入っていた。

```mermaid
flowchart LR
  Z[bulk all_xml.zip<br/>10,205 ディレクトリ] --> A[CurrentEnforced<br/>~9,470 件]
  Z --> B[UnEnforced<br/>~16 件 + 将来施行版]
  Z --> C[PreviousEnforced<br/>少数の重要過去版]

  API[/api/2/laws<br/>total_count=9,490/] --> A2[CurrentEnforced + UnEnforced<br/>1 法令につき 1 行]
  API -.-> R[/api/2/law_revisions/{lawId}<br/>全履歴を別途取得/]
```

**設計含意:**

- **bulk zip ≠ 履歴アーカイブ**。あくまで「現時点で参照価値がある revision」のキュレーション
- 完全な履歴を欲しい時は `/api/2/law_revisions/{lawId}` を MCP 内部で別途呼ぶ
- DB primary key は `law_revision_id`（= `{lawId}_{enforcementDate}_{amendmentLawId}`）。spike §6-4-5 の方針通り

### 2-6. DB schema への落とし込み

spike §6-1 の schema 案を更新:

```sql
CREATE TABLE laws (
  law_id TEXT NOT NULL,                       -- 例: 346AC0000000034
  law_revision_id TEXT PRIMARY KEY,           -- 例: 346AC0000000034_20260507_508AC0000000015
  law_type TEXT NOT NULL,                     -- 'Act' | 'CabinetOrder' | ...
  law_num TEXT NOT NULL,                      -- '昭和四十六年法律第三十四号'
  law_title TEXT NOT NULL,
  law_title_kana TEXT,
  abbrev TEXT,
  category TEXT,                              -- '金融・保険' 等

  promulgation_date TEXT NOT NULL,            -- '1971-04-01'
  amendment_promulgate_date TEXT,
  amendment_enforcement_date TEXT,
  amendment_scheduled_enforcement_date TEXT,  -- UnEnforced 用

  -- ステータス系（API 実測の値域に合わせる）
  current_revision_status TEXT NOT NULL
    CHECK (current_revision_status IN
      ('CurrentEnforced','UnEnforced','PreviousEnforced','Repeal')),
  repeal_status TEXT NOT NULL
    CHECK (repeal_status IN ('None','Repeal','LossOfEffectiveness','Expire')),
  repeal_date TEXT,
  remain_in_force INTEGER NOT NULL DEFAULT 0,  -- 0/1
  amendment_type TEXT,                          -- '1'|'3'|'8'
  -- mission は API 上常に 'New' のため列を作らない

  -- 同期メタ
  updated TEXT NOT NULL,                       -- API の revision_info.updated (ISO 8601)
  fetched_at TEXT NOT NULL,                    -- houki-nta-mcp と同じ
  content_hash TEXT NOT NULL                   -- 本文 SHA-256
);

CREATE INDEX idx_laws_law_id ON laws(law_id);
CREATE INDEX idx_laws_status ON laws(current_revision_status, repeal_status);
CREATE INDEX idx_laws_enforce ON laws(amendment_enforcement_date);
```

## 3. FTS5 粒度の予備調査（§7-2）

### 3-1. 差分 zip 42 ファイル全タグ統計

```
Sentence            42,942
ParagraphSentence   20,565
Paragraph           20,565
Item                 9,574
Article              9,453
ArticleCaption       8,609
TableColumn          5,357
Column               4,035
Subitem1             1,212
Subitem2               183
Section                336
Chapter                257
Subsection             420
Division               204
SupplProvision       1,439
TableStruct             85
StyleStruct             69
AppdxTable             (差分 zip 全体で 2)
```

### 3-2. 階層構造の確定

明治5年布告から令和の最新省令まで、**完全に同一の XSD** が使われている:

```
Law (root)
├── LawNum                                  「昭和四十六年法律第三十四号」
└── LawBody
    ├── LawTitle (Kana, Abbrev)
    ├── EnactStatement                      制定文（旧法に多い）
    ├── TOC                                  目次
    │   ├── TOCLabel
    │   ├── TOCChapter > TOCSection > TOCSubsection > TOCDivision > TOCArticle
    │   └── ArticleRange
    └── MainProvision
        ├── Chapter / Section / Subsection / Division
        │   └── (Title 各種)
        └── Article
            ├── ArticleCaption              「（目的）」
            ├── ArticleTitle                「第一条」
            ├── Paragraph
            │   ├── ParagraphNum
            │   ├── ParagraphSentence
            │   │   └── Sentence            ★ 実テキスト
            │   ├── Item
            │   │   ├── ItemTitle           「一」「二」
            │   │   ├── ItemSentence > Sentence
            │   │   └── Subitem1 > Subitem2 > ...  (最大 Subitem10)
            │   └── Column                  列形式（旧法に多い）
            └── ...
    SupplProvision                          附則
    AppdxTable / AppdxNote / AppdxFig / AppdxStyle  別表・別記
```

### 3-3. 法令あたり Article 数の分布（差分 zip 41 法令ベース）

| 統計 | 値 | 法令 |
|---|---|---|
| 最大 | 732 articles | 金融商品取引法 (408AC0000000095) |
| 中央値 | 117 articles | 中堅法令 |
| 最小 | 3 articles | 改正省令 |
| 平均 | 230 articles | — |

**全件 zip 推定:** 10,205 法令 × 230 ≒ **235 万 Article**。Article ごとに平均 2 Sentence なので **500 万 Sentence** 規模。

### 3-4. FTS5 取り込み単位の判断

**選択肢比較:**

| 方式 | レコード数 | 検索 UX | 実装難易度 |
|---|---|---|---|
| Law 単位 (1 法令 = 1 row) | 約 10,000 | 法令名にヒットさせやすい / 本文 hit 位置不明 | 易 |
| Article 単位 | 約 235 万 | 「第〇条にヒット」で返せる ★ | 中 |
| Paragraph 単位 | 約 500 万 | 詳細だがレコード数過多 | 中 |
| Sentence 単位 | 約 1,000 万 | 過剰、文脈不足 | 難 |

**推奨: Article 単位を主、Law 単位を従の 2 段 FTS5**

```sql
-- 法令メタ FTS（タイトル / 略称 / 番号）
CREATE VIRTUAL TABLE laws_fts USING fts5(
  law_revision_id UNINDEXED,
  law_title,
  law_title_kana,
  abbrev,
  law_num,
  category,
  tokenize = 'unicode61 remove_diacritics 0'
);

-- 本文 FTS（条単位）
CREATE TABLE articles (
  id INTEGER PRIMARY KEY,
  law_revision_id TEXT NOT NULL REFERENCES laws(law_revision_id),
  article_num TEXT NOT NULL,           -- '1' / '12_2' (12条の2)
  article_caption TEXT,                -- '（目的）'
  chapter_path TEXT,                   -- '第二章 第一節' のようなパス
  ord INTEGER NOT NULL                 -- 法令内ソート用
);

CREATE VIRTUAL TABLE articles_fts USING fts5(
  article_id UNINDEXED,
  body,                                -- Sentence 全部を結合
  caption,
  content='articles',
  tokenize = 'unicode61 remove_diacritics 0'
);
```

**理由:**

- houki-nta-mcp の通達 TOC 単位 FTS と同じパターン（「ヒット → 親通達 → ファイル」のドリルダウン）
- 法令単位 FTS は **タイトルや略称検索を高速化**するために別途必要
- Paragraph / Sentence 単位はやり過ぎ。実装複雑性に見合うメリットなし
- 別表 (AppdxTable) は **Article 同等のレコードとして articles テーブルに混ぜる**（`article_num='Appendix1'` 等）

### 3-5. tokenizer の選択

houki-nta-mcp で使った `unicode61 remove_diacritics 0` は和文に対しても**バイグラム検索**として機能するが、bigram tokenizer も検討の余地:

```sql
-- 案 A: unicode61 (houki-nta-mcp と同じ)
tokenize = 'unicode61 remove_diacritics 0'
-- → 「預金保険」で「預金」「金保」「保険」のいずれもヒットする (3-gram 風)
-- → 漢字熟語の途切れヒットが取れず、ノイズも多い

-- 案 B: ICU (CJK 対応)
tokenize = 'icu ja_JP'
-- → MeCab 風の単語分割。精度高いが SQLite ICU ビルド必須

-- 案 C: bigram (公式推奨の CJK 用)
tokenize = 'porter unicode61' + フロント側で 2-gram 化
-- → 自前で 2-gram 化が必要
```

**推奨: houki-nta-mcp と同じ `unicode61 remove_diacritics 0`** で開始。e-Gov 法令検索本家も精密検索ではないので、まず動作させてから精度改善は Phase 3 以降。

> **2026-05-09 訂正:** Phase 2-1 着手時に houki-nta-mcp の schema.ts を再確認したところ、実際には **`tokenize='trigram'` (SQLite ≥ 3.34 builtin)** を採用していた。`unicode61` は CJK を 1 トークン扱いするため日本語部分一致 (`MATCH '預金者'` が `'この法律は預金者を保護する'` にヒット) ができないことが実機テストで判明。Phase 2-1 で `trigram` に修正。詳細は [PHASE2-DESIGN.md §2.1 G](./PHASE2-DESIGN.md) を参照。

### 3-6. 全角ゆらぎ正規化

houki-nta-mcp の Phase 5 で確立した **「DB と検索で同じ正規化を通す」** パターン (`text-normalize`) を継承。

特に法令本文は半角混在が稀で、全件に対して `width-only normalize` を通せば検索品質は安定する。

## 4. PHASE2-DESIGN.md への反映事項

spike + followup の結論を踏まえた DESIGN への持ち込み事項:

1. **resume / Range は不採用**。リトライ全件再取得 + 推定値ベース progress
2. **mission 列は DB schema から削除**（API 上常に `New` のため）
3. **`current_revision_status` と `repeal_status` の 2 軸でステータス管理**
4. **`remain_in_force=true` の 14 件は検索でヒット可、結果に注釈**
5. **`/api/2/law_revisions/{lawId}` を MCP の `get_law_revisions` ツールに直結**（spike §6.4 の `revision_id` 主キーと整合）
6. **FTS5 は laws_fts (法令メタ) + articles_fts (条本文) の 2 段構成**
7. ~~**tokenizer は `unicode61 remove_diacritics 0` から開始**、houki-nta-mcp と同じ~~ → **訂正: `trigram` を採用** (Phase 2-1 で実機テストで判明、§3-5 訂正参照)
8. **width-only normalize は houki-abbreviations v0.3.0 の text-normalize を使用**（family 共通化済み）
9. **bulk zip は 10,205 directories だが 1 法令につき複数 revision 含む**前提で取り込みロジックを書く
10. **進捗表示は前回成功時のサイズを `expectedBytes` として hardcode** + バイト数累積

## 5. 残るオープン課題（PHASE2-DESIGN で詰めるべきもの）

| 課題 | 状態 |
|---|---|
| §7-1 DB schema 設計 | **本書 §2-6 + §3-4 で骨子確定** → DESIGN で詳細化 |
| §7-5 CLI コマンド命名 | 未着手。spike §6-1 案（houki-nta-mcp 流用）でほぼ確定 |
| §7-6 PAIN-POINTS 2 週ログ | shuji さん判断待ち。**spike + followup で代替可能性** |
| 別表 (AppdxTable) の articles テーブル取り込み詳細 | スキーマ案は出した。実装で詰める |
| AppdxTable / TableStruct の本文抽出 | TableColumn / TableRow の連結ルールを Phase 2 実装で決める |
| 旧法 (明治布告) の `EnactStatement` の扱い | MainProvision に同居させるか別カラムか |

---

**実証コマンド集:**

```bash
# Range の無視を実証
curl -s -D - -o /dev/null -H "Range: bytes=0-1023" \
  "https://laws.e-gov.go.jp/bulkdownload?file_section=1&only_xml_flag=true"
# → 200 OK + Accept-Ranges/Content-Range なし、全件返る

# 全 9,490 件の status 分布
for offset in 0 1000 2000 3000 4000 5000 6000 7000 8000 9000; do
  curl -s "https://laws.e-gov.go.jp/api/2/laws?limit=1000&offset=$offset" |
  jq -r '.laws[] | .revision_info | "\(.repeal_status)\t\(.current_revision_status)"'
done | sort | uniq -c

# 法令の全 revisions 取得
curl -s "https://laws.e-gov.go.jp/api/2/law_revisions/346AC0000000034" |
  jq '.revisions | length'  # → 18

# XML タグ統計
unzip -d xml/ R080507_xml.zip
cat xml/*/*.xml | grep -oE '<[A-Za-z][A-Za-z0-9]*' | sort | uniq -c | sort -rn
```
