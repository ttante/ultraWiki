import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cachePolicy } from '../src/domain/cachePolicy.js';
import type { LlmPromptRegistryFile, LlmPromptStage } from '../src/domain/llmPrompts.js';

type RequiredPrompt = {
  ref: string;
  stage: LlmPromptStage;
  requiredTemplateTokens: string[];
};

const requiredPrompts: RequiredPrompt[] = [
  {
    ref: cachePolicy.summaryPromptVersion,
    stage: 'summaries',
    requiredTemplateTokens: ['{{source_sections}}', '"summaries"', '"citations"']
  },
  {
    ref: cachePolicy.activeRecallPromptVersion,
    stage: 'active_recall',
    requiredTemplateTokens: ['{{source_sections}}', '"flashcards"', '"quizQuestions"', '"correctIndex"', '"misconceptions"']
  },
  {
    ref: cachePolicy.knowledgePromptVersion,
    stage: 'knowledge_structure',
    requiredTemplateTokens: ['{{source_sections}}', '"nodes"', '"edges"', '"timeline"']
  },
  {
    ref: cachePolicy.glossaryPromptVersion,
    stage: 'glossary',
    requiredTemplateTokens: ['{{source_sections}}', '"glossary"', '"term"', '"definition"', '"citation"']
  }
];

const parsePromptRef = (ref: string): { id: string; version: string } => {
  const separator = ref.lastIndexOf('@');
  if (separator <= 0 || separator === ref.length - 1) {
    throw new Error(`invalid prompt ref ${ref}`);
  }
  return {
    id: ref.slice(0, separator),
    version: ref.slice(separator + 1)
  };
};

const validateRegistry = (registry: LlmPromptRegistryFile): string[] => {
  const errors: string[] = [];
  if (!registry.version) {
    errors.push('registry version is required');
  }
  if (!Array.isArray(registry.prompts)) {
    errors.push('registry prompts must be an array');
    return errors;
  }

  const seenRefs = new Set<string>();
  for (const prompt of registry.prompts) {
    const ref = `${prompt.id}@${prompt.version}`;
    if (seenRefs.has(ref)) {
      errors.push(`duplicate prompt ref ${ref}`);
    }
    seenRefs.add(ref);
    if (!['active', 'deprecated', 'draft'].includes(prompt.status)) {
      errors.push(`${ref} has invalid status ${prompt.status}`);
    }
    if (!prompt.template || prompt.template.trim().length < 20) {
      errors.push(`${ref} template must describe the prompt intent`);
    }
    if (!prompt.changelog || prompt.changelog.trim().length < 5) {
      errors.push(`${ref} changelog is required`);
    }
  }

  for (const required of requiredPrompts) {
    const { id, version } = parsePromptRef(required.ref);
    const prompt = registry.prompts.find((entry) => entry.id === id && entry.version === version);
    if (!prompt) {
      errors.push(`missing required runtime prompt ${required.ref}`);
      continue;
    }
    if (prompt.status !== 'active') {
      errors.push(`${required.ref} must be active for runtime use`);
    }
    if (!prompt.llm) {
      errors.push(`${required.ref} missing llm runtime template`);
      continue;
    }
    if (prompt.llm.schema_name !== required.stage) {
      errors.push(`${required.ref} schema_name=${prompt.llm.schema_name} expected ${required.stage}`);
    }
    if (!prompt.llm.system || prompt.llm.system.trim().length < 20) {
      errors.push(`${required.ref} llm.system must be explicit`);
    }
    if (!prompt.llm.user_template || prompt.llm.user_template.trim().length < 50) {
      errors.push(`${required.ref} llm.user_template must be explicit`);
    }
    for (const token of required.requiredTemplateTokens) {
      if (!prompt.llm.user_template.includes(token)) {
        errors.push(`${required.ref} llm.user_template missing ${token}`);
      }
    }
  }

  return errors;
};

const run = async (): Promise<void> => {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(scriptDir, '../..');
  const registryPath = path.resolve(root, 'infra/prompts/registry.json');
  const registry = JSON.parse(await readFile(registryPath, 'utf8')) as LlmPromptRegistryFile;
  const errors = validateRegistry(registry);

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`FAIL ${error}`);
    }
    process.exit(1);
  }

  console.log(`LLM prompt registry passed: version=${registry.version} runtime_prompts=${requiredPrompts.length}`);
};

void run();
