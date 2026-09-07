import type {
  SavedLibraryFacets,
  SavedLibraryList,
  SavedLibraryProgressFilter,
  SavedLibraryQueryOptions,
  SavedLibraryReadinessFilter,
  SavedPackOrganization,
  SavedLibrarySort,
  StudyPackHistoryItem
} from './types.js';

export type NormalizedSavedLibraryQuery = {
  limit: number;
  search?: string;
  readiness: SavedLibraryReadinessFilter;
  progress: SavedLibraryProgressFilter;
  sort: SavedLibrarySort;
  tag?: string;
  collection?: string;
};

const clampQueryLimit = (limit: number, fallback = 12, max = 50): number => {
  if (!Number.isFinite(limit)) {
    return fallback;
  }
  return Math.max(1, Math.min(Math.trunc(limit), max));
};

export const normalizeSavedLibraryQuery = (options: SavedLibraryQueryOptions): NormalizedSavedLibraryQuery => ({
  limit: clampQueryLimit(options.limit),
  search: options.search?.trim().slice(0, 120) || undefined,
  readiness: options.readiness ?? 'all',
  progress: options.progress ?? 'all',
  sort: options.sort ?? 'saved_desc',
  tag: normalizeTagName(options.tag),
  collection: normalizeCollectionName(options.collection)
});

const savedTime = (item: StudyPackHistoryItem): number => Date.parse(item.savedAt ?? item.createdAt) || 0;

export const normalizeTagName = (tag?: string): string | undefined => {
  const normalized = tag?.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 32);
  return normalized || undefined;
};

export const normalizeCollectionName = (collection?: string): string | undefined => {
  const normalized = collection?.trim().replace(/\s+/g, ' ').slice(0, 60);
  return normalized || undefined;
};

export const normalizeSavedPackOrganization = (organization: SavedPackOrganization): SavedPackOrganization => {
  const seen = new Set<string>();
  const tags = organization.tags
    .map((tag) => normalizeTagName(tag))
    .filter((tag): tag is string => Boolean(tag))
    .filter((tag) => {
      if (seen.has(tag)) {
        return false;
      }
      seen.add(tag);
      return true;
    })
    .slice(0, 12);
  return {
    tags,
    collection: normalizeCollectionName(organization.collection)
  };
};

const hasProgressMatch = (item: StudyPackHistoryItem, filter: SavedLibraryProgressFilter): boolean => {
  if (filter === 'all') {
    return true;
  }
  const progress = item.progress;
  if (filter === 'due') {
    return (progress?.dueCards ?? 0) > 0;
  }
  if (filter === 'reviewed') {
    return (progress?.reviewedCards ?? 0) > 0;
  }
  return (progress?.reviewedCards ?? 0) === 0;
};

const hasOrganizationMatch = (item: StudyPackHistoryItem, tag?: string, collection?: string): boolean => {
  const organization = item.organization;
  const tagMatches = !tag || (organization?.tags ?? []).includes(tag);
  const collectionMatches = !collection || organization?.collection === collection;
  return tagMatches && collectionMatches;
};

export const matchesSavedLibrarySearch = (item: StudyPackHistoryItem, search?: string): boolean => {
  if (!search) {
    return true;
  }
  const normalized = search.toLowerCase();
  return [item.input, item.id, item.sourceRevisionId, item.organization?.collection, ...(item.organization?.tags ?? [])]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(normalized));
};

const topTagFacetCounts = (counts: Map<string, number>): SavedLibraryFacets['tags'] =>
  Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag))
    .slice(0, 30);

const topCollectionFacetCounts = (counts: Map<string, number>): SavedLibraryFacets['collections'] =>
  Array.from(counts.entries())
    .map(([collection, count]) => ({ collection, count }))
    .sort((left, right) => right.count - left.count || left.collection.localeCompare(right.collection))
    .slice(0, 30);

export const buildSavedLibraryFacets = (items: StudyPackHistoryItem[]): SavedLibraryFacets => {
  const tagCounts = new Map<string, number>();
  const collectionCounts = new Map<string, number>();
  for (const item of items) {
    for (const tag of item.organization?.tags ?? []) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
    if (item.organization?.collection) {
      collectionCounts.set(item.organization.collection, (collectionCounts.get(item.organization.collection) ?? 0) + 1);
    }
  }

  return {
    total: items.length,
    readiness: {
      full: items.filter((item) => item.readiness.status === 'full').length,
      partial: items.filter((item) => item.readiness.status === 'partial').length
    },
    progress: {
      due: items.filter((item) => (item.progress?.dueCards ?? 0) > 0).length,
      reviewed: items.filter((item) => (item.progress?.reviewedCards ?? 0) > 0).length,
      notStarted: items.filter((item) => (item.progress?.reviewedCards ?? 0) === 0).length
    },
    tags: topTagFacetCounts(tagCounts),
    collections: topCollectionFacetCounts(collectionCounts)
  };
};

export const filterAndSortSavedLibrary = (
  items: StudyPackHistoryItem[],
  options: SavedLibraryQueryOptions
): SavedLibraryList => {
  const normalized = normalizeSavedLibraryQuery(options);
  const searchMatched = items.filter((item) => matchesSavedLibrarySearch(item, normalized.search));
  const facets = buildSavedLibraryFacets(searchMatched);
  const filtered = searchMatched.filter((item) => {
    const readinessMatches = normalized.readiness === 'all' || item.readiness.status === normalized.readiness;
    return readinessMatches && hasProgressMatch(item, normalized.progress) && hasOrganizationMatch(item, normalized.tag, normalized.collection);
  });
  const sorted = [...filtered].sort((left, right) => {
    switch (normalized.sort) {
      case 'saved_asc':
        return savedTime(left) - savedTime(right) || left.input.localeCompare(right.input);
      case 'title_asc':
        return left.input.localeCompare(right.input) || savedTime(right) - savedTime(left);
      case 'title_desc':
        return right.input.localeCompare(left.input) || savedTime(right) - savedTime(left);
      case 'due_desc':
        return (right.progress?.dueCards ?? 0) - (left.progress?.dueCards ?? 0) || savedTime(right) - savedTime(left);
      case 'mastery_desc':
        return (right.progress?.masteryScore ?? 0) - (left.progress?.masteryScore ?? 0) || savedTime(right) - savedTime(left);
      case 'saved_desc':
      default:
        return savedTime(right) - savedTime(left) || left.input.localeCompare(right.input);
    }
  });

  return {
    items: sorted.slice(0, normalized.limit),
    facets
  };
};
