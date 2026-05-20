export type PromptStatus = 'active' | 'deprecated' | 'draft';

export type PromptDefinition = {
  id: string;
  version: string;
  status: PromptStatus;
  template: string;
  changelog: string;
};

export class PromptRegistry {
  private prompts = new Map<string, PromptDefinition>();

  register(prompt: PromptDefinition): void {
    const key = this.key(prompt.id, prompt.version);
    this.prompts.set(key, prompt);
  }

  get(id: string, version: string): PromptDefinition | undefined {
    return this.prompts.get(this.key(id, version));
  }

  listById(id: string): PromptDefinition[] {
    return Array.from(this.prompts.values()).filter((p) => p.id === id);
  }

  private key(id: string, version: string): string {
    return `${id}@${version}`;
  }
}

export const defaultPromptRegistry = new PromptRegistry();
defaultPromptRegistry.register({
  id: 'summary-by-level',
  version: '1.0.0',
  status: 'active',
  template: 'Summarize by level with evidence references only.',
  changelog: 'Initial prompt.'
});
