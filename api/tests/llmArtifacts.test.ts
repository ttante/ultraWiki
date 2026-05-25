import { describe, expect, it } from 'vitest';
import { createLlmArtifactGenerator } from '../src/domain/llmArtifacts.js';
import type { LlmJsonClient } from '../src/domain/llmProvider.js';
import type { SourceSection } from '../src/domain/ingestion.js';

const sections: SourceSection[] = [
  {
    heading: 'Overview',
    content:
      'Alan Turing was a mathematician. In 1950, Alan Turing wrote about machine intelligence. Turing influenced computer science.'
  }
];

describe('llm artifact generator', () => {
  it('uses valid LLM JSON for summaries and stamps model metadata', async () => {
    const client: LlmJsonClient = {
      generateJson: async () => ({
        summaries: [
          { level: 'beginner', text: 'Beginner', citations: ['source:1'] },
          { level: 'intermediate', text: 'Intermediate', citations: ['source:1'] },
          { level: 'advanced', text: 'Advanced', citations: ['source:1'] }
        ]
      })
    };
    const generator = createLlmArtifactGenerator({ client, model: 'qwen-local' });
    const summaries = await generator.generateSummaries(sections, 'summary-by-level@1.0.0');
    expect(summaries.map((summary) => summary.model)).toEqual(['qwen-local', 'qwen-local', 'qwen-local']);
    expect(summaries[0]?.text).toBe('Beginner');
  });

  it('falls back to deterministic artifacts when LLM output is malformed', async () => {
    const client: LlmJsonClient = { generateJson: async () => ({ summaries: [] }) };
    const events: string[] = [];
    const generator = createLlmArtifactGenerator({
      client,
      model: 'qwen-local',
      onFallback: (event) => events.push(`${event.schemaName}:${event.reason}`)
    });
    const summaries = await generator.generateSummaries(sections, 'summary-by-level@1.0.0');
    expect(summaries).toHaveLength(3);
    expect(summaries[0]?.model).toBe('local-rule-based');
    expect(events).toEqual(['summaries:invalid_response']);
  });

  it('uses valid LLM active-recall and knowledge outputs', async () => {
    const client: LlmJsonClient = {
      generateJson: async ({ schemaName }) => {
        if (schemaName === 'active_recall') {
          return {
            flashcards: Array.from({ length: 15 }, (_, i) => ({
              question: `q${i}`,
              answer: `a${i}`,
              citation: `source:${i}`
            })),
            quizQuestions: Array.from({ length: 10 }, (_, i) => ({
              question: `quiz${i}`,
              options: ['a', 'b', 'c', 'd'],
              correctIndex: 0,
              misconceptions: ['right because cited', 'wrong distractor', 'wrong distractor', 'wrong distractor'],
              explanation: 'Because the source says so.',
              citation: `source:${i}`
            }))
          };
        }
        if (schemaName === 'glossary') {
          return {
            glossary: Array.from({ length: 8 }, (_, i) => ({
              term: `term${i}`,
              definition: `definition ${i}`,
              citation: `source:${i}`
            }))
          };
        }
        return {
          nodes: [{ id: 'alan-turing', label: 'Alan Turing', type: 'person', citation: 'source:1' }],
          edges: [{ source: 'alan-turing', target: 'computer-science', relation: 'related_to', citation: 'source:1' }],
          timeline: [{ year: 1950, dateLabel: '1950', description: 'Turing wrote about intelligence.', citation: 'source:1' }]
        };
      }
    };
    const generator = createLlmArtifactGenerator({ client, model: 'qwen-local' });
    const activeRecall = await generator.generateActiveRecall(sections, 'active-recall@1.0.0');
    const glossary = await generator.generateGlossary(sections, 'glossary@1.0.0');
    const knowledge = await generator.generateKnowledge(sections, 'knowledge-structure-rules@1.0.0');
    expect(activeRecall.flashcards[0]?.model).toBe('qwen-local');
    expect(activeRecall.quizQuestions[0]?.model).toBe('qwen-local');
    expect(activeRecall.quizQuestions[0]?.misconceptions).toHaveLength(4);
    expect(glossary.glossary[0]?.model).toBe('qwen-local');
    expect(knowledge.nodes[0]?.label).toBe('Alan Turing');
  });
});
