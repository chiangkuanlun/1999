import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import { GoogleGenAI, Type } from '@google/genai';
import { config as loadEnv } from 'dotenv';
import express, { NextFunction, Request, Response } from 'express';
import { join } from 'node:path';
import { parseReferenceCsv } from './server/csv';
import {
  buildRoutingPrompt,
  createLlmUnavailableResult,
  LlmClassification,
} from './server/llm-routing';
import {
  Department,
  MunicipalCase,
  Organization,
  ReferenceCase,
} from './server/models';
import { routeCase, RoutingResult } from './server/routing';
import { JsonStore } from './server/store';
import { parseHistoricalWorkbook } from './server/xlsx-import';

const browserDistFolder = join(import.meta.dirname, '../browser');
loadEnv({ path: join(process.cwd(), '.env.local') });
loadEnv();
const app = express();
const angularApp = new AngularNodeAppEngine();
const store = new JsonStore();
const geminiApiKey = process.env['GEMINI_API_KEY'];
const geminiModel = process.env['GEMINI_MODEL'] || 'gemini-3.5-flash';
const ai = geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : null;

app.use(express.json({ limit: '5mb' }));

function id(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberInRange(value: unknown, fallback: number): number {
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 && result <= 1 ? result : fallback;
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean);
  }
  return text(value).split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
}

function requireOrganization(organizationId: string): Organization {
  const organization = store.snapshot().organizations.find(
    (item) => item.id === organizationId,
  );
  if (!organization) {
    throw Object.assign(new Error('找不到使用機關'), { status: 404 });
  }
  return organization;
}

function requireDepartment(departmentId: string): Department {
  const department = store.snapshot().departments.find(
    (item) => item.id === departmentId,
  );
  if (!department) {
    throw Object.assign(new Error('找不到責任局處'), { status: 404 });
  }
  return department;
}

async function geminiRoute(
  organization: Organization,
  departments: Department[],
  references: ReferenceCase[],
  title: string,
  description: string,
): Promise<RoutingResult | null> {
  if (!ai) {
    return null;
  }
  try {
    const activeDepartments = departments.filter(
      (department) => department.organizationId === organization.id && department.isActive,
    );
    const response = await ai.models.generateContent({
      model: geminiModel,
      contents: buildRoutingPrompt(
        title,
        description,
        activeDepartments,
        references.filter((reference) => reference.organizationId === organization.id),
      ),
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            departmentId: { type: Type.STRING },
            category: { type: Type.STRING },
            confidence: { type: Type.NUMBER },
            reason: { type: Type.STRING },
            matchedReferenceId: { type: Type.STRING },
            candidates: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  departmentId: { type: Type.STRING },
                  confidence: { type: Type.NUMBER },
                  reason: { type: Type.STRING },
                  matchedReferenceId: { type: Type.STRING },
                },
                required: ['departmentId', 'confidence', 'reason'],
              },
            },
          },
          required: ['departmentId', 'category', 'confidence', 'reason', 'candidates'],
        },
      },
    });
    const parsed = JSON.parse(response.text ?? '{}') as Partial<LlmClassification>;
    const selectedDepartment = activeDepartments.find(
      (department) => department.id === parsed.departmentId,
    );
    if (!selectedDepartment) {
      return null;
    }
    const confidence = numberInRange(parsed.confidence, 0);
    const assigned = confidence >= organization.assignmentThreshold;
    const parsedCandidates = Array.isArray(parsed.candidates)
      ? parsed.candidates
        .map((candidate) => {
          const department = activeDepartments.find(
            (item) => item.id === candidate.departmentId,
          );
          if (!department) {
            return null;
          }
          return {
            departmentId: department.id,
            departmentName: department.name,
            score: numberInRange(candidate.confidence, 0),
            referenceScore: 0,
            keywordScore: 0,
            ...(candidate.matchedReferenceId
              ? { matchedReferenceId: candidate.matchedReferenceId }
              : {}),
          };
        })
        .filter((candidate) => candidate !== null)
        .slice(0, 5)
      : [];
    return {
      assigned,
      ...(assigned ? { departmentId: selectedDepartment.id } : {}),
      category: parsed.category || selectedDepartment.category,
      confidence,
      reason:
        `Gemini 分析：${parsed.reason || '依局處權責判定'}；` +
        (assigned
          ? `達到機關門檻 ${Math.round(organization.assignmentThreshold * 100)}%。`
          : `未達機關門檻 ${Math.round(organization.assignmentThreshold * 100)}%，需人工覆核。`),
      ...(parsed.matchedReferenceId
        ? { matchedReferenceId: parsed.matchedReferenceId }
        : {}),
      candidates: parsedCandidates.length ? parsedCandidates : [{
          departmentId: selectedDepartment.id,
          departmentName: selectedDepartment.name,
          score: confidence,
          referenceScore: 0,
          keywordScore: 0,
          ...(parsed.matchedReferenceId
            ? { matchedReferenceId: parsed.matchedReferenceId }
            : {}),
        }],
      engine: 'gemini',
    };
  } catch (error) {
    console.warn('Gemini 分派失敗，改用本地案例比對：', error);
    return null;
  }
}

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    aiMode: ai ? `Gemini LLM（${geminiModel}）` : 'LLM 未設定',
    llmConfigured: Boolean(ai),
    llmModel: geminiModel,
  });
});

app.get('/api/organizations', (_req, res) => {
  res.json(store.snapshot().organizations);
});

app.post('/api/organizations', (req, res) => {
  const code = text(req.body.code);
  const name = text(req.body.name);
  if (!code || !name) {
    res.status(400).json({ error: '機關代碼與名稱為必填' });
    return;
  }
  const current = store.snapshot();
  if (current.organizations.some((item) => item.code.toLowerCase() === code.toLowerCase())) {
    res.status(409).json({ error: '機關代碼已存在' });
    return;
  }
  const timestamp = new Date().toISOString();
  const organization: Organization = {
    id: id('org'),
    code,
    name,
    assignmentThreshold: numberInRange(req.body.assignmentThreshold, 0.25),
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  store.update((data) => data.organizations.push(organization));
  res.status(201).json(organization);
});

app.put('/api/organizations/:id', (req, res) => {
  const organization = requireOrganization(req.params['id']);
  store.update((data) => {
    const target = data.organizations.find((item) => item.id === organization.id)!;
    target.code = text(req.body.code) || target.code;
    target.name = text(req.body.name) || target.name;
    target.assignmentThreshold = numberInRange(
      req.body.assignmentThreshold,
      target.assignmentThreshold,
    );
    if (typeof req.body.isActive === 'boolean') {
      target.isActive = req.body.isActive;
    }
    target.updatedAt = new Date().toISOString();
  });
  res.json(store.snapshot().organizations.find((item) => item.id === organization.id));
});

app.get('/api/departments', (req, res) => {
  const organizationId = text(req.query['organizationId']);
  const departments = store.snapshot().departments.filter(
    (department) => !organizationId || department.organizationId === organizationId,
  );
  res.json(departments);
});

app.post('/api/departments', (req, res) => {
  const organizationId = text(req.body.organizationId);
  const code = text(req.body.code);
  const name = text(req.body.name);
  requireOrganization(organizationId);
  if (!code || !name) {
    res.status(400).json({ error: '局處代碼與名稱為必填' });
    return;
  }
  const current = store.snapshot();
  if (current.departments.some(
    (item) =>
      item.organizationId === organizationId &&
      item.code.toLowerCase() === code.toLowerCase(),
  )) {
    res.status(409).json({ error: '此機關已有相同局處代碼' });
    return;
  }
  const timestamp = new Date().toISOString();
  const department: Department = {
    id: id('dept'),
    organizationId,
    code,
    name,
    category: text(req.body.category) || '一般陳情',
    responsibilities: list(req.body.responsibilities),
    keywords: list(req.body.keywords),
    contact: text(req.body.contact),
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  store.update((data) => data.departments.push(department));
  res.status(201).json(department);
});

app.put('/api/departments/:id', (req, res) => {
  const department = requireDepartment(req.params['id']);
  store.update((data) => {
    const target = data.departments.find((item) => item.id === department.id)!;
    target.code = text(req.body.code) || target.code;
    target.name = text(req.body.name) || target.name;
    target.category = text(req.body.category) || target.category;
    if (req.body.responsibilities !== undefined) {
      target.responsibilities = list(req.body.responsibilities);
    }
    if (req.body.keywords !== undefined) {
      target.keywords = list(req.body.keywords);
    }
    target.contact = req.body.contact !== undefined ? text(req.body.contact) : target.contact;
    if (typeof req.body.isActive === 'boolean') {
      target.isActive = req.body.isActive;
    }
    target.updatedAt = new Date().toISOString();
  });
  res.json(store.snapshot().departments.find((item) => item.id === department.id));
});

app.delete('/api/departments/:id', (req, res) => {
  const department = requireDepartment(req.params['id']);
  store.update((data) => {
    const target = data.departments.find((item) => item.id === department.id)!;
    target.isActive = false;
    target.updatedAt = new Date().toISOString();
  });
  res.json({ success: true });
});

app.get('/api/reference-cases', (req, res) => {
  const organizationId = text(req.query['organizationId']);
  const references = store.snapshot().referenceCases.filter(
    (reference) => !organizationId || reference.organizationId === organizationId,
  );
  const requestedLimit = Number(req.query['limit']);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), 1000)
    : references.length;
  res.setHeader('X-Total-Count', String(references.length));
  res.json(references.slice(-limit).reverse());
});

app.post('/api/reference-cases', (req, res) => {
  const organizationId = text(req.body.organizationId);
  const departmentId = text(req.body.departmentId);
  const title = text(req.body.title);
  const description = text(req.body.description);
  requireOrganization(organizationId);
  const department = requireDepartment(departmentId);
  if (department.organizationId !== organizationId) {
    res.status(400).json({ error: '責任局處不屬於指定機關' });
    return;
  }
  if (!title || !description) {
    res.status(400).json({ error: '案例標題與內容為必填' });
    return;
  }
  const reference: ReferenceCase = {
    id: id('ref'),
    organizationId,
    departmentId,
    ...(text(req.body.externalId) ? { externalId: text(req.body.externalId) } : {}),
    title,
    description,
    source: 'manual',
    createdAt: new Date().toISOString(),
  };
  store.update((data) => data.referenceCases.push(reference));
  res.status(201).json(reference);
});

app.post('/api/reference-cases/import', (req, res) => {
  const organizationId = text(req.body.organizationId);
  requireOrganization(organizationId);
  const rows = parseReferenceCsv(text(req.body.csvText));
  const snapshot = store.snapshot();
  const errors: { row: number; message: string }[] = [];
  const references: ReferenceCase[] = [];
  rows.forEach((row, index) => {
    const department = snapshot.departments.find(
      (item) =>
        item.organizationId === organizationId &&
        item.code.toLowerCase() === row.departmentCode.toLowerCase() &&
        item.isActive,
    );
    if (!department) {
      errors.push({ row: index + 2, message: `找不到啟用中的局處代碼 ${row.departmentCode}` });
      return;
    }
    references.push({
      id: id('ref'),
      organizationId,
      departmentId: department.id,
      ...(row.externalId ? { externalId: row.externalId } : {}),
      title: row.title,
      description: row.description,
      source: 'csv',
      createdAt: new Date().toISOString(),
    });
  });
  store.update((data) => data.referenceCases.push(...references));
  res.status(201).json({ imported: references.length, errors });
});

const excelUpload = express.raw({
  type: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream',
  ],
  limit: '20mb',
});

app.post('/api/reference-cases/xlsx/preview', excelUpload, async (req, res) => {
  const organizationId = text(req.query['organizationId']);
  requireOrganization(organizationId);
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    res.status(400).json({ error: '請選擇有效的 .xlsx 檔案' });
    return;
  }
  const parsed = await parseHistoricalWorkbook(req.body);
  const existingDepartments = store.snapshot().departments
    .filter((department) => department.organizationId === organizationId)
    .map((department) => department.name);
  const departmentNames = [...new Set(parsed.references.map((item) => item.departmentName))];
  res.json({
    sheetName: parsed.sheetName,
    headers: parsed.headers,
    rawRows: parsed.rawRows,
    uniqueCases: parsed.uniqueCases,
    duplicateWorkflowRows: parsed.duplicateWorkflowRows,
    skippedRows: parsed.skipped.length,
    departmentNames,
    newDepartmentNames: departmentNames.filter((name) => !existingDepartments.includes(name)),
    sample: parsed.references.slice(0, 5),
  });
});

app.post('/api/reference-cases/xlsx/import', excelUpload, async (req, res) => {
  const organizationId = text(req.query['organizationId']);
  requireOrganization(organizationId);
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    res.status(400).json({ error: '請選擇有效的 .xlsx 檔案' });
    return;
  }
  const parsed = await parseHistoricalWorkbook(req.body);
  const timestamp = new Date().toISOString();
  const snapshot = store.snapshot();
  const existingExternalIds = new Set(snapshot.referenceCases
    .filter((reference) => reference.organizationId === organizationId)
    .map((reference) => reference.externalId)
    .filter(Boolean));
  const departmentByName = new Map(snapshot.departments
    .filter((department) => department.organizationId === organizationId)
    .map((department) => [department.name, department]));
  const createdDepartments: Department[] = [];
  const references: ReferenceCase[] = [];
  let duplicateCases = 0;

  for (const item of parsed.references) {
    if (existingExternalIds.has(item.externalId)) {
      duplicateCases += 1;
      continue;
    }
    let department = departmentByName.get(item.departmentName);
    if (!department) {
      const sequence = snapshot.departments.length + createdDepartments.length + 1;
      department = {
        id: id('dept'),
        organizationId,
        code: `XLSX${String(sequence).padStart(3, '0')}`,
        name: item.departmentName,
        category: item.caseType || '歷史案例匯入',
        responsibilities: [item.caseType || '歷史案例'],
        keywords: item.caseType
          .split(/[、，,（）()\s]+/)
          .map((keyword) => keyword.trim())
          .filter(Boolean),
        contact: '',
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      createdDepartments.push(department);
      departmentByName.set(department.name, department);
    } else {
      if (item.caseType && !department.responsibilities.includes(item.caseType)) {
        department.responsibilities.push(item.caseType);
      }
    }
    references.push({
      id: id('ref'),
      organizationId,
      departmentId: department.id,
      externalId: item.externalId,
      title: item.title,
      description: item.description,
      source: 'xlsx',
      caseType: item.caseType,
      ...(item.location ? { location: item.location } : {}),
      ...(item.submittedAt ? { submittedAt: item.submittedAt } : {}),
      ...(item.assignedAt ? { assignedAt: item.assignedAt } : {}),
      ...(item.repliedAt ? { repliedAt: item.repliedAt } : {}),
      ...(item.processingDays !== undefined
        ? { processingDays: item.processingDays }
        : {}),
      originalStatus: item.originalStatus,
      sourceSheet: parsed.sheetName,
      createdAt: timestamp,
    });
    existingExternalIds.add(item.externalId);
  }

  store.update((data) => {
    data.departments.push(...createdDepartments);
    for (const department of departmentByName.values()) {
      const target = data.departments.find((item) => item.id === department.id);
      if (target && !createdDepartments.some((created) => created.id === target.id)) {
        target.responsibilities = [...new Set(department.responsibilities)];
        target.updatedAt = timestamp;
      }
    }
    data.referenceCases.push(...references);
  });
  res.status(201).json({
    imported: references.length,
    duplicateCases,
    skippedRows: parsed.skipped.length,
    rawRows: parsed.rawRows,
    duplicateWorkflowRows: parsed.duplicateWorkflowRows,
    createdDepartments: createdDepartments.map((department) => department.name),
  });
});

app.get('/api/cases', (req, res) => {
  const organizationId = text(req.query['organizationId']);
  res.json(store.snapshot().cases
    .filter((caseItem) => !organizationId || caseItem.organizationId === organizationId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt)));
});

app.post('/api/cases', async (req, res) => {
  const organizationId = text(req.body.organizationId);
  const title = text(req.body.title);
  const description = text(req.body.description);
  const organization = requireOrganization(organizationId);
  if (!title || !description) {
    res.status(400).json({ error: '案件標題與內容為必填' });
    return;
  }
  const snapshot = store.snapshot();
  const localSuggestion = routeCase(
    organization,
    snapshot.departments,
    snapshot.referenceCases,
    title,
    description,
  );
  const llmRouting = await geminiRoute(
      organization,
      snapshot.departments,
      snapshot.referenceCases,
      title,
      description,
    );
  const routing = llmRouting ?? createLlmUnavailableResult(
    localSuggestion,
    ai ? 'request_failed' : 'not_configured',
  );
  const timestamp = new Date().toISOString();
  const caseItem: MunicipalCase = {
    id: id('case'),
    organizationId,
    ...(text(req.body.externalId) ? { externalId: text(req.body.externalId) } : {}),
    title,
    description,
    ...(text(req.body.citizenName) ? { citizenName: text(req.body.citizenName) } : {}),
    ...(text(req.body.citizenPhone) ? { citizenPhone: text(req.body.citizenPhone) } : {}),
    ...(text(req.body.location) ? { location: text(req.body.location) } : {}),
    urgency: ['一般', '中度', '緊急'].includes(text(req.body.urgency))
      ? text(req.body.urgency) as MunicipalCase['urgency']
      : '一般',
    category: routing.category,
    ...(routing.departmentId ? { departmentId: routing.departmentId } : {}),
    status: '待處理',
    assignmentMode: routing.assigned ? 'auto' : 'manual_review',
    routingEngine: routing.engine,
    ...(routing.llmIssue ? { llmIssue: routing.llmIssue } : {}),
    confidence: routing.confidence,
    dispatchReason: routing.reason,
    ...(routing.matchedReferenceId
      ? { matchedReferenceId: routing.matchedReferenceId }
      : {}),
    candidates: routing.candidates,
    createdAt: timestamp,
    ...(routing.assigned ? { dispatchedAt: timestamp } : {}),
    isManuallyRerouted: false,
    logs: [{
      timestamp,
      action: '案件建立',
      operator: text(req.body.citizenName) || '系統使用者',
      details: routing.reason,
    }],
  };
  store.update((data) => data.cases.push(caseItem));
  res.status(201).json(caseItem);
});

app.post('/api/cases/:id/dispatch', (req, res) => {
  const departmentId = text(req.body.departmentId);
  const reason = text(req.body.reason);
  const snapshot = store.snapshot();
  const caseItem = snapshot.cases.find((item) => item.id === req.params['id']);
  if (!caseItem) {
    res.status(404).json({ error: '找不到案件' });
    return;
  }
  const department = requireDepartment(departmentId);
  if (department.organizationId !== caseItem.organizationId || !department.isActive) {
    res.status(400).json({ error: '局處不屬於案件機關或目前未啟用' });
    return;
  }
  if (!reason) {
    res.status(400).json({ error: '人工改派理由為必填' });
    return;
  }
  store.update((data) => {
    const target = data.cases.find((item) => item.id === caseItem.id)!;
    target.departmentId = department.id;
    target.category = department.category;
    target.assignmentMode = 'manual';
    target.isManuallyRerouted = true;
    target.dispatchedAt = new Date().toISOString();
    target.dispatchReason = `人工改派至${department.name}：${reason}`;
    target.logs.push({
      timestamp: new Date().toISOString(),
      action: '人工改派',
      operator: text(req.body.operator) || '管理者',
      details: target.dispatchReason,
    });
  });
  res.json(store.snapshot().cases.find((item) => item.id === caseItem.id));
});

app.post('/api/cases/:id/status', (req, res) => {
  const status = text(req.body.status) as MunicipalCase['status'];
  if (!['待處理', '處理中', '已結案'].includes(status)) {
    res.status(400).json({ error: '案件狀態無效' });
    return;
  }
  const existing = store.snapshot().cases.find((item) => item.id === req.params['id']);
  if (!existing) {
    res.status(404).json({ error: '找不到案件' });
    return;
  }
  store.update((data) => {
    const target = data.cases.find((item) => item.id === existing.id)!;
    target.status = status;
    target.feedback = text(req.body.feedback);
    target.logs.push({
      timestamp: new Date().toISOString(),
      action: '狀態更新',
      operator: text(req.body.operator) || '承辦人員',
      details: `狀態更新為${status}${target.feedback ? `：${target.feedback}` : ''}`,
    });
  });
  res.json(store.snapshot().cases.find((item) => item.id === existing.id));
});

app.get('/api/stats', (req, res) => {
  const organizationId = text(req.query['organizationId']);
  const cases = store.snapshot().cases.filter(
    (caseItem) => !organizationId || caseItem.organizationId === organizationId,
  );
  const autoAssigned = cases.filter((caseItem) => caseItem.assignmentMode === 'auto').length;
  const manuallyRerouted = cases.filter((caseItem) => caseItem.isManuallyRerouted).length;
  res.json({
    totalCases: cases.length,
    statusCounts: {
      pending: cases.filter((caseItem) => caseItem.status === '待處理').length,
      processing: cases.filter((caseItem) => caseItem.status === '處理中').length,
      closed: cases.filter((caseItem) => caseItem.status === '已結案').length,
    },
    autoAssignmentRate: cases.length ? Math.round(autoAssigned / cases.length * 1000) / 10 : 0,
    manualRerouteRate: cases.length ? Math.round(manuallyRerouted / cases.length * 1000) / 10 : 0,
    apiMode: ai ? `Gemini LLM（${geminiModel}）` : 'LLM 未設定',
    llmConfigured: Boolean(ai),
    llmModel: geminiModel,
  });
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API 路徑不存在' });
});

app.use((error: Error & { status?: number }, _req: Request, res: Response, next: NextFunction) => {
  void next;
  console.error(error);
  res.status(error.status ?? 500).json({
    error: error.status ? error.message : '伺服器發生未預期錯誤',
  });
});

app.use(express.static(browserDistFolder, {
  maxAge: '1y',
  index: false,
  redirect: false,
}));

app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

export const reqHandler = createNodeRequestHandler(app);
