import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTicketProgressIntegrity } from '../src/domain/ticketProgressIntegrity.js';

const run = async (): Promise<void> => {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(scriptDir, '../..');
  const trackerPath = path.resolve(root, 'docs/ticket-progress.md');
  const markdown = await readFile(trackerPath, 'utf8');
  const result = validateTicketProgressIntegrity(markdown);

  for (const error of result.errors) {
    console.error(`FAIL ${error}`);
  }

  if (!result.valid) {
    process.exit(1);
  }

  console.log(
    `Ticket progress integrity passed: queue=${result.queueRows.length}/${result.expectedQueueCount} active_remaining=${result.remainingRows.length}`
  );
};

void run();
