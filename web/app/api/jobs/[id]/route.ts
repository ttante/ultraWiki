import { backendFetch } from '../../../../lib/backend';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, context: { params: { id: string } }): Promise<Response> {
  const upstream = await backendFetch(`/api/jobs/${context.params.id}`);
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json'
    }
  });
}
