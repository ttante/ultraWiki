import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnv = {
  disableQueuePolling: process.env.DISABLE_QUEUE_POLLING,
  trustProxy: process.env.TRUST_PROXY,
  useMemoryRepo: process.env.USE_MEMORY_REPO
};

const restoreEnv = (): void => {
  if (originalEnv.disableQueuePolling === undefined) {
    delete process.env.DISABLE_QUEUE_POLLING;
  } else {
    process.env.DISABLE_QUEUE_POLLING = originalEnv.disableQueuePolling;
  }
  if (originalEnv.trustProxy === undefined) {
    delete process.env.TRUST_PROXY;
  } else {
    process.env.TRUST_PROXY = originalEnv.trustProxy;
  }
  if (originalEnv.useMemoryRepo === undefined) {
    delete process.env.USE_MEMORY_REPO;
  } else {
    process.env.USE_MEMORY_REPO = originalEnv.useMemoryRepo;
  }
};

const buildAppWithTrustProxy = async (trustProxy?: string) => {
  vi.resetModules();
  process.env.DISABLE_QUEUE_POLLING = '1';
  process.env.USE_MEMORY_REPO = '1';
  if (trustProxy === undefined) {
    delete process.env.TRUST_PROXY;
  } else {
    process.env.TRUST_PROXY = trustProxy;
  }

  const { buildApp } = await import('../src/app.js');
  return buildApp();
};

describe('app', () => {
  afterEach(() => {
    vi.resetModules();
    restoreEnv();
  });

  it('keeps proxy trust disabled by default', async () => {
    const app = await buildAppWithTrustProxy();

    expect(app.get('trust proxy')).toBe(false);
  });

  it('applies TRUST_PROXY to Express proxy trust', async () => {
    const app = await buildAppWithTrustProxy('1');

    expect(app.get('trust proxy')).toBe(true);
  });
});
