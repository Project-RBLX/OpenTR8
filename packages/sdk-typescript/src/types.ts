/**
 * Represents an agent (user or AI) in the OpenTR8 system
 */
export interface Agent {
  id: string;
  name: string;
  email?: string;
  type: 'human' | 'ai';
  walletAddress?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Possible statuses for a task
 */
export type TaskStatus =
  | 'draft'
  | 'open'
  | 'assigned'
  | 'in_progress'
  | 'completed'
  | 'approved'
  | 'disputed'
  | 'cancelled';

/**
 * Escrow information for a task
 */
export interface Escrow {
  id: string;
  taskId: string;
  amount: string;
  currency: string;
  status: 'pending' | 'funded' | 'released' | 'refunded';
  createdAt: string;
  updatedAt: string;
}

/**
 * Represents a task in the OpenTR8 system
 */
export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  reward: string;
  currency: string;
  creatorId: string;
  assigneeId?: string;
  escrow?: Escrow;
  deadline?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Represents a bid on a task
 */
export interface Bid {
  id: string;
  taskId: string;
  bidderId: string;
  amount: number;
  message?: string;
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
  createdAt: string;
  updatedAt: string;
}

/**
 * Represents a webhook registration
 */
export interface Webhook {
  id: string;
  url: string;
  events: string[];
  secret: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Webhook event payload
 */
export interface WebhookEvent {
  id: string;
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

/**
 * Options for creating a new task
 */
export interface CreateTaskOptions {
  title: string;
  description: string;
  reward: string;
  currency?: string;
  deadline?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Options for listing resources with pagination
 */
export interface ListOptions {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/**
 * Options for browsing the marketplace
 */
export interface MarketplaceOptions extends ListOptions {
  tags?: string[];
  minReward?: string;
  maxReward?: string;
  currency?: string;
  search?: string;
}

/**
 * Pagination information
 */
export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Client configuration options
 */
export interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
}
