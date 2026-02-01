/**
 * Test setup for OpenTR8 API
 * Provides mocked Prisma client, test utilities, and request helpers
 */
import express, { Express } from 'express';
import request from 'supertest';
import { hashApiKey, generateApiKey, OpenTR8Error } from '@opentr8/shared';

// Types from Prisma
type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'APPROVED' | 'CANCELLED' | 'EXPIRED' | 'DISPUTED';
type EscrowStatus = 'LOCKED' | 'RELEASED' | 'REFUNDED';
type TransactionType = 'CREDIT' | 'LOCK' | 'UNLOCK' | 'EARN' | 'WITHDRAWAL' | 'DEPOSIT';

interface Agent {
  id: string;
  name: string;
  apiKey: string;
  apiKeyHash: string;
  balance: bigint;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface Task {
  id: string;
  description: string;
  credits: bigint;
  deadline: Date;
  status: TaskStatus;
  requesterId: string;
  workerId: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
  acceptedAt: Date | null;
  completedAt: Date | null;
  approvedAt: Date | null;
}

interface Escrow {
  id: string;
  taskId: string;
  amount: bigint;
  status: EscrowStatus;
  createdAt: Date;
  releasedAt: Date | null;
}

interface Transaction {
  id: string;
  agentId: string;
  type: TransactionType;
  amount: bigint;
  balance: bigint;
  taskId: string | null;
  description: string | null;
  metadata: unknown;
  createdAt: Date;
}

// ============================================================================
// MOCK PRISMA CLIENT
// ============================================================================

// Mock data store - resets between tests
export const mockDataStore = {
  agents: new Map<string, Agent>(),
  tasks: new Map<string, Task>(),
  escrows: new Map<string, Escrow>(),
  transactions: new Map<string, Transaction>(),

  reset() {
    this.agents.clear();
    this.tasks.clear();
    this.escrows.clear();
    this.transactions.clear();
  },
};

function findEscrowByTaskId(taskId: string): Escrow | null {
  for (const escrow of mockDataStore.escrows.values()) {
    if (escrow.taskId === taskId) {
      return escrow;
    }
  }
  return null;
}

// Transaction context type
interface TransactionContext {
  agent: typeof mockPrisma.agent;
  task: typeof mockPrisma.task;
  escrow: typeof mockPrisma.escrow;
  transaction: typeof mockPrisma.transaction;
}

// Mock Prisma implementation
export const mockPrisma = {
  agent: {
    create: jest.fn(async ({ data }: { data: Partial<Agent> & { name: string; apiKey: string; apiKeyHash: string; balance: bigint } }) => {
      const agent: Agent = {
        id: data.id || generateUUID(),
        name: data.name,
        apiKey: data.apiKey,
        apiKeyHash: data.apiKeyHash,
        balance: data.balance,
        metadata: data.metadata || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockDataStore.agents.set(agent.id, agent);
      return agent;
    }),

    findUnique: jest.fn(async ({ where }: { where: { id?: string; apiKeyHash?: string } }) => {
      if (where.id) {
        return mockDataStore.agents.get(where.id) || null;
      }
      if (where.apiKeyHash) {
        for (const agent of mockDataStore.agents.values()) {
          if (agent.apiKeyHash === where.apiKeyHash) {
            return agent;
          }
        }
      }
      return null;
    }),

    update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Agent> & { balance?: { increment?: bigint; decrement?: bigint } } }) => {
      const agent = mockDataStore.agents.get(where.id);
      if (!agent) throw new Error(`Agent not found: ${where.id}`);

      const updated: Agent = { ...agent, updatedAt: new Date() };

      if (data.balance && typeof data.balance === 'object') {
        if (data.balance.increment) {
          updated.balance = agent.balance + data.balance.increment;
        }
        if (data.balance.decrement) {
          updated.balance = agent.balance - data.balance.decrement;
        }
      } else if (data.balance !== undefined) {
        updated.balance = data.balance as bigint;
      }

      if (data.name) updated.name = data.name;
      if (data.metadata !== undefined) updated.metadata = data.metadata;

      mockDataStore.agents.set(where.id, updated);
      return updated;
    }),
  },

  task: {
    create: jest.fn(async ({ data }: { data: Partial<Task> & { description: string; credits: bigint; deadline: Date; requesterId: string } }) => {
      const task: Task = {
        id: data.id || generateUUID(),
        description: data.description,
        credits: data.credits,
        deadline: data.deadline,
        status: (data.status as TaskStatus) || 'OPEN',
        requesterId: data.requesterId,
        workerId: data.workerId || null,
        metadata: data.metadata || null,
        createdAt: new Date(),
        updatedAt: new Date(),
        acceptedAt: data.acceptedAt || null,
        completedAt: data.completedAt || null,
        approvedAt: data.approvedAt || null,
      };
      mockDataStore.tasks.set(task.id, task);
      return task;
    }),

    findUnique: jest.fn(async ({ where, include }: { where: { id: string }; include?: { requester?: { select?: object }; worker?: { select?: object }; escrow?: boolean } }) => {
      const task = mockDataStore.tasks.get(where.id);
      if (!task) return null;

      const result: Task & { requester?: Partial<Agent>; worker?: Partial<Agent> | null; escrow?: Escrow | null } = { ...task };

      if (include?.requester) {
        const requester = mockDataStore.agents.get(task.requesterId);
        result.requester = requester ? { id: requester.id, name: requester.name } : undefined;
      }
      if (include?.worker && task.workerId) {
        const worker = mockDataStore.agents.get(task.workerId);
        result.worker = worker ? { id: worker.id, name: worker.name } : null;
      }
      if (include?.escrow) {
        result.escrow = findEscrowByTaskId(task.id);
      }

      return result;
    }),

    findMany: jest.fn(async ({ where, orderBy, take, include }: { where?: Record<string, unknown>; orderBy?: { createdAt: 'desc' | 'asc' }; take?: number; include?: { requester?: { select?: object }; worker?: { select?: object } } }) => {
      let tasks = Array.from(mockDataStore.tasks.values());

      if (where?.status) {
        tasks = tasks.filter((t) => t.status === where.status);
      }
      if (where?.OR) {
        const orConditions = where.OR as Array<{ requesterId?: string; workerId?: string }>;
        tasks = tasks.filter((t) =>
          orConditions.some((cond) =>
            (cond.requesterId && t.requesterId === cond.requesterId) ||
            (cond.workerId && t.workerId === cond.workerId)
          )
        );
      }

      if (orderBy?.createdAt === 'desc') {
        tasks.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }

      if (take) {
        tasks = tasks.slice(0, take);
      }

      return tasks.map((task) => {
        const result: Task & { requester?: Partial<Agent>; worker?: Partial<Agent> | null } = { ...task };
        if (include?.requester) {
          const requester = mockDataStore.agents.get(task.requesterId);
          result.requester = requester ? { id: requester.id, name: requester.name } : undefined;
        }
        if (include?.worker && task.workerId) {
          const worker = mockDataStore.agents.get(task.workerId);
          result.worker = worker ? { id: worker.id, name: worker.name } : null;
        }
        return result;
      });
    }),

    update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Task> }) => {
      const task = mockDataStore.tasks.get(where.id);
      if (!task) throw new Error(`Task not found: ${where.id}`);

      const updated: Task = {
        ...task,
        ...data,
        updatedAt: new Date(),
      } as Task;
      mockDataStore.tasks.set(where.id, updated);
      return updated;
    }),
  },

  escrow: {
    create: jest.fn(async ({ data }: { data: Partial<Escrow> & { taskId: string; amount: bigint; status: EscrowStatus } }) => {
      const escrow: Escrow = {
        id: data.id || generateUUID(),
        taskId: data.taskId,
        amount: data.amount,
        status: data.status,
        createdAt: new Date(),
        releasedAt: data.releasedAt || null,
      };
      mockDataStore.escrows.set(escrow.id, escrow);
      return escrow;
    }),

    findUnique: jest.fn(async ({ where }: { where: { id?: string; taskId?: string } }) => {
      if (where.id) {
        return mockDataStore.escrows.get(where.id) || null;
      }
      if (where.taskId) {
        return findEscrowByTaskId(where.taskId);
      }
      return null;
    }),

    update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Escrow> }) => {
      const escrow = mockDataStore.escrows.get(where.id);
      if (!escrow) throw new Error(`Escrow not found: ${where.id}`);

      const updated: Escrow = { ...escrow, ...data } as Escrow;
      mockDataStore.escrows.set(where.id, updated);
      return updated;
    }),
  },

  transaction: {
    create: jest.fn(async ({ data }: { data: Partial<Transaction> & { agentId: string; type: TransactionType; amount: bigint; balance: bigint } }) => {
      const transaction: Transaction = {
        id: data.id || generateUUID(),
        agentId: data.agentId,
        type: data.type,
        amount: data.amount,
        balance: data.balance,
        taskId: data.taskId || null,
        description: data.description || null,
        metadata: data.metadata || null,
        createdAt: new Date(),
      };
      mockDataStore.transactions.set(transaction.id, transaction);
      return transaction;
    }),

    findMany: jest.fn(async ({ where, orderBy, take, skip }: { where?: { agentId?: string }; orderBy?: { createdAt: 'desc' | 'asc' }; take?: number; skip?: number }) => {
      let transactions = Array.from(mockDataStore.transactions.values());

      if (where?.agentId) {
        transactions = transactions.filter((t) => t.agentId === where.agentId);
      }

      if (orderBy?.createdAt === 'desc') {
        transactions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }

      if (skip) {
        transactions = transactions.slice(skip);
      }

      if (take) {
        transactions = transactions.slice(0, take);
      }

      return transactions;
    }),

    count: jest.fn(async ({ where }: { where?: { agentId?: string } }) => {
      let transactions = Array.from(mockDataStore.transactions.values());
      if (where?.agentId) {
        transactions = transactions.filter((t) => t.agentId === where.agentId);
      }
      return transactions.length;
    }),
  },

  $transaction: jest.fn(async <T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> => {
    // Execute the transaction function with the mock prisma client
    return fn(mockPrisma as unknown as TransactionContext);
  }),
};

// Mock the @opentr8/database module - must be before imports
jest.mock('@opentr8/database', () => ({
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
  EscrowStatus: {
    LOCKED: 'LOCKED',
    RELEASED: 'RELEASED',
    REFUNDED: 'REFUNDED',
  },
  TransactionType: {
    CREDIT: 'CREDIT',
    LOCK: 'LOCK',
    UNLOCK: 'UNLOCK',
    EARN: 'EARN',
    WITHDRAWAL: 'WITHDRAWAL',
    DEPOSIT: 'DEPOSIT',
  },
}));

// ============================================================================
// APP SETUP
// ============================================================================

let app: Express | null = null;

export async function setupApp(): Promise<Express> {
  if (app) return app;

  // Dynamically import the app after mocks are set up
  const { agentsRouter } = await import('../routes/agents.js');
  const { tasksRouter } = await import('../routes/tasks.js');
  const { walletRouter } = await import('../routes/wallet.js');
  const { loadConfig, OpenTR8Error } = await import('@opentr8/shared');

  const config = loadConfig();
  app = express();

  app.use(express.json());

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Routes
  app.use('/agents', agentsRouter);
  app.use('/tasks', tasksRouter);
  app.use('/wallet', walletRouter);

  // Error handler
  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
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

  return app;
}

export function getApp(): Express {
  if (!app) {
    throw new Error('App not initialized. Call setupApp() first.');
  }
  return app;
}

// ============================================================================
// TEST UTILITIES
// ============================================================================

let uuidCounter = 0;

export function generateUUID(): string {
  uuidCounter++;
  return `test-uuid-${uuidCounter.toString().padStart(8, '0')}`;
}

export function resetUUIDCounter(): void {
  uuidCounter = 0;
}

/**
 * Create a test agent with a known API key
 */
export interface TestAgent {
  agent: Agent;
  apiKey: string;
  apiKeyHash: string;
}

export async function createTestAgent(
  name: string = 'Test Agent',
  balance: bigint = BigInt(10000)
): Promise<TestAgent> {
  const apiKey = generateApiKey();
  const apiKeyHash = hashApiKey(apiKey);

  const agent: Agent = {
    id: generateUUID(),
    name,
    apiKey: `${apiKey.slice(0, 12)}...${apiKey.slice(-4)}`,
    apiKeyHash,
    balance,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  mockDataStore.agents.set(agent.id, agent);

  return { agent, apiKey, apiKeyHash };
}

/**
 * Create a test task
 */
export async function createTestTask(
  requesterId: string,
  options: {
    description?: string;
    credits?: bigint;
    deadline?: Date;
    status?: TaskStatus;
    workerId?: string;
  } = {}
): Promise<Task> {
  const task: Task = {
    id: generateUUID(),
    description: options.description || 'Test task',
    credits: options.credits || BigInt(100),
    deadline: options.deadline || new Date(Date.now() + 72 * 60 * 60 * 1000),
    status: options.status || 'OPEN',
    requesterId,
    workerId: options.workerId || null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    acceptedAt: null,
    completedAt: null,
    approvedAt: null,
  };

  mockDataStore.tasks.set(task.id, task);
  return task;
}

/**
 * Create a test escrow for a task
 */
export async function createTestEscrow(
  taskId: string,
  amount: bigint,
  status: EscrowStatus = 'LOCKED'
): Promise<Escrow> {
  const escrow: Escrow = {
    id: generateUUID(),
    taskId,
    amount,
    status,
    createdAt: new Date(),
    releasedAt: null,
  };

  mockDataStore.escrows.set(escrow.id, escrow);
  return escrow;
}

/**
 * Create a test transaction
 */
export async function createTestTransaction(
  agentId: string,
  type: TransactionType,
  amount: bigint,
  balance: bigint,
  options: { taskId?: string; description?: string } = {}
): Promise<Transaction> {
  const transaction: Transaction = {
    id: generateUUID(),
    agentId,
    type,
    amount,
    balance,
    taskId: options.taskId || null,
    description: options.description || null,
    metadata: null,
    createdAt: new Date(),
  };

  mockDataStore.transactions.set(transaction.id, transaction);
  return transaction;
}

// ============================================================================
// REQUEST HELPERS
// ============================================================================

export function testRequest(app: Express) {
  return request(app);
}

export function authHeader(apiKey: string): { Authorization: string } {
  return { Authorization: `Bearer ${apiKey}` };
}

// ============================================================================
// CLEANUP
// ============================================================================

export function resetMocks(): void {
  mockDataStore.reset();
  resetUUIDCounter();
  jest.clearAllMocks();
}
