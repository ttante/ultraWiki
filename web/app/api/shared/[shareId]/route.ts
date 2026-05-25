import { backendFetch } from '../../../../lib/backend';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, context: { params: Promise<{ shareId: string }> }): Promise<Response> {
  const { shareId } = await context.params;
  const upstream = await backendFetch(`/api/shared/${shareId}`);

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json'
    }
  });
}
