import { NextRequest } from 'next/server';
import { backendFetch } from '../../../../../lib/backend';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const body = await req.text();
  const userId = req.headers.get('x-user-id') ?? '';
  const upstream = await backendFetch(`/api/study-packs/${id}/share`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(userId ? { 'x-user-id': userId } : {})
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
