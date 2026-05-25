import { taxonomy } from './taxonomy.js';

export type ArtifactCacheKind = 'summaries' | 'active_recall' | 'knowledge_structure' | 'glossary';

export const cachePolicy = {
  sourceParserVersion: 'wikipedia-parser@1.0.0',
  taxonomyVersion: taxonomy.version,
  summaryPromptVersion: 'summary-by-level@1.0.0',
  activeRecallPromptVersion: 'active-recall@1.0.0',
  knowledgePromptVersion: 'knowledge-structure-rules@1.0.0',
  glossaryPromptVersion: 'glossary@1.0.0'
} as const;

const normalizeKeyPart = (value: string): string => value.trim().replace(/_/g, ' ').replace(/\s+/g, ' ').toLowerCase();

export const buildSourceCacheKey = (language: string, title: string): string =>
  `wikipedia:${language}:${normalizeKeyPart(title)}`;

export const buildArtifactCacheKey = (
  kind: ArtifactCacheKind,
  sourceRevisionId: string,
  promptVersion: string,
  taxonomyVersion: string
): string => `${kind}:${sourceRevisionId}:${promptVersion}:${taxonomyVersion}`;

export const expiresAtFromNow = (nowMs: number, ttlSeconds: number): string =>
  new Date(nowMs + Math.max(0, ttlSeconds) * 1000).toISOString();

export const isCacheFresh = (expiresAt: string, nowMs = Date.now()): boolean =>
  new Date(expiresAt).getTime() > nowMs;
