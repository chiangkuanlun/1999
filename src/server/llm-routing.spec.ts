import { describe, expect, it } from 'vitest';
import { buildRoutingPrompt, createLlmUnavailableResult } from './llm-routing';
import { Department, ReferenceCase } from './models';
import { RoutingResult } from './routing';

const educationDepartment: Department = {
  id: 'education',
  organizationId: 'org',
  code: 'EDU',
  name: '教育處',
  category: '教學事務與身分法規',
  responsibilities: ['教師甄選', '教師介聘', '跨校調動', '校園安全'],
  keywords: ['教育', '學校'],
  contact: '',
  isActive: true,
  createdAt: '',
  updatedAt: '',
};

describe('LLM semantic routing', () => {
  it('puts complete responsibilities and synonym guidance in the prompt', () => {
    const prompt = buildRoutingPrompt(
      '教甄問題',
      '今年國小教師甄試題目很難，錄取名額又很少。',
      [educationDepartment],
      [] as ReferenceCase[],
    );

    expect(prompt).toContain('教甄');
    expect(prompt).toContain('教師甄選');
    expect(prompt).toContain('縮寫、同義詞、口語及上下文');
    expect(prompt).toContain('confidence 代表你對行政權責歸屬的信心');
  });

  it('never auto-assigns a local similarity fallback', () => {
    const localSuggestion: RoutingResult = {
      assigned: true,
      departmentId: 'education',
      category: '教育',
      confidence: 0.8,
      reason: 'local',
      candidates: [{
        departmentId: 'education',
        departmentName: '教育處',
        score: 0.8,
        referenceScore: 0.8,
        keywordScore: 0,
      }],
      engine: 'local_similarity',
    };

    const result = createLlmUnavailableResult(localSuggestion, 'not_configured');
    expect(result.assigned).toBe(false);
    expect(result.departmentId).toBeUndefined();
    expect(result.engine).toBe('local_suggestion');
    expect(result.reason).toContain('LLM 尚未設定');
  });
});
