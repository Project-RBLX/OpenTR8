import { Router } from 'express';
import { z } from 'zod';
import { prisma, Prisma } from '@opentr8/database';
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  InvalidStateError,
} from '@opentr8/shared';
import { authenticate, optionalAuth } from '../middleware/auth.js';

export const marketplaceRouter = Router();

// Validation schemas
const listMarketplaceSchema = z.object({
  minCredits: z.coerce.number().int().positive().optional(),
  maxCredits: z.coerce.number().int().positive().optional(),
  status: z.enum(['OPEN']).optional(), // Only OPEN tasks in marketplace
  sortBy: z.enum(['credits', 'deadline', 'createdAt']).optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  offset: z.coerce.number().int().nonnegative().optional().default(0),
});

const submitBidSchema = z.object({
  amount: z.number().int().positive(),
  message: z.string().max(1000).optional(),
});

/**
 * GET /marketplace - List public tasks available for bidding
 */
marketplaceRouter.get('/', optionalAuth, async (req, res, next) => {
  try {
    const query = listMarketplaceSchema.parse(req.query);

    // Build where clause for public, open tasks
    const where: Prisma.TaskWhereInput = {
      visibility: 'PUBLIC',
      status: 'OPEN',
    };

    // Credit range filters
    if (query.minCredits !== undefined || query.maxCredits !== undefined) {
      where.credits = {};
      if (query.minCredits !== undefined) {
        where.credits.gte = BigInt(query.minCredits);
      }
      if (query.maxCredits !== undefined) {
        where.credits.lte = BigInt(query.maxCredits);
      }
    }

    // Build order by
    const orderBy: Prisma.TaskOrderByWithRelationInput = {};
    orderBy[query.sortBy] = query.sortOrder;

    // Count total for pagination
    const total = await prisma.task.count({ where });

    // Fetch tasks with requester info and bid count
    const tasks = await prisma.task.findMany({
      where,
      orderBy,
      skip: query.offset,
      take: query.limit,
      include: {
        requester: {
          select: {
            id: true,
            name: true,
            reputation: {
              select: {
                tier: true,
                successRate: true,
              },
            },
          },
        },
        _count: {
          select: { bids: true },
        },
      },
    });

    res.json({
      tasks: tasks.map((t) => ({
        id: t.id,
        description: t.description,
        credits: t.credits.toString(),
        deadline: t.deadline,
        status: t.status,
        requester: {
          id: t.requester.id,
          name: t.requester.name,
          reputation: t.requester.reputation
            ? {
                tier: t.requester.reputation.tier,
                successRate: t.requester.reputation.successRate,
              }
            : null,
        },
        bidCount: t._count.bids,
        createdAt: t.createdAt,
      })),
      pagination: {
        total,
        limit: query.limit,
        offset: query.offset,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new BadRequestError('Invalid query parameters', { errors: error.errors }));
      return;
    }
    next(error);
  }
});

/**
 * GET /marketplace/my-bids - List bids submitted by the authenticated agent
 * NOTE: This route must come BEFORE /:id to avoid route conflicts
 */
marketplaceRouter.get('/my-bids', authenticate, async (req, res, next) => {
  try {
    const agent = req.agent!;

    const bids = await prisma.bid.findMany({
      where: { bidderId: agent.id },
      orderBy: { createdAt: 'desc' },
      include: {
        task: {
          select: {
            id: true,
            description: true,
            credits: true,
            deadline: true,
            status: true,
            requester: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    res.json({
      bids: bids.map((b) => ({
        id: b.id,
        amount: b.amount.toString(),
        message: b.message,
        status: b.status,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
        task: {
          id: b.task.id,
          description: b.task.description,
          credits: b.task.credits.toString(),
          deadline: b.task.deadline,
          status: b.task.status,
          requester: b.task.requester,
        },
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /marketplace/:id - Get public task details
 */
marketplaceRouter.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const task = await prisma.task.findUnique({
      where: { id: req.params.id },
      include: {
        requester: {
          select: {
            id: true,
            name: true,
            reputation: {
              select: {
                tier: true,
                successRate: true,
                tasksRequested: true,
                tasksCompleted: true,
              },
            },
          },
        },
        _count: {
          select: { bids: true },
        },
      },
    });

    if (!task) {
      throw new NotFoundError('Task', req.params.id);
    }

    // Only allow viewing public tasks (or private tasks if requester)
    if (task.visibility !== 'PUBLIC' && task.requesterId !== req.agent?.id) {
      throw new NotFoundError('Task', req.params.id);
    }

    res.json({
      id: task.id,
      description: task.description,
      credits: task.credits.toString(),
      deadline: task.deadline,
      status: task.status,
      visibility: task.visibility,
      requester: {
        id: task.requester.id,
        name: task.requester.name,
        reputation: task.requester.reputation
          ? {
              tier: task.requester.reputation.tier,
              successRate: task.requester.reputation.successRate,
              tasksRequested: task.requester.reputation.tasksRequested,
              tasksCompleted: task.requester.reputation.tasksCompleted,
            }
          : null,
      },
      bidCount: task._count.bids,
      metadata: task.metadata,
      createdAt: task.createdAt,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /marketplace/:id/bid - Submit a bid on a public task
 */
marketplaceRouter.post('/:id/bid', authenticate, async (req, res, next) => {
  try {
    const body = submitBidSchema.parse(req.body);
    const agent = req.agent!;
    const taskId = req.params.id;

    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      throw new NotFoundError('Task', taskId);
    }

    // Task must be public and open
    if (task.visibility !== 'PUBLIC') {
      throw new ForbiddenError('Can only bid on public tasks');
    }

    if (task.status !== 'OPEN') {
      throw new InvalidStateError(task.status, 'bid on task');
    }

    // Cannot bid on your own task
    if (task.requesterId === agent.id) {
      throw new ForbiddenError('Cannot bid on your own task');
    }

    // Check if agent already has a pending bid
    const existingBid = await prisma.bid.findUnique({
      where: {
        taskId_bidderId: {
          taskId,
          bidderId: agent.id,
        },
      },
    });

    if (existingBid && existingBid.status === 'PENDING') {
      throw new ForbiddenError('You already have a pending bid on this task');
    }

    // Create or update bid
    const bid = await prisma.bid.upsert({
      where: {
        taskId_bidderId: {
          taskId,
          bidderId: agent.id,
        },
      },
      create: {
        taskId,
        bidderId: agent.id,
        amount: BigInt(body.amount),
        message: body.message,
        status: 'PENDING',
      },
      update: {
        amount: BigInt(body.amount),
        message: body.message,
        status: 'PENDING',
        updatedAt: new Date(),
      },
    });

    res.status(201).json({
      id: bid.id,
      taskId: bid.taskId,
      amount: bid.amount.toString(),
      message: bid.message,
      status: bid.status,
      createdAt: bid.createdAt,
      updatedAt: bid.updatedAt,
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
 * DELETE /marketplace/:id/bid - Withdraw a bid
 */
marketplaceRouter.delete('/:id/bid', authenticate, async (req, res, next) => {
  try {
    const agent = req.agent!;
    const taskId = req.params.id;

    const bid = await prisma.bid.findUnique({
      where: {
        taskId_bidderId: {
          taskId,
          bidderId: agent.id,
        },
      },
    });

    if (!bid) {
      throw new NotFoundError('Bid', `task:${taskId}`);
    }

    if (bid.status !== 'PENDING') {
      throw new InvalidStateError(bid.status, 'withdraw bid');
    }

    const updatedBid = await prisma.bid.update({
      where: { id: bid.id },
      data: { status: 'WITHDRAWN' },
    });

    res.json({
      id: updatedBid.id,
      status: updatedBid.status,
      message: 'Bid withdrawn successfully',
    });
  } catch (error) {
    next(error);
  }
});
