import { NextRequest } from 'next/server';

export const cookieHeader = (req: NextRequest): HeadersInit => {
  const cookie = req.headers.get('cookie') ?? '';
  return cookie ? { cookie } : {};
};

export const forwardIdentityHeaders = (req: NextRequest): HeadersInit => {
  const userId = req.headers.get('x-user-id') ?? '';
  const userName = req.headers.get('x-user-name') ?? '';
  return {
    ...cookieHeader(req),
    ...(userId ? { 'x-user-id': userId } : {}),
    ...(userName ? { 'x-user-name': userName } : {})
  };
};

type HeadersWithSetCookieList = Headers & {
  getSetCookie?: () => string[];
};

export const getSetCookieHeaders = (headers: Headers): string[] => {
  const getSetCookie = (headers as HeadersWithSetCookieList).getSetCookie;
  if (typeof getSetCookie === 'function') {
    return getSetCookie.call(headers);
  }

  const setCookie = headers.get('set-cookie');
  return setCookie ? [setCookie] : [];
};

export const appendSetCookieHeaders = (target: Headers, source: Headers): void => {
  for (const cookie of getSetCookieHeaders(source)) {
    target.append('set-cookie', cookie);
  }
};

export const proxyRedirectResponse = async (upstream: Response): Promise<Response> => {
  const headers = new Headers();
  const location = upstream.headers.get('location');
  const contentType = upstream.headers.get('content-type');
  if (location) {
    headers.set('location', location);
  }
  appendSetCookieHeaders(headers, upstream.headers);
  if (contentType) {
    headers.set('content-type', contentType);
  }

  return new Response(await upstream.text(), {
    status: upstream.status,
    headers
  });
};
