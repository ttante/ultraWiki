import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import OutcomesSloRunbookPage, { loadRunbookMarkdown, markdownHeadingId } from '../app/runbooks/outcomes-slo-alerts/page';

describe('OutcomesSloRunbookPage', () => {
  it('renders web-accessible anchors from the checked-in runbook source', () => {
    const markdown = loadRunbookMarkdown();
    expect(markdown).toContain('### Cost Drilldowns');
    expect(markdownHeadingId('Security And Rate Limits')).toBe('security-and-rate-limits');

    render(React.createElement(OutcomesSloRunbookPage));

    expect(screen.getByRole('heading', { name: 'Ops Dashboard Overview' })).toHaveAttribute('id', 'ops-dashboard-overview');
    expect(screen.getByRole('heading', { name: 'SLO Targets' })).toHaveAttribute('id', 'slo-targets');
    expect(screen.getByRole('heading', { name: 'Cost Drilldowns' })).toHaveAttribute('id', 'cost-drilldowns');
    expect(screen.getByRole('heading', { name: 'Fallback And Errors' })).toHaveAttribute('id', 'fallback-and-errors');
    expect(screen.getByRole('heading', { name: 'Security And Rate Limits' })).toHaveAttribute('id', 'security-and-rate-limits');
    expect(screen.getByRole('heading', { name: 'Reliability Inputs' })).toHaveAttribute('id', 'reliability-inputs');
  });
});
