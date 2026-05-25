import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../src/config.js';
import type { ActiveRecallArtifacts } from '../src/domain/activeRecall.js';
import { runAsyncBenchmarkHarness } from '../src/domain/benchmarkHarness.js';
import type { SourceSection } from '../src/domain/ingestion.js';
import type { KnowledgeStructureArtifacts } from '../src/domain/knowledgeStructure.js';
import { createLlmArtifactGenerator } from '../src/domain/llmArtifacts.js';
import type { LlmFallbackEvent } from '../src/domain/llmProvider.js';
import { OpenAiCompatibleLlmClient } from '../src/domain/llmProvider.js';
import {
  evaluateRealModelEval,
  validateRealModelEvalThresholds,
  type RealModelEvalThresholds
} from '../src/domain/realModelEval.js';
import { computeGroundingStats, type SummaryArtifact } from '../src/domain/summary.js';

const sampleSections: SourceSection[] = [
  {
    heading: 'Sample',
    content:
      'In 1950 Alan Turing published Computing Machinery and Intelligence and proposed the imitation game. In 1956 John McCarthy organized the Dartmouth Conference, which helped establish artificial intelligence as a field. In 1969 ARPANET connected early research institutions and preceded modern Internet systems. These events shaped computer science, artificial intelligence, and networked computing.'
  }
];

const toInt = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const emptyRecall = (): ActiveRecallArtifacts => ({ flashcards: [], quizQuestions: [] });
const emptyKnowledge = (): KnowledgeStructureArtifacts => ({ nodes: [], edges: [], timeline: [] });

const run = async (): Promise<void> => {
  const config = getConfig();
  if (config.llmProvider !== 'openai_compatible') {
    console.error('FAIL real model eval requires LLM_PROVIDER=openai_compatible');
    process.exit(1);
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(scriptDir, '../..');
  const thresholds = JSON.parse(
    await readFile(path.resolve(root, 'infra/evaluation/real-model-eval.json'), 'utf8')
  ) as RealModelEvalThresholds;
  const thresholdErrors = validateRealModelEvalThresholds(thresholds);
  if (thresholdErrors.length > 0) {
    for (const error of thresholdErrors) {
      console.error(`FAIL ${error}`);
    }
    process.exit(1);
  }

  const fallbackEvents: LlmFallbackEvent[] = [];
  const client = new OpenAiCompatibleLlmClient({
    baseUrl: config.llmBaseUrl,
    model: config.llmModel,
    timeoutMs: config.llmTimeoutMs
  });
  const generator = createLlmArtifactGenerator({
    client,
    model: config.llmModel,
    onFallback: (event) => fallbackEvents.push(event)
  });

  let summaries: SummaryArtifact[] = [];
  let recall = emptyRecall();
  let knowledge = emptyKnowledge();
  const benchmark = await runAsyncBenchmarkHarness(
    {
      runtimeProfile: process.env.BENCH_RUNTIME_PROFILE ?? thresholds.runtime_profile,
      promptVersions: {
        summarization: 'summary-by-level@1.0.0',
        activeRecall: 'active-recall@1.0.0',
        knowledgeStructure: 'knowledge-structure-rules@1.0.0'
      },
      sections: sampleSections,
      iterations: toInt(process.env.BENCH_ITERATIONS, 1),
      memoryLimitMb: toInt(process.env.BENCH_MEMORY_LIMIT_MB, 12 * 1024),
      model: config.llmModel
    },
    {
      summarization: async () => {
        summaries = await generator.generateSummaries(sampleSections, 'summary-by-level@1.0.0');
      },
      activeRecall: async () => {
        recall = await generator.generateActiveRecall(sampleSections, 'active-recall@1.0.0');
      },
      knowledgeStructure: async () => {
        knowledge = await generator.generateKnowledge(sampleSections, 'knowledge-structure-rules@1.0.0');
      }
    }
  );

  const grounding = computeGroundingStats(summaries);
  const evaluation = evaluateRealModelEval({
    expectedModel: config.llmModel,
    benchmark,
    fallbackEvents,
    summaries,
    flashcards: recall.flashcards,
    quizQuestions: recall.quizQuestions,
    graphNodes: knowledge.nodes,
    graphEdges: knowledge.edges,
    timelineEvents: knowledge.timeline,
    citationRate: grounding.citationRate,
    thresholds
  });

  const reportPath = path.resolve(scriptDir, '../benchmarks/real-model-latest.json');
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        thresholds,
        benchmark,
        fallback_events: fallbackEvents,
        evaluation
      },
      null,
      2
    )
  );

  if (!evaluation.pass) {
    for (const failure of evaluation.failures) {
      console.error(`FAIL ${failure}`);
    }
    console.error(`Wrote real-model eval report: ${path.relative(root, reportPath)}`);
    process.exit(1);
  }

  console.log(`Real-model eval passed: model=${config.llmModel} report=${path.relative(root, reportPath)}`);
  console.log(JSON.stringify(evaluation.metrics, null, 2));
};

void run();
