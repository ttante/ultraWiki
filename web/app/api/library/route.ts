import { NextRequest } from 'next/server';
import { backendFetch } from '../../../lib/backend';
import { forwardIdentityHeaders } from '../../../lib/auth-proxy';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const suffix = req.nextUrl.search ? req.nextUrl.search : '';
  const upstream = await backendFetch(`/api/library${suffix}`, {
    headers: forwardIdentityHeaders(req)
  });

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json'
    }
  });
}
