import { NextRequest } from 'next/server';
import { backendFetch } from '../../../../../lib/backend';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, context: { params: { id: string } }): Promise<Response> {
  const sessionId = req.headers.get('x-session-id') ?? '';
  const upstream = await backendFetch(`/api/study-packs/${context.params.id}/resume`, {
    method: 'POST',
    headers: {
      ...(sessionId ? { 'x-session-id': sessionId } : {})
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
