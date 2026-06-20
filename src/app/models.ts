export interface Organization {
  id: string;
  code: string;
  name: string;
  assignmentThreshold: number;
  isActive: boolean;
}

export interface Department {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  category: string;
  responsibilities: string[];
  keywords: string[];
  contact: string;
  isActive: boolean;
}

export interface ReferenceCase {
  id: string;
  organizationId: string;
  departmentId: string;
  externalId?: string;
  title: string;
  description: string;
  source: 'manual' | 'csv' | 'xlsx';
  caseType?: string;
  location?: string;
  submittedAt?: string;
  assignedAt?: string;
  repliedAt?: string;
  processingDays?: number;
  originalStatus?: string;
  sourceSheet?: string;
  createdAt: string;
}

export interface HistoricalWorkbookPreview {
  sheetName: string;
  headers: string[];
  rawRows: number;
  uniqueCases: number;
  duplicateWorkflowRows: number;
  skippedRows: number;
  departmentNames: string[];
  newDepartmentNames: string[];
  sample: {
    externalId: string;
    title: string;
    departmentName: string;
    caseType: string;
  }[];
}

export interface CandidateScore {
  departmentId: string;
  departmentName: string;
  score: number;
  referenceScore: number;
  keywordScore: number;
  matchedReferenceId?: string;
}

export interface CaseLog {
  timestamp: string;
  action: string;
  operator: string;
  details: string;
}

export interface MunicipalCase {
  id: string;
  organizationId: string;
  externalId?: string;
  title: string;
  description: string;
  citizenName?: string;
  citizenPhone?: string;
  location?: string;
  urgency: '一般' | '中度' | '緊急';
  category: string;
  departmentId?: string;
  status: '待處理' | '處理中' | '已結案';
  assignmentMode: 'auto' | 'manual_review' | 'manual';
  confidence: number;
  dispatchReason: string;
  matchedReferenceId?: string;
  candidates: CandidateScore[];
  feedback?: string;
  createdAt: string;
  dispatchedAt?: string;
  isManuallyRerouted: boolean;
  logs: CaseLog[];
}

export interface Stats {
  totalCases: number;
  statusCounts: {
    pending: number;
    processing: number;
    closed: number;
  };
  autoAssignmentRate: number;
  manualRerouteRate: number;
  apiMode: string;
}
