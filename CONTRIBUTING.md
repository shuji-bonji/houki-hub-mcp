# Contributing

`houki-egov-mcp` は houki-hub MCP family の **e-Gov 担当**です。Architecture E（複数独立 MCP + 共有ライブラリ + Skill）の設計上、貢献の経路はリポジトリごとに分かれています。

## 貢献経路の地図

| 貢献したい内容 | 行き先 |
|---|---|
| **略称・通称の追加・修正** | [`@shuji-bonji/houki-abbreviations`](https://github.com/shuji-bonji/houki-abbreviations) リポジトリへ PR |
| **e-Gov 法令API クライアントの改善** | このリポジトリへ PR |
| **法令種別ナレッジの修正・追加**（憲法・法律・政令 等の解説） | このリポジトリの `src/knowledge/law-hierarchy.ts` へ PR |
| **通達系の追加（国税庁・厚労省 等）** | 別 MCP リポジトリ（`houki-nta-mcp` / `houki-mhlw-mcp` 等）として開発 |
| **判例・裁決系の追加** | 別 MCP リポジトリ（`houki-court-mcp` / `houki-saiketsu-mcp` 等）として開発 |
| **業務ドメイン Skill**（消費税判定、電帳法対応 等） | 各自のプロジェクトの `.claude/skills/` へ |

## このリポジトリ（houki-egov-mcp）への貢献

### e-Gov 法令API クライアントの改善

- `src/services/egov-client.ts` — e-Gov 法令API v2 のクライアント本体
- `src/services/law-tree.ts` — JSON 化された法令ツリーの走査
- `src/services/law-service.ts` — 高レベル API（略称解決＋本文取得＋整形）
- `src/formatters/markdown.ts` — 条文の Markdown 整形
- `src/utils/cache.ts` — LRU cache
- `src/utils/article-num.ts` — 条番号の表記揺れ吸収

実装変更は対応するテスト（`*.test.ts`）も追加・更新してください。

### 法令種別ナレッジ（`src/knowledge/law-hierarchy.ts`）

法務専門家でない利用者が「政令と省令の違い」「通達は守らなくていいのか」を確認するためのナレッジ層です。誤解を生みやすい領域なので、以下のルールで貢献してください:

- **判断ロジックは入れない** — あくまで「事実情報の整理」に留める（×「○○すべき」、○「○○について法律はこう書かれている」）
- **境界事例は明記する** — 「個別事案の判断は有資格者に相談」と必ず書く
- **テストを書く** — `law-hierarchy.test.ts` で構造の整合性をチェック

### 漢数字対応・大規模法令の応答サイズ対策

[CHANGELOG.md](CHANGELOG.md) の `[Unreleased]` セクションに記載の Phase 1 磨き込み課題は PR を歓迎します:

- 「第三十条」のような漢数字条番号の正規化
- 民法・会社法等の大規模法令で応答サイズを抑える工夫
- エラーメッセージの LLM 可読化向上

## 略称辞書への貢献は別リポジトリ

略称辞書（`@shuji-bonji/houki-abbreviations`）は v0.2.0 から **独立 npm パッケージ**になりました。エントリ追加・修正は以下に PR してください:

👉 https://github.com/shuji-bonji/houki-abbreviations

houki-abbreviations の [CONTRIBUTING.md](https://github.com/shuji-bonji/houki-abbreviations/blob/main/CONTRIBUTING.md) に詳細手順があります。

## 通達・判例系の追加は別 MCP として

Architecture E では、通達・判例等は **独立 MCP パッケージ**として実装します。`houki-egov-mcp` の中に拡張レイヤを持つ設計は v0.1.x までで、v0.2.0 では削除されました。

新しい MCP を作る場合の命名規則:

| 種類 | パッケージ名の例 |
|---|---|
| 省庁通達 | `@shuji-bonji/houki-{省庁略号}-mcp`（例: `houki-nta-mcp`, `houki-mhlw-mcp`） |
| 判例・裁決 | `@shuji-bonji/houki-{機能}-mcp`（例: `houki-court-mcp`, `houki-saiketsu-mcp`） |
| 都道府県条例 | `@shuji-bonji/houki-jorei-{県名}-mcp` |

各 MCP は `@shuji-bonji/houki-abbreviations` を dependency にして、共通の略称解決ロジックを使ってください。エントリの `source_mcp_hint` フィールドで自分の管轄を識別する設計になっています。

新しい MCP を houki-hub family に加える場合は、Issue で相談してから着手するのが安全です。

## Skill の作成（利用者プロジェクトに置く）

業務ドメイン特化のワークフロー（消費税区分判定、電帳法対応、電子契約実装 等）は **Skill** として書き、各利用者のプロジェクトの `.claude/skills/` 配下に置きます。houki-egov-mcp 本体には含めません。

将来的には `.claude/skills/houki-research/` を「houki ファミリー横断のオーケストレーション Skill」として houki-hub meta-package が配布する予定です。

### 参考になる Skill の例

**個人事業主・士業系**

- 消費税区分判定 Skill — 消法 4/6/7/30 + 消基通 5-1-1 / 11-1-1 / 11-2-10 を組み合わせた判定ツリー
- 社労士実務 Skill — 36協定・割増賃金・育介法運用
- フリーランス青色申告 Skill — 所法 / 措法の小規模事業者特例

**プロダクト実装系（エンジニアが丸投げされがちな領域）**

- 電子帳簿保存法 実装チェック Skill — 電帳法4条〜9条、スキャナ保存要件、JIIMA認証
- 電子契約 実装 Skill — 電子署名法2条・3条、立会人型/当事者型の要件
- e-KYC 実装 Skill — 犯収法4条・6条、ホ方式/ワ方式
- 決済サービス業法 Skill — 資金決済法・割販法・犯収法・金商法の対象判定
- EC ローンチ Skill — 特商法11条・12条の6・景表法・割販法の必要表示チェック
- プライバシーポリシー起草 Skill — 個情法17条・18条・27条・32条
- UGC / SNS サービスリスク Skill — プロ責法・著作権法
- ヘルステック薬機法 Skill — 医療機器該当性判定・広告規制
- IoT・無線デバイス Skill — 電波法技適・電気通信事業法

Skill の書き方は本プロジェクトのスコープ外ですが、作ったものを他人に共有する場合は **「本MCPが返す事実情報に基づく判断ツリー」** と明示することを推奨します（利用者が判断の根拠を追えるように）。

## コーディング規約

- TypeScript 7.x / ESM / Node.js >= 22（CI は 22 と 24）
- MCP SDK は v2（`@modelcontextprotocol/server`）。サーバー本体は `src/server.ts` の `createServer()`、bin エントリ `src/index.ts` が `serveStdio(createServer)` で起動
- インポートは `.js` 拡張子を明示（TS ファイル内でも）
- `console.log` 禁止（stdio MCP プロトコル保護のため）。ログは `src/utils/logger.ts` 経由
- テストは `vitest`。MCP 経由の応答は `src/server.test.ts`（`InMemoryTransport`）で検証
- lint / フォーマットは Biome（`biome.json`）。`npm run check` で自動修正込みの一括実行
  - 法令テキストに含まれる全角スペース（U+3000）は、文字列・コメント・正規表現の中では指摘されません（コード部分に混入した場合のみ `noIrregularWhitespace` が警告）

## 質問・議論

- GitHub Discussions
- Issues にドラフト相談も歓迎

## 作者のスタンス

このプロジェクトは「完璧な一枚岩」ではなく「**育てる基盤**」として運用されます。辞書（houki-abbreviations）・各省庁 MCP・Skill の3層で、それぞれのドメインを持つ人が自分の専門を持ち寄れる設計にしています。

完璧でないエントリでも、**PR で議論して磨く**方針です。気軽に投げてください。
