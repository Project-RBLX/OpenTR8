/**
 * Tests for /agents routes
 */
import { Express } from 'express';
import {
  setupApp,
  testRequest,
  authHeader,
  resetMocks,
  createTestAgent,
  mockPrisma,
} from '../setup.js';

describe('/agents routes', () => {
  let app: Express;

  beforeAll(async () => {
    app = await setupApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  // ============================================================================
  // POST /agents - Agent Registration
  // ============================================================================

  describe('POST /agents', () => {
    it('should register a new agent successfully', async () => {
      const response = await testRequest(app)
        .post('/agents')
        .send({ name: 'Test Agent' })
        .expect(201);

      expect(response.body).toMatchObject({
        name: 'Test Agent',
        message: 'Save your API key - it will not be shown again!',
      });
      expect(response.body.id).toBeDefined();
      expect(response.body.apiKey).toBeDefined();
      expect(response.body.apiKey).toMatch(/^otr8_/);
      expect(response.body.balance).toBeDefined();
      expect(response.body.createdAt).toBeDefined();

      // Verify prisma transaction was called
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('should register agent with optional metadata', async () => {
      const metadata = { type: 'assistant', version: '1.0' };
      const response = await testRequest(app)
        .post('/agents')
        .send({ name: 'Meta Agent', metadata })
        .expect(201);

      expect(response.body.name).toBe('Meta Agent');
      expect(response.body.apiKey).toBeDefined();
    });

    it('should return 400 for missing name', async () => {
      const response = await testRequest(app)
        .post('/agents')
        .send({})
        .expect(400);

      expect(response.body.error.code).toBe('BAD_REQUEST');
      expect(response.body.error.message).toBe('Invalid request body');
      expect(response.body.error.details.errors).toBeDefined();
    });

    it('should return 400 for empty name', async () => {
      const response = await testRequest(app)
        .post('/agents')
        .send({ name: '' })
        .expect(400);

      expect(response.body.error.code).toBe('BAD_REQUEST');
    });

    it('should return 400 for name that is too long', async () => {
      const longName = 'a'.repeat(101);
      const response = await testRequest(app)
        .post('/agents')
        .send({ name: longName })
        .expect(400);

      expect(response.body.error.code).toBe('BAD_REQUEST');
    });

    it('should return 400 for invalid metadata type', async () => {
      const response = await testRequest(app)
        .post('/agents')
        .send({ name: 'Test', metadata: 'invalid string' })
        .expect(400);

      expect(response.body.error.code).toBe('BAD_REQUEST');
    });
  });

  // ============================================================================
  // GET /agents/me - Get Current Agent
  // ============================================================================

  describe('GET /agents/me', () => {
    it('should return agent profile for authenticated user', async () => {
      const { agent, apiKey } = await createTestAgent('My Agent', BigInt(5000));

      const response = await testRequest(app)
        .get('/agents/me')
        .set(authHeader(apiKey))
        .expect(200);

      expect(response.body).toMatchObject({
        id: agent.id,
        name: 'My Agent',
        balance: '5000',
      });
      expect(response.body.createdAt).toBeDefined();
      expect(response.body.updatedAt).toBeDefined();
    });

    it('should return 401 without authorization header', async () => {
      const response = await testRequest(app)
        .get('/agents/me')
        .expect(401);

      expect(response.body.error.code).toBe('UNAUTHORIZED');
      expect(response.body.error.message).toBe('Missing Authorization header');
    });

    it('should return 401 for invalid API key', async () => {
      const response = await testRequest(app)
        .get('/agents/me')
        .set(authHeader('otr8_invalid_key_1234567890abcdef1234567890abcdef1234567890abcdef12345678'))
        .expect(401);

      expect(response.body.error.code).toBe('UNAUTHORIZED');
      expect(response.body.error.message).toBe('Invalid API key');
    });

    it('should return 401 for malformed authorization header', async () => {
      const response = await testRequest(app)
        .get('/agents/me')
        .set({ Authorization: 'Basic abc123' })
        .expect(401);

      expect(response.body.error.code).toBe('UNAUTHORIZED');
      expect(response.body.error.message).toContain('Invalid Authorization header format');
    });

    it('should return 401 for missing token after Bearer', async () => {
      const response = await testRequest(app)
        .get('/agents/me')
        .set({ Authorization: 'Bearer ' })
        .expect(401);

      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should include metadata in response if present', async () => {
      const { apiKey, agent } = await createTestAgent('Agent with Meta');
      // Manually set metadata
      agent.metadata = { capabilities: ['code', 'chat'] };

      const response = await testRequest(app)
        .get('/agents/me')
        .set(authHeader(apiKey))
        .expect(200);

      expect(response.body.metadata).toEqual({ capabilities: ['code', 'chat'] });
    });

    it('should return null metadata when not set', async () => {
      const { apiKey } = await createTestAgent('No Meta Agent');

      const response = await testRequest(app)
        .get('/agents/me')
        .set(authHeader(apiKey))
        .expect(200);

      expect(response.body.metadata).toBeNull();
    });
  });
});
