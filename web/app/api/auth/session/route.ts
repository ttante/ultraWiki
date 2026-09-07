import { NextRequest } from 'next/server';
import { backendFetch } from '../../../../lib/backend';
import { cookieHeader } from '../../../../lib/auth-proxy';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const upstream = await backendFetch('/api/auth/session', {
    headers: cookieHeader(req)
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json'
    }
  });
}
