import express from 'express';
import { loadConfig, OpenTR8Error } from '@opentr8/shared';
import { agentsRouter } from './routes/agents.js';
import { tasksRouter } from './routes/tasks.js';
import { walletRouter } from './routes/wallet.js';
import { webhooksRouter } from './routes/webhooks.js';
import { reputationRouter } from './routes/reputation.js';
import { disputesRouter } from './routes/disputes.js';
import { marketplaceRouter } from './routes/marketplace.js';
import { templatesRouter } from './routes/templates.js';
import { multiPartyRouter } from './routes/multi-party.js';
import { initializeWebhookDelivery } from './services/webhook-delivery.js';
import { initializeReputationService } from './services/reputation.js';

const config = loadConfig();
const app = express();

// Middleware
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/agents', agentsRouter);
app.use('/tasks', tasksRouter);
app.use('/wallet', walletRouter);
app.use('/webhooks', webhooksRouter);
app.use('/reputation', reputationRouter);
app.use('/disputes', disputesRouter);
app.use('/marketplace', marketplaceRouter);
app.use('/templates', templatesRouter);
app.use('/multi-party', multiPartyRouter);

// Initialize services
initializeWebhookDelivery();
initializeReputationService();

// Error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error('Error:', err);

    if (err instanceof OpenTR8Error) {
      res.status(err.statusCode).json(err.toJSON());
      return;
    }

    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: config.nodeEnv === 'development' ? err.message : 'Internal server error',
      },
    });
  }
);

// Start server
app.listen(config.port, () => {
  console.log(`OpenTR8 API running on port ${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);
});

export default app;
