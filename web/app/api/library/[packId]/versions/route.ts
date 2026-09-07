import { NextRequest } from 'next/server';
import { backendFetch } from '../../../../../lib/backend';
import { forwardIdentityHeaders } from '../../../../../lib/auth-proxy';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, context: { params: Promise<{ packId: string }> }): Promise<Response> {
  const { packId } = await context.params;
  const query = req.nextUrl.searchParams.toString();
  const upstream = await backendFetch(`/api/library/${packId}/versions${query ? `?${query}` : ''}`, {
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
