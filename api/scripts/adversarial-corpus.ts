import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLikelyWikipediaInput, sanitizeSourceText } from '../src/domain/security.js';

type CorpusCase = {
  id: string;
  input: string;
  expect_flagged: boolean;
  required_signatures: string[];
  expected_wikipedia_input: boolean;
};

type CorpusFile = {
  version: string;
  cases: CorpusCase[];
};

const run = async (): Promise<void> => {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const corpusPath = path.resolve(scriptDir, '../../infra/evaluation/adversarial-corpus.json');
  const corpus = JSON.parse(await readFile(corpusPath, 'utf8')) as CorpusFile;

  let failed = 0;

  for (const testCase of corpus.cases) {
    const sanitized = sanitizeSourceText(testCase.input);
    const wikiInput = isLikelyWikipediaInput(testCase.input);

    if (sanitized.flagged !== testCase.expect_flagged) {
      failed += 1;
      console.error(`FAIL case=${testCase.id} flagged expected=${testCase.expect_flagged} actual=${sanitized.flagged}`);
    }

    for (const signature of testCase.required_signatures) {
      if (!sanitized.signatures.includes(signature)) {
        failed += 1;
        console.error(`FAIL case=${testCase.id} missing signature=${signature}`);
      }
    }

    if (wikiInput !== testCase.expected_wikipedia_input) {
      failed += 1;
      console.error(
        `FAIL case=${testCase.id} wikipedia_input expected=${testCase.expected_wikipedia_input} actual=${wikiInput}`
      );
    }
  }

  if (failed > 0) {
    process.exit(1);
  }

  console.log(`Adversarial corpus passed: ${corpus.cases.length} cases (version=${corpus.version})`);
};

void run();
