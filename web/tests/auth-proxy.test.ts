import { describe, expect, it, vi } from 'vitest';
import { appendSetCookieHeaders, getSetCookieHeaders, proxyRedirectResponse } from '../lib/auth-proxy';

const headersWithSetCookies = (cookies: string[]): Headers => {
  const headers = new Headers();
  Object.defineProperty(headers, 'getSetCookie', {
    value: () => cookies
  });
  return headers;
};

describe('auth proxy helpers', () => {
  it('reads separate Set-Cookie values when the runtime exposes getSetCookie', () => {
    expect(getSetCookieHeaders(headersWithSetCookies(['a=1; Path=/', 'b=; Path=/; Max-Age=0']))).toEqual([
      'a=1; Path=/',
      'b=; Path=/; Max-Age=0'
    ]);
  });

  it('appends each upstream Set-Cookie header separately', () => {
    const source = headersWithSetCookies(['auth=token; Path=/', 'state=; Path=/; Max-Age=0']);
    const target = new Headers();
    const append = vi.spyOn(target, 'append');

    appendSetCookieHeaders(target, source);

    expect(append).toHaveBeenCalledWith('set-cookie', 'auth=token; Path=/');
    expect(append).toHaveBeenCalledWith('set-cookie', 'state=; Path=/; Max-Age=0');
  });

  it('preserves redirect metadata and auth cookies from upstream responses', async () => {
    const upstreamHeaders = headersWithSetCookies(['auth=token; Path=/', 'state=; Path=/; Max-Age=0']);
    upstreamHeaders.set('location', '/library');
    upstreamHeaders.set('content-type', 'text/plain');
    const append = vi.spyOn(Headers.prototype, 'append');

    const response = await proxyRedirectResponse({
      status: 302,
      headers: upstreamHeaders,
      text: async () => 'redirecting'
    } as Response);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/library');
    expect(response.headers.get('content-type')).toBe('text/plain');
    expect(append).toHaveBeenCalledWith('set-cookie', 'auth=token; Path=/');
    expect(append).toHaveBeenCalledWith('set-cookie', 'state=; Path=/; Max-Age=0');
    append.mockRestore();
  });
});
