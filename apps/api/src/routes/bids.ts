import { Router } from 'express';
import { prisma } from '@opentr8/database';
import {
  NotFoundError,
  ForbiddenError,
  InvalidStateError,
  ConflictError,
} from '@opentr8/shared';
import { authenticate } from '../middleware/auth.js';
import { eventEmitter, TaskWithRelations } from '../services/events.js';

export const bidsRouter = Router({ mergeParams: true });

/**
 * GET /tasks/:id/bids - List bids on a task (requester only)
 */
bidsRouter.get('/', authenticate, async (req, res, next) => {
  try {
    const agent = req.agent!;
    const taskId = req.params.id;

    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      throw new NotFoundError('Task', taskId);
    }

    // Only requester can view bids on their task
    if (task.requesterId !== agent.id) {
      throw new ForbiddenError('Only the task requester can view bids');
    }

    const bids = await prisma.bid.findMany({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
      include: {
        bidder: {
          select: {
            id: true,
            name: true,
            reputation: {
              select: {
                tier: true,
                successRate: true,
                tasksCompleted: true,
                avgResponseTime: true,
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
        bidder: {
          id: b.bidder.id,
          name: b.bidder.name,
          reputation: b.bidder.reputation
            ? {
                tier: b.bidder.reputation.tier,
                successRate: b.bidder.reputation.successRate,
                tasksCompleted: b.bidder.reputation.tasksCompleted,
                avgResponseTimeHours: b.bidder.reputation.avgResponseTime,
              }
            : null,
        },
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /tasks/:id/bids/:bidId/accept - Accept a bid
 * This assigns the bidder as worker and updates the task
 */
bidsRouter.post('/:bidId/accept', authenticate, async (req, res, next) => {
  try {
    const agent = req.agent!;
    const taskId = req.params.id;
    const bidId = req.params.bidId;

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { escrow: true },
    });

    if (!task) {
      throw new NotFoundError('Task', taskId);
    }

    // Only requester can accept bids
    if (task.requesterId !== agent.id) {
      throw new ForbiddenError('Only the task requester can accept bids');
    }

    // Task must be open
    if (task.status !== 'OPEN') {
      throw new InvalidStateError(task.status, 'accept bid');
    }

    const bid = await prisma.bid.findUnique({
      where: { id: bidId },
    });

    if (!bid || bid.taskId !== taskId) {
      throw new NotFoundError('Bid', bidId);
    }

    if (bid.status !== 'PENDING') {
      throw new InvalidStateError(bid.status, 'accept bid');
    }

    if (!task.escrow) {
      throw new ConflictError('Task has no escrow');
    }

    // Calculate escrow adjustment if bid amount differs from task credits
    const creditsDiff = bid.amount - task.credits;

    // Execute the bid acceptance in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // If bid amount is different from original credits, adjust escrow
      if (creditsDiff !== BigInt(0)) {
        if (creditsDiff > BigInt(0)) {
          // Bid is higher than original - need more credits from requester
          const requester = await tx.agent.findUnique({
            where: { id: agent.id },
          });

          if (!requester || requester.balance < creditsDiff) {
            throw new ConflictError(
              `Insufficient balance. Need ${creditsDiff.toString()} more credits for accepted bid amount.`
            );
          }

          // Deduct additional credits from requester
          const updatedRequester = await tx.agent.update({
            where: { id: agent.id },
            data: { balance: { decrement: creditsDiff } },
          });

          // Update escrow amount
          await tx.escrow.update({
            where: { id: task.escrow!.id },
            data: { amount: bid.amount },
          });

          // Record transaction for additional lock
          await tx.transaction.create({
            data: {
              agentId: agent.id,
              type: 'LOCK',
              amount: -creditsDiff,
              balance: updatedRequester.balance,
              taskId: taskId,
              description: `Additional credits locked for accepted bid: ${taskId}`,
            },
          });
        } else {
          // Bid is lower than original - refund difference to requester
          const refundAmount = -creditsDiff; // Make positive

          const updatedRequester = await tx.agent.update({
            where: { id: agent.id },
            data: { balance: { increment: refundAmount } },
          });

          // Update escrow amount
          await tx.escrow.update({
            where: { id: task.escrow!.id },
            data: { amount: bid.amount },
          });

          // Record transaction for partial refund
          await tx.transaction.create({
            data: {
              agentId: agent.id,
              type: 'UNLOCK',
              amount: refundAmount,
              balance: updatedRequester.balance,
              taskId: taskId,
              description: `Credits refunded for lower bid acceptance: ${taskId}`,
            },
          });
        }
      }

      // Update task with worker and new credits
      const updatedTask = await tx.task.update({
        where: { id: taskId },
        data: {
          workerId: bid.bidderId,
          credits: bid.amount,
          status: 'IN_PROGRESS',
          visibility: 'PRIVATE', // Make private once accepted
          acceptedAt: new Date(),
        },
        include: {
          requester: { select: { id: true, name: true } },
          worker: { select: { id: true, name: true } },
        },
      });

      // Accept the winning bid
      await tx.bid.update({
        where: { id: bidId },
        data: { status: 'ACCEPTED' },
      });

      // Reject all other pending bids
      await tx.bid.updateMany({
        where: {
          taskId,
          id: { not: bidId },
          status: 'PENDING',
        },
        data: { status: 'REJECTED' },
      });

      return updatedTask;
    });

    // Emit task.accepted event
    eventEmitter.emitTaskEvent('task.accepted', result as TaskWithRelations);

    res.json({
      id: result.id,
      status: result.status,
      credits: result.credits.toString(),
      workerId: result.workerId,
      acceptedAt: result.acceptedAt,
      message: 'Bid accepted, worker assigned',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /tasks/:id/bids/:bidId/reject - Reject a bid
 */
bidsRouter.post('/:bidId/reject', authenticate, async (req, res, next) => {
  try {
    const agent = req.agent!;
    const taskId = req.params.id;
    const bidId = req.params.bidId;

    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      throw new NotFoundError('Task', taskId);
    }

    // Only requester can reject bids
    if (task.requesterId !== agent.id) {
      throw new ForbiddenError('Only the task requester can reject bids');
    }

    const bid = await prisma.bid.findUnique({
      where: { id: bidId },
    });

    if (!bid || bid.taskId !== taskId) {
      throw new NotFoundError('Bid', bidId);
    }

    if (bid.status !== 'PENDING') {
      throw new InvalidStateError(bid.status, 'reject bid');
    }

    const updatedBid = await prisma.bid.update({
      where: { id: bidId },
      data: { status: 'REJECTED' },
    });

    res.json({
      id: updatedBid.id,
      status: updatedBid.status,
      message: 'Bid rejected',
    });
  } catch (error) {
    next(error);
  }
});
