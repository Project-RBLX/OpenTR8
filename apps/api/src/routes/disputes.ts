import { Router } from 'express';
import { z } from 'zod';
import { DisputeStatus, DisputeResolution } from '@opentr8/database';
import {
  BadRequestError,
  ForbiddenError,
} from '@opentr8/shared';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import { disputeService } from '../services/disputes.js';

export const disputesRouter = Router();

// Validation schemas
const openDisputeSchema = z.object({
  reason: z.string().min(10).max(5000),
});

const submitEvidenceSchema = z.object({
  content: z.string().min(1).max(10000),
  attachments: z.array(z.string().url()).optional(),
});

const addCommentSchema = z.object({
  content: z.string().min(1).max(2000),
});

const resolveDisputeSchema = z.object({
  resolution: z.enum(['REQUESTER_WINS', 'WORKER_WINS', 'SPLIT']),
});

/**
 * POST /tasks/:id/dispute - Open a dispute on a task
 * Mounted as /tasks/:id/dispute in task routes
 */
export const openDisputeHandler = Router({ mergeParams: true });

openDisputeHandler.post('/', authenticate, async (req, res, next) => {
  try {
    const body = openDisputeSchema.parse(req.body);
    const agent = req.agent!;
    const taskId = req.params.id;

    const dispute = await disputeService.openDispute(
      taskId,
      agent.id,
      body.reason
    );

    res.status(201).json({
      id: dispute.id,
      taskId: dispute.taskId,
      status: dispute.status,
      initiatorId: dispute.initiatorId,
      reason: dispute.reason,
      createdAt: dispute.createdAt,
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
 * GET /disputes - List disputes
 * Query params:
 *   - status: Filter by dispute status
 *   - my-disputes: If true, only show disputes where agent is a party
 */
disputesRouter.get('/', optionalAuth, async (req, res, next) => {
  try {
    const status = req.query.status as DisputeStatus | undefined;
    const myDisputes = req.query['my-disputes'] === 'true';
    const agent = req.agent;

    // Validate status if provided
    if (status && !['OPENED', 'EVIDENCE', 'ARBITRATION', 'RESOLVED'].includes(status)) {
      throw new BadRequestError('Invalid status filter', {
        validStatuses: ['OPENED', 'EVIDENCE', 'ARBITRATION', 'RESOLVED'],
      });
    }

    const disputes = await disputeService.listDisputes({
      agentId: agent?.id,
      status,
      myDisputes,
    });

    res.json({
      disputes: disputes.map((d) => ({
        id: d.id,
        taskId: d.taskId,
        status: d.status,
        initiatorId: d.initiatorId,
        reason: d.reason,
        resolution: d.resolution,
        arbiterId: d.arbiterId,
        createdAt: d.createdAt,
        resolvedAt: d.resolvedAt,
        // Include relations if available
        task: (d as any).task
          ? {
              id: (d as any).task.id,
              description: (d as any).task.description,
              credits: (d as any).task.credits.toString(),
              status: (d as any).task.status,
              requester: (d as any).task.requester,
              worker: (d as any).task.worker,
            }
          : undefined,
        initiator: (d as any).initiator,
        arbiter: (d as any).arbiter,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /disputes/:id - Get dispute details with evidence
 */
disputesRouter.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const disputeId = req.params.id;
    const dispute = await disputeService.getDispute(disputeId);

    res.json({
      id: dispute.id,
      taskId: dispute.taskId,
      status: dispute.status,
      initiatorId: dispute.initiatorId,
      reason: dispute.reason,
      resolution: dispute.resolution,
      arbiterId: dispute.arbiterId,
      createdAt: dispute.createdAt,
      updatedAt: dispute.updatedAt,
      resolvedAt: dispute.resolvedAt,
      task: {
        id: dispute.task.id,
        description: dispute.task.description,
        credits: dispute.task.credits.toString(),
        deadline: dispute.task.deadline,
        status: dispute.task.status,
        requesterId: dispute.task.requesterId,
        workerId: dispute.task.workerId,
        requester: (dispute.task as any).requester,
        worker: (dispute.task as any).worker,
        escrow: (dispute.task as any).escrow
          ? {
              status: (dispute.task as any).escrow.status,
              amount: (dispute.task as any).escrow.amount.toString(),
            }
          : null,
      },
      initiator: (dispute as any).initiator,
      arbiter: (dispute as any).arbiter,
      evidence: dispute.evidence.map((e) => ({
        id: e.id,
        content: e.content,
        attachments: e.attachments,
        submittedBy: (e as any).submittedBy,
        createdAt: e.createdAt,
      })),
      comments: dispute.comments.map((c) => ({
        id: c.id,
        content: c.content,
        author: (c as any).author,
        createdAt: c.createdAt,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /disputes/:id/evidence - Submit evidence for a dispute
 */
disputesRouter.post('/:id/evidence', authenticate, async (req, res, next) => {
  try {
    const body = submitEvidenceSchema.parse(req.body);
    const agent = req.agent!;
    const disputeId = req.params.id;

    const evidence = await disputeService.submitEvidence(
      disputeId,
      agent.id,
      body.content,
      body.attachments || []
    );

    res.status(201).json({
      id: evidence.id,
      disputeId: evidence.disputeId,
      content: evidence.content,
      attachments: evidence.attachments,
      submittedById: evidence.submittedById,
      createdAt: evidence.createdAt,
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
 * POST /disputes/:id/comment - Add a comment to a dispute
 */
disputesRouter.post('/:id/comment', authenticate, async (req, res, next) => {
  try {
    const body = addCommentSchema.parse(req.body);
    const agent = req.agent!;
    const disputeId = req.params.id;

    const comment = await disputeService.addComment(
      disputeId,
      agent.id,
      body.content
    );

    res.status(201).json({
      id: comment.id,
      disputeId: comment.disputeId,
      content: comment.content,
      authorId: comment.authorId,
      createdAt: comment.createdAt,
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
 * POST /disputes/:id/resolve - Resolve a dispute (admin/arbiter only for now)
 *
 * Note: In production, this should be restricted to authorized arbiters.
 * For now, any authenticated agent can resolve a dispute.
 */
disputesRouter.post('/:id/resolve', authenticate, async (req, res, next) => {
  try {
    const body = resolveDisputeSchema.parse(req.body);
    const agent = req.agent!;
    const disputeId = req.params.id;

    // TODO: Add proper arbiter authorization check
    // For now, we allow any authenticated agent to resolve for demo purposes
    // In production, check if agent.id is an authorized arbiter

    const dispute = await disputeService.resolveDispute(
      disputeId,
      body.resolution as DisputeResolution,
      agent.id
    );

    res.json({
      id: dispute.id,
      taskId: dispute.taskId,
      status: dispute.status,
      resolution: dispute.resolution,
      arbiterId: dispute.arbiterId,
      resolvedAt: dispute.resolvedAt,
      message: `Dispute resolved: ${body.resolution}`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new BadRequestError('Invalid request body', { errors: error.errors }));
      return;
    }
    next(error);
  }
});
