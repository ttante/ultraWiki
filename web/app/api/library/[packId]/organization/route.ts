import { NextRequest } from 'next/server';
import { backendFetch } from '../../../../../lib/backend';
import { forwardIdentityHeaders } from '../../../../../lib/auth-proxy';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, context: { params: Promise<{ packId: string }> }): Promise<Response> {
  const { packId } = await context.params;
  const body = await req.text();
  const upstream = await backendFetch(`/api/library/${packId}/organization`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...forwardIdentityHeaders(req)
    },
    body: body || '{}'
  });

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json'
    }
  });
}
