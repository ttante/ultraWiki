import type { ActiveRecallArtifacts, Flashcard, QuizQuestion } from './activeRecall.js';
import { generateActiveRecallArtifacts } from './activeRecall.js';
import type { GlossaryArtifacts, GlossaryTerm } from './glossary.js';
import { generateGlossaryArtifacts } from './glossary.js';
import type { SourceSection } from './ingestion.js';
import type { GraphEdge, GraphNode, KnowledgeStructureArtifacts, TimelineEvent } from './knowledgeStructure.js';
import { generateKnowledgeStructureArtifacts } from './knowledgeStructure.js';
import { buildLlmJsonRequest } from './llmPrompts.js';
import type { LlmFallbackEvent, LlmGenerationEvent, LlmJsonClient } from './llmProvider.js';
import { generateJsonWithFallback } from './llmProvider.js';
import type { SummaryArtifact, SummaryLevel } from './summary.js';
import { generateGroundedSummaries } from './summary.js';

export type LlmArtifactGenerator = {
  generateSummaries(sections: SourceSection[], promptVersion: string): Promise<SummaryArtifact[]>;
  generateKnowledge(sections: SourceSection[], promptVersion: string): Promise<KnowledgeStructureArtifacts>;
  generateGlossary(sections: SourceSection[], promptVersion: string): Promise<GlossaryArtifacts>;
  generateActiveRecall(sections: SourceSection[], promptVersion: string): Promise<ActiveRecallArtifacts>;
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

const isSummaryLevel = (value: unknown): value is SummaryLevel =>
  value === 'beginner' || value === 'intermediate' || value === 'advanced';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const validateSummaries = (value: unknown, promptVersion: string, model: string): SummaryArtifact[] | null => {
  const record = asRecord(value);
  const summaries = record?.summaries;
  if (!Array.isArray(summaries)) {
    return null;
  }

  const out: SummaryArtifact[] = [];
  for (const entry of summaries) {
    const summary = asRecord(entry);
    if (!summary || !isSummaryLevel(summary.level) || typeof summary.text !== 'string' || !isStringArray(summary.citations)) {
      return null;
    }
    out.push({
      level: summary.level,
      text: summary.text,
      citations: summary.citations,
      promptVersion,
      model
    });
  }

  const levels = new Set(out.map((entry) => entry.level));
  return levels.has('beginner') && levels.has('intermediate') && levels.has('advanced') ? out : null;
};

const validateActiveRecall = (value: unknown, promptVersion: string, model: string): ActiveRecallArtifacts | null => {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.flashcards) || !Array.isArray(record.quizQuestions)) {
    return null;
  }

  const flashcards: Flashcard[] = [];
  for (const entry of record.flashcards) {
    const card = asRecord(entry);
    if (
      !card ||
      typeof card.question !== 'string' ||
      typeof card.answer !== 'string' ||
      typeof card.citation !== 'string'
    ) {
      return null;
    }
    flashcards.push({
      question: card.question,
      answer: card.answer,
      citation: card.citation,
      promptVersion,
      model
    });
  }

  const quizQuestions: QuizQuestion[] = [];
  for (const entry of record.quizQuestions) {
    const question = asRecord(entry);
    if (
      !question ||
      typeof question.question !== 'string' ||
      !isStringArray(question.options) ||
      question.options.length !== 4 ||
      !Number.isInteger(question.correctIndex) ||
      Number(question.correctIndex) < 0 ||
      Number(question.correctIndex) > 3 ||
      typeof question.explanation !== 'string' ||
      typeof question.citation !== 'string'
    ) {
      return null;
    }
    quizQuestions.push({
      question: question.question,
      options: question.options,
      correctIndex: Number(question.correctIndex),
      misconceptions: isStringArray(question.misconceptions)
        ? question.misconceptions
        : question.options.map((option, index) =>
            index === Number(question.correctIndex)
              ? 'This option is supported by the cited source.'
              : `This distractor is not the cited source-backed answer: ${option.slice(0, 120)}`
          ),
      explanation: question.explanation,
      citation: question.citation,
      promptVersion,
      model
    });
  }

  return flashcards.length >= 10 && quizQuestions.length >= 5 ? { flashcards, quizQuestions } : null;
};

const nodeTypes = new Set(['person', 'organization', 'event', 'concept', 'place', 'work']);
const relationTypes = new Set(['influenced', 'founded', 'member_of', 'occurred_in', 'related_to', 'precedes']);

const validateKnowledge = (value: unknown): KnowledgeStructureArtifacts | null => {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.nodes) || !Array.isArray(record.edges) || !Array.isArray(record.timeline)) {
    return null;
  }

  const nodes: GraphNode[] = [];
  for (const entry of record.nodes) {
    const node = asRecord(entry);
    if (
      !node ||
      typeof node.id !== 'string' ||
      typeof node.label !== 'string' ||
      typeof node.type !== 'string' ||
      !nodeTypes.has(node.type) ||
      typeof node.citation !== 'string'
    ) {
      return null;
    }
    nodes.push({ id: node.id, label: node.label, type: node.type as GraphNode['type'], citation: node.citation });
  }

  const edges: GraphEdge[] = [];
  for (const entry of record.edges) {
    const edge = asRecord(entry);
    if (
      !edge ||
      typeof edge.source !== 'string' ||
      typeof edge.target !== 'string' ||
      typeof edge.relation !== 'string' ||
      !relationTypes.has(edge.relation) ||
      typeof edge.citation !== 'string'
    ) {
      return null;
    }
    edges.push({
      source: edge.source,
      target: edge.target,
      relation: edge.relation as GraphEdge['relation'],
      citation: edge.citation
    });
  }

  const timeline: TimelineEvent[] = [];
  for (const entry of record.timeline) {
    const event = asRecord(entry);
    if (
      !event ||
      !Number.isInteger(event.year) ||
      typeof event.dateLabel !== 'string' ||
      typeof event.description !== 'string' ||
      typeof event.citation !== 'string'
    ) {
      return null;
    }
    timeline.push({
      year: Number(event.year),
      dateLabel: event.dateLabel,
      description: event.description,
      citation: event.citation
    });
  }

  return { nodes, edges, timeline };
};

const validateGlossary = (value: unknown, promptVersion: string, model: string): GlossaryArtifacts | null => {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.glossary)) {
    return null;
  }

  const glossary: GlossaryTerm[] = [];
  for (const entry of record.glossary) {
    const term = asRecord(entry);
    if (
      !term ||
      typeof term.term !== 'string' ||
      typeof term.definition !== 'string' ||
      typeof term.citation !== 'string'
    ) {
      return null;
    }
    glossary.push({
      term: term.term,
      definition: term.definition,
      citation: term.citation,
      promptVersion,
      model
    });
  }

  return glossary.length >= 5 ? { glossary } : null;
};

export const createLlmArtifactGenerator = ({
  client,
  model,
  onFallback,
  onEvent
}: {
  client?: LlmJsonClient;
  model: string;
  onFallback?: (event: LlmFallbackEvent) => void;
  onEvent?: (event: LlmGenerationEvent) => void;
}): LlmArtifactGenerator => ({
  generateSummaries: async (sections, promptVersion) =>
    generateJsonWithFallback({
      client,
      request: buildLlmJsonRequest('summaries', promptVersion, sections),
      validate: (value) => validateSummaries(value, promptVersion, model),
      fallback: () => generateGroundedSummaries(sections, promptVersion),
      onFallback,
      onEvent
    }),

  generateKnowledge: async (sections, promptVersion) =>
    generateJsonWithFallback({
      client,
      request: buildLlmJsonRequest('knowledge_structure', promptVersion, sections),
      validate: validateKnowledge,
      fallback: () => generateKnowledgeStructureArtifacts(sections),
      onFallback,
      onEvent
    }),

  generateGlossary: async (sections, promptVersion) =>
    generateJsonWithFallback({
      client,
      request: buildLlmJsonRequest('glossary', promptVersion, sections),
      validate: (value) => validateGlossary(value, promptVersion, model),
      fallback: () => generateGlossaryArtifacts(sections, promptVersion),
      onFallback,
      onEvent
    }),

  generateActiveRecall: async (sections, promptVersion) =>
    generateJsonWithFallback({
      client,
      request: buildLlmJsonRequest('active_recall', promptVersion, sections),
      validate: (value) => validateActiveRecall(value, promptVersion, model),
      fallback: () => generateActiveRecallArtifacts(sections, promptVersion),
      onFallback,
      onEvent
    })
});
