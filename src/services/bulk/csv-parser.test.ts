/**
 * Phase 2-4: all_law_list.csv パーサのテスト
 *
 * fixture: 実物の CSV から抜粋したサンプル。BOM / CRLF / クォート付きフィールド /
 * 派生 revision_id 抽出を網羅。
 */

import { describe, expect, it } from 'vitest';
import { parseCsv, parseAllLawList, extractLawRevisionId, CsvParseError } from './csv-parser.js';

// 実物の CSV と同形式のヘッダ (UTF-8 BOM 付き、CRLF)
const BOM = '﻿';
const CRLF = '\r\n';
const HEADER =
  '法令種別,法令番号,法令名,法令名読み,旧法令名,公布日,改正法令名,改正法令番号,改正法令公布日,施行日,施行日備考,法令ID,本文URL,未施行';

// 簡易行 (旧法令名 / 改正法令名 が空)
const ROW_SIMPLE =
  '政令,明治五年太政官布告第三百三十七号,明治五年太政官布告第三百三十七号（改暦ノ布告）,かいれきのふこく,,明治五年十一月九日,,,明治五年十一月九日,明治五年十一月九日,,105DF0000000337,https://laws.e-gov.go.jp/law/105DF0000000337/18721109_000000000000000,';

// 旧法令名がクォート内 CSV になっているケース
const ROW_QUOTED =
  '政令,昭和二十四年政令第四百八号,産業標準化法に基づく登録申請手数料の額等を定める政令,さんぎょうほうれい,"工業標準化法に基く表示許可申請手数料令,工業標準化法関係手数料令",昭和二十四年十二月二十七日,情報通信技術の活用による行政手続,令和元年政令第百八十三号,令和元年十二月十三日,令和元年十二月十六日,,324CO0000000408,https://laws.e-gov.go.jp/law/324CO0000000408/20191216_501CO0000000183,';

// 未施行フラグ '○' あり
const ROW_UNENFORCED =
  '法律,平成十年法律第百三十号,金融庁設置法,きんゆうちょうせっちほう,,平成十年十月十六日,金融機能の強化のための特別措置に関する法律等の一部を改正する法律,令和八年法律第十五号,令和八年五月七日,令和八年八月六日,公布の日から起算して三月を超えない範囲内において政令で定める日,410AC1000000130,https://laws.e-gov.go.jp/law/410AC1000000130/20260806_508AC0000000015,○';

describe('parseCsv (state-machine CSV parser)', () => {
  it('BOM を除去する', () => {
    const rows = parseCsv(BOM + 'a,b,c');
    expect(rows).toEqual([['a', 'b', 'c']]);
  });

  it('CRLF を行終端として扱う', () => {
    const rows = parseCsv('a,b\r\nc,d\r\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('LF (Unix) も行終端として扱う', () => {
    const rows = parseCsv('a,b\nc,d');
    expect(rows).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('クォート内のコンマをフィールドの一部として扱う', () => {
    const rows = parseCsv('"a,b",c');
    expect(rows).toEqual([['a,b', 'c']]);
  });

  it('クォート内のクォートエスケープ "" を扱う', () => {
    const rows = parseCsv('"a""b",c');
    expect(rows).toEqual([['a"b', 'c']]);
  });

  it('クォート内の改行 (CRLF) をフィールドの一部として扱う', () => {
    const rows = parseCsv('"a\r\nb",c');
    expect(rows).toEqual([['a\r\nb', 'c']]);
  });

  it('空行を結果に含めない', () => {
    const rows = parseCsv('a,b\r\n\r\nc,d');
    expect(rows).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('末尾改行なしでも最後の行を取り込む', () => {
    const rows = parseCsv('a,b,c');
    expect(rows).toEqual([['a', 'b', 'c']]);
  });

  it('Buffer 入力も受け付ける', () => {
    const rows = parseCsv(Buffer.from(BOM + 'a,b\r\nc,d', 'utf-8'));
    expect(rows).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});

describe('extractLawRevisionId', () => {
  it('新規制定 (改正なし) URL から revision_id を構成する', () => {
    const r = extractLawRevisionId(
      'https://laws.e-gov.go.jp/law/105DF0000000337/18721109_000000000000000',
      '105DF0000000337'
    );
    expect(r.law_revision_id).toBe('105DF0000000337_18721109_000000000000000');
    expect(r.enforcement_date).toBe('18721109');
    expect(r.amendment_law_id).toBe('000000000000000');
  });

  it('改正法令 URL から revision_id を構成する', () => {
    const r = extractLawRevisionId(
      'https://laws.e-gov.go.jp/law/322AC0000000149/20250601_504AC0000000068',
      '322AC0000000149'
    );
    expect(r.law_revision_id).toBe('322AC0000000149_20250601_504AC0000000068');
    expect(r.enforcement_date).toBe('20250601');
    expect(r.amendment_law_id).toBe('504AC0000000068');
  });

  it('英数字混在の改正 ID も扱える (例: M10000001002 形式)', () => {
    const r = extractLawRevisionId(
      'https://laws.e-gov.go.jp/law/122M10000001012/18931111_126M10000001002',
      '122M10000001012'
    );
    expect(r.amendment_law_id).toBe('126M10000001002');
  });

  it('クエリ / フラグメント / 末尾スラッシュを除去する', () => {
    const r = extractLawRevisionId(
      'https://laws.e-gov.go.jp/law/105DF0000000337/18721109_000000000000000?foo=bar#frag',
      '105DF0000000337'
    );
    expect(r.law_revision_id).toBe('105DF0000000337_18721109_000000000000000');
  });

  it('期待形式以外の URL では例外を投げる', () => {
    expect(() => extractLawRevisionId('https://example.com/foo', 'X')).toThrow();
    expect(() => extractLawRevisionId('https://laws.e-gov.go.jp/law/X/abc_def', 'X')).toThrow();
  });
});

describe('parseAllLawList', () => {
  it('簡易行 (旧法令名なし) を正しくパース', () => {
    const csv = BOM + HEADER + CRLF + ROW_SIMPLE + CRLF;
    const rows = parseAllLawList(csv);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.law_type_label).toBe('政令');
    expect(row.law_id).toBe('105DF0000000337');
    expect(row.law_title).toBe('明治五年太政官布告第三百三十七号（改暦ノ布告）');
    expect(row.former_law_title).toBeNull();
    expect(row.amendment_law_title).toBeNull();
    expect(row.amendment_law_num).toBeNull();
    expect(row.unenforced).toBe(false);
    expect(row.law_revision_id).toBe('105DF0000000337_18721109_000000000000000');
    expect(row.enforcement_date).toBe('18721109');
    expect(row.amendment_law_id).toBe('000000000000000');
  });

  it('クォート付きフィールド (旧法令名 CSV-in-CSV) を正しくパース', () => {
    const csv = BOM + HEADER + CRLF + ROW_QUOTED + CRLF;
    const rows = parseAllLawList(csv);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.law_id).toBe('324CO0000000408');
    expect(row.former_law_title).toBe(
      '工業標準化法に基く表示許可申請手数料令,工業標準化法関係手数料令'
    );
    expect(row.amendment_law_title).toBe('情報通信技術の活用による行政手続');
    expect(row.amendment_law_num).toBe('令和元年政令第百八十三号');
    expect(row.law_revision_id).toBe('324CO0000000408_20191216_501CO0000000183');
  });

  it('未施行フラグ ○ を boolean に正規化', () => {
    const csv = BOM + HEADER + CRLF + ROW_UNENFORCED + CRLF;
    const rows = parseAllLawList(csv);
    expect(rows[0].unenforced).toBe(true);
    expect(rows[0].law_revision_id).toBe('410AC1000000130_20260806_508AC0000000015');
  });

  it('複数行を順序通りに返す', () => {
    const csv = BOM + HEADER + CRLF + ROW_SIMPLE + CRLF + ROW_UNENFORCED + CRLF;
    const rows = parseAllLawList(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0].law_id).toBe('105DF0000000337');
    expect(rows[1].law_id).toBe('410AC1000000130');
  });

  it('header 列数が違うと CsvParseError', () => {
    const badHeader = '法令種別,法令番号,法令名'; // 14 列でない
    const csv = BOM + badHeader + CRLF + ROW_SIMPLE + CRLF;
    expect(() => parseAllLawList(csv)).toThrow(CsvParseError);
  });

  it('行の列数が足りないと CsvParseError (skipMalformed=false)', () => {
    const csv = BOM + HEADER + CRLF + 'a,b,c' + CRLF;
    expect(() => parseAllLawList(csv)).toThrow(CsvParseError);
  });

  it('skipMalformed=true で不正行を skip', () => {
    const csv = BOM + HEADER + CRLF + 'bogus,line\r\n' + ROW_SIMPLE + CRLF;
    const rows = parseAllLawList(csv, { skipMalformed: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].law_id).toBe('105DF0000000337');
  });

  it('skipMalformed=true で revision_id 抽出失敗行を skip', () => {
    const badUrl = ROW_SIMPLE.replace(
      'https://laws.e-gov.go.jp/law/105DF0000000337/18721109_000000000000000',
      'https://example.com/no-revision-id'
    );
    const csv = BOM + HEADER + CRLF + badUrl + CRLF + ROW_UNENFORCED + CRLF;
    const rows = parseAllLawList(csv, { skipMalformed: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].law_id).toBe('410AC1000000130');
  });

  it('Buffer 入力も受け付ける', () => {
    const csv = BOM + HEADER + CRLF + ROW_SIMPLE + CRLF;
    const rows = parseAllLawList(Buffer.from(csv, 'utf-8'));
    expect(rows).toHaveLength(1);
  });

  it('空入力を空配列で返す', () => {
    expect(parseAllLawList('')).toEqual([]);
    expect(parseAllLawList(BOM)).toEqual([]);
  });
});
