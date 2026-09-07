import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type AuthSession = {
  userId: string;
  displayName?: string;
  provider: 'oidc';
  expiresAt: number;
};

export type OAuthState = {
  state: string;
  redirectPath: string;
  expiresAt: number;
};

export type OidcConfig = {
  authorizationUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  issuer: string;
  scope: string;
};

export type OidcTokenResponse = {
  access_token?: string;
  id_token?: string;
  token_type?: string;
};

export type OidcUserInfo = {
  sub: string;
  name?: string;
  email?: string;
  preferred_username?: string;
};

const base64Url = (value: Buffer | string): string =>
  Buffer.from(value).toString('base64url');

const sign = (payload: string, secret: string): string =>
  createHmac('sha256', secret).update(payload).digest('base64url');

export const createSignedToken = (payload: unknown, secret: string): string => {
  const encoded = base64Url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded, secret)}`;
};

export const verifySignedToken = <T>(token: string | undefined, secret: string): T | undefined => {
  if (!token) {
    return undefined;
  }
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) {
    return undefined;
  }
  const expected = sign(encoded, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return undefined;
  }
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as T;
  } catch {
    return undefined;
  }
};

export const createSessionToken = (session: AuthSession, secret: string): string =>
  createSignedToken(session, secret);

export const verifySessionToken = (token: string | undefined, secret: string, now = Date.now()): AuthSession | undefined => {
  const session = verifySignedToken<AuthSession>(token, secret);
  if (!session || session.provider !== 'oidc' || !session.userId || session.expiresAt <= now) {
    return undefined;
  }
  return session;
};

export const createOAuthStateToken = (redirectPath: string, secret: string, ttlMs: number, now = Date.now()): OAuthState => ({
  state: createSignedToken({ nonce: randomBytes(16).toString('base64url'), expiresAt: now + ttlMs }, secret),
  redirectPath: redirectPath.startsWith('/') && !redirectPath.startsWith('//') ? redirectPath : '/',
  expiresAt: now + ttlMs
});

export const verifyOAuthStateToken = (
  token: string | undefined,
  expectedState: string | undefined,
  secret: string,
  now = Date.now()
): OAuthState | undefined => {
  const state = verifySignedToken<OAuthState>(token, secret);
  if (!state || !expectedState || state.state !== expectedState || state.expiresAt <= now) {
    return undefined;
  }
  return state;
};

export const buildAuthorizationUrl = (config: OidcConfig, state: string): string => {
  const url = new URL(config.authorizationUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', config.scope);
  url.searchParams.set('state', state);
  return url.toString();
};

export const exchangeAuthorizationCode = async (config: OidcConfig, code: string): Promise<OidcTokenResponse> => {
  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret
    })
  });
  if (!response.ok) {
    throw new Error(`oidc_token_exchange_failed:${response.status}`);
  }
  return (await response.json()) as OidcTokenResponse;
};

export const fetchOidcUserInfo = async (config: OidcConfig, accessToken: string): Promise<OidcUserInfo> => {
  const response = await fetch(config.userinfoUrl, {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    throw new Error(`oidc_userinfo_failed:${response.status}`);
  }
  const payload = (await response.json()) as Partial<OidcUserInfo>;
  if (!payload.sub) {
    throw new Error('oidc_userinfo_missing_sub');
  }
  return payload as OidcUserInfo;
};

export const userIdFromOidc = (issuer: string, sub: string): string =>
  `oidc:${issuer}:${sub}`;
