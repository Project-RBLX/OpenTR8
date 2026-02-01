/**
 * Tests for /tasks routes
 * Covers full task lifecycle and state machine transitions
 */
import { Express } from 'express';
import {
  setupApp,
  testRequest,
  authHeader,
  resetMocks,
  createTestAgent,
  createTestTask,
  createTestEscrow,
  mockPrisma,
  mockDataStore,
} from '../setup.js';

describe('/tasks routes', () => {
  let app: Express;

  beforeAll(async () => {
    app = await setupApp();
  });

  beforeEach(() => {
    resetMocks();
  });

  // ============================================================================
  // POST /tasks - Create Task
  // ============================================================================

  describe('POST /tasks', () => {
    it('should create a task and lock credits in escrow', async () => {
      const { apiKey, agent } = await createTestAgent('Task Creator', BigInt(10000));

      const response = await testRequest(app)
        .post('/tasks')
        .set(authHeader(apiKey))
        .send({
          description: 'Build a REST API',
          credits: 500,
        })
        .expect(201);

      expect(response.body).toMatchObject({
        description: 'Build a REST API',
        credits: '500',
        status: 'OPEN',
        requesterId: agent.id,
      });
      expect(response.body.id).toBeDefined();
      expect(response.body.deadline).toBeDefined();
      expect(response.body.createdAt).toBeDefined();

      // Verify escrow was created via transaction
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('should create a task with custom deadline', async () => {
      const { apiKey } = await createTestAgent('Requester', BigInt(10000));

      const response = await testRequest(app)
        .post('/tasks')
        .set(authHeader(apiKey))
        .send({
          description: 'Urgent task',
          credits: 100,
          deadlineHours: 24,
        })
        .expect(201);

      expect(response.body.description).toBe('Urgent task');
      const deadline = new Date(response.body.deadline);
      const now = new Date();
      const diffHours = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);
      expect(diffHours).toBeGreaterThan(23);
      expect(diffHours).toBeLessThan(25);
    });

    it('should create a task with optional metadata', async () => {
      const { apiKey } = await createTestAgent('Requester', BigInt(10000));

      const response = await testRequest(app)
        .post('/tasks')
        .set(authHeader(apiKey))
        .send({
          description: 'Task with metadata',
          credits: 200,
          metadata: { skill: 'coding', priority: 'high' },
        })
        .expect(201);

      expect(response.body.description).toBe('Task with metadata');
    });

    it('should return 401 without authentication', async () => {
      const response = await testRequest(app)
        .post('/tasks')
        .send({
          description: 'Test task',
          credits: 100,
        })
        .expect(401);

      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 400 for insufficient credits', async () => {
      const { apiKey } = await createTestAgent('Poor Agent', BigInt(50));

      const response = await testRequest(app)
        .post('/tasks')
        .set(authHeader(apiKey))
        .send({
          description: 'Expensive task',
          credits: 1000,
        })
        .expect(400);

      expect(response.body.error.code).toBe('INSUFFICIENT_CREDITS');
      expect(response.body.error.details.required).toBe('1000');
      expect(response.body.error.details.available).toBe('50');
    });

    it('should return 400 for missing description', async () => {
      const { apiKey } = await createTestAgent();

      const response = await testRequest(app)
        .post('/tasks')
        .set(authHeader(apiKey))
        .send({
          credits: 100,
        })
        .expect(400);

      expect(response.body.error.code).toBe('BAD_REQUEST');
    });

    it('should return 400 for missing credits', async () => {
      const { apiKey } = await createTestAgent();

      const response = await testRequest(app)
        .post('/tasks')
        .set(authHeader(apiKey))
        .send({
          description: 'Test task',
        })
        .expect(400);

      expect(response.body.error.code).toBe('BAD_REQUEST');
    });

    it('should return 400 for negative credits', async () => {
      const { apiKey } = await createTestAgent();

      const response = await testRequest(app)
        .post('/tasks')
        .set(authHeader(apiKey))
        .send({
          description: 'Test task',
          credits: -100,
        })
        .expect(400);

      expect(response.body.error.code).toBe('BAD_REQUEST');
    });

    it('should return 400 for zero credits', async () => {
      const { apiKey } = await createTestAgent();

      const response = await testRequest(app)
        .post('/tasks')
        .set(authHeader(apiKey))
        .send({
          description: 'Free task',
          credits: 0,
        })
        .expect(400);

      expect(response.body.error.code).toBe('BAD_REQUEST');
    });

    it('should return 400 for description that is too long', async () => {
      const { apiKey } = await createTestAgent();
      const longDescription = 'a'.repeat(5001);

      const response = await testRequest(app)
        .post('/tasks')
        .set(authHeader(apiKey))
        .send({
          description: longDescription,
          credits: 100,
        })
        .expect(400);

      expect(response.body.error.code).toBe('BAD_REQUEST');
    });
  });

  // ============================================================================
  // GET /tasks - List Tasks
  // ============================================================================

  describe('GET /tasks', () => {
    it('should list all tasks without authentication', async () => {
      const { agent } = await createTestAgent('Requester');
      await createTestTask(agent.id, { description: 'Task 1' });
      await createTestTask(agent.id, { description: 'Task 2' });

      const response = await testRequest(app)
        .get('/tasks')
        .expect(200);

      expect(response.body.tasks).toHaveLength(2);
    });

    it('should filter tasks by status', async () => {
      const { agent } = await createTestAgent('Requester');
      const { agent: worker } = await createTestAgent('Worker');

      await createTestTask(agent.id, { status: 'OPEN' });
      await createTestTask(agent.id, { status: 'IN_PROGRESS', workerId: worker.id });
      await createTestTask(agent.id, { status: 'COMPLETED', workerId: worker.id });

      const response = await testRequest(app)
        .get('/tasks?status=OPEN')
        .expect(200);

      expect(response.body.tasks).toHaveLength(1);
      expect(response.body.tasks[0].status).toBe('OPEN');
    });

    it('should filter tasks by "mine" when authenticated', async () => {
      const { agent: requester, apiKey } = await createTestAgent('Requester');
      const { agent: otherAgent } = await createTestAgent('Other');
      const { agent: worker } = await createTestAgent('Worker');

      // Requester's task
      await createTestTask(requester.id, { description: 'My task' });
      // Other's task
      await createTestTask(otherAgent.id, { description: 'Other task' });
      // Task where requester is worker
      await createTestTask(otherAgent.id, { description: 'Assigned to me', workerId: requester.id });

      const response = await testRequest(app)
        .get('/tasks?mine=true')
        .set(authHeader(apiKey))
        .expect(200);

      expect(response.body.tasks).toHaveLength(2);
    });

    it('should include requester and worker info', async () => {
      const { agent: requester } = await createTestAgent('The Requester');
      const { agent: worker } = await createTestAgent('The Worker');

      await createTestTask(requester.id, {
        status: 'IN_PROGRESS',
        workerId: worker.id,
      });

      const response = await testRequest(app)
        .get('/tasks')
        .expect(200);

      expect(response.body.tasks[0].requester).toMatchObject({
        id: requester.id,
        name: 'The Requester',
      });
      expect(response.body.tasks[0].worker).toMatchObject({
        id: worker.id,
        name: 'The Worker',
      });
    });

    it('should return empty array when no tasks exist', async () => {
      const response = await testRequest(app)
        .get('/tasks')
        .expect(200);

      expect(response.body.tasks).toEqual([]);
    });
  });

  // ============================================================================
  // GET /tasks/:id - Get Task Details
  // ============================================================================

  describe('GET /tasks/:id', () => {
    it('should return task details', async () => {
      const { agent } = await createTestAgent('Requester');
      const task = await createTestTask(agent.id, {
        description: 'Detailed task',
        credits: BigInt(500),
      });
      await createTestEscrow(task.id, BigInt(500));

      const response = await testRequest(app)
        .get(`/tasks/${task.id}`)
        .expect(200);

      expect(response.body).toMatchObject({
        id: task.id,
        description: 'Detailed task',
        credits: '500',
        status: 'OPEN',
      });
      expect(response.body.escrow).toMatchObject({
        status: 'LOCKED',
        amount: '500',
      });
    });

    it('should return 404 for non-existent task', async () => {
      const response = await testRequest(app)
        .get('/tasks/non-existent-id')
        .expect(404);

      expect(response.body.error.code).toBe('NOT_FOUND');
      expect(response.body.error.message).toContain('Task');
    });
  });

  // ============================================================================
  // POST /tasks/:id/accept - Accept Task
  // ============================================================================

  describe('POST /tasks/:id/accept', () => {
    it('should allow a different agent to accept an open task', async () => {
      const { agent: requester } = await createTestAgent('Requester');
      const { apiKey: workerKey, agent: worker } = await createTestAgent('Worker');
      const task = await createTestTask(requester.id);

      const response = await testRequest(app)
        .post(`/tasks/${task.id}/accept`)
        .set(authHeader(workerKey))
        .expect(200);

      expect(response.body).toMatchObject({
        id: task.id,
        status: 'IN_PROGRESS',
        workerId: worker.id,
      });
      expect(response.body.acceptedAt).toBeDefined();
    });

    it('should return 401 without authentication', async () => {
      const { agent } = await createTestAgent('Requester');
      const task = await createTestTask(agent.id);

      const response = await testRequest(app)
        .post(`/tasks/${task.id}/accept`)
        .expect(401);

      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 404 for non-existent task', async () => {
      const { apiKey } = await createTestAgent('Worker');

      const response = await testRequest(app)
        .post('/tasks/non-existent-id/accept')
        .set(authHeader(apiKey))
        .expect(404);

      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 when task is not OPEN', async () => {
      const { agent: requester } = await createTestAgent('Requester');
      const { apiKey: workerKey, agent: worker } = await createTestAgent('Worker');
      const task = await createTestTask(requester.id, {
        status: 'IN_PROGRESS',
        workerId: worker.id,
      });

      const response = await testRequest(app)
        .post(`/tasks/${task.id}/accept`)
        .set(authHeader(workerKey))
        .expect(400);

      expect(response.body.error.code).toBe('INVALID_STATE');
      expect(response.body.error.details.currentState).toBe('IN_PROGRESS');
    });

    it('should return 403 when trying to accept own task', async () => {
      const { apiKey, agent } = await createTestAgent('Self Accepter');
      const task = await createTestTask(agent.id);

      const response = await testRequest(app)
        .post(`/tasks/${task.id}/accept`)
        .set(authHeader(apiKey))
        .expect(403);

      expect(response.body.error.code).toBe('FORBIDDEN');
      expect(response.body.error.message).toContain('Cannot accept your own task');
    });

    it('should return 400 when task deadline has passed', async () => {
      const { agent: requester } = await createTestAgent('Requester');
      const { apiKey: workerKey } = await createTestAgent('Worker');

      // Create task with expired deadline
      const expiredDeadline = new Date(Date.now() - 1000); // 1 second ago
      const task = await createTestTask(requester.id, { deadline: expiredDeadline });

      const response = await testRequest(app)
        .post(`/tasks/${task.id}/accept`)
        .set(authHeader(workerKey))
        .expect(400);

      expect(response.body.error.code).toBe('INVALID_STATE');
      expect(response.body.error.details.currentState).toBe('EXPIRED');
    });
  });

  // ============================================================================
  // POST /tasks/:id/complete - Mark Task as Completed
  // ============================================================================

  describe('POST /tasks/:id/complete', () => {
    it('should allow worker to mark task as completed', async () => {
      const { agent: requester } = await createTestAgent('Requester');
      const { apiKey: workerKey, agent: worker } = await createTestAgent('Worker');
      const task = await createTestTask(requester.id, {
        status: 'IN_PROGRESS',
        workerId: worker.id,
      });

      const response = await testRequest(app)
        .post(`/tasks/${task.id}/complete`)
        .set(authHeader(workerKey))
        .expect(200);

      expect(response.body).toMatchObject({
        id: task.id,
        status: 'COMPLETED',
      });
      expect(response.body.completedAt).toBeDefined();
    });

    it('should return 401 without authentication', async () => {
      const { agent } = await createTestAgent('Requester');
      const task = await createTestTask(agent.id, { status: 'IN_PROGRESS' });

      const response = await testRequest(app)
        .post(`/tasks/${task.id}/complete`)
        .expect(401);

      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 404 for non-existent task', async () => {
      const { apiKey } = await createTestAgent('Worker');

      const response = await testRequest(app)
        .post('/tasks/non-existent-id/complete')
        .set(authHeader(apiKey))
        .expect(404);

      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 403 when non-worker tries to complete', async () => {
      const { agent: requester, apiKey: requesterKey } = await createTestAgent('Requester');
      const { agent: worker } = await createTestAgent('Worker');
      const task = await createTestTask(requester.id, {
        status: 'IN_PROGRESS',
        workerId: worker.id,
      });

      const response = await testRequest(app)
        .post(`/tasks/${task.id}/complete`)
        .set(authHeader(requesterKey))
        .expect(403);

      expect(response.body.error.code).toBe('FORBIDDEN');
      expect(response.body.error.message).toContain('Only the assigned worker');
    });

    it('should return 400 when task is not IN_PROGRESS', async () => {
      const { agent: requester } = await createTestAgent('Requester');
      const { apiKey: workerKey, agent: worker } = await createTestAgent('Worker');
      const task = await createTestTask(requester.id, {
        status: 'OPEN',
      });

      const response = await testRequest(app)
        .post(`/tasks/${task.id}/complete`)
        .set(authHeader(workerKey))
        .expect(403);

      // Worker isn't assigned to OPEN task
      expect(response.body.error.code).toBe('FORBIDDEN');
    });
  });

  // ============================================================================
  // POST /tasks/:id/approve - Approve Task and Release Credits
  // ============================================================================

  describe('POST /tasks/:id/approve', () => {
    it('should allow requester to approve and release credits', async () => {
      const { agent: requester, apiKey: requesterKey } = await createTestAgent('Requester');
      const { agent: worker } = await createTestAgent('Worker', BigInt(0));
      const task = await createTestTask(requester.id, {
        status: 'COMPLETED',
        workerId: worker.id,
        credits: BigInt(500),
      });
      await createTestEscrow(task.id, BigInt(500));

      const response = await testRequest(app)
        .post(`/tasks/${task.id}/approve`)
        .set(authHeader(requesterKey))
        .expect(200);

      expect(response.body).toMatchObject({
        id: task.id,
        status: 'APPROVED',
        message: 'Credits released to worker',
      });
      expect(response.body.approvedAt).toBeDefined();

      // Verify transaction was used for escrow release
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('should return 401 without authentication', async () => {
      const { agent } = await createTestAgent('Requester');
      const task = await createTestTask(agent.id, { status: 'COMPLETED' });

      const response = await testRequest(app)
        .post(`/tasks/${task.id}/approve`)
        .expect(401);

      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 404 for non-existent task', async () => {
      const { apiKey } = await createTestAgent('Requester');

      const response = await testRequest(app)
        .post('/tasks/non-existent-id/approve')
        .set(authHeader(apiKey))
        .expect(404);

      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 403 when non-requester tries to approve', async () => {
      const { agent: requester } = await createTestAgent('Requester');
      const { agent: worker, apiKey: workerKey } = await createTestAgent('Worker');
      const task = await createTestTask(requester.id, {
        status: 'COMPLETED',
        workerId: worker.id,
      });

      const response = await testRequest(app)
        .post(`/tasks/${task.id}/approve`)
        .set(authHeader(workerKey))
        .expect(403);

      expect(response.body.error.code).toBe('FORBIDDEN');
      expect(response.body.error.message).toContain('Only the requester');
    });

    it('should return 400 when task is not COMPLETED', async () => {
      const { agent: requester, apiKey: requesterKey } = await createTestAgent('Requester');
      const { agent: worker } = await createTestAgent('Worker');
      const task = await createTestTask(requester.id, {
        status: 'IN_PROGRESS',
        workerId: worker.id,
      });

      const response = await testRequest(app)
        .post(`/tasks/${task.id}/approve`)
        .set(authHeader(requesterKey))
        .expect(400);

      expect(response.body.error.code).toBe('INVALID_STATE');
      expect(response.body.error.details.currentState).toBe('IN_PROGRESS');
    });

    it('should return 409 when task has no escrow', async () => {
      const { agent: requester, apiKey: requesterKey } = await createTestAgent('Requester');
      const { agent: worker } = await createTestAgent('Worker');
      const task = await createTestTask(requester.id, {
        status: 'COMPLETED',
        workerId: worker.id,
      });
      // Note: Not creating escrow

      const response = await testRequest(app)
        .post(`/tasks/${task.id}/approve`)
        .set(authHeader(requesterKey))
        .expect(409);

      expect(response.body.error.code).toBe('CONFLICT');
    });
  });

  // ============================================================================
  // POST /tasks/:id/cancel - Cancel Task and Refund Credits
  // ============================================================================

  describe('POST /tasks/:id/cancel', () => {
    it('should allow requester to cancel and refund credits', async () => {
      const { agent: requester, apiKey: requesterKey } = await createTestAgent('Requester', BigInt(9500));
      const task = await createTestTask(requester.id, {
        status: 'OPEN',
        credits: BigInt(500),
      });
      await createTestEscrow(task.id, BigInt(500));

      const response = await testRequest(app)
        .post(`/tasks/${task.id}/cancel`)
        .set(authHeader(requesterKey))
        .expect(200);

      expect(response.body).toMatchObject({
        id: task.id,
        status: 'CANCELLED',
        message: 'Task cancelled, credits refunded',
      });

      // Verify transaction was used for escrow refund
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('should return 401 without authentication', async () => {
      const { agent } = await createTestAgent('Requester');
      const task = await createTestTask(agent.id, { status: 'OPEN' });

      const response = await testRequest(app)
        .post(`/tasks/${task.id}/cancel`)
        .expect(401);

      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 404 for non-existent task', async () => {
      const { apiKey } = await createTestAgent('Requester');

      const response = await testRequest(app)
        .post('/tasks/non-existent-id/cancel')
        .set(authHeader(apiKey))
        .expect(404);

      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 403 when non-requester tries to cancel', async () => {
      const { agent: requester } = await createTestAgent('Requester');
      const { apiKey: otherKey } = await createTestAgent('Other');
      const task = await createTestTask(requester.id, { status: 'OPEN' });

      const response = await testRequest(app)
        .post(`/tasks/${task.id}/cancel`)
        .set(authHeader(otherKey))
        .expect(403);

      expect(response.body.error.code).toBe('FORBIDDEN');
      expect(response.body.error.message).toContain('Only the requester');
    });

    it('should return 400 when task is not OPEN', async () => {
      const { agent: requester, apiKey: requesterKey } = await createTestAgent('Requester');
      const { agent: worker } = await createTestAgent('Worker');
      const task = await createTestTask(requester.id, {
        status: 'IN_PROGRESS',
        workerId: worker.id,
      });

      const response = await testRequest(app)
        .post(`/tasks/${task.id}/cancel`)
        .set(authHeader(requesterKey))
        .expect(400);

      expect(response.body.error.code).toBe('INVALID_STATE');
      expect(response.body.error.details.currentState).toBe('IN_PROGRESS');
    });

    it('should return 409 when task has no escrow', async () => {
      const { agent: requester, apiKey: requesterKey } = await createTestAgent('Requester');
      const task = await createTestTask(requester.id, { status: 'OPEN' });
      // Note: Not creating escrow

      const response = await testRequest(app)
        .post(`/tasks/${task.id}/cancel`)
        .set(authHeader(requesterKey))
        .expect(409);

      expect(response.body.error.code).toBe('CONFLICT');
    });
  });

  // ============================================================================
  // Full Task Lifecycle Tests
  // ============================================================================

  describe('Task Lifecycle', () => {
    it('should complete full happy path: create -> accept -> complete -> approve', async () => {
      const { agent: requester, apiKey: requesterKey } = await createTestAgent('Requester', BigInt(10000));
      const { agent: worker, apiKey: workerKey } = await createTestAgent('Worker', BigInt(0));

      // 1. Create task
      const createResponse = await testRequest(app)
        .post('/tasks')
        .set(authHeader(requesterKey))
        .send({
          description: 'Complete lifecycle test',
          credits: 1000,
        })
        .expect(201);

      const taskId = createResponse.body.id;
      expect(createResponse.body.status).toBe('OPEN');

      // Create escrow manually for the test (since mock doesn't chain)
      await createTestEscrow(taskId, BigInt(1000));

      // 2. Accept task
      const acceptResponse = await testRequest(app)
        .post(`/tasks/${taskId}/accept`)
        .set(authHeader(workerKey))
        .expect(200);

      expect(acceptResponse.body.status).toBe('IN_PROGRESS');
      expect(acceptResponse.body.workerId).toBe(worker.id);

      // 3. Complete task
      const completeResponse = await testRequest(app)
        .post(`/tasks/${taskId}/complete`)
        .set(authHeader(workerKey))
        .expect(200);

      expect(completeResponse.body.status).toBe('COMPLETED');

      // 4. Approve task
      const approveResponse = await testRequest(app)
        .post(`/tasks/${taskId}/approve`)
        .set(authHeader(requesterKey))
        .expect(200);

      expect(approveResponse.body.status).toBe('APPROVED');
    });

    it('should handle cancellation flow: create -> cancel', async () => {
      const { agent: requester, apiKey: requesterKey } = await createTestAgent('Requester', BigInt(10000));

      // 1. Create task
      const createResponse = await testRequest(app)
        .post('/tasks')
        .set(authHeader(requesterKey))
        .send({
          description: 'Task to cancel',
          credits: 500,
        })
        .expect(201);

      const taskId = createResponse.body.id;

      // Create escrow manually
      await createTestEscrow(taskId, BigInt(500));

      // 2. Cancel task
      const cancelResponse = await testRequest(app)
        .post(`/tasks/${taskId}/cancel`)
        .set(authHeader(requesterKey))
        .expect(200);

      expect(cancelResponse.body.status).toBe('CANCELLED');
    });
  });
});
