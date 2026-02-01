import { EventEmitter } from 'events';
import { Task, Agent } from '@opentr8/database';

// Event types supported by the webhook system
export type TaskEventType =
  | 'task.created'
  | 'task.accepted'
  | 'task.completed'
  | 'task.approved'
  | 'task.cancelled'
  | 'task.expired'
  | 'task.disputed';

export const TASK_EVENTS: TaskEventType[] = [
  'task.created',
  'task.accepted',
  'task.completed',
  'task.approved',
  'task.cancelled',
  'task.expired',
  'task.disputed',
];

// Task with relations for webhook payload
export interface TaskWithRelations extends Task {
  requester?: Pick<Agent, 'id' | 'name'>;
  worker?: Pick<Agent, 'id' | 'name'> | null;
}

// Webhook event payload structure
export interface WebhookEventPayload {
  event: TaskEventType;
  timestamp: string;
  data: {
    task: SerializedTask;
  };
}

// Serialized task with BigInt converted to string
export interface SerializedTask {
  id: string;
  description: string;
  credits: string;
  deadline: string;
  status: string;
  requesterId: string;
  workerId: string | null;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
  approvedAt: string | null;
  requester?: { id: string; name: string };
  worker?: { id: string; name: string } | null;
}

/**
 * Serialize a task for webhook delivery
 * Converts BigInt and Date fields to strings
 */
export function serializeTask(task: TaskWithRelations): SerializedTask {
  return {
    id: task.id,
    description: task.description,
    credits: task.credits.toString(),
    deadline: task.deadline.toISOString(),
    status: task.status,
    requesterId: task.requesterId,
    workerId: task.workerId,
    metadata: task.metadata,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    acceptedAt: task.acceptedAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    approvedAt: task.approvedAt?.toISOString() ?? null,
    requester: task.requester
      ? { id: task.requester.id, name: task.requester.name }
      : undefined,
    worker: task.worker
      ? { id: task.worker.id, name: task.worker.name }
      : null,
  };
}

/**
 * Create a webhook event payload
 */
export function createEventPayload(
  event: TaskEventType,
  task: TaskWithRelations
): WebhookEventPayload {
  return {
    event,
    timestamp: new Date().toISOString(),
    data: {
      task: serializeTask(task),
    },
  };
}

// Type-safe event map for the emitter
interface EventMap {
  'task.created': [task: TaskWithRelations];
  'task.accepted': [task: TaskWithRelations];
  'task.completed': [task: TaskWithRelations];
  'task.approved': [task: TaskWithRelations];
  'task.cancelled': [task: TaskWithRelations];
  'task.expired': [task: TaskWithRelations];
  'task.disputed': [task: TaskWithRelations];
}

/**
 * Typed EventEmitter for OpenTR8 events
 */
class TypedEventEmitter extends EventEmitter {
  emit<K extends keyof EventMap>(event: K, ...args: EventMap[K]): boolean {
    return super.emit(event, ...args);
  }

  on<K extends keyof EventMap>(
    event: K,
    listener: (...args: EventMap[K]) => void
  ): this {
    return super.on(event, listener);
  }

  once<K extends keyof EventMap>(
    event: K,
    listener: (...args: EventMap[K]) => void
  ): this {
    return super.once(event, listener);
  }

  off<K extends keyof EventMap>(
    event: K,
    listener: (...args: EventMap[K]) => void
  ): this {
    return super.off(event, listener);
  }
}

/**
 * Singleton event emitter for the application
 */
class OpenTR8EventEmitter extends TypedEventEmitter {
  private static instance: OpenTR8EventEmitter | null = null;

  private constructor() {
    super();
    // Increase max listeners to handle many webhooks
    this.setMaxListeners(100);
  }

  static getInstance(): OpenTR8EventEmitter {
    if (!OpenTR8EventEmitter.instance) {
      OpenTR8EventEmitter.instance = new OpenTR8EventEmitter();
    }
    return OpenTR8EventEmitter.instance;
  }

  /**
   * Emit a task event
   */
  emitTaskEvent(event: TaskEventType, task: TaskWithRelations): void {
    this.emit(event, task);
  }
}

// Export singleton instance
export const eventEmitter = OpenTR8EventEmitter.getInstance();

// Export for testing
export { OpenTR8EventEmitter };
