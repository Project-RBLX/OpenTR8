/**
 * Tests for /wallet routes
 */
import { Express } from 'express';
import {
  setupApp,
  testRequest,
  authHeader,
  resetMocks,
  createTestAgent,
  createTestTransaction,
} from '../setup.js';

describe('/wallet routes', () => {
  let app: Express;

  beforeAll(async () => {
    app = await setupApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  // ============================================================================
  // GET /wallet - Get Balance
  // ============================================================================

  describe('GET /wallet', () => {
    it('should return wallet balance for authenticated user', async () => {
      const { apiKey, agent } = await createTestAgent('Wallet User', BigInt(5000));

      const response = await testRequest(app)
        .get('/wallet')
        .set(authHeader(apiKey))
        .expect(200);

      expect(response.body).toEqual({
        balance: '5000',
      });
    });

    it('should return zero balance when agent has no credits', async () => {
      const { apiKey } = await createTestAgent('Broke Agent', BigInt(0));

      const response = await testRequest(app)
        .get('/wallet')
        .set(authHeader(apiKey))
        .expect(200);

      expect(response.body).toEqual({
        balance: '0',
      });
    });

    it('should return 401 without authentication', async () => {
      const response = await testRequest(app)
        .get('/wallet')
        .expect(401);

      expect(response.body.error.code).toBe('UNAUTHORIZED');
      expect(response.body.error.message).toBe('Missing Authorization header');
    });

    it('should return 401 for invalid API key', async () => {
      const response = await testRequest(app)
        .get('/wallet')
        .set(authHeader('otr8_invalid_key_1234567890abcdef1234567890abcdef1234567890abcdef12345678'))
        .expect(401);

      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  // ============================================================================
  // GET /wallet/transactions - Get Transaction History
  // ============================================================================

  describe('GET /wallet/transactions', () => {
    it('should return transaction history for authenticated user', async () => {
      const { apiKey, agent } = await createTestAgent('Transaction User', BigInt(10000));

      // Create some transactions
      await createTestTransaction(agent.id, 'CREDIT', BigInt(10000), BigInt(10000), {
        description: 'Initial credit',
      });
      await createTestTransaction(agent.id, 'LOCK', BigInt(-500), BigInt(9500), {
        taskId: 'task-1',
        description: 'Locked for task',
      });
      await createTestTransaction(agent.id, 'EARN', BigInt(200), BigInt(9700), {
        taskId: 'task-2',
        description: 'Earned from completed task',
      });

      const response = await testRequest(app)
        .get('/wallet/transactions')
        .set(authHeader(apiKey))
        .expect(200);

      expect(response.body.transactions).toHaveLength(3);
      expect(response.body.pagination).toMatchObject({
        total: 3,
        limit: 50,
        offset: 0,
        hasMore: false,
      });

      // Verify transaction structure
      const firstTransaction = response.body.transactions[0];
      expect(firstTransaction).toHaveProperty('id');
      expect(firstTransaction).toHaveProperty('type');
      expect(firstTransaction).toHaveProperty('amount');
      expect(firstTransaction).toHaveProperty('balance');
      expect(firstTransaction).toHaveProperty('createdAt');
    });

    it('should return empty array when no transactions exist', async () => {
      const { apiKey } = await createTestAgent('New Agent');

      const response = await testRequest(app)
        .get('/wallet/transactions')
        .set(authHeader(apiKey))
        .expect(200);

      expect(response.body.transactions).toEqual([]);
      expect(response.body.pagination).toMatchObject({
        total: 0,
        hasMore: false,
      });
    });

    it('should support pagination with limit parameter', async () => {
      const { apiKey, agent } = await createTestAgent('Paginated User');

      // Create 10 transactions
      for (let i = 0; i < 10; i++) {
        await createTestTransaction(agent.id, 'CREDIT', BigInt(100), BigInt((i + 1) * 100));
      }

      const response = await testRequest(app)
        .get('/wallet/transactions?limit=5')
        .set(authHeader(apiKey))
        .expect(200);

      expect(response.body.transactions).toHaveLength(5);
      expect(response.body.pagination).toMatchObject({
        total: 10,
        limit: 5,
        offset: 0,
        hasMore: true,
      });
    });

    it('should support pagination with offset parameter', async () => {
      const { apiKey, agent } = await createTestAgent('Offset User');

      // Create 10 transactions
      for (let i = 0; i < 10; i++) {
        await createTestTransaction(agent.id, 'CREDIT', BigInt(100), BigInt((i + 1) * 100));
      }

      const response = await testRequest(app)
        .get('/wallet/transactions?limit=5&offset=5')
        .set(authHeader(apiKey))
        .expect(200);

      expect(response.body.transactions).toHaveLength(5);
      expect(response.body.pagination).toMatchObject({
        total: 10,
        limit: 5,
        offset: 5,
        hasMore: false,
      });
    });

    it('should cap limit at 100', async () => {
      const { apiKey, agent } = await createTestAgent('Max Limit User');

      // Create a transaction
      await createTestTransaction(agent.id, 'CREDIT', BigInt(100), BigInt(100));

      const response = await testRequest(app)
        .get('/wallet/transactions?limit=500')
        .set(authHeader(apiKey))
        .expect(200);

      // Limit should be capped at 100
      expect(response.body.pagination.limit).toBe(100);
    });

    it('should handle invalid limit gracefully (defaults to 50)', async () => {
      const { apiKey, agent } = await createTestAgent('Invalid Limit User');
      await createTestTransaction(agent.id, 'CREDIT', BigInt(100), BigInt(100));

      const response = await testRequest(app)
        .get('/wallet/transactions?limit=invalid')
        .set(authHeader(apiKey))
        .expect(200);

      expect(response.body.pagination.limit).toBe(50);
    });

    it('should handle invalid offset gracefully (defaults to 0)', async () => {
      const { apiKey, agent } = await createTestAgent('Invalid Offset User');
      await createTestTransaction(agent.id, 'CREDIT', BigInt(100), BigInt(100));

      const response = await testRequest(app)
        .get('/wallet/transactions?offset=invalid')
        .set(authHeader(apiKey))
        .expect(200);

      expect(response.body.pagination.offset).toBe(0);
    });

    it('should return 401 without authentication', async () => {
      const response = await testRequest(app)
        .get('/wallet/transactions')
        .expect(401);

      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should only return transactions for the authenticated user', async () => {
      const { apiKey: user1Key, agent: user1 } = await createTestAgent('User 1');
      const { apiKey: user2Key, agent: user2 } = await createTestAgent('User 2');

      // Create transactions for both users
      await createTestTransaction(user1.id, 'CREDIT', BigInt(1000), BigInt(1000));
      await createTestTransaction(user1.id, 'LOCK', BigInt(-500), BigInt(500));
      await createTestTransaction(user2.id, 'CREDIT', BigInt(5000), BigInt(5000));

      // User 1 should only see their 2 transactions
      const response1 = await testRequest(app)
        .get('/wallet/transactions')
        .set(authHeader(user1Key))
        .expect(200);

      expect(response1.body.transactions).toHaveLength(2);
      response1.body.transactions.forEach((t: { amount: string }) => {
        expect(['1000', '-500']).toContain(t.amount);
      });

      // User 2 should only see their 1 transaction
      const response2 = await testRequest(app)
        .get('/wallet/transactions')
        .set(authHeader(user2Key))
        .expect(200);

      expect(response2.body.transactions).toHaveLength(1);
      expect(response2.body.transactions[0].amount).toBe('5000');
    });

    it('should include taskId when present', async () => {
      const { apiKey, agent } = await createTestAgent('Task Reference User');

      await createTestTransaction(agent.id, 'LOCK', BigInt(-500), BigInt(9500), {
        taskId: 'test-task-123',
        description: 'Locked for task',
      });

      const response = await testRequest(app)
        .get('/wallet/transactions')
        .set(authHeader(apiKey))
        .expect(200);

      expect(response.body.transactions[0].taskId).toBe('test-task-123');
      expect(response.body.transactions[0].description).toBe('Locked for task');
    });

    it('should handle null taskId and description', async () => {
      const { apiKey, agent } = await createTestAgent('Null Fields User');

      await createTestTransaction(agent.id, 'CREDIT', BigInt(10000), BigInt(10000));

      const response = await testRequest(app)
        .get('/wallet/transactions')
        .set(authHeader(apiKey))
        .expect(200);

      expect(response.body.transactions[0].taskId).toBeNull();
      expect(response.body.transactions[0].description).toBeNull();
    });
  });
});
