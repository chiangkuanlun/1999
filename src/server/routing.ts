import {
  CandidateScore,
  Department,
  Organization,
  ReferenceCase,
} from './models';

export interface RoutingResult {
  assigned: boolean;
  departmentId?: string;
  category: string;
  confidence: number;
  reason: string;
  matchedReferenceId?: string;
  candidates: CandidateScore[];
  engine: 'gemini' | 'local_similarity' | 'local_suggestion';
  llmIssue?: 'not_configured' | 'request_failed';
}

export function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function tokenize(value: string): Set<string> {
  const normalized = normalizeText(value);
  const tokens = new Set<string>(normalized.match(/[a-z0-9]+/g) ?? []);
  for (const block of normalized.match(/[\u3400-\u9fff]+/g) ?? []) {
    tokens.add(block);
    for (let index = 0; index < block.length - 1; index += 1) {
      tokens.add(block.slice(index, index + 2));
    }
  }
  return tokens;
}

export function jaccardSimilarity(left: string, right: string): number {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / union;
}

function keywordCoverage(content: string, keywords: string[]): number {
  const normalized = normalizeText(content);
  const validKeywords = keywords
    .map((keyword) => normalizeText(keyword))
    .filter(Boolean);
  if (!validKeywords.length) {
    return 0;
  }
  const matched = validKeywords.filter((keyword) => normalized.includes(keyword)).length;
  return matched / validKeywords.length;
}

export function routeCase(
  organization: Organization,
  departments: Department[],
  references: ReferenceCase[],
  title: string,
  description: string,
): RoutingResult {
  const content = `${title} ${description}`;
  const activeDepartments = departments.filter(
    (department) =>
      department.organizationId === organization.id && department.isActive,
  );

  const candidates = activeDepartments.map<CandidateScore>((department) => {
    const departmentReferences = references.filter(
      (reference) =>
        reference.organizationId === organization.id &&
        reference.departmentId === department.id,
    );
    let referenceScore = 0;
    let matchedReferenceId: string | undefined;
    for (const reference of departmentReferences) {
      const score = jaccardSimilarity(
        content,
        `${reference.title} ${reference.description}`,
      );
      if (score > referenceScore) {
        referenceScore = score;
        matchedReferenceId = reference.id;
      }
    }
    const keywordScore = keywordCoverage(content, [
      ...department.keywords,
      ...department.responsibilities,
    ]);
    const score = Math.min(1, referenceScore * 0.8 + keywordScore * 0.2);
    return {
      departmentId: department.id,
      departmentName: department.name,
      score: Number(score.toFixed(4)),
      referenceScore: Number(referenceScore.toFixed(4)),
      keywordScore: Number(keywordScore.toFixed(4)),
      ...(matchedReferenceId ? { matchedReferenceId } : {}),
    };
  }).sort((left, right) => right.score - left.score);

  const best = candidates[0];
  const assigned = Boolean(best && best.score >= organization.assignmentThreshold);
  if (!best) {
    return {
      assigned: false,
      category: '尚未分類',
      confidence: 0,
      reason: '此機關尚無啟用中的責任局處，需由管理者人工處理。',
      candidates: [],
      engine: 'local_similarity',
    };
  }

  const department = activeDepartments.find((item) => item.id === best.departmentId)!;
  const reason =
    `參考案例相似度 ${Math.round(best.referenceScore * 100)}%，` +
    `權責關鍵字命中 ${Math.round(best.keywordScore * 100)}%，` +
    `綜合信心 ${Math.round(best.score * 100)}%；` +
    (assigned
      ? `達到機關門檻 ${Math.round(organization.assignmentThreshold * 100)}%，自動分派至${department.name}。`
      : `未達機關門檻 ${Math.round(organization.assignmentThreshold * 100)}%，保留人工覆核。`);

  return {
    assigned,
    ...(assigned ? { departmentId: department.id } : {}),
    category: department.category,
    confidence: best.score,
    reason,
    ...(best.matchedReferenceId
      ? { matchedReferenceId: best.matchedReferenceId }
      : {}),
    candidates: candidates.slice(0, 5),
    engine: 'local_similarity',
  };
}
