import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  consolidateHistoricalRows,
  parseHistoricalWorkbook,
  REQUIRED_1999_HEADERS,
} from './xlsx-import';

describe('1999 historical Excel importer', () => {
  it('consolidates workflow rows and prefers the final reply unit', () => {
    const result = consolidateHistoricalRows([
      {
        caseNo: '11501010001',
        title: '反映跨年規劃問題',
        description: '案件內容',
        submittedAt: '115.01.01',
        assignedAt: '115.01.01',
        repliedAt: '115.01.01',
        processingDays: 1,
        status: '民眾交辦',
        assigningUnit: '民眾',
        executingUnit: '文化局',
        location: '',
        caseType: '藝文活動',
        sourceRow: 2,
      },
      {
        caseNo: '11501010001',
        title: '反映跨年規劃問題',
        description: '案件內容',
        submittedAt: '115.01.01',
        assignedAt: '115.01.01',
        repliedAt: '115.01.05',
        processingDays: 2,
        status: '回覆',
        assigningUnit: '文化局',
        executingUnit: '民眾',
        location: '',
        caseType: '藝文活動',
        sourceRow: 3,
      },
    ]);

    expect(result.references).toHaveLength(1);
    expect(result.references[0].departmentName).toBe('文化局');
    expect(result.references[0].originalStatus).toBe('回覆');
  });

  it('parses the 12-column workbook format', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('2026-01-01~2026-03-31');
    sheet.addRow([...REQUIRED_1999_HEADERS]);
    sheet.addRow([
      '11501010005',
      '早餐店吸菸問題',
      '騎樓用餐區有人吸菸',
      '46023',
      '115.01.01 05時48分39秒',
      '115.01.07 09時51分40秒',
      4,
      '回覆',
      '衛生局',
      '民眾',
      '竹光路217號',
      '菸害',
    ]);
    const buffer = await workbook.xlsx.writeBuffer();
    const result = await parseHistoricalWorkbook(buffer);

    expect(result.rawRows).toBe(1);
    expect(result.uniqueCases).toBe(1);
    expect(result.references[0]).toMatchObject({
      externalId: '11501010005',
      departmentName: '衛生局',
      caseType: '菸害',
      location: '竹光路217號',
    });
  });

  it('rejects workbooks missing required headers', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('bad').addRow(['案件編號', '案由']);
    const buffer = await workbook.xlsx.writeBuffer();

    await expect(parseHistoricalWorkbook(buffer))
      .rejects.toThrow(/缺少必要欄位/);
  });
});
