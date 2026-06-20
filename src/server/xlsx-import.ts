import ExcelJS from 'exceljs';

export const REQUIRED_1999_HEADERS = [
  '案件編號',
  '案由',
  '內容',
  '投書日期',
  '分案日期',
  '回覆日期',
  '處理天數',
  '案件狀態',
  '交辦單位',
  '執行單位',
  '地點/地址',
  '案件類型',
] as const;

export interface HistoricalCaseRow {
  caseNo: string;
  title: string;
  description: string;
  submittedAt: string;
  assignedAt: string;
  repliedAt: string;
  processingDays?: number;
  status: string;
  assigningUnit: string;
  executingUnit: string;
  location: string;
  caseType: string;
  sourceRow: number;
}

export interface HistoricalReference {
  externalId: string;
  title: string;
  description: string;
  departmentName: string;
  caseType: string;
  location?: string;
  submittedAt?: string;
  assignedAt?: string;
  repliedAt?: string;
  processingDays?: number;
  originalStatus: string;
  sourceRow: number;
}

export interface ParsedHistoricalWorkbook {
  sheetName: string;
  headers: string[];
  rawRows: number;
  uniqueCases: number;
  duplicateWorkflowRows: number;
  references: HistoricalReference[];
  skipped: { row: number; message: string }[];
}

const SYSTEM_UNITS = new Set(['', '民眾', '管考單位', 'NULL', 'null']);

function valueText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object') {
    if ('text' in value) {
      return String(value.text ?? '').trim();
    }
    if ('result' in value) {
      return String(value.result ?? '').trim();
    }
    if ('richText' in value) {
      return value.richText.map((item) => item.text).join('').trim();
    }
  }
  return String(value).trim();
}

function normalizeNull(value: string): string {
  return /^(null|n\/a)$/i.test(value.trim()) ? '' : value.trim();
}

function departmentCandidate(row: HistoricalCaseRow): string {
  if (row.status === '回覆' && !SYSTEM_UNITS.has(row.assigningUnit)) {
    return row.assigningUnit;
  }
  if (!SYSTEM_UNITS.has(row.assigningUnit)) {
    return row.assigningUnit;
  }
  if (!SYSTEM_UNITS.has(row.executingUnit)) {
    return row.executingUnit;
  }
  return '';
}

function rowPriority(row: HistoricalCaseRow): number {
  const statusPriority: Record<string, number> = {
    回覆: 50,
    持續列管: 40,
    移文: 30,
    分文: 20,
    民眾交辦: 10,
  };
  return (statusPriority[row.status] ?? 0) +
    (!SYSTEM_UNITS.has(row.assigningUnit) ? 2 : 0) +
    (!SYSTEM_UNITS.has(row.executingUnit) ? 1 : 0);
}

export function consolidateHistoricalRows(
  rows: HistoricalCaseRow[],
): { references: HistoricalReference[]; skipped: { row: number; message: string }[] } {
  const grouped = new Map<string, HistoricalCaseRow[]>();
  const skipped: { row: number; message: string }[] = [];
  for (const row of rows) {
    if (!row.caseNo || !row.title || !row.description) {
      skipped.push({ row: row.sourceRow, message: '案件編號、案由或內容空白' });
      continue;
    }
    const group = grouped.get(row.caseNo) ?? [];
    group.push(row);
    grouped.set(row.caseNo, group);
  }

  const references: HistoricalReference[] = [];
  for (const [externalId, workflowRows] of grouped) {
    const selected = [...workflowRows].sort((left, right) =>
      rowPriority(right) - rowPriority(left) || right.sourceRow - left.sourceRow,
    )[0];
    const departmentName = departmentCandidate(selected);
    if (!departmentName) {
      skipped.push({ row: selected.sourceRow, message: `案件 ${externalId} 無法判定責任單位` });
      continue;
    }
    references.push({
      externalId,
      title: selected.title,
      description: selected.description,
      departmentName,
      caseType: selected.caseType || '未分類',
      ...(selected.location ? { location: selected.location } : {}),
      ...(selected.submittedAt ? { submittedAt: selected.submittedAt } : {}),
      ...(selected.assignedAt ? { assignedAt: selected.assignedAt } : {}),
      ...(selected.repliedAt ? { repliedAt: selected.repliedAt } : {}),
      ...(selected.processingDays !== undefined
        ? { processingDays: selected.processingDays }
        : {}),
      originalStatus: selected.status,
      sourceRow: selected.sourceRow,
    });
  }
  return { references, skipped };
}

export async function parseHistoricalWorkbook(
  buffer: ArrayBuffer | Uint8Array,
): Promise<ParsedHistoricalWorkbook> {
  const workbook = new ExcelJS.Workbook();
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const excelBuffer = Uint8Array.from(bytes).buffer;
  await workbook.xlsx.load(excelBuffer as ExcelJS.Buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('Excel 檔案沒有工作表');
  }

  const headers = (worksheet.getRow(1).values as ExcelJS.CellValue[])
    .slice(1)
    .map(valueText);
  const missingHeaders = REQUIRED_1999_HEADERS.filter((header) => !headers.includes(header));
  if (missingHeaders.length) {
    throw new Error(`Excel 缺少必要欄位：${missingHeaders.join('、')}`);
  }
  const indexes = Object.fromEntries(
    headers.map((header, index) => [header, index + 1]),
  ) as Record<string, number>;
  const rows: HistoricalCaseRow[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }
    const get = (header: string) => normalizeNull(valueText(row.getCell(indexes[header]).value));
    const processingDaysText = get('處理天數');
    const processingDays = Number(processingDaysText);
    rows.push({
      caseNo: get('案件編號'),
      title: get('案由'),
      description: get('內容'),
      submittedAt: get('投書日期'),
      assignedAt: get('分案日期'),
      repliedAt: get('回覆日期'),
      ...(Number.isFinite(processingDays) ? { processingDays } : {}),
      status: get('案件狀態'),
      assigningUnit: get('交辦單位'),
      executingUnit: get('執行單位'),
      location: get('地點/地址'),
      caseType: get('案件類型'),
      sourceRow: rowNumber,
    });
  });
  const consolidated = consolidateHistoricalRows(rows);
  return {
    sheetName: worksheet.name,
    headers,
    rawRows: rows.length,
    uniqueCases: consolidated.references.length,
    duplicateWorkflowRows: Math.max(0, rows.length - new Set(rows.map((row) => row.caseNo)).size),
    references: consolidated.references,
    skipped: consolidated.skipped,
  };
}
