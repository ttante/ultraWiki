import type {
  HistoryMissingArtifact,
  PackRecord,
  SavedPackVersionArtifactCounts,
  SavedPackVersionHistory,
  SavedPackVersionItem,
  StudyPackHistoryItem
} from './types.js';

const artifactKeys: Array<keyof SavedPackVersionArtifactCounts> = [
  'summaries',
  'glossary',
  'flashcards',
  'quizQuestions',
  'graphNodes',
  'graphEdges',
  'timelineEvents'
];

const zeroArtifactCounts = (): SavedPackVersionArtifactCounts => ({
  summaries: 0,
  glossary: 0,
  flashcards: 0,
  quizQuestions: 0,
  graphNodes: 0,
  graphEdges: 0,
  timelineEvents: 0
});

export const normalizeVersionInput = (input: string): string => input.trim().replace(/\s+/g, ' ').toLowerCase();

export const artifactCountsForPack = (pack: Pick<
  PackRecord,
  'summaries' | 'glossary' | 'flashcards' | 'quizQuestions' | 'graphNodes' | 'graphEdges' | 'timelineEvents'
>): SavedPackVersionArtifactCounts => ({
  summaries: pack.summaries.length,
  glossary: pack.glossary.length,
  flashcards: pack.flashcards.length,
  quizQuestions: pack.quizQuestions.length,
  graphNodes: pack.graphNodes.length,
  graphEdges: pack.graphEdges.length,
  timelineEvents: pack.timelineEvents.length
});

export const buildSavedPackVersionItem = (
  item: StudyPackHistoryItem,
  artifactCounts: SavedPackVersionArtifactCounts,
  currentPackId: string,
  currentSourceRevisionId: string
): SavedPackVersionItem => ({
  ...item,
  current: item.id === currentPackId,
  sourceRevisionChanged: item.sourceRevisionId !== currentSourceRevisionId,
  artifactCounts
});

const versionTime = (item: StudyPackHistoryItem): number => Date.parse(item.savedAt ?? item.createdAt) || 0;

const compareByVersionTime = (a: StudyPackHistoryItem, b: StudyPackHistoryItem): number => {
  const timeDelta = versionTime(b) - versionTime(a);
  if (timeDelta !== 0) {
    return timeDelta;
  }
  return a.input.localeCompare(b.input) || a.id.localeCompare(b.id);
};

const artifactDeltas = (
  current: SavedPackVersionArtifactCounts,
  baseline?: SavedPackVersionArtifactCounts
): SavedPackVersionArtifactCounts => {
  if (!baseline) {
    return zeroArtifactCounts();
  }
  return artifactKeys.reduce<SavedPackVersionArtifactCounts>((acc, key) => {
    acc[key] = current[key] - baseline[key];
    return acc;
  }, zeroArtifactCounts());
};

const missingDiff = (current: HistoryMissingArtifact[], baseline: HistoryMissingArtifact[] | undefined) => {
  const baselineSet = new Set(baseline ?? []);
  const currentSet = new Set(current);
  return {
    added: current.filter((artifact) => !baselineSet.has(artifact)),
    removed: (baseline ?? []).filter((artifact) => !currentSet.has(artifact))
  };
};

export const buildSavedPackVersionHistory = (
  items: SavedPackVersionItem[],
  currentPackId: string,
  limit: number
): SavedPackVersionHistory | undefined => {
  const current = items.find((item) => item.id === currentPackId);
  if (!current) {
    return undefined;
  }
  const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 50));
  const sorted = [...items].sort(compareByVersionTime);
  const versions = [current, ...sorted.filter((item) => item.id !== currentPackId).slice(0, boundedLimit - 1)]
    .sort(compareByVersionTime);
  const baseline = versions.find((item) => item.id !== currentPackId);
  const missing = missingDiff(current.readiness.missingArtifacts, baseline?.readiness.missingArtifacts);

  return {
    current,
    versions,
    compare: {
      baselinePackId: baseline?.id,
      baselineSourceRevisionId: baseline?.sourceRevisionId,
      sourceRevisionChanged: baseline ? current.sourceRevisionId !== baseline.sourceRevisionId : false,
      readinessChanged: baseline ? current.readiness.status !== baseline.readiness.status : false,
      artifactDeltas: artifactDeltas(current.artifactCounts, baseline?.artifactCounts),
      missingArtifactsAdded: missing.added,
      missingArtifactsRemoved: missing.removed
    }
  };
};
