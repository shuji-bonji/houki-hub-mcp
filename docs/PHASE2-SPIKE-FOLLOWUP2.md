# Phase 2 Spike Follow-up 2 — 残オープン課題追加調査

**実施日:** 2026-05-09
**前提:** [PHASE2-SPIKE-FOLLOWUP.md](./PHASE2-SPIKE-FOLLOWUP.md) §5 で残った課題のうち、以下 4 項目をサンプリング実測で詰める

- AppdxTable / TableStruct の本文抽出ルール
- 旧法 EnactStatement の出現頻度と Subitem 最大深度
- 法令種別ごとのスキーマ差異（Constitution / ImperialOrder / Rule）
- Ruby / Sup / Sub と attached_files の扱い

## 結論サマリ

| 項目 | 結論 |
|---|---|
| AppdxTable | `Table > TableRow > TableColumn > Sentence` の階層。**本文抽出は Sentence の textContent 連結で OK**、罫線情報 (BorderTop/Left 等) は捨てる。**colspan / rowspan / WritingMode** 属性あり |
| AppdxStyle (様式) | **本文抽出不可** — `<Fig src="./pict/xxx.pdf"/>` の PDF 参照のみ。FTS5 取り込み時は AppdxStyleTitle のみ index、本文は空文字 |
| AppdxNote / AppdxFig / AppdxFormat | サンプル内では低頻度。AppdxFig は画像のみで本文なし |
| EnactStatement (制定文) | 明治期 30 件サンプリング中 **3 件（10%）に出現**。`LawBody` 直下の `MainProvision` の前。FTS5 取り込み時は `article_num='Enact'` 等で扱う |
| Subitem 最大深度（観測上） | **Subitem4** が観測上の上限（所得税法）。e-Gov XSD 仕様では Subitem10 まで定義。**租税系で深いが大半は Subitem1-2 に収まる** |
| Constitution 特殊要素 | **`<Preamble>` (前文)** が Constitution 固有。MainProvision の前に位置。articles テーブルでは `article_num='Preamble'` で扱う |
| ImperialOrder の構造 | **Article タグなし**の小型法令が存在する。`MainProvision > Paragraph > Sentence` 直結。**Article 単位 FTS5 では捕捉できない** ⚠️ |
| Rule の構造 | 通常法令と同等。EnactStatement を持つ場合あり |
| Ruby / Rt (ふりがな) | `<Ruby>漢字<Rt>かな</Rt></Ruby>` 形式。FTS5 では **Rt を除去して漢字部分のみ index** が定石 |
| Sup / Sub | サンプル内での出現は **ゼロ**。化学式や数式系法令にあれば対応する程度で OK |
| Fig (本文中) | `<Fig src="./pict/xxx.pdf"/>` の PDF 参照。本文には現れず別ファイルなので FTS5 では無視 |
| ArithFormula (数式) | テキスト要素として登場（例: `（Ｗ＋Ｄ／Ｐ）×Ｒ＋Ａ／Ｐ＝Ｔ`）。Sentence の textContent に含めて index |
| attached_files (画像) | **法令によっては jpg/pdf 添付あり**（例: 介護保険法に 2 jpg）。Phase 2 では DB に保存せず、ID と src のメタ情報のみ別テーブルで管理 |

## 1. AppdxTable / TableStruct の構造

### 1-1. 階層

```
AppdxTable
├── AppdxTableTitle              「付録第一」「別表第一」
├── RelatedArticleNum             「（第二十条関係）」
└── TableStruct (or 直接 Item/Subitem)
    └── Table  (WritingMode="vertical|horizontal")
        └── TableRow
            └── TableColumn  (BorderTop/BorderLeft/BorderBottom/BorderRight, colspan, rowspan)
                └── Sentence  ← 本文
```

### 1-2. 本文抽出ルール（FTS5 用）

```ts
// AppdxTable から検索可能テキストを抽出
function extractAppdxTableBody(node: Element): string {
  // 1. 罫線情報・WritingMode は無視
  // 2. すべての Sentence の textContent を半角スペースで連結
  // 3. colspan/rowspan は無視（検索対象として表構造の再現は不要）
  return Array.from(node.querySelectorAll('Sentence'))
    .map(s => s.textContent ?? '')
    .filter(t => t.trim().length > 0)
    .join(' ');
}
```

### 1-3. articles テーブルへの取り込み

spike followup §3-4 の articles テーブルで以下のように扱う:

```sql
-- AppdxTable は article_num に特殊値を入れる
INSERT INTO articles (law_revision_id, article_num, article_caption, body) VALUES
  (..., 'AppdxTable_1', '付録第一（第二十条関係）', '出走すべき選手が七人であるとき 選手番号 ...'),
  (..., 'AppdxTable_2', '付録第二（第二十三条関係）', '算式 （Ｗ＋Ｄ／Ｐ）×Ｒ＋Ａ／Ｐ＝Ｔ ...'),
  (..., 'AppdxStyle_1', '第一号様式（第五条関係）', '');  -- ← 本文なし、参照PDF
```

### 1-4. AppdxStyle (様式) は本文ゼロ

```xml
<AppdxStyle>
  <AppdxStyleTitle>第一号様式</AppdxStyleTitle>
  <RelatedArticleNum>（第五条関係）</RelatedArticleNum>
  <StyleStruct>
    <Style>
      <Fig src="./pict/2FH00000062873.pdf" />
    </Style>
  </StyleStruct>
</AppdxStyle>
```

**FTS5 では AppdxStyleTitle と RelatedArticleNum のみ index、body は空文字。** ユーザーが「第一号様式」で検索した時に hit させる目的でメタは保持。

## 2. EnactStatement (制定文) と Subitem 最大深度

### 2-1. EnactStatement の出現

明治期 30 件サンプル中 **3 件 (10%) に出現**。`LawBody` 直下、`MainProvision` の前に位置する。例:

```xml
<LawBody>
  <LawTitle>商法</LawTitle>
  <EnactStatement>商法別冊ノ通之ヲ定ム</EnactStatement>
  <EnactStatement>此法律施行ノ期日ハ勅令ヲ以テ之ヲ定ム</EnactStatement>
  <EnactStatement>明治二十三年法律第三十二号商法ハ第三編ヲ除ク外此法律施行ノ日ヨリ之ヲ廃止ス</EnactStatement>
  <EnactStatement>（別冊）</EnactStatement>
  <TOC>...</TOC>
  <MainProvision>...</MainProvision>
</LawBody>
```

### 2-2. articles テーブルへの取り込み

EnactStatement は articles テーブルで `article_num='Enact'` として複数行（出現順 ord）で取り込む:

```sql
INSERT INTO articles (law_revision_id, article_num, ord, body) VALUES
  (..., 'Enact', 0, '商法別冊ノ通之ヲ定ム'),
  (..., 'Enact', 1, '此法律施行ノ期日ハ勅令ヲ以テ之ヲ定ム'),
  ...
```

### 2-3. Subitem 最大深度

実測した深い法令での Subitem 最大値:

| 法令 | 法令種別 | サイズ | Subitem 最大 | 分布 |
|---|---|---|---|---|
| 所得税法 | Act | (大) | **4** | {1: 366, 2: 76, 3: 71, 4: 20} |
| 法人税法 | Act | (大) | 3 | {1: 436, 2: 72, 3: 24} |
| 租税特別措置法 | Act | 7.8 MB | 3 | {1: 1350, 2: 284, 3: 74} |
| 租税特別措置法施行令 | CabinetOrder | 8.1 MB | 3 | {1: 1355, 2: 300, 3: 18} |
| 租税特別措置法施行規則 | MinisterialOrdinance | 4.8 MB | 3 | {1: 1732, 2: 425, 3: 85} |
| 建築基準法 | Act | 7.2 MB | 3 | {1: 355, 2: 65, 3: 40} |
| 預金保険法 | Act | 0.7 MB | 1 | {1: 45} |
| 民法 | Act | 1.1 MB | 1 | {1: 6} |

**結論:** e-Gov XSD は Subitem10 まで定義しているが、**実利用は Subitem4 まで**。schema は `Subitem1〜Subitem10` の処理コードを書いておくが、Subitem3〜10 は同じ extract 関数で扱える。

### 2-4. FTS5 取り込み方針

Subitem の階層構造は **Article の body に flat に含める**。階層情報を残したいなら別途 JSON 列に構造を持たせるが、検索目的なら flat で十分:

```ts
function extractArticleBody(article: Element): string {
  // すべての Sentence の textContent を結合（Subitem 階層に関係なく）
  return Array.from(article.querySelectorAll('Sentence'))
    .map(s => extractTextWithoutRt(s))
    .join(' ');
}

function extractTextWithoutRt(node: Element): string {
  // <Ruby>綻<Rt>たん</Rt></Ruby> → 「綻」
  // Rt 要素を除外して textContent を取る
  const clone = node.cloneNode(true) as Element;
  clone.querySelectorAll('Rt').forEach(rt => rt.remove());
  return clone.textContent ?? '';
}
```

## 3. 法令種別ごとのスキーマ差異

### 3-1. 主要タグ統計の比較

5 種別から 1 法令ずつサンプリング:

| タグ | Constitution | ImperialOrder | Rule | Act | CabinetOrder |
|---|---|---|---|---|---|
| サイズ | 56 KB | 2 KB | 40 KB | 702 KB | 882 KB |
| **Article** | 103 | **0** ⚠️ | 25 | 447 | 640 |
| Paragraph | 164 | 3 | 97 | 1101 | 1465 |
| Item | 17 | 0 | 25 | 543 | 667 |
| Subitem1 | 0 | 0 | 0 | 45 | 71 |
| Sentence | 219 | 3 | 122 | 2001 | 2542 |
| **EnactStatement** | 0 | 0 | **1** | 0 | 0 |
| **Preamble** | **1** ★ | 0 | 0 | 0 | 0 |
| MainProvision | 1 | 1 | 1 | 1 | 1 |
| Chapter | 11 | 0 | 5 | 12 | 18 |
| Section | 0 | 0 | 0 | 12 | 11 |
| SupplProvision | 0 | 0 | 49 | 65 | 57 |

### 3-2. 重要発見: ImperialOrder には Article がない場合がある

**明治19年勅令51号** の構造:

```xml
<Law Era="Meiji" Year="19" Num="051" LawType="ImperialOrder">
  <LawNum>明治十九年勅令第五十一号</LawNum>
  <LawBody>
    <LawTitle>明治十九年勅令第五十一号（本初子午線経度計算方及標準時ノ件）</LawTitle>
    <MainProvision>
      <Paragraph Num="1">
        <ParagraphNum>一</ParagraphNum>
        <ParagraphSentence>
          <Sentence>英国グリニツチ天文台子午儀ノ中心ヲ経過スル子午線ヲ以テ経度ノ本初子午線トス</Sentence>
        </ParagraphSentence>
      </Paragraph>
      <Paragraph Num="2">...</Paragraph>
      <Paragraph Num="3">...</Paragraph>
    </MainProvision>
  </LawBody>
</Law>
```

**Article タグが一つもない**。`MainProvision > Paragraph > Sentence` の直結構造。

**FTS5 取り込みへの含意:**

```ts
function extractArticles(law: Element): ArticleRecord[] {
  const articles = law.querySelectorAll('Article');
  if (articles.length === 0) {
    // ★ Fallback: Article がない法令は MainProvision 全体を 1 article として扱う
    const main = law.querySelector('MainProvision');
    if (main) {
      return [{
        article_num: 'MainProvision',
        article_caption: null,
        body: extractTextFromMainProvision(main),
        ord: 0,
      }];
    }
  }
  // 通常の Article 単位抽出
  return Array.from(articles).map(/* ... */);
}
```

これは spike followup §3-4 の articles テーブル設計に追加するルール。

### 3-3. Constitution 固有: Preamble (前文)

```xml
<LawBody>
  <LawTitle>日本国憲法</LawTitle>
  <Preamble>
    <Paragraph Num="1">
      <ParagraphSentence>
        <Sentence>日本国民は、正当に選挙された国会における代表者を通じて行動し...</Sentence>
      </ParagraphSentence>
    </Paragraph>
    ... (全 4 段落)
  </Preamble>
  <MainProvision>
    <Chapter Num="1">...</Chapter>
    ...
  </MainProvision>
</LawBody>
```

Preamble は Constitution 固有。articles テーブルでは `article_num='Preamble'` で取り込み。

### 3-4. Rule に EnactStatement が出現

会計検査院法施行規則に `EnactStatement: 1` が観測された。EnactStatement は **戦前法令だけでなく、現行 Rule にも出現する** ため、全法令種別で対応する必要がある。

## 4. Ruby / Sup / Sub / attached_files

### 4-1. Ruby (ふりがな) の構造

```xml
<Sentence>... <Ruby>綻<Rt>たん</Rt></Ruby> ...</Sentence>
```

**FTS5 取り込み時は Rt を除去して Ruby の漢字部分だけ index する。**

```ts
// 想定実装
function stripRubyText(node: Element): string {
  const clone = node.cloneNode(true) as Element;
  clone.querySelectorAll('Rt').forEach(rt => rt.remove());
  return clone.textContent ?? '';
}
```

理由:

1. ユーザーは「破綻」で検索する。「は<Rt>たん</Rt>」を含めるとノイズ
2. 読み仮名は `law_title_kana` で別途検索可能

### 4-2. Sup / Sub の出現

サンプル法令（5 法令、合計 14 MB 以上）で **`<Sup>` / `<Sub>` の出現はゼロ**。化学式・物理式系の法令にあれば textContent で取り込む既定の挙動で対応可能。Phase 2 では特別な扱い不要。

### 4-3. Fig / ArithFormula

| タグ | サンプル例 | FTS5 取り込み |
|---|---|---|
| `<Fig src="./pict/x.pdf"/>` | 画像 PDF 参照 | **無視**（src 文字列は index しない） |
| `<ArithFormula>...</ArithFormula>` | `（Ｗ＋Ｄ／Ｐ）×Ｒ＋Ａ／Ｐ＝Ｔ` | **textContent をそのまま index** |

ArithFormula は法令本文中に「数式」を含めるためのタグ。文字列として検索可能。

### 4-4. attached_files の有無

5 法令サンプルで attached_files を確認:

| 法令 | attached_files |
|---|---|
| 預金保険法 | エラー（attached_files_info=null） |
| 日本国憲法 | 同上 |
| 租税特別措置法 | 同上 |
| **介護保険法** | **2 件** (`./pict/H11HO127-001.jpg`, `./pict/H11HO127-002.jpg`) |

つまり**法令によって添付画像があるか否かが大きく異なる**。

### 4-5. attached_files の DB 設計

Phase 2 では DB に画像本体は保存しない。**メタ情報（src, updated）だけ別テーブルで管理**:

```sql
CREATE TABLE attached_files (
  id INTEGER PRIMARY KEY,
  law_revision_id TEXT NOT NULL REFERENCES laws(law_revision_id),
  src TEXT NOT NULL,        -- './pict/H11HO127-001.jpg'
  updated TEXT NOT NULL,    -- ISO 8601
  fetched_at TEXT
);
CREATE INDEX idx_attached_law ON attached_files(law_revision_id);
```

実画像は `/api/2/attachment/{law_revision_id}` で別途取得可能（spike §4-1 の swagger paths 参照）。Phase 2 では参照だけ持ち、Phase 3 以降で画像取り込みを検討。

## 5. PHASE2-DESIGN.md への追加反映事項

spike + followup + followup2 を統合した DESIGN への追加事項:

1. **articles テーブルの `article_num` は文字列で柔軟に**:
   - 通常: `'1'` / `'12_2'` (12条の2)
   - 特殊: `'Preamble'` / `'MainProvision'` / `'Enact'` / `'AppdxTable_N'` / `'AppdxStyle_N'` / `'SupplProvision_N'`
2. **Article がない法令への fallback**: ImperialOrder の小型法令向けに「MainProvision 全体を 1 article として取り込む」ロジック必須
3. **Ruby の Rt 除去ルール**: extract 関数で必ず適用
4. **AppdxStyle は body 空文字でも index**: タイトルだけは検索 hit させる
5. **attached_files テーブル**: law_revision_id 単位で別テーブル管理、Phase 2 ではメタのみ
6. **Subitem は最大 10 まで対応**: 実利用は 4 までだが、コード上は flat extract で対応すれば実害なし
7. **EnactStatement は全法令種別で対応**: 戦前法令だけでなく Rule でも出現

## 6. 残課題（Phase 2 着手後に詰めるもの）

| 課題 | 状態 |
|---|---|
| §7-5 CLI コマンド命名 | spike §6-1 案でほぼ確定。DESIGN で確定 |
| §7-6 PAIN-POINTS 2 週ログ | shuji さん判断待ち。spike + followup × 2 で代替可能性 |
| 画像 (attached_files) の取り込み戦略 | Phase 3 以降。`/api/2/attachment/{revision_id}` の挙動確認 |
| `Misc` law_type | swagger に定義あるが実態未確認。Phase 2 着手後に対応 |
| 添付画像が含まれる法令の総数 | サンプリング規模拡大が必要 |
| Sup / Sub が出現する法令 | 化学式・物理式系を狙って探索 (Phase 2 内で実装テスト) |
| 「Article がない法令」の総数 | 何件あるか不明。Phase 2 取り込みフェーズで集計 |

---

**実証コマンド集:**

```bash
# Constitution / ImperialOrder / Rule の検索
curl -s "https://laws.e-gov.go.jp/api/2/laws?law_type=Constitution"
curl -s "https://laws.e-gov.go.jp/api/2/laws?law_type=ImperialOrder&limit=5"
curl -s "https://laws.e-gov.go.jp/api/2/laws?law_type=Rule&limit=5"

# Article を持たない ImperialOrder の例
curl -s "https://laws.e-gov.go.jp/api/2/law_data/119IO0000000051?response_format=xml" |
  grep -oE '<(Article|Paragraph|Sentence)\b' | sort | uniq -c

# Subitem 最大深度（所得税法）
curl -s "https://laws.e-gov.go.jp/api/2/law_data/340AC0000000033?response_format=xml" |
  grep -oE '<Subitem[0-9]+' | sort -u

# Constitution の Preamble 抽出
curl -s "https://laws.e-gov.go.jp/api/2/law_data/321CONSTITUTION?response_format=xml" |
  python3 -c "import sys, re; print(re.search(r'<Preamble>.*?</Preamble>', sys.stdin.read(), re.DOTALL).group(0))"

# attached_files の確認
curl -s "https://laws.e-gov.go.jp/api/2/law_data/411AC0000000127?response_format=json" |
  jq '.attached_files_info.attached_files'
```
