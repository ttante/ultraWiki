import { NextRequest } from 'next/server';
import { backendFetch } from '../../../../../lib/backend';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  const suffix = req.nextUrl.search ? req.nextUrl.search : '';
  const upstream = await backendFetch(`/api/study-packs/${id}/export${suffix}`);
  const body = await upstream.text();

  return new Response(body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      ...(upstream.headers.get('content-disposition')
        ? { 'content-disposition': upstream.headers.get('content-disposition') as string }
        : {})
    }
  });
}
