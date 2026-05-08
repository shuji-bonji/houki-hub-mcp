/**
 * all_law_list.csv パーサ — Phase 2-4
 *
 * e-Gov bulk download zip に同梱される `all_law_list.csv` を読み取り、
 * 法令メタの行配列に変換する。差分 zip にも同形式の `R{YY}{MM}{DD}.csv` が
 * 入るので、両方で利用される。
 *
 * 仕様 (PHASE2-SPIKE.md §1-5 で実証):
 *  - エンコーディング: UTF-8 with BOM
 *  - 改行: CRLF
 *  - 列数: 14
 *  - クォート: RFC 4180 (二重引用符 `"..."` でフィールド内コンマ・改行をエスケープ)
 *
 * 列順:
 *   1: 法令種別        (政令 / 法律 / 府省令 等)
 *   2: 法令番号        (明治五年太政官布告第三百三十七号)
 *   3: 法令名          (改暦ノ布告)
 *   4: 法令名読み      (かいれきのふこく)
 *   5: 旧法令名        (空 or 旧法令名 (複数の場合は CSV 内 CSV))
 *   6: 公布日 (和暦)   (明治五年十一月九日)
 *   7: 改正法令名
 *   8: 改正法令番号
 *   9: 改正法令公布日 (和暦)
 *  10: 施行日 (和暦)
 *  11: 施行日備考
 *  12: 法令ID         (105DF0000000337)
 *  13: 本文URL        (https://laws.e-gov.go.jp/law/{law_id}/{enforcement_date}_{amendment_law_id})
 *  14: 未施行         (空 or '○')
 *
 * 派生フィールド (本パーサが計算):
 *  - law_revision_id      = `{law_id}_{enforcement_date}_{amendment_law_id}` (PK 候補)
 *  - enforcement_date     = `YYYYMMDD` (URL から抽出)
 *  - amendment_law_id     = '000000000000000' (新規制定) or 改正法令の law_id
 */

/**
 * all_law_list.csv 1 行を表す。
 *
 * **設計判断:** 和暦テキスト (列 6/9/10) はパースせずそのまま raw 文字列として保持する。
 * API v2 の ISO 形式 (`promulgation_date: '1872-11-09'`) を ingester で採用するため、
 * CSV 側の和暦は表示・突合用に保持するのみ。
 */
export interface AllLawListRow {
  /** 列 1: 法令種別 (政令 / 法律 / 府省令 等。raw label) */
  law_type_label: string;
  /** 列 2: 法令番号 (raw, 和暦混じり) */
  law_num: string;
  /** 列 3: 法令名 */
  law_title: string;
  /** 列 4: 法令名読み (ひらがな) */
  law_title_kana: string;
  /** 列 5: 旧法令名 (複数の場合あり、空文字なら null) */
  former_law_title: string | null;
  /** 列 6: 公布日 (和暦テキスト) */
  promulgation_date_wareki: string;
  /** 列 7: 改正法令名 */
  amendment_law_title: string | null;
  /** 列 8: 改正法令番号 (和暦) */
  amendment_law_num: string | null;
  /** 列 9: 改正法令公布日 (和暦) */
  amendment_promulgate_date_wareki: string | null;
  /** 列 10: 施行日 (和暦) */
  enforcement_date_wareki: string;
  /** 列 11: 施行日備考 */
  enforcement_date_note: string | null;
  /** 列 12: 法令ID (e-Gov) */
  law_id: string;
  /** 列 13: 本文 URL (出典) */
  source_url: string;
  /** 列 14: 未施行 (true なら未施行) */
  unenforced: boolean;
  /** 派生: revision_id (`{law_id}_{enforcement_date}_{amendment_law_id}`) */
  law_revision_id: string;
  /** 派生: 施行日 (URL 由来、YYYYMMDD) */
  enforcement_date: string;
  /** 派生: 改正法令ID (URL 由来、新規制定なら '000000000000000') */
  amendment_law_id: string;
}

/** CSV パースのエラー */
export class CsvParseError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly column?: number
  ) {
    super(
      `CSV parse error at line ${line}${column !== undefined ? `, col ${column}` : ''}: ${message}`
    );
    this.name = 'CsvParseError';
  }
}

/** 期待する列数 (固定) */
const EXPECTED_COLUMNS = 14;

/**
 * RFC 4180 互換の CSV パーサ。state machine ベース。
 *
 * 入力は string か Buffer（UTF-8）。BOM は自動で除去する。
 * 改行は CRLF / LF / CR のいずれも許容（フィールド内の改行はクォート内のみ有効）。
 */
export function parseCsv(input: string | Buffer): string[][] {
  const text = typeof input === 'string' ? input : input.toString('utf-8');
  // BOM 除去
  const stripped = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (stripped.length === 0) return [];

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];

    if (inQuotes) {
      if (ch === '"') {
        // エスケープ "" or 引用符閉じ
        if (i + 1 < stripped.length && stripped[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      // フィールド先頭の "
      if (field.length === 0) {
        inQuotes = true;
      } else {
        // フィールド途中の " は文字として扱う (寛容)
        field += '"';
      }
      continue;
    }

    if (ch === ',') {
      row.push(field);
      field = '';
      continue;
    }

    // 行終端 (CRLF / LF / CR を吸収)
    if (ch === '\r' || ch === '\n') {
      row.push(field);
      field = '';
      // 空行 (列なし) は除外
      if (!(row.length === 1 && row[0] === '')) {
        rows.push(row);
      }
      row = [];
      // CRLF のとき LF を skip
      if (ch === '\r' && i + 1 < stripped.length && stripped[i + 1] === '\n') {
        i++;
      }
      continue;
    }

    field += ch;
  }

  // 末尾に改行がない場合も最後の行を確定する
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (!(row.length === 1 && row[0] === '')) {
      rows.push(row);
    }
  }

  return rows;
}

/**
 * 本文 URL (`https://laws.e-gov.go.jp/law/{law_id}/{YYYYMMDD}_{amendmentLawId}`)
 * から末尾セグメントを抽出して `law_revision_id` を構成する。
 *
 * @param sourceUrl all_law_list.csv 列 13
 * @param lawId all_law_list.csv 列 12
 *
 * @throws Error URL パスが期待形式でないとき
 */
export function extractLawRevisionId(
  sourceUrl: string,
  lawId: string
): { law_revision_id: string; enforcement_date: string; amendment_law_id: string } {
  // 末尾セグメント = `{enforcement_date}_{amendment_law_id}`
  // クエリ・フラグメントを除去
  const cleaned = sourceUrl.replace(/[?#].*$/, '').replace(/\/+$/, '');
  const idx = cleaned.lastIndexOf('/');
  if (idx < 0) {
    throw new Error(`本文 URL が期待形式ではありません (path 区切りなし): ${sourceUrl}`);
  }
  const lastSegment = cleaned.slice(idx + 1);
  // {YYYYMMDD}_{amendmentLawId}
  // amendmentLawId はゼロ pad 15 文字 or 法令ID 15 文字
  const m = /^(\d{8})_([0-9A-Z]+)$/.exec(lastSegment);
  if (!m) {
    throw new Error(`本文 URL の末尾セグメントが期待形式ではありません: ${lastSegment}`);
  }
  const [, enforcement_date, amendment_law_id] = m;
  return {
    law_revision_id: `${lawId}_${enforcement_date}_${amendment_law_id}`,
    enforcement_date,
    amendment_law_id,
  };
}

/**
 * all_law_list.csv (または差分 zip 内の R{YY}{MM}{DD}.csv) をパースして
 * `AllLawListRow[]` に変換する。
 *
 * @param input CSV 全文 (Buffer or string)
 * @param options.skipMalformed 列数不一致行を skip して継続する (default false → 例外を投げる)
 */
export function parseAllLawList(
  input: string | Buffer,
  options: { skipMalformed?: boolean } = {}
): AllLawListRow[] {
  const rawRows = parseCsv(input);
  if (rawRows.length === 0) return [];

  // 1 行目はヘッダ。列数チェックに使う
  const header = rawRows[0];
  if (header.length !== EXPECTED_COLUMNS) {
    throw new CsvParseError(
      `header に ${header.length} 列ありますが ${EXPECTED_COLUMNS} 列を期待します`,
      1
    );
  }

  const result: AllLawListRow[] = [];
  for (let i = 1; i < rawRows.length; i++) {
    const cols = rawRows[i];
    const lineNum = i + 1;
    if (cols.length !== EXPECTED_COLUMNS) {
      if (options.skipMalformed) continue;
      throw new CsvParseError(
        `${cols.length} 列見つかりましたが ${EXPECTED_COLUMNS} 列を期待します`,
        lineNum
      );
    }

    const [
      law_type_label,
      law_num,
      law_title,
      law_title_kana,
      former_law_title,
      promulgation_date_wareki,
      amendment_law_title,
      amendment_law_num,
      amendment_promulgate_date_wareki,
      enforcement_date_wareki,
      enforcement_date_note,
      law_id,
      source_url,
      unenforced_label,
    ] = cols;

    let derived: ReturnType<typeof extractLawRevisionId>;
    try {
      derived = extractLawRevisionId(source_url, law_id);
    } catch (err) {
      if (options.skipMalformed) continue;
      throw new CsvParseError(`revision_id の抽出に失敗: ${(err as Error).message}`, lineNum, 13);
    }

    result.push({
      law_type_label,
      law_num,
      law_title,
      law_title_kana,
      former_law_title: former_law_title === '' ? null : former_law_title,
      promulgation_date_wareki,
      amendment_law_title: amendment_law_title === '' ? null : amendment_law_title,
      amendment_law_num: amendment_law_num === '' ? null : amendment_law_num,
      amendment_promulgate_date_wareki:
        amendment_promulgate_date_wareki === '' ? null : amendment_promulgate_date_wareki,
      enforcement_date_wareki,
      enforcement_date_note: enforcement_date_note === '' ? null : enforcement_date_note,
      law_id,
      source_url,
      unenforced: unenforced_label.trim().length > 0,
      law_revision_id: derived.law_revision_id,
      enforcement_date: derived.enforcement_date,
      amendment_law_id: derived.amendment_law_id,
    });
  }

  return result;
}
