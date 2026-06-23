import { describe, expect, it } from 'vitest';
import { parseReferenceCsv } from './csv';

describe('reference CSV parser', () => {
  it('parses English headers and quoted commas', () => {
    const rows = parseReferenceCsv(
      'department_code,case_no,title,description\n' +
      'PWD,REF-1,"道路,坑洞","路面破損, 請修補"\n',
    );
    expect(rows).toEqual([{
      departmentCode: 'PWD',
      externalId: 'REF-1',
      title: '道路,坑洞',
      description: '路面破損, 請修補',
    }]);
  });

  it('accepts Chinese headers', () => {
    const rows = parseReferenceCsv(
      '局處代碼,案件編號,標題,案件內容\nEPD,2,噪音,深夜施工噪音\n',
    );
    expect(rows[0].departmentCode).toBe('EPD');
    expect(rows[0].title).toBe('噪音');
  });

  it('rejects missing required headers', () => {
    expect(() => parseReferenceCsv('title,description\n標題,內容\n'))
      .toThrow(/department_code/);
  });
});

