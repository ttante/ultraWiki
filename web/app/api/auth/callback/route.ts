import { NextRequest } from 'next/server';
import { backendFetch } from '../../../../lib/backend';
import { cookieHeader, proxyRedirectResponse } from '../../../../lib/auth-proxy';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const suffix = req.nextUrl.search ? req.nextUrl.search : '';
  const upstream = await backendFetch(`/api/auth/callback${suffix}`, {
    headers: cookieHeader(req),
    redirect: 'manual'
  });
  return proxyRedirectResponse(upstream);
}
