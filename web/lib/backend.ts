export const getBackendBaseUrl = (): string =>
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export const backendFetch = async (path: string, init?: RequestInit): Promise<Response> => {
  const base = getBackendBaseUrl().replace(/\/$/, '');
  return fetch(`${base}${path}`, init);
};
