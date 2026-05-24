import { NextRequest } from 'next/server';
import { backendFetch } from '../../../../lib/backend';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const sessionId = req.headers.get('x-session-id') ?? '';
  const upstream = await backendFetch('/api/queue/status', {
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
