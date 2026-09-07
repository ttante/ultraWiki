import { NextRequest } from 'next/server';
import { backendFetch } from '../../../../../lib/backend';
import { forwardIdentityHeaders } from '../../../../../lib/auth-proxy';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const sessionId = req.headers.get('x-session-id') ?? '';
  const upstream = await backendFetch(`/api/study-packs/${id}/resume`, {
    method: 'POST',
    headers: {
      ...(sessionId ? { 'x-session-id': sessionId } : {}),
      ...forwardIdentityHeaders(req)
    }
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json'
    }
  });
}
