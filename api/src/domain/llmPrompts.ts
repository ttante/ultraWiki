import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { SourceSection } from './ingestion.js';
import type { LlmJsonRequest } from './llmProvider.js';

export type LlmPromptStage = 'summaries' | 'knowledge_structure' | 'glossary' | 'active_recall';
export type PromptStatus = 'active' | 'deprecated' | 'draft';

export type LlmPromptDefinition = {
  id: string;
  version: string;
  status: PromptStatus;
  template: string;
  changelog: string;
  llm?: {
    schema_name: LlmPromptStage;
    system: string;
    user_template: string;
  };
};

export type LlmPromptRegistryFile = {
  version: string;
  prompts: LlmPromptDefinition[];
};

const parsePromptRef = (promptRef: string): { id: string; version: string } => {
  const separator = promptRef.lastIndexOf('@');
  if (separator <= 0 || separator === promptRef.length - 1) {
    throw new Error(`invalid_prompt_ref:${promptRef}`);
  }
  return {
    id: promptRef.slice(0, separator),
    version: promptRef.slice(separator + 1)
  };
};

export const renderSourceSections = (sections: SourceSection[]): string =>
  sections
    .slice(0, 12)
    .map((section, index) => `Section ${index + 1}: ${section.heading}\n${section.content.slice(0, 3000)}`)
    .join('\n\n');

export const resolvePromptRegistryPath = (): string => {
  const configuredPath = process.env.PROMPT_REGISTRY_PATH;
  const candidates = configuredPath
    ? [path.resolve(configuredPath)]
    : [
        path.resolve(process.cwd(), '../infra/prompts/registry.json'),
        path.resolve(process.cwd(), 'infra/prompts/registry.json')
      ];

  const registryPath = candidates.find((candidate) => existsSync(candidate));
  if (!registryPath) {
    throw new Error(`prompt_registry_not_found:${candidates.join(',')}`);
  }
  return registryPath;
};

let cachedRegistry: LlmPromptRegistryFile | undefined;

export const loadLlmPromptRegistry = (registryPath?: string): LlmPromptRegistryFile => {
  if (!registryPath && cachedRegistry) {
    return cachedRegistry;
  }

  const resolvedPath = registryPath ?? resolvePromptRegistryPath();
  const parsed = JSON.parse(readFileSync(resolvedPath, 'utf8')) as LlmPromptRegistryFile;
  if (!parsed.version || !Array.isArray(parsed.prompts)) {
    throw new Error(`invalid_prompt_registry:${resolvedPath}`);
  }

  if (!registryPath) {
    cachedRegistry = parsed;
  }
  return parsed;
};

export const getLlmPrompt = (promptRef: string, registry = loadLlmPromptRegistry()): LlmPromptDefinition => {
  const { id, version } = parsePromptRef(promptRef);
  const prompt = registry.prompts.find((entry) => entry.id === id && entry.version === version);
  if (!prompt) {
    throw new Error(`llm_prompt_not_found:${promptRef}`);
  }
  if (!prompt.llm) {
    throw new Error(`llm_prompt_missing_runtime_template:${promptRef}`);
  }
  return prompt;
};

export const buildLlmJsonRequest = (
  stage: LlmPromptStage,
  promptRef: string,
  sections: SourceSection[],
  registry = loadLlmPromptRegistry()
): LlmJsonRequest => {
  const prompt = getLlmPrompt(promptRef, registry);
  if (!prompt.llm || prompt.llm.schema_name !== stage) {
    throw new Error(`llm_prompt_stage_mismatch:${promptRef}:${stage}`);
  }

  const sourceSections = renderSourceSections(sections);
  const userPrompt = prompt.llm.user_template.replace(/\{\{\s*source_sections\s*\}\}/g, sourceSections);

  return {
    schemaName: prompt.llm.schema_name,
    messages: [
      { role: 'system', content: prompt.llm.system },
      { role: 'user', content: userPrompt }
    ]
  };
};
