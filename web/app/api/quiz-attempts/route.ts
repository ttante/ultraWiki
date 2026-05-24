import { NextRequest } from 'next/server';
import { backendFetch } from '../../../lib/backend';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.text();
  const upstream = await backendFetch('/api/quiz-attempts', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
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
