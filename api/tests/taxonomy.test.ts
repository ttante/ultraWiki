import { describe, expect, it } from 'vitest';
import { taxonomy } from '../src/domain/taxonomy.js';

describe('taxonomy', () => {
  it('validates known taxonomy values', () => {
    expect(taxonomy.version).toBe('1.0.0');
    expect(taxonomy.isTopicType('history')).toBe(true);
    expect(taxonomy.isEntityType('person')).toBe(true);
    expect(taxonomy.isRelationType('influenced')).toBe(true);
    expect(taxonomy.isPedagogyLevel('advanced')).toBe(true);
  });

  it('rejects unknown taxonomy values', () => {
    expect(taxonomy.isTopicType('mystery')).toBe(false);
    expect(taxonomy.isEntityType('animal')).toBe(false);
  });
});
