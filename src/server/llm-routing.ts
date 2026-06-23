import { Department, ReferenceCase } from './models';
import { RoutingResult } from './routing';

export interface LlmCandidate {
  departmentId: string;
  confidence: number;
  reason: string;
  matchedReferenceId?: string;
}

export interface LlmClassification {
  departmentId: string;
  category: string;
  confidence: number;
  reason: string;
  matchedReferenceId?: string;
  candidates: LlmCandidate[];
}

export function buildRoutingPrompt(
  title: string,
  description: string,
  departments: Department[],
  references: ReferenceCase[],
): string {
  const departmentContext = departments.map((department) => ({
    id: department.id,
    name: department.name,
    category: department.category,
    responsibilities: department.responsibilities,
    keywords: department.keywords,
  }));
  const referenceContext = references.slice(-150).map((reference) => ({
    id: reference.id,
    departmentId: reference.departmentId,
    title: reference.title,
    description: reference.description,
    caseType: reference.caseType,
  }));
  return `你是台灣地方政府 1999 案件分派專員。請依案件真正的行政權責，以語意理解選出責任局處。

重要判定規則：
1. 必須理解縮寫、同義詞、口語及上下文，不可只做字面關鍵字比對。
2. 例如「教甄」等同「教師甄選」；「考題太難、錄取名額、初試」屬教師甄選業務。
3. 局處的「權責項目」是最重要依據，其次才是案件分類、關鍵字及歷史案例。
4. 不要因案件提到「學校」就籠統分類，必須辨認教師人事、校舍、午餐、體育等具體權責。
5. confidence 代表你對行政權責歸屬的信心，不是字詞重疊率。明確命中權責項目時通常應高於 0.75。
6. 請提供前五名候選局處；reason 必須指出案件語意與哪一項權責相符。
7. departmentId 只能使用下列局處清單中的 id。

案件標題：
${title}

案件內容：
${description}

責任局處與完整權責：
${JSON.stringify(departmentContext)}

歷史參考案例：
${JSON.stringify(referenceContext)}
`;
}

export function createLlmUnavailableResult(
  localSuggestion: RoutingResult,
  issue: 'not_configured' | 'request_failed',
): RoutingResult {
  const { departmentId: _departmentId, ...suggestionWithoutAssignment } = localSuggestion;
  void _departmentId;
  const explanation = issue === 'not_configured'
    ? 'LLM 尚未設定，因此未執行語意判定'
    : 'LLM 呼叫失敗，因此未完成語意判定';
  return {
    ...suggestionWithoutAssignment,
    assigned: false,
    engine: 'local_suggestion',
    llmIssue: issue,
    reason:
      `${explanation}。下列候選僅由本地文字相似度產生，不能作為自動分派依據；` +
      `最高候選為${localSuggestion.candidates[0]?.departmentName ?? '無'}，請人工覆核或啟用 LLM。`,
  };
}
