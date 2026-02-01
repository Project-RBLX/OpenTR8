// Client
export { OpenTR8Client } from './client.js';

// Types
export type {
  Agent,
  Task,
  TaskStatus,
  Escrow,
  Bid,
  Webhook,
  WebhookEvent,
  CreateTaskOptions,
  ListOptions,
  MarketplaceOptions,
  Pagination,
  ClientOptions,
} from './types.js';

// Errors
export {
  OpenTR8Error,
  ApiError,
  AuthenticationError,
  NotFoundError,
  ValidationError,
} from './errors.js';

// Webhook utilities
export {
  verifyWebhookSignature,
  parseWebhookEvent,
} from './webhook.js';
