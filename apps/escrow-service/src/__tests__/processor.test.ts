/**
 * Tests for the expired task processor
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  createMockPrismaClient,
  createMockTransactionClient,
  createMockAgent,
  createExpiredOpenTask,
  createExpiredCompletedTask,
  MockPrismaClient,
  MockTransactionClient,
} from './setup.js';

// Mock the database module
const mockPrisma = createMockPrismaClient();

jest.unstable_mockModule('@opentr8/database', () => ({
  prisma: mockPrisma,
  TaskStatus: {
    OPEN: 'OPEN',
    IN_PROGRESS: 'IN_PROGRESS',
    COMPLETED: 'COMPLETED',
    APPROVED: 'APPROVED',
    CANCELLED: 'CANCELLED',
    EXPIRED: 'EXPIRED',
    DISPUTED: 'DISPUTED',
  },
}));

// Import the module after mocking
const { processExpiredTasks } = await import('../processor.js');

describe('processExpiredTasks', () => {
  let mockTxClient: MockTransactionClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockTxClient = createMockTransactionClient();

    // Setup $transaction to execute the callback with the mock tx client
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: MockTransactionClient) => Promise<void>) => {
      await callback(mockTxClient);
    });
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('when no expired tasks exist', () => {
    it('should return 0 and not process anything', async () => {
      mockPrisma.task.findMany.mockResolvedValue([]);

      const result = await processExpiredTasks();

      expect(result).toBe(0);
      expect(mockPrisma.task.findMany).toHaveBeenCalledWith({
        where: {
          deadline: { lt: expect.any(Date) },
          status: { in: ['OPEN', 'COMPLETED'] },
        },
        include: { escrow: true },
      });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('expired OPEN tasks (refund to requester)', () => {
    it('should refund credits to requester for expired OPEN task', async () => {
      const expiredTask = createExpiredOpenTask({
        id: 'task-open-1',
        requesterId: 'requester-1',
        escrow: {
          id: 'escrow-1',
          taskId: 'task-open-1',
          amount: BigInt(500),
          status: 'LOCKED',
          createdAt: new Date(),
          releasedAt: null,
        },
      });

      const updatedRequester = createMockAgent({
        id: 'requester-1',
        balance: BigInt(1500), // 1000 + 500 refund
      });

      mockPrisma.task.findMany.mockResolvedValue([expiredTask]);
      mockTxClient.agent.update.mockResolvedValue(updatedRequester);
      mockTxClient.escrow.update.mockResolvedValue({});
      mockTxClient.task.update.mockResolvedValue({});
      mockTxClient.transaction.create.mockResolvedValue({});

      const result = await processExpiredTasks();

      expect(result).toBe(1);

      // Verify agent balance incremented
      expect(mockTxClient.agent.update).toHaveBeenCalledWith({
        where: { id: 'requester-1' },
        data: { balance: { increment: BigInt(500) } },
      });

      // Verify escrow marked as refunded
      expect(mockTxClient.escrow.update).toHaveBeenCalledWith({
        where: { id: 'escrow-1' },
        data: {
          status: 'REFUNDED',
          releasedAt: expect.any(Date),
        },
      });

      // Verify task marked as expired
      expect(mockTxClient.task.update).toHaveBeenCalledWith({
        where: { id: 'task-open-1' },
        data: { status: 'EXPIRED' },
      });

      // Verify transaction record created with UNLOCK type
      expect(mockTxClient.transaction.create).toHaveBeenCalledWith({
        data: {
          agentId: 'requester-1',
          type: 'UNLOCK',
          amount: BigInt(500),
          balance: BigInt(1500),
          taskId: 'task-open-1',
          description: expect.stringContaining('refunded'),
        },
      });
    });

    it('should skip task without escrow', async () => {
      const taskWithoutEscrow = createExpiredOpenTask({
        id: 'task-no-escrow',
        escrow: null,
      });

      mockPrisma.task.findMany.mockResolvedValue([taskWithoutEscrow]);

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await processExpiredTasks();

      expect(result).toBe(0);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('task-no-escrow has no escrow')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('expired COMPLETED tasks (auto-release to worker)', () => {
    it('should release credits to worker for expired COMPLETED task', async () => {
      const expiredTask = createExpiredCompletedTask({
        id: 'task-completed-1',
        workerId: 'worker-1',
        escrow: {
          id: 'escrow-2',
          taskId: 'task-completed-1',
          amount: BigInt(750),
          status: 'LOCKED',
          createdAt: new Date(),
          releasedAt: null,
        },
      });

      const updatedWorker = createMockAgent({
        id: 'worker-1',
        balance: BigInt(1750), // 1000 + 750 earned
      });

      mockPrisma.task.findMany.mockResolvedValue([expiredTask]);
      mockTxClient.agent.update.mockResolvedValue(updatedWorker);
      mockTxClient.escrow.update.mockResolvedValue({});
      mockTxClient.task.update.mockResolvedValue({});
      mockTxClient.transaction.create.mockResolvedValue({});

      const result = await processExpiredTasks();

      expect(result).toBe(1);

      // Verify worker balance incremented
      expect(mockTxClient.agent.update).toHaveBeenCalledWith({
        where: { id: 'worker-1' },
        data: { balance: { increment: BigInt(750) } },
      });

      // Verify escrow marked as released
      expect(mockTxClient.escrow.update).toHaveBeenCalledWith({
        where: { id: 'escrow-2' },
        data: {
          status: 'RELEASED',
          releasedAt: expect.any(Date),
        },
      });

      // Verify task marked as expired with approvedAt set
      expect(mockTxClient.task.update).toHaveBeenCalledWith({
        where: { id: 'task-completed-1' },
        data: {
          status: 'EXPIRED',
          approvedAt: expect.any(Date),
        },
      });

      // Verify transaction record created with EARN type
      expect(mockTxClient.transaction.create).toHaveBeenCalledWith({
        data: {
          agentId: 'worker-1',
          type: 'EARN',
          amount: BigInt(750),
          balance: BigInt(1750),
          taskId: 'task-completed-1',
          description: expect.stringContaining('auto-released'),
        },
      });
    });

    it('should skip COMPLETED task without workerId', async () => {
      const completedTaskNoWorker = createExpiredCompletedTask({
        id: 'task-no-worker',
        workerId: null,
      });

      mockPrisma.task.findMany.mockResolvedValue([completedTaskNoWorker]);

      const result = await processExpiredTasks();

      expect(result).toBe(0);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('multiple expired tasks', () => {
    it('should process multiple expired tasks of different types', async () => {
      const openTask = createExpiredOpenTask({
        id: 'task-open-multi',
        requesterId: 'requester-multi',
        escrow: {
          id: 'escrow-multi-1',
          taskId: 'task-open-multi',
          amount: BigInt(100),
          status: 'LOCKED',
          createdAt: new Date(),
          releasedAt: null,
        },
      });

      const completedTask = createExpiredCompletedTask({
        id: 'task-completed-multi',
        workerId: 'worker-multi',
        escrow: {
          id: 'escrow-multi-2',
          taskId: 'task-completed-multi',
          amount: BigInt(200),
          status: 'LOCKED',
          createdAt: new Date(),
          releasedAt: null,
        },
      });

      mockPrisma.task.findMany.mockResolvedValue([openTask, completedTask]);
      mockTxClient.agent.update.mockResolvedValue(createMockAgent({ balance: BigInt(1100) }));
      mockTxClient.escrow.update.mockResolvedValue({});
      mockTxClient.task.update.mockResolvedValue({});
      mockTxClient.transaction.create.mockResolvedValue({});

      const result = await processExpiredTasks();

      expect(result).toBe(2);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('should continue processing other tasks when one fails', async () => {
      const task1 = createExpiredOpenTask({
        id: 'task-fail',
        requesterId: 'requester-fail',
        escrow: {
          id: 'escrow-fail',
          taskId: 'task-fail',
          amount: BigInt(100),
          status: 'LOCKED',
          createdAt: new Date(),
          releasedAt: null,
        },
      });

      const task2 = createExpiredOpenTask({
        id: 'task-success',
        requesterId: 'requester-success',
        escrow: {
          id: 'escrow-success',
          taskId: 'task-success',
          amount: BigInt(200),
          status: 'LOCKED',
          createdAt: new Date(),
          releasedAt: null,
        },
      });

      mockPrisma.task.findMany.mockResolvedValue([task1, task2]);

      let callCount = 0;
      mockPrisma.$transaction.mockImplementation(async (callback: (tx: MockTransactionClient) => Promise<void>) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Database error');
        }
        await callback(mockTxClient);
      });

      mockTxClient.agent.update.mockResolvedValue(createMockAgent({ balance: BigInt(1200) }));
      mockTxClient.escrow.update.mockResolvedValue({});
      mockTxClient.task.update.mockResolvedValue({});
      mockTxClient.transaction.create.mockResolvedValue({});

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const result = await processExpiredTasks();

      expect(result).toBe(1); // Only second task succeeded
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error processing expired task task-fail'),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  describe('transaction atomicity', () => {
    it('should use Prisma transaction for atomic updates', async () => {
      const expiredTask = createExpiredOpenTask({
        id: 'task-atomic',
        requesterId: 'requester-atomic',
        escrow: {
          id: 'escrow-atomic',
          taskId: 'task-atomic',
          amount: BigInt(300),
          status: 'LOCKED',
          createdAt: new Date(),
          releasedAt: null,
        },
      });

      mockPrisma.task.findMany.mockResolvedValue([expiredTask]);
      mockTxClient.agent.update.mockResolvedValue(createMockAgent({ balance: BigInt(1300) }));
      mockTxClient.escrow.update.mockResolvedValue({});
      mockTxClient.task.update.mockResolvedValue({});
      mockTxClient.transaction.create.mockResolvedValue({});

      await processExpiredTasks();

      // Verify $transaction was called (ensures atomicity)
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function));

      // Verify all operations were done within the transaction
      expect(mockTxClient.agent.update).toHaveBeenCalled();
      expect(mockTxClient.escrow.update).toHaveBeenCalled();
      expect(mockTxClient.task.update).toHaveBeenCalled();
      expect(mockTxClient.transaction.create).toHaveBeenCalled();
    });

    it('should rollback all changes if transaction fails', async () => {
      const expiredTask = createExpiredOpenTask({
        id: 'task-rollback',
        requesterId: 'requester-rollback',
        escrow: {
          id: 'escrow-rollback',
          taskId: 'task-rollback',
          amount: BigInt(400),
          status: 'LOCKED',
          createdAt: new Date(),
          releasedAt: null,
        },
      });

      mockPrisma.task.findMany.mockResolvedValue([expiredTask]);
      mockPrisma.$transaction.mockRejectedValue(new Error('Transaction failed'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const result = await processExpiredTasks();

      expect(result).toBe(0);
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('already processed tasks', () => {
    it('should not find already expired tasks (they have different status)', async () => {
      // The query only looks for OPEN and COMPLETED status
      // So already processed tasks (with EXPIRED status) won't be returned
      mockPrisma.task.findMany.mockResolvedValue([]);

      const result = await processExpiredTasks();

      expect(result).toBe(0);
      expect(mockPrisma.task.findMany).toHaveBeenCalledWith({
        where: {
          deadline: { lt: expect.any(Date) },
          status: { in: ['OPEN', 'COMPLETED'] },
        },
        include: { escrow: true },
      });
    });
  });
});
