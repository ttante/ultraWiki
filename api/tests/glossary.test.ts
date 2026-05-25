import { describe, expect, it } from 'vitest';
import { generateGlossaryArtifacts } from '../src/domain/glossary.js';

describe('glossary artifacts', () => {
  it('generates source-grounded glossary terms with prompt metadata', () => {
    const artifacts = generateGlossaryArtifacts(
      [
        {
          heading: 'Machine Intelligence',
          content:
            'Alan Turing discussed machine intelligence, computation, algorithms, and mathematical logic in relation to early computer science.'
        }
      ],
      'glossary@1.0.0',
      'local-test'
    );

    expect(artifacts.glossary.length).toBeGreaterThanOrEqual(5);
    expect(artifacts.glossary[0]).toMatchObject({
      promptVersion: 'glossary@1.0.0',
      model: 'local-test'
    });
    expect(artifacts.glossary[0]?.citation).toContain('source:');
  });
});
