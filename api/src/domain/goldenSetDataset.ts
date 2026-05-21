import { createHash } from 'node:crypto';

export const requiredGoldenSetDomains = ['biography', 'history', 'science', 'abstract_concept'] as const;

export type GoldenSetDomain = (typeof requiredGoldenSetDomains)[number];

export type GoldenSetTopic = {
  id: string;
  domain: GoldenSetDomain;
  title: string;
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
    if (seenIds.has(topic.id)) {
      errors.push(`duplicate topic id: ${topic.id}`);
    }
    seenIds.add(topic.id);

    if (!required.has(topic.domain)) {
      errors.push(`unsupported domain for topic ${topic.id}: ${topic.domain}`);
    }
    required.delete(topic.domain);

    if (!Array.isArray(topic.sections) || topic.sections.length === 0) {
      errors.push(`topic ${topic.id} must include at least one section`);
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
