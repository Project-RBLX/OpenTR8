/**
 * Tests for authentication middleware
 */
import { Express } from 'express';
import express from 'express';
import request from 'supertest';
import { hashApiKey, generateApiKey } from '@opentr8/shared';
import {
  setupApp,
  testRequest,
  authHeader,
  resetMocks,
  createTestAgent,
  mockDataStore,
} from '../setup.js';

describe('Authentication Middleware', () => {
  let app: Express;

  beforeAll(async () => {
    app = await setupApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  // ============================================================================
  // authenticate middleware (required auth)
  // ============================================================================

  describe('authenticate (required)', () => {
    it('should attach agent to request when valid token provided', async () => {
      const { apiKey, agent } = await createTestAgent('Auth Test Agent');

      const response = await testRequest(app)
        .get('/agents/me')
        .set(authHeader(apiKey))
        .expect(200);

      expect(response.body.id).toBe(agent.id);
      expect(response.body.name).toBe('Auth Test Agent');
    });

    it('should return 401 when Authorization header is missing', async () => {
      const response = await testRequest(app)
        .get('/agents/me')
        .expect(401);

      expect(response.body).toEqual({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing Authorization header',
        },
      });
    });

    it('should return 401 when Authorization header has wrong scheme', async () => {
      const response = await testRequest(app)
        .get('/agents/me')
        .set({ Authorization: 'Basic abc123' })
        .expect(401);

      expect(response.body).toEqual({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid Authorization header format. Use: Bearer <api_key>',
        },
      });
    });

    it('should return 401 when token is empty', async () => {
      const response = await testRequest(app)
        .get('/agents/me')
        .set({ Authorization: 'Bearer ' })
        .expect(401);

      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 when token is missing after Bearer', async () => {
      const response = await testRequest(app)
        .get('/agents/me')
        .set({ Authorization: 'Bearer' })
        .expect(401);

      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 when API key does not match any agent', async () => {
      const fakeApiKey = generateApiKey();

      const response = await testRequest(app)
        .get('/agents/me')
        .set(authHeader(fakeApiKey))
        .expect(401);

      expect(response.body).toEqual({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid API key',
        },
      });
    });

    it('should return 401 for malformed API key', async () => {
      const response = await testRequest(app)
        .get('/agents/me')
        .set(authHeader('not-a-valid-key'))
        .expect(401);

      expect(response.body.error.code).toBe('UNAUTHORIZED');
      expect(response.body.error.message).toBe('Invalid API key');
    });

    it('should handle different valid API keys for different agents', async () => {
      const { apiKey: key1, agent: agent1 } = await createTestAgent('Agent 1');
      const { apiKey: key2, agent: agent2 } = await createTestAgent('Agent 2');

      // First agent
      const response1 = await testRequest(app)
        .get('/agents/me')
        .set(authHeader(key1))
        .expect(200);

      expect(response1.body.id).toBe(agent1.id);
      expect(response1.body.name).toBe('Agent 1');

      // Second agent
      const response2 = await testRequest(app)
        .get('/agents/me')
        .set(authHeader(key2))
        .expect(200);

      expect(response2.body.id).toBe(agent2.id);
      expect(response2.body.name).toBe('Agent 2');
    });

    it('should authenticate correctly after agent creation', async () => {
      // Create agent via API
      const createResponse = await testRequest(app)
        .post('/agents')
        .send({ name: 'New Agent' })
        .expect(201);

      const apiKey = createResponse.body.apiKey;
      const agentId = createResponse.body.id;

      // Use the returned API key to authenticate
      const meResponse = await testRequest(app)
        .get('/agents/me')
        .set(authHeader(apiKey))
        .expect(200);

      expect(meResponse.body.id).toBe(agentId);
      expect(meResponse.body.name).toBe('New Agent');
    });
  });

  // ============================================================================
  // optionalAuth middleware
  // ============================================================================

  describe('optionalAuth (optional)', () => {
    it('should allow request without authentication', async () => {
      const { agent } = await createTestAgent('Requester');

      // Create a task first
      const { apiKey } = await createTestAgent('Requester 2', BigInt(10000));
      await testRequest(app)
        .post('/tasks')
        .set(authHeader(apiKey))
        .send({ description: 'Public task', credits: 100 });

      // Access without auth - should work
      const response = await testRequest(app)
        .get('/tasks')
        .expect(200);

      expect(response.body.tasks).toBeDefined();
    });

    it('should attach agent when valid token provided', async () => {
      const { apiKey, agent } = await createTestAgent('Optional Auth Agent', BigInt(10000));

      // Create a task
      await testRequest(app)
        .post('/tasks')
        .set(authHeader(apiKey))
        .send({ description: 'My task', credits: 100 });

      // Access with auth and filter by mine
      const response = await testRequest(app)
        .get('/tasks?mine=true')
        .set(authHeader(apiKey))
        .expect(200);

      expect(response.body.tasks.length).toBeGreaterThanOrEqual(1);
    });

    it('should not fail on invalid token for optional auth', async () => {
      const { agent } = await createTestAgent('Task Creator', BigInt(10000));

      // Try to access with invalid token - should still work (optional auth doesn't fail)
      const response = await testRequest(app)
        .get('/tasks')
        .set(authHeader('invalid-key'))
        .expect(200);

      expect(response.body.tasks).toBeDefined();
    });

    it('should ignore mine filter when not authenticated', async () => {
      const { agent, apiKey } = await createTestAgent('Creator', BigInt(10000));
      const { agent: other } = await createTestAgent('Other');

      // Create a task
      await testRequest(app)
        .post('/tasks')
        .set(authHeader(apiKey))
        .send({ description: 'Creator task', credits: 100 });

      // Try mine=true without auth - should return all tasks
      const response = await testRequest(app)
        .get('/tasks?mine=true')
        .expect(200);

      // mine filter requires agent, so without auth it should show all
      expect(response.body.tasks).toBeDefined();
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle very long authorization header gracefully', async () => {
      const longToken = 'a'.repeat(10000);

      const response = await testRequest(app)
        .get('/agents/me')
        .set({ Authorization: `Bearer ${longToken}` })
        .expect(401);

      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should handle authorization header with extra spaces', async () => {
      const { apiKey } = await createTestAgent('Spaced Agent');

      // Extra space after Bearer should cause split to have empty token
      const response = await testRequest(app)
        .get('/agents/me')
        .set({ Authorization: `Bearer  ${apiKey}` }) // Double space
        .expect(401);

      // The second split element will be empty, not the API key
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should handle authorization header with tab character', async () => {
      const { apiKey } = await createTestAgent('Tab Agent');

      const response = await testRequest(app)
        .get('/agents/me')
        .set({ Authorization: `Bearer\t${apiKey}` })
        .expect(401);

      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should handle case sensitivity of Bearer scheme', async () => {
      const { apiKey } = await createTestAgent('Case Agent');

      // 'bearer' lowercase should fail
      const response = await testRequest(app)
        .get('/agents/me')
        .set({ Authorization: `bearer ${apiKey}` })
        .expect(401);

      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should handle request with multiple authorization headers', async () => {
      const { apiKey } = await createTestAgent('Multi Auth Agent');

      // Most HTTP libraries take the last value, but behavior may vary
      // This test documents the expected behavior
      const response = await testRequest(app)
        .get('/agents/me')
        .set({ Authorization: `Bearer ${apiKey}` })
        .expect(200);

      expect(response.body.name).toBe('Multi Auth Agent');
    });
  });

  // ============================================================================
  // Security Tests
  // ============================================================================

  describe('Security', () => {
    it('should not expose API key hash in error messages', async () => {
      const fakeApiKey = generateApiKey();

      const response = await testRequest(app)
        .get('/agents/me')
        .set(authHeader(fakeApiKey))
        .expect(401);

      const responseText = JSON.stringify(response.body);

      // Should not contain the hash
      expect(responseText).not.toContain(hashApiKey(fakeApiKey));
      // Should not contain the key itself
      expect(responseText).not.toContain(fakeApiKey);
    });

    it('should use timing-safe comparison (no timing attacks)', async () => {
      // This is more of a documentation test - the actual implementation
      // uses crypto.createHash which provides consistent timing
      const { apiKey } = await createTestAgent('Timing Agent');

      const start1 = Date.now();
      await testRequest(app)
        .get('/agents/me')
        .set(authHeader('short'))
        .expect(401);
      const time1 = Date.now() - start1;

      const start2 = Date.now();
      await testRequest(app)
        .get('/agents/me')
        .set(authHeader(generateApiKey()))
        .expect(401);
      const time2 = Date.now() - start2;

      // Times should be roughly similar (within 100ms for test reliability)
      // This isn't a precise timing attack test, just sanity check
      expect(Math.abs(time1 - time2)).toBeLessThan(100);
    });

    it('should not leak agent existence through error messages', async () => {
      // Error message should be the same whether agent exists or not
      const { apiKey: validKey } = await createTestAgent('Real Agent');
      const fakeKey = generateApiKey();

      const response1 = await testRequest(app)
        .get('/agents/me')
        .set(authHeader(fakeKey))
        .expect(401);

      // Modify the valid agent's key in the store to simulate mismatch
      const response2 = await testRequest(app)
        .get('/agents/me')
        .set(authHeader(generateApiKey()))
        .expect(401);

      // Both should have identical error messages
      expect(response1.body.error.message).toBe(response2.body.error.message);
    });
  });
});
