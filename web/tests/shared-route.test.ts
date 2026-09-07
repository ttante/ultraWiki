import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../app/api/shared/[shareId]/route';

describe('shared pack API proxy', () => {
  const previousApiBaseUrl = process.env.API_BASE_URL;

  afterEach(() => {
    if (previousApiBaseUrl === undefined) {
      delete process.env.API_BASE_URL;
    } else {
      process.env.API_BASE_URL = previousApiBaseUrl;
    }
  });

  it('proxies shared pack reads to the backend', async () => {
    process.env.API_BASE_URL = 'http://api.test';
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ share: { share_id: 'share-1' }, pack: { id: 'pack-1' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(new Request('http://web.test/api/shared/share-1'), {
      params: Promise.resolve({ shareId: 'share-1' })
    });

    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/shared/share-1', undefined);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    await expect(response.json()).resolves.toEqual({ share: { share_id: 'share-1' }, pack: { id: 'pack-1' } });
  });
});
