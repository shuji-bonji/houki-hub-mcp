/**
 * 法令種別の階層・制定主体・効力をまとめた構造化ナレッジ。
 *
 * houki-egov-mcp のユーザーは法務専門家ではない（プロダクト開発者・個人事業主等）。
 * `get_law` で取得した `law_type` がそもそも何を意味するのか、
 * 通達は本当に守らなくていいのか、政令と省令の違いは何か、といった
 * **法令種別そのものの基礎知識**を提供する。
 *
 * このデータは `explain_law_type` ツールで返却され、
 * 詳細な人間向け解説は `docs/LAW-HIERARCHY.md` を参照。
 */

import type { LawTypeCode } from '../constants.js';

export interface LawHierarchyEntry {
  /** 日本語名称（主名） */
  name: string;
  /** 別称・通称 */
  aliases?: string[];
  /** e-Gov の law_type コード（該当する場合） */
  law_type_code?: LawTypeCode;
  /** 制定主体 */
  enacting_body: string;
  /** 階層順位（1=憲法、数字大きいほど下位／法令外は 99） */
  hierarchy_rank: number;
  /** 適用される範囲 */
  level: 'national' | 'local' | 'agency-internal' | 'judicial';
  /** 国民への直接拘束力があるか */
  binds_citizens: boolean;
  /** 罰則を新たに設定できるか */
  can_set_penalties: boolean;
  /** 説明（実務上のポイント込み） */
  description: string;
  /** 具体例 */
  examples: string[];
  /** 取得元 */
  sources: Array<{ label: string; url?: string }>;
  /** 補足注意点 */
  notes?: string[];
}

export const LAW_HIERARCHY: Record<string, LawHierarchyEntry> = {
  憲法: {
    name: '憲法',
    aliases: ['日本国憲法'],
    enacting_body: '国民（憲法改正は国民投票による承認）',
    hierarchy_rank: 1,
    level: 'national',
    binds_citizens: true,
    can_set_penalties: false,
    description:
      '日本における最高法規。すべての法令は憲法に違反することはできない（98条）。改正には国会の発議＋国民投票の過半数承認が必要（96条）。',
    examples: ['日本国憲法'],
    sources: [
      {
        label: 'e-Gov 法令検索',
        url: 'https://laws.e-gov.go.jp/law/321CONSTITUTION',
      },
    ],
  },

  法律: {
    name: '法律',
    law_type_code: 'Act',
    enacting_body: '国会（衆議院・参議院）',
    hierarchy_rank: 2,
    level: 'national',
    binds_citizens: true,
    can_set_penalties: true,
    description:
      '国民の代表である国会が制定する。国民の権利を制限したり義務を課したりすることができる。罰則を設けるには法律の根拠が必要（罪刑法定主義）。改正・廃止には国会の議決を要する。',
    examples: [
      '民法（明治二十九年法律第八十九号）',
      '消費税法（昭和六十三年法律第百八号）',
      '労働基準法（昭和二十二年法律第四十九号）',
    ],
    sources: [{ label: 'e-Gov 法令検索', url: 'https://laws.e-gov.go.jp/' }],
  },

  政令: {
    name: '政令',
    aliases: ['施行令', 'CabinetOrder'],
    law_type_code: 'CabinetOrder',
    enacting_body: '内閣',
    hierarchy_rank: 3,
    level: 'national',
    binds_citizens: true,
    can_set_penalties: true,
    description:
      '法律の委任に基づき内閣が制定する命令。法律の実施に必要な詳細事項を定める。「○○法施行令」と呼ばれることが多い。法律の委任なしに新たな権利制限・罰則を設けることはできない（憲法73条6号）。',
    examples: ['消費税法施行令', '所得税法施行令', '労働基準法施行令'],
    sources: [{ label: 'e-Gov 法令検索', url: 'https://laws.e-gov.go.jp/' }],
    notes: [
      '法律から委任された範囲を超える政令は無効（委任の範囲を超える政令の効力が裁判で争われた例がある）',
    ],
  },

  省令: {
    name: '省令',
    aliases: ['府令', '内閣府令', '施行規則', 'MinisterialOrdinance'],
    law_type_code: 'MinisterialOrdinance',
    enacting_body: '各省大臣／内閣府の主任の大臣',
    hierarchy_rank: 4,
    level: 'national',
    binds_citizens: true,
    can_set_penalties: true,
    description:
      '法律・政令の委任に基づき各省大臣が発する命令。「○○法施行規則」と呼ばれることが多い。技術的・細目的な手続や基準を定める。電子帳簿保存法のスキャナ保存要件、薬機法の医療機器分類など、実装に直結する基準が省令レベルにあることが多い。',
    examples: [
      '消費税法施行規則',
      '労働基準法施行規則',
      '電子帳簿保存法施行規則',
      '個人情報の保護に関する法律施行規則',
    ],
    sources: [{ label: 'e-Gov 法令検索', url: 'https://laws.e-gov.go.jp/' }],
    notes: [
      '実装エンジニアが最もよく参照するレイヤー。「具体的な要件」がここに書かれていることが多い',
      '「府令」は内閣府の長たる内閣総理大臣が発するもの（金融庁・消費者庁関連等）',
    ],
  },

  規則: {
    name: '規則',
    enacting_body:
      '最高裁判所／国会（衆議院・参議院）／会計検査院／人事院／地方公共団体の長・委員会 等',
    hierarchy_rank: 4,
    level: 'national',
    binds_citizens: true,
    can_set_penalties: false,
    description:
      '「規則」は文脈で意味が変わる多義語。最高裁判所規則（憲法77条）は司法手続を定めるもので法律と同等の効力を持つ。国会の各院規則は院内手続を定める。地方公共団体の規則は条例より下位で、首長や委員会が定める。罰則設定は限定的。',
    examples: [
      '最高裁判所規則（民事訴訟規則 等）',
      '人事院規則',
      '会計検査院規則',
      '○○県規則／○○市教育委員会規則',
    ],
    sources: [
      { label: 'e-Gov 法令検索', url: 'https://laws.e-gov.go.jp/' },
      { label: '各自治体例規集', url: '' },
    ],
    notes: [
      '「省令」も別名「○○省規則」と呼ばれることがあり混同しやすい',
      '最高裁判所規則は実質的に法律と同等の効力',
    ],
  },

  条例: {
    name: '条例',
    enacting_body: '地方公共団体の議会',
    hierarchy_rank: 5,
    level: 'local',
    binds_citizens: true,
    can_set_penalties: true,
    description:
      '地方自治法14条に基づき地方議会が制定する地方独自の法。地域の実情に合わせたルールを定められるが、法律・政令・省令に違反することはできない（憲法94条）。罰則は2年以下の拘禁刑または100万円以下の罰金まで設定可能（地方自治法14条3項）。',
    examples: ['青少年保護育成条例', '迷惑防止条例', '受動喫煙防止条例', '暴力団排除条例'],
    sources: [{ label: '各自治体の例規集（自治体ウェブサイト）', url: '' }],
    notes: [
      'e-Gov には条例は掲載されていない — 各自治体ウェブサイトを参照',
      '同じ趣旨の条例でも自治体によって細部が異なる',
    ],
  },

  告示: {
    name: '告示',
    enacting_body: '各省大臣／委員会／その他公的機関',
    hierarchy_rank: 6,
    level: 'national',
    binds_citizens: true,
    can_set_penalties: false,
    description:
      '行政機関が一定の事項を公に知らせるための公示形式。法律・政令・省令の委任に基づくものは法的拘束力を持つ場合がある（例：薬機法の公定書誌、税務関連の告示）。一方、単なる事実の通知であれば直接の拘束力はない。法的位置付けは個別判断。',
    examples: [
      '日本薬局方（厚生労働省告示）',
      '電子帳簿保存法関係の国税庁告示',
      '保険適用品目の告示',
    ],
    sources: [
      { label: '官報（インターネット版）', url: 'https://kanpou.npb.go.jp/' },
      { label: 'e-Gov（一部の告示）', url: 'https://laws.e-gov.go.jp/' },
      { label: '各省庁ウェブサイト', url: '' },
    ],
    notes: ['告示の中には事実上、省令と同等の拘束力を持つものもある（公定書誌など）'],
  },

  訓令: {
    name: '訓令',
    enacting_body: '上級行政機関',
    hierarchy_rank: 99,
    level: 'agency-internal',
    binds_citizens: false,
    can_set_penalties: false,
    description:
      '上級行政機関が下級行政機関や所属職員に対して発する内部命令。国民を直接拘束する効力はない。事務処理の指針として機能する。',
    examples: ['各省訓令（事務取扱の手順を定めるもの）'],
    sources: [{ label: '各省庁ウェブサイト', url: '' }],
    notes: ['通達と訓令の区別は曖昧な場合があり、慣行で使い分けられている'],
  },

  通達: {
    name: '通達',
    aliases: ['通知', '基本通達', '取扱通達'],
    enacting_body: '上級行政機関（各省庁・国税庁・最高裁等）',
    hierarchy_rank: 99,
    level: 'agency-internal',
    binds_citizens: false,
    can_set_penalties: false,
    description:
      '行政機関内部に対する解釈指針・運用指示。**法令ではなく、国民を直接拘束しない**（裁判所も通達には拘束されない）。ただし行政の運用は通達に従って行われるため、**実務上は通達を踏まえないと申請等で不利益**を受けることがある。電子帳簿保存法取扱通達、消費税法基本通達などがその例。',
    examples: [
      '消費税法基本通達（消基通）',
      '所得税基本通達（所基通）',
      '法人税基本通達（法基通）',
      '電子帳簿保存法取扱通達',
      '36協定関係の厚生労働省通達',
    ],
    sources: [
      { label: '国税庁ウェブサイト', url: 'https://www.nta.go.jp/law/tsutatsu/' },
      { label: '厚生労働省 法令等データベース', url: 'https://www.mhlw.go.jp/hourei_db/' },
      { label: '安全衛生情報センター（JAISH）', url: 'https://www.jaish.gr.jp/' },
    ],
    notes: [
      '「AI が通達を引用したから OK」とは言えない — 法的根拠は法律・政令・省令にある',
      '税務署・労基署等は通達に従って判断するため、実務では確認必須',
      'e-Gov には掲載されない — 各省庁サイト経由で取得',
    ],
  },

  通知: {
    name: '通知',
    enacting_body: '行政機関',
    hierarchy_rank: 99,
    level: 'agency-internal',
    binds_citizens: false,
    can_set_penalties: false,
    description:
      '行政機関が下部機関・関係者・国民に対して特定事項を知らせる文書。通達と類似するが、より個別的な事案・運用変更等の連絡が中心。法的拘束力はない。',
    examples: ['事務連絡', '留意事項について（厚労省通知）'],
    sources: [{ label: '各省庁ウェブサイト', url: '' }],
  },
};

/**
 * 名前からエントリを検索（完全一致 + aliases）
 */
export function findLawHierarchy(name: string): LawHierarchyEntry | null {
  const trimmed = name.trim();
  // 完全一致
  if (LAW_HIERARCHY[trimmed]) {
    return LAW_HIERARCHY[trimmed];
  }
  // aliases 検索
  for (const entry of Object.values(LAW_HIERARCHY)) {
    if (entry.aliases?.includes(trimmed)) {
      return entry;
    }
  }
  // law_type_code 検索（"Act" → 法律 等）
  for (const entry of Object.values(LAW_HIERARCHY)) {
    if (entry.law_type_code === trimmed) {
      return entry;
    }
  }
  return null;
}

/** 全種別の名前リスト */
export function listLawHierarchyNames(): string[] {
  return Object.keys(LAW_HIERARCHY);
}
