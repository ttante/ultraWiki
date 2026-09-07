export type TicketPriority = 'P0' | 'P1' | 'P2';

export type ReleaseReadinessEvidence = {
  label: string;
  command?: string;
  artifact?: string;
};

export type ReleaseReadinessGroup = {
  id: string;
  ticket_ids: string[];
  evidence: ReleaseReadinessEvidence[];
};

export type ReleaseReadinessReport = {
  version: string;
  release_candidate: string;
  generated_at: string;
  status: 'ready' | 'blocked';
  required_gates: string[];
  evidence_groups: ReleaseReadinessGroup[];
};

export type TicketSummary = {
  id: string;
  title: string;
  priority: TicketPriority;
};

export type ReleaseReadinessValidation = {
  valid: boolean;
  errors: string[];
  coveredTickets: number;
  requiredTickets: number;
};

export const requiredReadinessCommands = [
  'npm run lint',
  'npm run typecheck',
  'npm run test',
  'npm run build',
  'npm run gate:tdd-proof',
  'npm run gate:ticket-progress',
  'npm run gate:coverage',
  'npm run gate:contracts',
  'npm run gate:quality-scoring',
  'npm run gate:golden-set',
  'npm run gate:prompt-regression',
  'npm run gate:llm-prompt-registry',
  'npm run gate:runtime-presets',
  'npm run gate:local-llm-config',
  'npm run gate:real-model-eval-config',
  'npm run gate:change-gating-policy',
  'npm run gate:adversarial-corpus',
  'npm run gate:lifecycle-retention',
  'npm run gate:backup-restore-drill',
  'npm run gate:support-playbook',
  'npm run gate:bench-regression',
  'npm run gate:migration-safety',
  'npm run gate:monitoring-config',
  'npm run gate:alert-policy',
  'npm run gate:error-budget-policy',
  'npm run gate:alert-runbook-linkage',
  'npm run gate:release-data-ops',
  'npm run gate:outcomes-maintenance'
] as const;

export const extractTickets = (ticketsMarkdown: string): TicketSummary[] => {
  const out: TicketSummary[] = [];
  const blocks = ticketsMarkdown.split(/\n(?=### T\d+\.\d+)/);
  for (const block of blocks) {
    const match = block.match(/^### (T\d+\.\d+) ([^\n]+)\n([\s\S]*)/);
    if (!match) {
      continue;
    }
    const priority = match[3].match(/Priority:\s*(P[0-2])/)?.[1] as TicketPriority | undefined;
    if (priority) {
      out.push({ id: match[1], title: match[2], priority });
    }
  }
  return out;
};

export const validateReleaseReadinessReport = (
  report: ReleaseReadinessReport,
  ticketsMarkdown: string
): ReleaseReadinessValidation => {
  const errors: string[] = [];
  const requiredTickets = extractTickets(ticketsMarkdown).filter(
    (ticket) => ticket.priority === 'P0' || ticket.priority === 'P1'
  );
  const requiredTicketIds = new Set(requiredTickets.map((ticket) => ticket.id));
  const coveredTicketIds = new Set<string>();
  const groupIds = new Set<string>();

  if (!report.version || report.version.trim().length === 0) {
    errors.push('version is required');
  }
  if (!report.release_candidate || report.release_candidate.trim().length === 0) {
    errors.push('release_candidate is required');
  }
  if (!Number.isFinite(Date.parse(report.generated_at))) {
    errors.push('generated_at must be an ISO timestamp');
  }
  if (report.status !== 'ready') {
    errors.push(`release status must be ready before release, got ${report.status}`);
  }

  for (const command of requiredReadinessCommands) {
    if (!report.required_gates.includes(command)) {
      errors.push(`required_gates missing command: ${command}`);
    }
  }

  for (const group of report.evidence_groups) {
    if (groupIds.has(group.id)) {
      errors.push(`duplicate evidence group: ${group.id}`);
    }
    groupIds.add(group.id);
    if (group.ticket_ids.length === 0) {
      errors.push(`evidence group ${group.id} has no ticket links`);
    }
    if (group.evidence.length === 0) {
      errors.push(`evidence group ${group.id} has no evidence`);
    }
    for (const ticketId of group.ticket_ids) {
      if (!requiredTicketIds.has(ticketId)) {
        errors.push(`evidence group ${group.id} references unknown or non-P0/P1 ticket: ${ticketId}`);
      }
      coveredTicketIds.add(ticketId);
    }
    for (const evidence of group.evidence) {
      if (evidence.label.trim().length === 0) {
        errors.push(`evidence group ${group.id} has unlabeled evidence`);
      }
      if (!evidence.command && !evidence.artifact) {
        errors.push(`evidence group ${group.id} evidence=${evidence.label} missing command or artifact`);
      }
    }
  }

  for (const ticket of requiredTickets) {
    if (!coveredTicketIds.has(ticket.id)) {
      errors.push(`P0/P1 ticket missing readiness evidence: ${ticket.id} ${ticket.title}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    coveredTickets: coveredTicketIds.size,
    requiredTickets: requiredTickets.length
  };
};
