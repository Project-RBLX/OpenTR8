/**
 * Test setup for escrow-service
 * Provides Prisma mocks and test utilities
 */

import { jest } from '@jest/globals';

// Types for Prisma mock
export interface MockAgent {
  id: string;
  name: string;
  apiKey: string;
  apiKeyHash: string;
  balance: bigint;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockEscrow {
  id: string;
  taskId: string;
  amount: bigint;
  status: 'LOCKED' | 'RELEASED' | 'REFUNDED';
  createdAt: Date;
  releasedAt: Date | null;
}

export interface MockTask {
  id: string;
  description: string;
  credits: bigint;
  deadline: Date;
  status: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'APPROVED' | 'CANCELLED' | 'EXPIRED' | 'DISPUTED';
  requesterId: string;
  workerId: string | null;
  escrow: MockEscrow | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  acceptedAt: Date | null;
  completedAt: Date | null;
  approvedAt: Date | null;
}

export interface MockTransaction {
  id: string;
  agentId: string;
  type: 'CREDIT' | 'LOCK' | 'UNLOCK' | 'EARN' | 'WITHDRAWAL' | 'DEPOSIT';
  amount: bigint;
  balance: bigint;
  taskId: string | null;
  description: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

// Mock transaction client type
export interface MockTransactionClient {
  agent: {
    update: jest.Mock;
  };
  escrow: {
    update: jest.Mock;
  };
  task: {
    update: jest.Mock;
  };
  transaction: {
    create: jest.Mock;
  };
}

// Mock Prisma client type
export interface MockPrismaClient {
  task: {
    findMany: jest.Mock;
    update: jest.Mock;
  };
  agent: {
    update: jest.Mock;
  };
  escrow: {
    update: jest.Mock;
  };
  transaction: {
    create: jest.Mock;
  };
  $transaction: jest.Mock;
}

/**
 * Create a mock Prisma client for testing
 */
export function createMockPrismaClient(): MockPrismaClient {
  return {
    task: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    agent: {
      update: jest.fn(),
    },
    escrow: {
      update: jest.fn(),
    },
    transaction: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };
}

/**
 * Create a mock transaction client for testing
 */
export function createMockTransactionClient(): MockTransactionClient {
  return {
    agent: {
      update: jest.fn(),
    },
    escrow: {
      update: jest.fn(),
    },
    task: {
      update: jest.fn(),
    },
    transaction: {
      create: jest.fn(),
    },
  };
}

/**
 * Create a mock agent for testing
 */
export function createMockAgent(overrides: Partial<MockAgent> = {}): MockAgent {
  return {
    id: 'agent-123',
    name: 'Test Agent',
    apiKey: 'test-api-key',
    apiKeyHash: 'test-hash',
    balance: BigInt(1000),
    metadata: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

/**
 * Create a mock escrow for testing
 */
export function createMockEscrow(overrides: Partial<MockEscrow> = {}): MockEscrow {
  return {
    id: 'escrow-123',
    taskId: 'task-123',
    amount: BigInt(100),
    status: 'LOCKED',
    createdAt: new Date('2024-01-01'),
    releasedAt: null,
    ...overrides,
  };
}

/**
 * Create a mock task for testing
 */
export function createMockTask(overrides: Partial<MockTask> = {}): MockTask {
  return {
    id: 'task-123',
    description: 'Test task',
    credits: BigInt(100),
    deadline: new Date('2024-01-01'),
    status: 'OPEN',
    requesterId: 'requester-123',
    workerId: null,
    escrow: createMockEscrow(),
    metadata: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    acceptedAt: null,
    completedAt: null,
    approvedAt: null,
    ...overrides,
  };
}

/**
 * Create an expired OPEN task (for refund testing)
 */
export function createExpiredOpenTask(overrides: Partial<MockTask> = {}): MockTask {
  const pastDeadline = new Date();
  pastDeadline.setHours(pastDeadline.getHours() - 1); // 1 hour ago

  return createMockTask({
    status: 'OPEN',
    deadline: pastDeadline,
    workerId: null,
    ...overrides,
  });
}

/**
 * Create an expired COMPLETED task (for auto-release testing)
 */
export function createExpiredCompletedTask(overrides: Partial<MockTask> = {}): MockTask {
  const pastDeadline = new Date();
  pastDeadline.setHours(pastDeadline.getHours() - 1); // 1 hour ago

  return createMockTask({
    status: 'COMPLETED',
    deadline: pastDeadline,
    workerId: 'worker-123',
    completedAt: new Date('2024-01-01'),
    ...overrides,
  });
}

/**
 * Create a non-expired task
 */
export function createNonExpiredTask(overrides: Partial<MockTask> = {}): MockTask {
  const futureDeadline = new Date();
  futureDeadline.setHours(futureDeadline.getHours() + 1); // 1 hour from now

  return createMockTask({
    deadline: futureDeadline,
    ...overrides,
  });
}

/**
 * Setup fake timers for testing intervals
 */
export function setupFakeTimers(): void {
  jest.useFakeTimers();
}

/**
 * Restore real timers
 */
export function restoreTimers(): void {
  jest.useRealTimers();
}

/**
 * Advance timers by the specified milliseconds
 */
export function advanceTimers(ms: number): void {
  jest.advanceTimersByTime(ms);
}

/**
 * Run all pending timers
 */
export function runAllTimers(): void {
  jest.runAllTimers();
}

/**
 * Run only pending timers (not newly scheduled ones)
 */
export function runOnlyPendingTimers(): void {
  jest.runOnlyPendingTimers();
}
