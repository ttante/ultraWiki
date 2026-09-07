import { NextRequest } from 'next/server';
import { backendFetch } from '../../../../lib/backend';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const suffix = req.nextUrl.search ? req.nextUrl.search : '';
  const upstream = await backendFetch(`/api/analytics/slo${suffix}`);
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json'
    }
  });
}
