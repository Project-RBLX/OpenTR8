import { Router } from 'express';
import { z } from 'zod';
import { prisma, TaskStatus, TaskTemplate } from '@opentr8/database';
import {
  loadConfig,
  calculateDeadline,
  isExpired,
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  InsufficientCreditsError,
  InvalidStateError,
  ConflictError,
} from '@opentr8/shared';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import { eventEmitter, TaskWithRelations } from '../services/events.js';
import { openDisputeHandler } from './disputes.js';
import { validateInput, validateOutputSafe } from '../services/schema-validator.js';

export const tasksRouter = Router();
const config = loadConfig();

// Validation schemas
const createTaskSchema = z.object({
  description: z.string().min(1).max(5000),
  credits: z.number().int().positive().optional(), // Optional when using template
  deadlineHours: z.number().int().positive().optional(),
  visibility: z.enum(['PRIVATE', 'PUBLIC']).optional().default('PRIVATE'),
  metadata: z.record(z.unknown()).optional(),
  templateId: z.string().uuid().optional(), // Optional template reference
});

const validateOutputSchema = z.object({
  output: z.record(z.unknown()),
});

/**
 * POST /tasks - Create a new task (locks credits in escrow)
 */
tasksRouter.post('/', authenticate, async (req, res, next) => {
  try {
    const body = createTaskSchema.parse(req.body);
    const agent = req.agent!;

    // Handle template-based task creation
    let template: TaskTemplate | null = null;
    if (body.templateId) {
      template = await prisma.taskTemplate.findUnique({
        where: { id: body.templateId },
      });

      if (!template) {
        throw new NotFoundError('TaskTemplate', body.templateId);
      }

      // Check template access: must be public or owned by the agent
      if (!template.isPublic && template.creatorId !== agent.id) {
        throw new NotFoundError('TaskTemplate', body.templateId);
      }

      // Validate input metadata against template schema
      if (body.metadata) {
        validateInput(template, body.metadata);
      }
    }

    // Determine credits: use body.credits, or template defaults, or require explicit value
    let creditsValue: number;
    if (body.credits !== undefined) {
      creditsValue = body.credits;
    } else if (template && template.defaultCredits > 0) {
      creditsValue = Number(template.defaultCredits);
    } else {
      throw new BadRequestError('Credits are required when not using a template or template has no default credits');
    }
    const credits = BigInt(creditsValue);

    // Check sufficient balance
    if (agent.balance < credits) {
      throw new InsufficientCreditsError(credits, agent.balance);
    }

    // Calculate deadline: use body.deadlineHours, or template defaults, or config defaults
    const deadlineHours = body.deadlineHours || (template?.defaultDeadlineHours) || config.defaultTaskTimeoutHours;
    const deadline = calculateDeadline(deadlineHours);

    // Create task with escrow in transaction
    const task = await prisma.$transaction(async (tx) => {
      // Deduct credits from agent
      const updatedAgent = await tx.agent.update({
        where: { id: agent.id },
        data: { balance: { decrement: credits } },
      });

      // Create task
      const newTask = await tx.task.create({
        data: {
          description: body.description,
          credits,
          deadline,
          requesterId: agent.id,
          visibility: body.visibility,
          metadata: body.metadata,
          templateId: body.templateId,
        },
      });

      // Create escrow
      await tx.escrow.create({
        data: {
          taskId: newTask.id,
          amount: credits,
          status: 'LOCKED',
        },
      });

      // Record transaction
      await tx.transaction.create({
        data: {
          agentId: agent.id,
          type: 'LOCK',
          amount: -credits,
          balance: updatedAgent.balance,
          taskId: newTask.id,
          description: `Credits locked for task: ${newTask.id}`,
        },
      });

      // Increment template usage count if using a template
      if (body.templateId) {
        await tx.taskTemplate.update({
          where: { id: body.templateId },
          data: { usageCount: { increment: 1 } },
        });
      }

      return newTask;
    });

    // Fetch task with relations for webhook
    const taskWithRelations = await prisma.task.findUnique({
      where: { id: task.id },
      include: {
        requester: { select: { id: true, name: true } },
        worker: { select: { id: true, name: true } },
      },
    });

    // Emit task.created event
    if (taskWithRelations) {
      eventEmitter.emitTaskEvent('task.created', taskWithRelations as TaskWithRelations);
    }

    res.status(201).json({
      id: task.id,
      description: task.description,
      credits: task.credits.toString(),
      deadline: task.deadline,
      status: task.status,
      visibility: task.visibility,
      requesterId: task.requesterId,
      templateId: task.templateId,
      createdAt: task.createdAt,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new BadRequestError('Invalid request body', { errors: error.errors }));
      return;
    }
    next(error);
  }
});

/**
 * GET /tasks - List tasks (optionally filter by status)
 */
tasksRouter.get('/', optionalAuth, async (req, res, next) => {
  try {
    const status = req.query.status as TaskStatus | undefined;
    const mine = req.query.mine === 'true';
    const agent = req.agent;

    const where: Record<string, unknown> = {};

    if (status) {
      where.status = status;
    }

    if (mine && agent) {
      where.OR = [{ requesterId: agent.id }, { workerId: agent.id }];
    }

    const tasks = await prisma.task.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        requester: { select: { id: true, name: true } },
        worker: { select: { id: true, name: true } },
      },
    });

    res.json({
      tasks: tasks.map((t) => ({
        id: t.id,
        description: t.description,
        credits: t.credits.toString(),
        deadline: t.deadline,
        status: t.status,
        requester: t.requester,
        worker: t.worker,
        createdAt: t.createdAt,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /tasks/:id - Get task details
 */
tasksRouter.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const task = await prisma.task.findUnique({
      where: { id: req.params.id },
      include: {
        requester: { select: { id: true, name: true } },
        worker: { select: { id: true, name: true } },
        escrow: true,
        dispute: {
          select: {
            id: true,
            status: true,
            reason: true,
            resolution: true,
            createdAt: true,
            resolvedAt: true,
          },
        },
        template: {
          select: {
            id: true,
            name: true,
            category: true,
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundError('Task', req.params.id);
    }

    res.json({
      id: task.id,
      description: task.description,
      credits: task.credits.toString(),
      deadline: task.deadline,
      status: task.status,
      requester: task.requester,
      worker: task.worker,
      escrow: task.escrow
        ? {
            status: task.escrow.status,
            amount: task.escrow.amount.toString(),
          }
        : null,
      dispute: task.dispute
        ? {
            id: task.dispute.id,
            status: task.dispute.status,
            reason: task.dispute.reason,
            resolution: task.dispute.resolution,
            createdAt: task.dispute.createdAt,
            resolvedAt: task.dispute.resolvedAt,
          }
        : null,
      template: task.template
        ? {
            id: task.template.id,
            name: task.template.name,
            category: task.template.category,
          }
        : null,
      metadata: task.metadata,
      createdAt: task.createdAt,
      acceptedAt: task.acceptedAt,
      completedAt: task.completedAt,
      approvedAt: task.approvedAt,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /tasks/:id/accept - Accept a task
 */
tasksRouter.post('/:id/accept', authenticate, async (req, res, next) => {
  try {
    const agent = req.agent!;
    const taskId = req.params.id;

    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      throw new NotFoundError('Task', taskId);
    }

    if (task.status !== 'OPEN') {
      throw new InvalidStateError(task.status, 'accept task');
    }

    if (task.requesterId === agent.id) {
      throw new ForbiddenError('Cannot accept your own task');
    }

    if (isExpired(task.deadline)) {
      throw new InvalidStateError('EXPIRED', 'accept task');
    }

    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'IN_PROGRESS',
        workerId: agent.id,
        acceptedAt: new Date(),
      },
      include: {
        requester: { select: { id: true, name: true } },
        worker: { select: { id: true, name: true } },
      },
    });

    // Emit task.accepted event
    eventEmitter.emitTaskEvent('task.accepted', updatedTask as TaskWithRelations);

    res.json({
      id: updatedTask.id,
      status: updatedTask.status,
      workerId: updatedTask.workerId,
      acceptedAt: updatedTask.acceptedAt,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /tasks/:id/complete - Mark task as completed (worker only)
 */
tasksRouter.post('/:id/complete', authenticate, async (req, res, next) => {
  try {
    const agent = req.agent!;
    const taskId = req.params.id;

    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      throw new NotFoundError('Task', taskId);
    }

    if (task.workerId !== agent.id) {
      throw new ForbiddenError('Only the assigned worker can mark task as completed');
    }

    if (task.status !== 'IN_PROGRESS') {
      throw new InvalidStateError(task.status, 'complete task');
    }

    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
      include: {
        requester: { select: { id: true, name: true } },
        worker: { select: { id: true, name: true } },
      },
    });

    // Emit task.completed event
    eventEmitter.emitTaskEvent('task.completed', updatedTask as TaskWithRelations);

    res.json({
      id: updatedTask.id,
      status: updatedTask.status,
      completedAt: updatedTask.completedAt,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /tasks/:id/approve - Approve completion and release credits (requester only)
 */
tasksRouter.post('/:id/approve', authenticate, async (req, res, next) => {
  try {
    const agent = req.agent!;
    const taskId = req.params.id;

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { escrow: true },
    });

    if (!task) {
      throw new NotFoundError('Task', taskId);
    }

    if (task.requesterId !== agent.id) {
      throw new ForbiddenError('Only the requester can approve task completion');
    }

    if (task.status !== 'COMPLETED') {
      throw new InvalidStateError(task.status, 'approve task');
    }

    if (!task.escrow || !task.workerId) {
      throw new ConflictError('Task has no escrow or worker');
    }

    // Release credits to worker
    const result = await prisma.$transaction(async (tx) => {
      // Update worker balance
      const worker = await tx.agent.update({
        where: { id: task.workerId! },
        data: { balance: { increment: task.escrow!.amount } },
      });

      // Update escrow status
      await tx.escrow.update({
        where: { id: task.escrow!.id },
        data: {
          status: 'RELEASED',
          releasedAt: new Date(),
        },
      });

      // Update task status
      const updatedTask = await tx.task.update({
        where: { id: taskId },
        data: {
          status: 'APPROVED',
          approvedAt: new Date(),
        },
        include: {
          requester: { select: { id: true, name: true } },
          worker: { select: { id: true, name: true } },
        },
      });

      // Record transaction for worker
      await tx.transaction.create({
        data: {
          agentId: task.workerId!,
          type: 'EARN',
          amount: task.escrow!.amount,
          balance: worker.balance,
          taskId: taskId,
          description: `Credits earned for completing task: ${taskId}`,
        },
      });

      return updatedTask;
    });

    // Emit task.approved event
    eventEmitter.emitTaskEvent('task.approved', result as TaskWithRelations);

    res.json({
      id: result.id,
      status: result.status,
      approvedAt: result.approvedAt,
      message: 'Credits released to worker',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /tasks/:id/cancel - Cancel task and refund credits (requester only, before acceptance)
 */
tasksRouter.post('/:id/cancel', authenticate, async (req, res, next) => {
  try {
    const agent = req.agent!;
    const taskId = req.params.id;

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { escrow: true },
    });

    if (!task) {
      throw new NotFoundError('Task', taskId);
    }

    if (task.requesterId !== agent.id) {
      throw new ForbiddenError('Only the requester can cancel the task');
    }

    if (task.status !== 'OPEN') {
      throw new InvalidStateError(task.status, 'cancel task (can only cancel OPEN tasks)');
    }

    if (!task.escrow) {
      throw new ConflictError('Task has no escrow');
    }

    // Refund credits to requester
    const result = await prisma.$transaction(async (tx) => {
      // Update requester balance
      const requester = await tx.agent.update({
        where: { id: agent.id },
        data: { balance: { increment: task.escrow!.amount } },
      });

      // Update escrow status
      await tx.escrow.update({
        where: { id: task.escrow!.id },
        data: {
          status: 'REFUNDED',
          releasedAt: new Date(),
        },
      });

      // Update task status
      const updatedTask = await tx.task.update({
        where: { id: taskId },
        data: { status: 'CANCELLED' },
        include: {
          requester: { select: { id: true, name: true } },
          worker: { select: { id: true, name: true } },
        },
      });

      // Record transaction
      await tx.transaction.create({
        data: {
          agentId: agent.id,
          type: 'UNLOCK',
          amount: task.escrow!.amount,
          balance: requester.balance,
          taskId: taskId,
          description: `Credits refunded for cancelled task: ${taskId}`,
        },
      });

      return updatedTask;
    });

    // Emit task.cancelled event
    eventEmitter.emitTaskEvent('task.cancelled', result as TaskWithRelations);

    res.json({
      id: result.id,
      status: result.status,
      message: 'Task cancelled, credits refunded',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /tasks/:id/publish - Make a task public (visible in marketplace)
 */
tasksRouter.post('/:id/publish', authenticate, async (req, res, next) => {
  try {
    const agent = req.agent!;
    const taskId = req.params.id;

    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      throw new NotFoundError('Task', taskId);
    }

    if (task.requesterId !== agent.id) {
      throw new ForbiddenError('Only the requester can publish the task');
    }

    if (task.status !== 'OPEN') {
      throw new InvalidStateError(task.status, 'publish task (can only publish OPEN tasks)');
    }

    if (task.visibility === 'PUBLIC') {
      throw new ConflictError('Task is already public');
    }

    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data: { visibility: 'PUBLIC' },
    });

    res.json({
      id: updatedTask.id,
      visibility: updatedTask.visibility,
      message: 'Task is now visible in the marketplace',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /tasks/:id/unpublish - Make a task private (remove from marketplace)
 */
tasksRouter.post('/:id/unpublish', authenticate, async (req, res, next) => {
  try {
    const agent = req.agent!;
    const taskId = req.params.id;

    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      throw new NotFoundError('Task', taskId);
    }

    if (task.requesterId !== agent.id) {
      throw new ForbiddenError('Only the requester can unpublish the task');
    }

    if (task.status !== 'OPEN') {
      throw new InvalidStateError(task.status, 'unpublish task (can only unpublish OPEN tasks)');
    }

    if (task.visibility === 'PRIVATE') {
      throw new ConflictError('Task is already private');
    }

    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data: { visibility: 'PRIVATE' },
    });

    res.json({
      id: updatedTask.id,
      visibility: updatedTask.visibility,
      message: 'Task is now private',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /tasks/:id/validate-output - Validate task output against template schema
 */
tasksRouter.post('/:id/validate-output', optionalAuth, async (req, res, next) => {
  try {
    const body = validateOutputSchema.parse(req.body);
    const taskId = req.params.id;

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        template: true,
      },
    });

    if (!task) {
      throw new NotFoundError('Task', taskId);
    }

    if (!task.template) {
      throw new BadRequestError('Task was not created from a template and has no output schema to validate against');
    }

    const result = validateOutputSafe(task.template, body.output);

    res.json({
      valid: result.valid,
      errors: result.errors,
      templateId: task.templateId,
      templateName: task.template.name,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new BadRequestError('Invalid request body', { errors: error.errors }));
      return;
    }
    next(error);
  }
});

/**
 * POST /tasks/:id/dispute - Open a dispute on a task
 */
tasksRouter.use('/:id/dispute', openDisputeHandler);

/**
 * Bids sub-router for /tasks/:id/bids
 */
import { bidsRouter } from './bids.js';
tasksRouter.use('/:id/bids', bidsRouter);
