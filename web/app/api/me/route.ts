import { NextRequest } from 'next/server';
import { backendFetch } from '../../../lib/backend';
import { appendSetCookieHeaders, forwardIdentityHeaders } from '../../../lib/auth-proxy';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const upstream = await backendFetch('/api/me', {
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

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.text();
  const upstream = await backendFetch('/api/me', {
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

export async function DELETE(req: NextRequest): Promise<Response> {
  const upstream = await backendFetch('/api/me', {
    method: 'DELETE',
    headers: forwardIdentityHeaders(req)
  });
  const text = await upstream.text();
  const headers = new Headers({
    'content-type': upstream.headers.get('content-type') ?? 'application/json'
  });
  appendSetCookieHeaders(headers, upstream.headers);
  return new Response(text, {
    status: upstream.status,
    headers
  });
}
