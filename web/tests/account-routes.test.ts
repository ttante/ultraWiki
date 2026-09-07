import type { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DELETE as deleteAccount } from '../app/api/me/route';
import { GET as exportAccount } from '../app/api/me/export/route';

const requestWithIdentity = (): NextRequest =>
  ({
    headers: new Headers({
      cookie: 'ultrawiki_auth_session=session-token',
      'x-user-id': 'legacy-user'
    })
  }) as unknown as NextRequest;

describe('account API proxies', () => {
  const previousApiBaseUrl = process.env.API_BASE_URL;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (previousApiBaseUrl === undefined) {
      delete process.env.API_BASE_URL;
    } else {
      process.env.API_BASE_URL = previousApiBaseUrl;
    }
  });

  it('forwards account export identity headers to the backend', async () => {
    process.env.API_BASE_URL = 'http://api.test';
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ user_id: 'legacy-user', exported_at: '2026-01-01T00:00:00.000Z' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await exportAccount(requestWithIdentity());

    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/me/export', {
      headers: {
        cookie: 'ultrawiki_auth_session=session-token',
        'x-user-id': 'legacy-user'
      }
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
  });

  it('proxies account deletion and preserves auth cookie clearing', async () => {
    process.env.API_BASE_URL = 'http://api.test';
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ user_id: 'legacy-user', deleted_at: '2026-01-01T00:00:00.000Z', deleted: {} }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'set-cookie': 'ultrawiki_auth_session=; Path=/; Max-Age=0'
        }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await deleteAccount(requestWithIdentity());

    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/me', {
      method: 'DELETE',
      headers: {
        cookie: 'ultrawiki_auth_session=session-token',
        'x-user-id': 'legacy-user'
      }
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('ultrawiki_auth_session=');
  });
});
