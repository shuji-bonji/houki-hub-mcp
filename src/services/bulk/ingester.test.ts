/**
 * Phase 2-5: ingester のテスト
 *
 * `createMemoryZip` で in-memory zip fixture を組み立て、ingester を実 SQLite
 * (in-memory DB) に流して期待する row が入っているかを検証する。
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type DatabaseT from 'better-sqlite3';
import { initSchema } from '../../db/schema.js';
import { closeDb } from '../../db/index.js';
import { ingestZip, IngestError } from './ingester.js';
import { createMemoryZip } from './zip-reader.js';

const BOM = '﻿';
const CRLF = '\r\n';
const HEADER =
  '法令種別,法令番号,法令名,法令名読み,旧法令名,公布日,改正法令名,改正法令番号,改正法令公布日,施行日,施行日備考,法令ID,本文URL,未施行';

/** CSV: 改暦ノ布告 */
const CSV_KAIREKI =
  '政令,明治五年太政官布告第三百三十七号,明治五年太政官布告第三百三十七号（改暦ノ布告）,かいれきのふこく,,明治五年十一月九日,,,明治五年十一月九日,明治五年十一月九日,,105DF0000000337,https://laws.e-gov.go.jp/law/105DF0000000337/18721109_000000000000000,';

/** XML: 改暦ノ布告 (最小) */
const XML_KAIREKI = `<?xml version="1.0" encoding="UTF-8"?>
<Law Era="Meiji" Year="05" Num="337" LawType="CabinetOrder" Lang="ja" PromulgateMonth="11" PromulgateDay="09">
  <LawNum>明治五年太政官布告第三百三十七号</LawNum>
  <LawBody>
    <LawTitle Kana="かいれきのふこく" Abbrev="改暦の布告">明治五年太政官布告第三百三十七号（改暦ノ布告）</LawTitle>
    <MainProvision>
      <Article Num="1">
        <ArticleCaption>（暦に関する事項）</ArticleCaption>
        <ArticleTitle>第一条</ArticleTitle>
        <Paragraph Num="1">
          <ParagraphSentence>
            <Sentence>今般改暦ノ儀別紙　詔書ノ通被　仰出候条此旨相達候事</Sentence>
          </ParagraphSentence>
        </Paragraph>
      </Article>
    </MainProvision>
  </LawBody>
</Law>`;

/** CSV: 預金保険法 */
const CSV_YOKIN =
  '法律,昭和四十六年法律第三十四号,預金保険法,よきんほけんほう,,昭和四十六年四月一日,,,昭和四十六年四月一日,昭和四十六年四月一日,,346AC0000000034,https://laws.e-gov.go.jp/law/346AC0000000034/19710401_000000000000000,';

const XML_YOKIN = `<?xml version="1.0" encoding="UTF-8"?>
<Law Era="Showa" Year="46" Num="034" LawType="Act" Lang="ja" PromulgateMonth="04" PromulgateDay="01">
  <LawNum>昭和四十六年法律第三十四号</LawNum>
  <LawBody>
    <LawTitle Kana="よきんほけんほう" Abbrev="預保法">預金保険法</LawTitle>
    <MainProvision>
      <Chapter Num="1">
        <ChapterTitle>第一章　総則</ChapterTitle>
        <Article Num="1">
          <ArticleCaption>（目的）</ArticleCaption>
          <ArticleTitle>第一条</ArticleTitle>
          <Paragraph Num="1">
            <ParagraphSentence>
              <Sentence>この法律は、預金者等の保護を目的とする。</Sentence>
            </ParagraphSentence>
          </Paragraph>
        </Article>
      </Chapter>
    </MainProvision>
  </LawBody>
</Law>`;

/** CSV: 未施行法令 */
const CSV_UNENFORCED =
  '法律,平成十年法律第百三十号,金融庁設置法,きんゆうちょうせっちほう,,平成十年十月十六日,,,,令和八年八月六日,,410AC1000000130,https://laws.e-gov.go.jp/law/410AC1000000130/20260806_508AC0000000015,○';

const XML_UNENFORCED = `<?xml version="1.0" encoding="UTF-8"?>
<Law Era="Heisei" Year="10" Num="130" LawType="Act" Lang="ja" PromulgateMonth="10" PromulgateDay="16">
  <LawNum>平成十年法律第百三十号</LawNum>
  <LawBody>
    <LawTitle>金融庁設置法</LawTitle>
    <MainProvision>
      <Article Num="1">
        <ArticleCaption>（設置）</ArticleCaption>
        <ArticleTitle>第一条</ArticleTitle>
        <Paragraph Num="1">
          <ParagraphSentence>
            <Sentence>金融庁を設置する。</Sentence>
          </ParagraphSentence>
        </Paragraph>
      </Article>
    </MainProvision>
  </LawBody>
</Law>`;

function buildCsv(rows: string[]): string {
  return BOM + HEADER + CRLF + rows.join(CRLF) + CRLF;
}

describe('ingestZip', () => {
  let db: DatabaseT.Database;
  const NOW_ISO = '2026-05-08T15:00:00+09:00';

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
  });

  afterEach(() => {
    closeDb(db);
  });

  it('CSV + XML 1 件を正常に ingest', async () => {
    const zip = createMemoryZip([
      { path: 'all_law_list.csv', content: buildCsv([CSV_KAIREKI]) },
      {
        path: '105DF0000000337_18721109_000000000000000/105DF0000000337_18721109_000000000000000.xml',
        content: XML_KAIREKI,
      },
    ]);

    const result = await ingestZip({ db, zip, nowIso: NOW_ISO });
    expect(result.csvRows).toBe(1);
    expect(result.xmlSeen).toBe(1);
    expect(result.upserted).toBe(1);
    expect(result.unchanged).toBe(0);
    expect(result.failed).toBe(0);

    const law = db
      .prepare('SELECT * FROM laws WHERE law_revision_id = ?')
      .get('105DF0000000337_18721109_000000000000000') as Record<string, unknown>;
    expect(law).toBeDefined();
    expect(law.law_id).toBe('105DF0000000337');
    expect(law.law_title).toBe('明治五年太政官布告第三百三十七号（改暦ノ布告）');
    expect(law.abbrev).toBe('改暦の布告');
    expect(law.law_type).toBe('CabinetOrder');
    expect(law.promulgation_date).toBe('1872-11-09');
    expect(law.amendment_enforcement_date).toBe('1872-11-09');
    expect(law.current_revision_status).toBe('CurrentEnforced');
    expect(law.repeal_status).toBe('None');
    expect(law.remain_in_force).toBe(0);
    expect(law.fetched_at).toBe(NOW_ISO);
  });

  it('articles テーブルにも本文が入る', async () => {
    const zip = createMemoryZip([
      { path: 'all_law_list.csv', content: buildCsv([CSV_KAIREKI]) },
      {
        path: '105DF0000000337_18721109_000000000000000/105DF0000000337_18721109_000000000000000.xml',
        content: XML_KAIREKI,
      },
    ]);

    await ingestZip({ db, zip, nowIso: NOW_ISO });

    const articles = db
      .prepare('SELECT * FROM articles WHERE law_revision_id = ? ORDER BY ord')
      .all('105DF0000000337_18721109_000000000000000') as Array<Record<string, unknown>>;
    expect(articles).toHaveLength(1);
    expect(articles[0].article_num).toBe('1');
    expect(articles[0].caption).toBe('（暦に関する事項）');
    expect(articles[0].body as string).toContain('改暦ノ儀');
  });

  it('articles_fts に trigger 経由で同期される', async () => {
    const zip = createMemoryZip([
      { path: 'all_law_list.csv', content: buildCsv([CSV_YOKIN]) },
      {
        path: '346AC0000000034_19710401_000000000000000/346AC0000000034_19710401_000000000000000.xml',
        content: XML_YOKIN,
      },
    ]);
    await ingestZip({ db, zip, nowIso: NOW_ISO });

    const hits = db
      .prepare(`SELECT rowid FROM articles_fts WHERE articles_fts MATCH '預金者'`)
      .all() as Array<{ rowid: number }>;
    expect(hits.length).toBeGreaterThan(0);
  });

  it('laws_fts (standalone) にも手動で同期される', async () => {
    const zip = createMemoryZip([
      { path: 'all_law_list.csv', content: buildCsv([CSV_YOKIN]) },
      {
        path: '346AC0000000034_19710401_000000000000000/346AC0000000034_19710401_000000000000000.xml',
        content: XML_YOKIN,
      },
    ]);
    await ingestZip({ db, zip, nowIso: NOW_ISO });

    const hits = db
      .prepare(`SELECT law_revision_id FROM laws_fts WHERE laws_fts MATCH '預保法'`)
      .all() as Array<{ law_revision_id: string }>;
    expect(hits).toHaveLength(1);
    expect(hits[0].law_revision_id).toBe('346AC0000000034_19710401_000000000000000');
  });

  it('未施行フラグ (○) は current_revision_status=UnEnforced', async () => {
    const zip = createMemoryZip([
      { path: 'all_law_list.csv', content: buildCsv([CSV_UNENFORCED]) },
      {
        path: '410AC1000000130_20260806_508AC0000000015/410AC1000000130_20260806_508AC0000000015.xml',
        content: XML_UNENFORCED,
      },
    ]);
    await ingestZip({ db, zip, nowIso: NOW_ISO });

    const law = db
      .prepare('SELECT current_revision_status FROM laws WHERE law_revision_id = ?')
      .get('410AC1000000130_20260806_508AC0000000015') as { current_revision_status: string };
    expect(law.current_revision_status).toBe('UnEnforced');
  });

  it('content_hash 一致で再 ingest を no-op (skip)', async () => {
    const entries = [
      { path: 'all_law_list.csv', content: buildCsv([CSV_KAIREKI]) },
      {
        path: '105DF0000000337_18721109_000000000000000/105DF0000000337_18721109_000000000000000.xml',
        content: XML_KAIREKI,
      },
    ];
    // 1 回目
    await ingestZip({ db, zip: createMemoryZip(entries), nowIso: NOW_ISO });
    // 2 回目
    const r2 = await ingestZip({
      db,
      zip: createMemoryZip(entries),
      nowIso: '2026-05-09T03:00:00+09:00',
    });
    expect(r2.unchanged).toBe(1);
    expect(r2.upserted).toBe(0);

    // fetched_at は更新されていない (no-op)
    const law = db
      .prepare('SELECT fetched_at FROM laws WHERE law_revision_id = ?')
      .get('105DF0000000337_18721109_000000000000000') as { fetched_at: string };
    expect(law.fetched_at).toBe(NOW_ISO); // 1 回目の値のまま
  });

  it('content 変化で再 ingest が UPDATE される', async () => {
    const entriesV1 = [
      { path: 'all_law_list.csv', content: buildCsv([CSV_KAIREKI]) },
      {
        path: '105DF0000000337_18721109_000000000000000/105DF0000000337_18721109_000000000000000.xml',
        content: XML_KAIREKI,
      },
    ];
    await ingestZip({ db, zip: createMemoryZip(entriesV1), nowIso: NOW_ISO });

    // XML を改変
    const xmlV2 = XML_KAIREKI.replace('改暦ノ儀', '改暦ノ儀 (改正)');
    const entriesV2 = [
      { path: 'all_law_list.csv', content: buildCsv([CSV_KAIREKI]) },
      {
        path: '105DF0000000337_18721109_000000000000000/105DF0000000337_18721109_000000000000000.xml',
        content: xmlV2,
      },
    ];
    const r2 = await ingestZip({
      db,
      zip: createMemoryZip(entriesV2),
      nowIso: '2026-05-09T03:00:00+09:00',
    });
    expect(r2.upserted).toBe(1);
    expect(r2.unchanged).toBe(0);

    // articles も差し替わっている
    const article = db
      .prepare('SELECT body FROM articles WHERE law_revision_id = ?')
      .get('105DF0000000337_18721109_000000000000000') as { body: string };
    expect(article.body).toContain('改正');
  });

  it('複数法令を順序通り ingest', async () => {
    const zip = createMemoryZip([
      { path: 'all_law_list.csv', content: buildCsv([CSV_KAIREKI, CSV_YOKIN, CSV_UNENFORCED]) },
      {
        path: '105DF0000000337_18721109_000000000000000/105DF0000000337_18721109_000000000000000.xml',
        content: XML_KAIREKI,
      },
      {
        path: '346AC0000000034_19710401_000000000000000/346AC0000000034_19710401_000000000000000.xml',
        content: XML_YOKIN,
      },
      {
        path: '410AC1000000130_20260806_508AC0000000015/410AC1000000130_20260806_508AC0000000015.xml',
        content: XML_UNENFORCED,
      },
    ]);
    const r = await ingestZip({ db, zip, nowIso: NOW_ISO, batchSize: 2 });
    expect(r.csvRows).toBe(3);
    expect(r.upserted).toBe(3);

    const count = (db.prepare('SELECT COUNT(*) as c FROM laws').get() as { c: number }).c;
    expect(count).toBe(3);
  });

  it('CSV にない zip エントリは無視される', async () => {
    const zip = createMemoryZip([
      { path: 'all_law_list.csv', content: buildCsv([CSV_KAIREKI]) },
      {
        path: '105DF0000000337_18721109_000000000000000/105DF0000000337_18721109_000000000000000.xml',
        content: XML_KAIREKI,
      },
      // CSV にない法令
      {
        path: '999XYZ_19990101_000000000000000/999XYZ_19990101_000000000000000.xml',
        content: XML_KAIREKI,
      },
    ]);
    const r = await ingestZip({ db, zip, nowIso: NOW_ISO });
    expect(r.csvRows).toBe(1);
    expect(r.upserted).toBe(1);

    const count = (db.prepare('SELECT COUNT(*) as c FROM laws').get() as { c: number }).c;
    expect(count).toBe(1);
  });

  it('XML が見つからない CSV 行は failed カウンタに計上', async () => {
    const zip = createMemoryZip([
      { path: 'all_law_list.csv', content: buildCsv([CSV_KAIREKI]) },
      // XML が無い
    ]);
    const r = await ingestZip({ db, zip, nowIso: NOW_ISO });
    expect(r.failed).toBe(1);
    expect(r.upserted).toBe(0);
  });

  it('壊れた XML は skip (default onXmlError)', async () => {
    const zip = createMemoryZip([
      { path: 'all_law_list.csv', content: buildCsv([CSV_KAIREKI]) },
      {
        path: '105DF0000000337_18721109_000000000000000/105DF0000000337_18721109_000000000000000.xml',
        content: '<NotLaw></NotLaw>', // ルート不正
      },
    ]);
    const r = await ingestZip({ db, zip, nowIso: NOW_ISO });
    expect(r.failed).toBe(1);
    expect(r.upserted).toBe(0);
  });

  it('壊れた XML で onXmlError=throw だと例外', async () => {
    const zip = createMemoryZip([
      { path: 'all_law_list.csv', content: buildCsv([CSV_KAIREKI]) },
      {
        path: '105DF0000000337_18721109_000000000000000/105DF0000000337_18721109_000000000000000.xml',
        content: '<NotLaw></NotLaw>',
      },
    ]);
    await expect(ingestZip({ db, zip, nowIso: NOW_ISO, onXmlError: 'throw' })).rejects.toThrow(
      IngestError
    );
  });

  it('CSV が無いと IngestError', async () => {
    const zip = createMemoryZip([
      {
        path: '105DF0000000337_18721109_000000000000000/105DF0000000337_18721109_000000000000000.xml',
        content: XML_KAIREKI,
      },
    ]);
    await expect(ingestZip({ db, zip, nowIso: NOW_ISO })).rejects.toThrow(IngestError);
  });

  it('sync_state を upsert する (source=all_xml)', async () => {
    const zip = createMemoryZip([
      { path: 'all_law_list.csv', content: buildCsv([CSV_KAIREKI]) },
      {
        path: '105DF0000000337_18721109_000000000000000/105DF0000000337_18721109_000000000000000.xml',
        content: XML_KAIREKI,
      },
    ]);
    await ingestZip({ db, zip, nowIso: '2026-05-08T15:00:00+09:00', source: 'all_xml' });

    const ss = db.prepare('SELECT * FROM sync_state WHERE id = 1').get() as Record<string, unknown>;
    expect(ss.last_sync_date).toBe('2026-05-08');
    expect(ss.last_full_dl_at).toBe('2026-05-08T15:00:00+09:00');
    expect(ss.bulk_source).toBe('all_xml');
    expect(ss.total_laws).toBe(1);
  });

  it('source=incremental では既存の last_full_dl_at を保持', async () => {
    // 先に full DL
    await ingestZip({
      db,
      zip: createMemoryZip([
        { path: 'all_law_list.csv', content: buildCsv([CSV_KAIREKI]) },
        {
          path: '105DF0000000337_18721109_000000000000000/105DF0000000337_18721109_000000000000000.xml',
          content: XML_KAIREKI,
        },
      ]),
      nowIso: '2026-05-08T15:00:00+09:00',
      source: 'all_xml',
    });

    // incremental (CSV 同じだが時刻違い)
    await ingestZip({
      db,
      zip: createMemoryZip([
        { path: 'R080509.csv', content: buildCsv([CSV_KAIREKI]) },
        {
          path: '105DF0000000337_18721109_000000000000000/105DF0000000337_18721109_000000000000000.xml',
          content: XML_KAIREKI,
        },
      ]),
      nowIso: '2026-05-09T06:00:00+09:00',
      source: 'incremental',
    });

    const ss = db.prepare('SELECT * FROM sync_state WHERE id = 1').get() as Record<string, unknown>;
    expect(ss.last_sync_date).toBe('2026-05-09'); // 進む
    expect(ss.last_full_dl_at).toBe('2026-05-08T15:00:00+09:00'); // 維持
    expect(ss.bulk_source).toBe('incremental');
  });

  it('progress callback を発火する', async () => {
    const zip = createMemoryZip([
      { path: 'all_law_list.csv', content: buildCsv([CSV_KAIREKI, CSV_YOKIN, CSV_UNENFORCED]) },
      {
        path: '105DF0000000337_18721109_000000000000000/105DF0000000337_18721109_000000000000000.xml',
        content: XML_KAIREKI,
      },
      {
        path: '346AC0000000034_19710401_000000000000000/346AC0000000034_19710401_000000000000000.xml',
        content: XML_YOKIN,
      },
      {
        path: '410AC1000000130_20260806_508AC0000000015/410AC1000000130_20260806_508AC0000000015.xml',
        content: XML_UNENFORCED,
      },
    ]);

    const events: Array<{ processed: number; total: number }> = [];
    await ingestZip({
      db,
      zip,
      nowIso: NOW_ISO,
      batchSize: 2,
      onProgress: (e) => events.push({ processed: e.processed, total: e.total }),
    });

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.every((e) => e.total === 3)).toBe(true);
    // 最後の event は processed=3 まで進む
    expect(events[events.length - 1].processed).toBe(3);
  });
});
