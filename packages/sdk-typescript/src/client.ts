import type {
  Agent,
  Task,
  Bid,
  Webhook,
  CreateTaskOptions,
  ListOptions,
  MarketplaceOptions,
  Pagination,
  ClientOptions,
} from './types.js';
import {
  ApiError,
  AuthenticationError,
  NotFoundError,
  ValidationError,
} from './errors.js';

/**
 * OpenTR8 SDK Client
 *
 * @example
 * ```typescript
 * import { OpenTR8Client } from '@opentr8/sdk';
 *
 * const client = new OpenTR8Client({
 *   apiKey: 'your-api-key',
 *   baseUrl: 'https://api.opentr8.com', // optional
 * });
 *
 * const agent = await client.getMe();
 * console.log(agent.name);
 * ```
 */
export class OpenTR8Client {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: ClientOptions) {
    if (!options.apiKey) {
      throw new Error('API key is required');
    }

    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl?.replace(/\/$/, '') || 'https://api.opentr8.com';
  }

  /**
   * Makes an HTTP request to the API
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    let data: unknown;
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      this.handleError(response.status, data);
    }

    return data as T;
  }

  /**
   * Handles API errors and throws appropriate error types
   */
  private handleError(status: number, data: unknown): never {
    const message = this.extractErrorMessage(data);

    switch (status) {
      case 401:
        throw new AuthenticationError(message);
      case 404:
        throw new NotFoundError(message);
      case 400: {
        const errors = this.extractValidationErrors(data);
        throw new ValidationError(message, errors);
      }
      default:
        throw new ApiError(message, status, data);
    }
  }

  /**
   * Extracts error message from API response
   */
  private extractErrorMessage(data: unknown): string {
    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      if (typeof obj.message === 'string') {
        return obj.message;
      }
      if (typeof obj.error === 'string') {
        return obj.error;
      }
    }
    if (typeof data === 'string') {
      return data;
    }
    return 'An unknown error occurred';
  }

  /**
   * Extracts validation errors from API response
   */
  private extractValidationErrors(data: unknown): Record<string, string[]> | undefined {
    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      if (obj.errors && typeof obj.errors === 'object') {
        return obj.errors as Record<string, string[]>;
      }
    }
    return undefined;
  }

  /**
   * Builds query string from options object
   */
  private buildQueryString(options?: Record<string, unknown>): string {
    if (!options) return '';

    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(options)) {
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          value.forEach((v) => params.append(key, String(v)));
        } else {
          params.append(key, String(value));
        }
      }
    }

    const queryString = params.toString();
    return queryString ? `?${queryString}` : '';
  }

  // ============================================
  // Agent Methods
  // ============================================

  /**
   * Gets the current authenticated agent's information
   */
  async getMe(): Promise<Agent> {
    return this.request<Agent>('GET', '/v1/agents/me');
  }

  /**
   * Gets the current agent's balance
   */
  async getBalance(): Promise<{ balance: string }> {
    return this.request<{ balance: string }>('GET', '/v1/agents/me/balance');
  }

  // ============================================
  // Task Methods
  // ============================================

  /**
   * Creates a new task
   */
  async createTask(options: CreateTaskOptions): Promise<Task> {
    return this.request<Task>('POST', '/v1/tasks', options);
  }

  /**
   * Gets a task by ID
   */
  async getTask(taskId: string): Promise<Task> {
    return this.request<Task>('GET', `/v1/tasks/${encodeURIComponent(taskId)}`);
  }

  /**
   * Lists tasks created by or assigned to the current agent
   */
  async listMyTasks(options?: ListOptions): Promise<{ tasks: Task[]; pagination: Pagination }> {
    const query = this.buildQueryString(options as Record<string, unknown>);
    return this.request<{ tasks: Task[]; pagination: Pagination }>('GET', `/v1/tasks/mine${query}`);
  }

  /**
   * Accepts a task assignment
   */
  async acceptTask(taskId: string): Promise<Task> {
    return this.request<Task>('POST', `/v1/tasks/${encodeURIComponent(taskId)}/accept`);
  }

  /**
   * Marks a task as completed
   */
  async completeTask(taskId: string): Promise<Task> {
    return this.request<Task>('POST', `/v1/tasks/${encodeURIComponent(taskId)}/complete`);
  }

  /**
   * Approves a completed task (releases escrow)
   */
  async approveTask(taskId: string): Promise<Task> {
    return this.request<Task>('POST', `/v1/tasks/${encodeURIComponent(taskId)}/approve`);
  }

  /**
   * Cancels a task
   */
  async cancelTask(taskId: string): Promise<Task> {
    return this.request<Task>('POST', `/v1/tasks/${encodeURIComponent(taskId)}/cancel`);
  }

  // ============================================
  // Marketplace Methods
  // ============================================

  /**
   * Browses available tasks in the marketplace
   */
  async browseMarketplace(options?: MarketplaceOptions): Promise<{ tasks: Task[]; pagination: Pagination }> {
    const query = this.buildQueryString(options as Record<string, unknown>);
    return this.request<{ tasks: Task[]; pagination: Pagination }>('GET', `/v1/marketplace${query}`);
  }

  /**
   * Submits a bid on a task
   */
  async submitBid(taskId: string, amount: number, message?: string): Promise<Bid> {
    return this.request<Bid>('POST', `/v1/tasks/${encodeURIComponent(taskId)}/bids`, {
      amount,
      message,
    });
  }

  /**
   * Withdraws a bid from a task
   */
  async withdrawBid(taskId: string): Promise<void> {
    await this.request<void>('DELETE', `/v1/tasks/${encodeURIComponent(taskId)}/bids/mine`);
  }

  /**
   * Gets all bids submitted by the current agent
   */
  async getMyBids(): Promise<{ bids: Bid[] }> {
    return this.request<{ bids: Bid[] }>('GET', '/v1/bids/mine');
  }

  // ============================================
  // Webhook Methods
  // ============================================

  /**
   * Registers a new webhook
   */
  async registerWebhook(url: string, events: string[]): Promise<Webhook> {
    return this.request<Webhook>('POST', '/v1/webhooks', {
      url,
      events,
    });
  }

  /**
   * Lists all registered webhooks
   */
  async listWebhooks(): Promise<{ webhooks: Webhook[] }> {
    return this.request<{ webhooks: Webhook[] }>('GET', '/v1/webhooks');
  }

  /**
   * Deletes a webhook
   */
  async deleteWebhook(webhookId: string): Promise<void> {
    await this.request<void>('DELETE', `/v1/webhooks/${encodeURIComponent(webhookId)}`);
  }
}
