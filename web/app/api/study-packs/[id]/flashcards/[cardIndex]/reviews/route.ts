import { NextRequest } from 'next/server';
import { backendFetch } from '../../../../../../../lib/backend';
import { forwardIdentityHeaders } from '../../../../../../../lib/auth-proxy';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string; cardIndex: string }> }
): Promise<Response> {
  const { id, cardIndex } = await context.params;
  const body = await req.text();
  const upstream = await backendFetch(`/api/study-packs/${id}/flashcards/${cardIndex}/reviews`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
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
