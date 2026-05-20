const topicTypes = ['biography', 'history', 'science', 'technology', 'culture', 'other'] as const;
const entityTypes = ['person', 'organization', 'event', 'concept', 'place', 'work'] as const;
const relationTypes = ['influenced', 'founded', 'member_of', 'occurred_in', 'related_to', 'precedes'] as const;
const pedagogyLevels = ['beginner', 'intermediate', 'advanced'] as const;

export type TopicType = (typeof topicTypes)[number];
export type EntityType = (typeof entityTypes)[number];
export type RelationType = (typeof relationTypes)[number];
export type PedagogyLevel = (typeof pedagogyLevels)[number];

const includes = <T extends readonly string[]>(arr: T, value: string): value is T[number] => arr.includes(value);

export const taxonomy = {
  topicTypes,
  entityTypes,
  relationTypes,
  pedagogyLevels,
  isTopicType: (value: string): value is TopicType => includes(topicTypes, value),
  isEntityType: (value: string): value is EntityType => includes(entityTypes, value),
  isRelationType: (value: string): value is RelationType => includes(relationTypes, value),
  isPedagogyLevel: (value: string): value is PedagogyLevel => includes(pedagogyLevels, value)
};
