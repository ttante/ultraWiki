import { createHash } from 'node:crypto';

export const requiredGoldenSetDomains = [
  'biography',
  'history',
  'science',
  'technology',
  'culture',
  'abstract_concept'
] as const;

export type GoldenSetDomain = (typeof requiredGoldenSetDomains)[number];

export type GoldenSetTopic = {
  id: string;
  domain: GoldenSetDomain;
  title: string;
  canonical_url: string;
  source_revision_id: string;
  sections: { heading: string; content: string }[];
  thresholds: {
    min_nodes: number;
    min_edges: number;
    min_timeline: number;
    min_citation_rate: number;
  };
};

export type GoldenSetDataset = {
  version: string;
  checksum_sha256: string;
  topics: GoldenSetTopic[];
};

const stable = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stable(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

export const computeGoldenSetChecksum = (dataset: Omit<GoldenSetDataset, 'checksum_sha256'>): string => {
  const canonical = stable({ version: dataset.version, topics: dataset.topics });
  return createHash('sha256').update(canonical).digest('hex');
};

export const validateGoldenSetDataset = (dataset: GoldenSetDataset): string[] => {
  const errors: string[] = [];
  if (!dataset.version || dataset.version.trim().length === 0) {
    errors.push('dataset version is required');
  }

  if (!Array.isArray(dataset.topics) || dataset.topics.length === 0) {
    errors.push('dataset topics must be a non-empty array');
    return errors;
  }

  const required = new Set(requiredGoldenSetDomains);
  const seenIds = new Set<string>();

  for (const topic of dataset.topics) {
    if (!topic.id || topic.id.trim().length === 0) {
      errors.push('topic id is required');
    }
    if (seenIds.has(topic.id)) {
      errors.push(`duplicate topic id: ${topic.id}`);
    }
    seenIds.add(topic.id);

    if (!required.has(topic.domain)) {
      errors.push(`unsupported domain for topic ${topic.id}: ${topic.domain}`);
    }
    required.delete(topic.domain);

    if (!topic.title || topic.title.trim().length === 0) {
      errors.push(`topic ${topic.id} title is required`);
    }
    if (!/^https:\/\/en\.wikipedia\.org\/wiki\/[A-Za-z0-9_%()-]+$/.test(topic.canonical_url ?? '')) {
      errors.push(`topic ${topic.id} canonical_url must be an English Wikipedia article URL`);
    }
    if (!topic.source_revision_id || topic.source_revision_id.trim().length === 0) {
      errors.push(`topic ${topic.id} source_revision_id is required`);
    }
    if (!Array.isArray(topic.sections) || topic.sections.length === 0) {
      errors.push(`topic ${topic.id} must include at least one section`);
    } else {
      for (const [index, section] of topic.sections.entries()) {
        if (!section.heading?.trim() || !section.content?.trim()) {
          errors.push(`topic ${topic.id} section ${index + 1} must include heading and content`);
        }
      }
    }

    if (
      topic.thresholds.min_nodes < 0 ||
      topic.thresholds.min_edges < 0 ||
      topic.thresholds.min_timeline < 0 ||
      topic.thresholds.min_citation_rate < 0 ||
      topic.thresholds.min_citation_rate > 1
    ) {
      errors.push(`topic ${topic.id} thresholds are outside allowed ranges`);
    }
  }

  if (required.size > 0) {
    errors.push(`missing required domains: ${Array.from(required).join(', ')}`);
  }

  const expected = computeGoldenSetChecksum({ version: dataset.version, topics: dataset.topics });
  if (dataset.checksum_sha256 !== expected) {
    errors.push(`checksum mismatch: expected ${expected} got ${dataset.checksum_sha256}`);
  }

  return errors;
};
