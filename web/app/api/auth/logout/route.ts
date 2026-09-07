import { NextRequest } from 'next/server';
import { backendFetch } from '../../../../lib/backend';
import { appendSetCookieHeaders, cookieHeader } from '../../../../lib/auth-proxy';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const upstream = await backendFetch('/api/auth/logout', {
    method: 'POST',
    headers: cookieHeader(req)
  });
  const text = await upstream.text();
  const headers = new Headers({
    'content-type': upstream.headers.get('content-type') ?? 'application/json'
  });
  appendSetCookieHeaders(headers, upstream.headers);
  return new Response(text, {
    status: upstream.status,
    headers
  });
}
