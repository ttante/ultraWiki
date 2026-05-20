import { describe, expect, it } from 'vitest';
import { PromptRegistry } from '../src/domain/promptRegistry.js';

describe('PromptRegistry', () => {
  it('registers and fetches prompts by id/version', () => {
    const registry = new PromptRegistry();
    registry.register({
      id: 'summary',
      version: '1.0.0',
      status: 'active',
      template: 'template',
      changelog: 'initial'
    });

    expect(registry.get('summary', '1.0.0')?.template).toBe('template');
    expect(registry.listById('summary')).toHaveLength(1);
  });
});
