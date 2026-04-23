# Extension Layer

jp-houki-mcp の**拡張レイヤ**は、通達・裁決・下級裁判例など、e-Gov 外の法情報ソースを**独立 npm パッケージ**として追加するための仕組み。

## なぜ分離するのか

- **税務しか使わない人**に労働省通達ツールを見せない（ツール数肥大化の回避）
- **公式 MCP が法令条文を提供**しても、通達層は引き続き価値を持つ
- **各省庁のWeb構造変更**に追随するのは個別パッケージのほうが軽い

## 想定する拡張パッケージ（例）

| パッケージ名 | 対象 | 参考既存実装 |
|---|---|---|
| `@jp-houki/ext-nta` | 国税庁基本通達・措置法通達 | `kentaroajisaka/tax-law-mcp` |
| `@jp-houki/ext-saiketsu` | 国税不服審判所 公表裁決事例 | 同上 |
| `@jp-houki/ext-mhlw` | 厚生労働省通達 | `kentaroajisaka/labor-law-mcp` |
| `@jp-houki/ext-jaish` | 安全衛生情報センター（JAISH）通達 | 同上 |
| `@jp-houki/ext-court` | 裁判所 判例検索（最高裁・下級裁） | — |
| `@jp-houki/ext-fsa` | 金融庁 監督指針 | — |

## インターフェース（Phase 0 暫定）

`src/extensions/types.ts` 参照。

```typescript
import type { ExtensionFactory } from '@shuji-bonji/jp-houki-mcp/extensions';

const factory: ExtensionFactory = () => ({
  manifest: {
    namespace: 'nta',
    label: '国税庁通達',
    version: '0.1.0',
    source: {
      label: '国税庁ホームページ',
      url: 'https://www.nta.go.jp/',
    },
  },
  tools: [
    {
      name: 'nta_list_tsutatsu',
      description: '...',
      inputSchema: { /* ... */ },
    },
  ],
  handlers: {
    nta_list_tsutatsu: async (args) => { /* ... */ },
  },
});

export default factory;
```

## 読み込み方（Phase 1 で実装予定）

```bash
JP_HOUKI_EXTENSIONS="@jp-houki/ext-nta,@jp-houki/ext-mhlw" npx @shuji-bonji/jp-houki-mcp
```

起動時に環境変数で指定されたパッケージを動的 import し、`manifest.namespace` でツール名の衝突を防ぐ。

## 命名規則

- 拡張ツール名は `{namespace}_{verb}` 形式にする（例: `nta_get_tsutatsu`）
- コアの `search_law` などと混ざらないようにする
