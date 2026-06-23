import { describe, expect, it } from 'vitest';
import { Department, Organization, ReferenceCase } from './models';
import { jaccardSimilarity, routeCase, tokenize } from './routing';

const organization: Organization = {
  id: 'org',
  code: 'ORG',
  name: '測試機關',
  assignmentThreshold: 0.15,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const departments: Department[] = [
  {
    id: 'roads',
    organizationId: 'org',
    code: 'PWD',
    name: '工務局',
    category: '道路',
    responsibilities: ['道路養護', '路燈維修'],
    keywords: ['坑洞', '道路', '路燈'],
    contact: '',
    isActive: true,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'environment',
    organizationId: 'org',
    code: 'EPD',
    name: '環保局',
    category: '環境',
    responsibilities: ['噪音稽查', '垃圾清運'],
    keywords: ['噪音', '垃圾', '異味'],
    contact: '',
    isActive: true,
    createdAt: '',
    updatedAt: '',
  },
];

const references: ReferenceCase[] = [
  {
    id: 'ref-road',
    organizationId: 'org',
    departmentId: 'roads',
    title: '道路坑洞',
    description: '路面坑洞影響行車安全',
    source: 'manual',
    createdAt: '',
  },
];

describe('case routing', () => {
  it('tokenizes Chinese text with bigrams', () => {
    expect(tokenize('道路坑洞需要修補').has('坑洞')).toBe(true);
  });

  it('calculates a positive similarity for related cases', () => {
    expect(jaccardSimilarity('道路出現坑洞', '路面坑洞影響安全')).toBeGreaterThan(0);
  });

  it('routes a matching case to the responsible department', () => {
    const result = routeCase(
      organization,
      departments,
      references,
      '道路有大型坑洞',
      '路面破損已經影響行車安全',
    );
    expect(result.assigned).toBe(true);
    expect(result.departmentId).toBe('roads');
    expect(result.matchedReferenceId).toBe('ref-road');
    expect(result.confidence).toBeGreaterThanOrEqual(organization.assignmentThreshold);
  });

  it('keeps low-confidence cases for manual review', () => {
    const result = routeCase(
      { ...organization, assignmentThreshold: 0.95 },
      departments,
      references,
      '不明事項',
      '內容無法判斷',
    );
    expect(result.assigned).toBe(false);
    expect(result.departmentId).toBeUndefined();
  });
});

