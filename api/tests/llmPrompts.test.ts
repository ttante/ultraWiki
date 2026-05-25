import { describe, expect, it } from 'vitest';
import { buildLlmJsonRequest, getLlmPrompt, loadLlmPromptRegistry, renderSourceSections } from '../src/domain/llmPrompts.js';
import type { SourceSection } from '../src/domain/ingestion.js';

const sections: SourceSection[] = [
  { heading: 'Overview', content: 'Ada Lovelace wrote notes about the Analytical Engine in 1843.' },
  { heading: 'Influence', content: 'Her work later influenced ideas in computing.' }
];

describe('LLM prompt registry runtime templates', () => {
  it('loads active runtime prompts by versioned prompt ref', () => {
    const registry = loadLlmPromptRegistry();
    expect(getLlmPrompt('summary-by-level@1.0.0', registry).llm?.schema_name).toBe('summaries');
    expect(getLlmPrompt('active-recall@1.0.0', registry).llm?.schema_name).toBe('active_recall');
    expect(getLlmPrompt('knowledge-structure-rules@1.0.0', registry).llm?.schema_name).toBe('knowledge_structure');
    expect(getLlmPrompt('glossary@1.0.0', registry).llm?.schema_name).toBe('glossary');
  });

  it('renders bounded source sections into versioned LLM requests', () => {
    const request = buildLlmJsonRequest('summaries', 'summary-by-level@1.0.0', sections);

    expect(request.schemaName).toBe('summaries');
    expect(request.messages).toEqual([
      expect.objectContaining({ role: 'system', content: expect.stringContaining('Return only valid JSON') }),
      expect.objectContaining({ role: 'user', content: expect.stringContaining('Section 1: Overview') })
    ]);
    expect(request.messages[1]?.content).toContain('"summaries"');
    expect(request.messages[1]?.content).not.toContain('{{source_sections}}');

    const glossaryRequest = buildLlmJsonRequest('glossary', 'glossary@1.0.0', sections);
    expect(glossaryRequest.messages[1]?.content).toContain('"glossary"');
  });

  it('rejects using a prompt version for the wrong generation stage', () => {
    expect(() => buildLlmJsonRequest('active_recall', 'summary-by-level@1.0.0', sections)).toThrow(
      'llm_prompt_stage_mismatch:summary-by-level@1.0.0:active_recall'
    );
  });

  it('limits each prompt payload to the first twelve truncated source sections', () => {
    const manySections = Array.from({ length: 13 }, (_, index) => ({
      heading: `H${index + 1}`,
      content: 'x'.repeat(3500)
    }));

    const rendered = renderSourceSections(manySections);

    expect(rendered).toContain('Section 12: H12');
    expect(rendered).not.toContain('Section 13: H13');
    expect(rendered).not.toContain('x'.repeat(3001));
  });
});
