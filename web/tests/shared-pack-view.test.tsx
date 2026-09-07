import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SharedPackView from '../components/shared-pack-view';

const sharedPackPayload = {
  share: {
    share_id: 'share-1',
    pack_id: 'pack-1',
    owner_user_id: 'owner-1',
    role: 'viewer' as const,
    created_at: '2026-01-01T00:00:00.000Z'
  },
  pack: {
    id: 'pack-1',
    input: 'Ada Lovelace',
    source_revision_id: 'rev-ada-123',
    source_attribution: {
      canonical_url: 'https://en.wikipedia.org/wiki/Ada_Lovelace',
      revision_url: 'https://en.wikipedia.org/w/index.php?oldid=123',
      license: 'CC BY-SA 4.0' as const
    },
    grounding_stats: {
      citation_rate: 0.94,
      unsupported_claims: 1
    },
    summaries: [
      {
        level: 'beginner' as const,
        text: 'Ada Lovelace wrote notes about the Analytical Engine and is often discussed in computing history.',
        citations: ['Ada Lovelace citation one'],
        prompt_version: 'summary@1.0.0',
        model: 'qwen2.5-14b'
      }
    ],
    glossary: [
      {
        term: 'Analytical Engine',
        definition: 'A source-grounded term connected to Lovelace and computing history.',
        citation: 'Glossary citation one',
        prompt_version: 'glossary@1.0.0',
        model: 'qwen2.5-14b'
      }
    ],
    flashcards: [
      {
        question: 'What machine did Ada Lovelace write notes about?',
        answer: 'The Analytical Engine.',
        citation: 'Flashcard citation one',
        prompt_version: 'flashcard@1.0.0',
        model: 'qwen2.5-14b'
      }
    ],
    quiz_questions: [
      {
        question: 'Which answer best describes Lovelace in this pack?',
        options: ['Astronomer', 'Computing history figure', 'Botanist', 'Navigator'],
        correct_index: 1,
        misconceptions: [],
        explanation: 'The pack connects Lovelace to computing history and the Analytical Engine.',
        citation: 'Quiz citation one',
        prompt_version: 'quiz@1.0.0',
        model: 'qwen2.5-14b'
      }
    ],
    graph: {
      nodes: [],
      edges: []
    },
    timeline: [
      {
        year: 1843,
        date_label: '1843',
        description: 'Lovelace notes were published.',
        citation: 'Timeline citation'
      }
    ],
    recommendations: [],
    readiness: {
      status: 'full' as const,
      missing_artifacts: [],
      can_resume: false
    }
  }
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });

describe('SharedPackView', () => {
  it('renders a shared pack as read-only and saves it to the current library key', async () => {
    window.localStorage.setItem('ultrawiki_user_id', 'viewer-key');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/shared/share-1') {
        return jsonResponse(sharedPackPayload);
      }
      if (url === '/api/study-packs/pack-1/save' && init?.method === 'POST') {
        return jsonResponse({ pack_id: 'pack-1', saved: true, saved_at: '2026-01-01T00:00:00.000Z' });
      }
      return jsonResponse({ error: 'unexpected request' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(SharedPackView, { shareId: 'share-1' }));

    expect(await screen.findByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByText('Read-only study pack')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Grade Quiz' })).not.toBeInTheDocument();
    expect(screen.getByText('What machine did Ada Lovelace write notes about?')).toBeInTheDocument();

    const savePanel = screen.getByRole('heading', { name: 'Save To Library' }).closest('section') as HTMLElement;
    expect(within(savePanel).getByLabelText('Library key')).toHaveValue('viewer-key');
    fireEvent.click(within(savePanel).getByRole('button', { name: 'Save to library' }));

    await screen.findByText('Saved to library.');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/study-packs/pack-1/save',
      expect.objectContaining({
        method: 'POST',
        headers: { 'x-user-id': 'viewer-key' }
      })
    );
  });

  it('shows a missing-share state for 404 responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'share_not_found' }, 404)));

    render(React.createElement(SharedPackView, { shareId: 'missing-share' }));

    expect(await screen.findByRole('heading', { name: 'Shared pack unavailable' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save to library' })).not.toBeInTheDocument();
  });

  it('shows an expired-share state when the shared payload is past expires_at', async () => {
    vi.setSystemTime(new Date('2026-01-02T00:00:00.000Z'));
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      ...sharedPackPayload,
      share: {
        ...sharedPackPayload.share,
        expires_at: '2026-01-01T00:00:00.000Z'
      }
    })));

    render(React.createElement(SharedPackView, { shareId: 'expired-share' }));

    expect(await screen.findByRole('heading', { name: 'Share link expired' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ada Lovelace' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save to library' })).not.toBeInTheDocument();
  });

  it('renders editor shared access as a read-only public state without owner controls', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      ...sharedPackPayload,
      share: {
        ...sharedPackPayload.share,
        role: 'editor' as const
      }
    })));

    render(React.createElement(SharedPackView, { shareId: 'editor-share' }));

    expect(await screen.findByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByText('Read-only study pack')).toBeInTheDocument();
    const sharePanel = screen.getByRole('heading', { name: 'Share' }).closest('section') as HTMLElement;
    expect(within(sharePanel).getByText('Editor')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Grade Quiz' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create share link' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Managed Share Links' })).not.toBeInTheDocument();
  });
});
