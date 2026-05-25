import { NextRequest } from 'next/server';
import { backendFetch } from '../../../lib/backend';

export const dynamic = 'force-dynamic';

const forwardHeaders = (req: NextRequest): HeadersInit => {
  const userId = req.headers.get('x-user-id') ?? '';
  const userName = req.headers.get('x-user-name') ?? '';
  return {
    ...(userId ? { 'x-user-id': userId } : {}),
    ...(userName ? { 'x-user-name': userName } : {})
  };
};

export async function GET(req: NextRequest): Promise<Response> {
  const upstream = await backendFetch('/api/me', {
    headers: forwardHeaders(req)
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
      ...forwardHeaders(req)
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
