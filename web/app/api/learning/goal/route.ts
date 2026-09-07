import { NextRequest } from 'next/server';
import { backendFetch } from '../../../../lib/backend';
import { forwardIdentityHeaders } from '../../../../lib/auth-proxy';

export const dynamic = 'force-dynamic';

const proxyLearningGoal = async (req: NextRequest): Promise<Response> => {
  const upstream = await backendFetch('/api/learning/goal', {
    method: req.method,
    headers: {
      ...forwardIdentityHeaders(req),
      ...(req.headers.get('content-type') ? { 'content-type': req.headers.get('content-type') as string } : {})
    },
    body: req.method === 'GET' ? undefined : await req.text()
  });

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json'
    }
  });
};

export async function GET(req: NextRequest): Promise<Response> {
  return proxyLearningGoal(req);
}

export async function PUT(req: NextRequest): Promise<Response> {
  return proxyLearningGoal(req);
}
