import { NextRequest } from 'next/server';
import { backendFetch } from '../../../../lib/backend';
import { forwardIdentityHeaders } from '../../../../lib/auth-proxy';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.text();
  const sessionId = req.headers.get('x-session-id') ?? '';

  const upstream = await backendFetch('/api/study-packs/batch', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(sessionId ? { 'x-session-id': sessionId } : {}),
      ...forwardIdentityHeaders(req)
    },
    body
  });

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json'
    }
  });
}
