import { backendFetch } from '../../../../../lib/backend';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const upstream = await backendFetch('/api/runtime/llm/presets');
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json'
    }
  });
}
