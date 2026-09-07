import { describe, expect, it } from 'vitest';
import {
  buildAuthorizationUrl,
  createOAuthStateToken,
  createSessionToken,
  createSignedToken,
  userIdFromOidc,
  verifyOAuthStateToken,
  verifySessionToken,
  type OidcConfig
} from '../src/domain/auth.js';

const oidcConfig: OidcConfig = {
  authorizationUrl: 'https://issuer.example/authorize',
  tokenUrl: 'https://issuer.example/token',
  userinfoUrl: 'https://issuer.example/userinfo',
  clientId: 'ultrawiki',
  clientSecret: 'secret',
  redirectUri: 'https://app.example/api/auth/callback',
  issuer: 'issuer.example',
  scope: 'openid profile email'
};

describe('auth domain helpers', () => {
  it('creates and verifies expiring OIDC session tokens', () => {
    const token = createSessionToken(
      {
        userId: 'oidc:issuer.example:abc',
        displayName: 'Ada',
        provider: 'oidc',
        expiresAt: 2_000
      },
      'secret'
    );

    expect(verifySessionToken(token, 'secret', 1_000)).toMatchObject({
      userId: 'oidc:issuer.example:abc',
      displayName: 'Ada',
      provider: 'oidc'
    });
    expect(verifySessionToken(token, 'secret', 2_000)).toBeUndefined();
    expect(verifySessionToken(`${token}x`, 'secret', 1_000)).toBeUndefined();
  });

  it('creates safe OAuth state and authorization URLs', () => {
    const state = createOAuthStateToken('//evil.example', 'secret', 60_000, 1_000);
    const cookieToken = createSessionToken(
      {
        userId: state.state,
        provider: 'oidc',
        expiresAt: state.expiresAt
      },
      'secret'
    );
    expect(verifyOAuthStateToken(cookieToken, state.state, 'secret', 1_500)).toBeUndefined();

    const safeState = createOAuthStateToken('/library', 'secret', 60_000, 1_000);
    const safeCookieToken = `${Buffer.from(JSON.stringify(safeState)).toString('base64url')}.invalid`;
    expect(verifyOAuthStateToken(safeCookieToken, safeState.state, 'secret', 1_500)).toBeUndefined();
    expect(verifyOAuthStateToken(createSignedToken(safeState, 'secret'), safeState.state, 'secret', 1_500)).toMatchObject({
      redirectPath: '/library'
    });

    const url = new URL(buildAuthorizationUrl(oidcConfig, safeState.state));
    expect(url.origin).toBe('https://issuer.example');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('ultrawiki');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example/api/auth/callback');
    expect(url.searchParams.get('scope')).toBe('openid profile email');
    expect(url.searchParams.get('state')).toBe(safeState.state);
    expect(userIdFromOidc('issuer.example', 'abc')).toBe('oidc:issuer.example:abc');
  });
});
