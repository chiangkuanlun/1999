import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AppData } from './models';

const now = new Date().toISOString();
const seedData: AppData = {
  organizations: [
    {
      id: 'org_taipei',
      code: 'TPE',
      name: '示範市政府',
      assignmentThreshold: 0.2,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ],
  departments: [
    {
      id: 'dept_public_works',
      organizationId: 'org_taipei',
      code: 'PWD',
      name: '工務局',
      category: '道路與公共設施',
      responsibilities: ['道路養護', '路燈維修', '人行道與坑洞'],
      keywords: ['道路', '坑洞', '路燈', '人行道', '柏油'],
      contact: '02-2720-8889 #555',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'dept_environment',
      organizationId: 'org_taipei',
      code: 'EPD',
      name: '環境保護局',
      category: '環境清潔與公害',
      responsibilities: ['垃圾清運', '噪音稽查', '空氣污染與異味'],
      keywords: ['垃圾', '噪音', '異味', '污染', '清運'],
      contact: '02-2720-8889 #333',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ],
  referenceCases: [
    {
      id: 'ref_road_1',
      organizationId: 'org_taipei',
      departmentId: 'dept_public_works',
      externalId: 'REF-001',
      title: '道路坑洞影響行車',
      description: '主要道路出現大型坑洞，請派員修補路面。',
      source: 'manual',
      createdAt: now,
    },
    {
      id: 'ref_env_1',
      organizationId: 'org_taipei',
      departmentId: 'dept_environment',
      externalId: 'REF-002',
      title: '深夜施工噪音',
      description: '工地深夜施工產生噪音，影響附近居民安寧。',
      source: 'manual',
      createdAt: now,
    },
  ],
  cases: [],
};

export class JsonStore {
  private readonly filePath: string;
  private data: AppData;

  constructor(filePath = process.env['CASE_ROUTING_DATA'] ?? join(process.cwd(), 'data', 'case-routing.json')) {
    this.filePath = filePath;
    this.data = this.load();
  }

  snapshot(): AppData {
    return structuredClone(this.data);
  }

  update(mutator: (data: AppData) => void): AppData {
    mutator(this.data);
    this.persist();
    return this.snapshot();
  }

  private load(): AppData {
    if (!existsSync(this.filePath)) {
      const initialData = structuredClone(seedData);
      this.persistData(initialData);
      return initialData;
    }
    return JSON.parse(readFileSync(this.filePath, 'utf8')) as AppData;
  }

  private persist(): void {
    this.persistData(this.data);
  }

  private persistData(data: AppData): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(data, null, 2), 'utf8');
    renameSync(temporaryPath, this.filePath);
  }
}

