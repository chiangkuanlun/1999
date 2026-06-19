export interface CsvReferenceRow {
  departmentCode: string;
  externalId?: string;
  title: string;
  description: string;
}

function parseLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      values.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  if (quoted) {
    throw new Error('CSV 含有未結束的雙引號');
  }
  values.push(current.trim());
  return values;
}

export function parseReferenceCsv(csvText: string): CsvReferenceRow[] {
  const lines = csvText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    throw new Error('CSV 至少需要標題列與一筆資料');
  }

  const headers = parseLine(lines[0]).map((header) => header.toLowerCase());
  const aliases: Record<string, string[]> = {
    departmentCode: ['department_code', 'departmentcode', '局處代碼'],
    externalId: ['external_id', 'case_no', '案件編號'],
    title: ['title', '標題'],
    description: ['description', '內容', '案件內容'],
  };
  const columnIndex = Object.fromEntries(
    Object.entries(aliases).map(([field, options]) => [
      field,
      headers.findIndex((header) => options.includes(header)),
    ]),
  ) as Record<keyof CsvReferenceRow, number>;
  if (
    columnIndex.departmentCode < 0 ||
    columnIndex.title < 0 ||
    columnIndex.description < 0
  ) {
    throw new Error('CSV 必須包含 department_code、title、description 欄位');
  }

  return lines.slice(1).map((line, index) => {
    const values = parseLine(line);
    const row: CsvReferenceRow = {
      departmentCode: values[columnIndex.departmentCode]?.trim() ?? '',
      title: values[columnIndex.title]?.trim() ?? '',
      description: values[columnIndex.description]?.trim() ?? '',
      ...(columnIndex.externalId >= 0 && values[columnIndex.externalId]
        ? { externalId: values[columnIndex.externalId].trim() }
        : {}),
    };
    if (!row.departmentCode || !row.title || !row.description) {
      throw new Error(`CSV 第 ${index + 2} 列有必要欄位空白`);
    }
    return row;
  });
}

