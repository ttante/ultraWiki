import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateReleaseReadinessReport,
  type ReleaseReadinessReport
} from '../src/domain/releaseReadiness.js';

const run = async (): Promise<void> => {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(scriptDir, '../..');
  const reportPath = path.resolve(root, 'infra/release/readiness-report.json');
  const ticketsPath = path.resolve(root, 'docs/tickets.md');
  const docPath = path.resolve(root, 'docs/release-readiness.md');
  const [reportRaw, ticketsMarkdown, readinessDoc] = await Promise.all([
    readFile(reportPath, 'utf8'),
    readFile(ticketsPath, 'utf8'),
    readFile(docPath, 'utf8')
  ]);
  const report = JSON.parse(reportRaw) as ReleaseReadinessReport;
  const validation = validateReleaseReadinessReport(report, ticketsMarkdown);
  let failed = 0;

  for (const error of validation.errors) {
    failed += 1;
    console.error(`FAIL ${error}`);
  }

  if (!readinessDoc.includes(report.release_candidate)) {
    failed += 1;
    console.error(`FAIL docs/release-readiness.md does not reference ${report.release_candidate}`);
  }

  for (const group of report.evidence_groups) {
    for (const evidence of group.evidence) {
      if (!evidence.artifact) {
        continue;
      }
      try {
        await stat(path.resolve(root, evidence.artifact));
      } catch {
        failed += 1;
        console.error(`FAIL group=${group.id} evidence=${evidence.label} artifact missing: ${evidence.artifact}`);
      }
    }
  }

  if (failed > 0) {
    process.exit(1);
  }

  console.log(
    `Release readiness passed: covered=${validation.coveredTickets}/${validation.requiredTickets} groups=${report.evidence_groups.length}`
  );
};

void run();
