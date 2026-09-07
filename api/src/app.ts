import express from 'express';
import { getConfig } from './config.js';
import { httpLogger } from './logger.js';
import { registerApiRoutes } from './routes/api.js';

export const buildApp = () => {
  const config = getConfig();
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.use(express.json({ limit: '1mb' }));
  if (process.env.DISABLE_HTTP_LOGGER !== '1') {
    app.use(httpLogger);
  }

  app.get('/health', (_req, res) => {
    res.status(200).json({ service: 'api', status: 'ok' });
  });

  registerApiRoutes(app);
  return app;
};
