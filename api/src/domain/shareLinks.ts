import { createHash, createHmac } from 'node:crypto';

export const activeShareTokenVersion = 'hmac-sha256-v1';
export const legacyShareTokenVersion = 'legacy-md5';

export type ShareTokenLookup = {
  shareId: string;
  tokenHash: string;
};

const digest = (algorithm: string, value: string): string => createHash(algorithm).update(value).digest('hex');

export const hashShareToken = (token: string): string => `sha256:${digest('sha256', token)}`;

export const hashLegacyShareToken = (shareId: string): string => `legacy-md5:${digest('md5', shareId)}`;

export const createShareToken = (shareId: string, secret: string): string => {
  const signature = createHmac('sha256', secret).update(shareId).digest('base64url');
  return `${shareId}.${signature}`;
};

export const createShareTokenHash = (shareId: string, secret: string): string =>
  hashShareToken(createShareToken(shareId, secret));

export const parseShareToken = (token: string): ShareTokenLookup | undefined => {
  const trimmed = token.trim();
  if (!trimmed) {
    return undefined;
  }

  const [shareId, signature, ...extra] = trimmed.split('.');
  if (!shareId || extra.length > 0) {
    return undefined;
  }

  if (!signature) {
    return {
      shareId,
      tokenHash: hashLegacyShareToken(shareId)
    };
  }

  return {
    shareId,
    tokenHash: hashShareToken(trimmed)
  };
};

export const publicShareToken = (shareId: string, tokenVersion: string | undefined, secret: string): string =>
  tokenVersion === legacyShareTokenVersion ? shareId : createShareToken(shareId, secret);

export const expiresAtFromTtl = (ttlSeconds: number, now = Date.now()): string =>
  new Date(now + Math.max(1, ttlSeconds) * 1000).toISOString();
