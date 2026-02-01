import { Router } from 'express';
import { z } from 'zod';
import { MultiPartyTaskStatus, MultiPartyRole } from '@opentr8/database';
import { BadRequestError, calculateDeadline, loadConfig } from '@opentr8/shared';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import { multiPartyService, MultiPartyTaskWithRelations } from '../services/multi-party.js';

export const multiPartyRouter = Router();
const config = loadConfig();

// Validation schemas
const participantSchema = z.object({
  agentId: z.string().uuid(),
  role: z.enum(['WORKER', 'REVIEWER']),
  creditShare: z.number().int().nonnegative(),
});

const milestoneSchema = z.object({
  description: z.string().min(1).max(2000),
  credits: z.number().int().nonnegative(),
});

const createMultiPartyTaskSchema = z.object({
  description: z.string().min(1).max(5000),
  totalCredits: z.number().int().positive(),
  deadlineHours: z.number().int().positive().optional(),
  participants: z.array(participantSchema).min(1),
  milestones: z.array(milestoneSchema).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const inviteParticipantSchema = z.object({
  agentId: z.string().uuid(),
  role: z.enum(['WORKER', 'REVIEWER']),
  creditShare: z.number().int().nonnegative(),
});

const updateMilestoneSchema = z.object({
  status: z.enum(['IN_PROGRESS', 'COMPLETED']),
});

/**
 * Helper to serialize a multi-party task for API response
 */
function serializeMultiPartyTask(task: MultiPartyTaskWithRelations) {
  return {
    id: task.id,
    description: task.description,
    totalCredits: task.totalCredits.toString(),
    status: task.status,
    organizer: task.organizer,
    deadline: task.deadline,
    metadata: task.metadata,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    participants: task.participants.map((p) => ({
      id: p.id,
      agent: p.agent,
      role: p.role,
      creditShare: p.creditShare.toString(),
      status: p.status,
      createdAt: p.createdAt,
      acceptedAt: p.acceptedAt,
      completedAt: p.completedAt,
      paidAt: p.paidAt,
    })),
    escrow: task.escrow
      ? {
          id: task.escrow.id,
          totalAmount: task.escrow.totalAmount.toString(),
          releasedAmount: task.escrow.releasedAmount.toString(),
          status: task.escrow.status,
          createdAt: task.escrow.createdAt,
          releasedAt: task.escrow.releasedAt,
        }
      : null,
    milestones: task.milestones.map((m) => ({
      id: m.id,
      description: m.description,
      credits: m.credits.toString(),
      orderIndex: m.orderIndex,
      status: m.status,
      createdAt: m.createdAt,
      completedAt: m.completedAt,
      approvedAt: m.approvedAt,
    })),
  };
}

/**
 * POST /multi-party - Create a multi-party task
 */
multiPartyRouter.post('/', authenticate, async (req, res, next) => {
  try {
    const body = createMultiPartyTaskSchema.parse(req.body);
    const agent = req.agent!;

    const deadlineHours = body.deadlineHours || config.defaultTaskTimeoutHours;
    const deadline = calculateDeadline(deadlineHours);

    const task = await multiPartyService.createMultiPartyTask(agent.id, {
      description: body.description,
      totalCredits: BigInt(body.totalCredits),
      deadline,
      participants: body.participants.map((p) => ({
        agentId: p.agentId,
        role: p.role as MultiPartyRole,
        creditShare: BigInt(p.creditShare),
      })),
      milestones: body.milestones?.map((m) => ({
        description: m.description,
        credits: BigInt(m.credits),
      })),
      metadata: body.metadata,
    });

    res.status(201).json(serializeMultiPartyTask(task));
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new BadRequestError('Invalid request body', { errors: error.errors }));
      return;
    }
    next(error);
  }
});

/**
 * GET /multi-party - List multi-party tasks
 * Query params:
 *   - status: Filter by task status
 *   - as-organizer: If true, only show tasks where agent is organizer
 *   - as-participant: If true, only show tasks where agent is participant
 */
multiPartyRouter.get('/', optionalAuth, async (req, res, next) => {
  try {
    const status = req.query.status as MultiPartyTaskStatus | undefined;
    const asOrganizer = req.query['as-organizer'] === 'true';
    const asParticipant = req.query['as-participant'] === 'true';
    const agent = req.agent;

    // Validate status if provided
    const validStatuses: MultiPartyTaskStatus[] = [
      'OPEN',
      'IN_PROGRESS',
      'COMPLETED',
      'DISTRIBUTED',
      'CANCELLED',
      'EXPIRED',
    ];
    if (status && !validStatuses.includes(status)) {
      throw new BadRequestError('Invalid status filter', {
        validStatuses,
      });
    }

    const tasks = await multiPartyService.listMultiPartyTasks({
      agentId: agent?.id,
      status,
      asOrganizer,
      asParticipant,
    });

    res.json({
      tasks: tasks.map(serializeMultiPartyTask),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /multi-party/:id - Get multi-party task details
 */
multiPartyRouter.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const taskId = req.params.id;
    const task = await multiPartyService.getMultiPartyTask(taskId);
    res.json(serializeMultiPartyTask(task));
  } catch (error) {
    next(error);
  }
});

/**
 * POST /multi-party/:id/invite - Invite a participant (organizer only)
 */
multiPartyRouter.post('/:id/invite', authenticate, async (req, res, next) => {
  try {
    const body = inviteParticipantSchema.parse(req.body);
    const agent = req.agent!;
    const taskId = req.params.id;

    const participant = await multiPartyService.inviteParticipant(
      taskId,
      agent.id,
      body.agentId,
      body.role as MultiPartyRole,
      BigInt(body.creditShare)
    );

    res.status(201).json({
      id: participant.id,
      taskId: participant.taskId,
      agentId: participant.agentId,
      role: participant.role,
      creditShare: participant.creditShare.toString(),
      status: participant.status,
      createdAt: participant.createdAt,
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
 * POST /multi-party/:id/accept - Accept invitation to a task
 */
multiPartyRouter.post('/:id/accept', authenticate, async (req, res, next) => {
  try {
    const agent = req.agent!;
    const taskId = req.params.id;

    const participant = await multiPartyService.acceptInvitation(
      taskId,
      agent.id
    );

    res.json({
      id: participant.id,
      taskId: participant.taskId,
      agentId: participant.agentId,
      status: participant.status,
      acceptedAt: participant.acceptedAt,
      message: 'Invitation accepted',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /multi-party/:id/decline - Decline invitation to a task
 */
multiPartyRouter.post('/:id/decline', authenticate, async (req, res, next) => {
  try {
    const agent = req.agent!;
    const taskId = req.params.id;

    const participant = await multiPartyService.declineInvitation(
      taskId,
      agent.id
    );

    res.json({
      id: participant.id,
      taskId: participant.taskId,
      agentId: participant.agentId,
      status: participant.status,
      message: 'Invitation declined',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /multi-party/:id/complete - Mark your work as complete
 */
multiPartyRouter.post('/:id/complete', authenticate, async (req, res, next) => {
  try {
    const agent = req.agent!;
    const taskId = req.params.id;

    const participant = await multiPartyService.completeParticipantWork(
      taskId,
      agent.id
    );

    res.json({
      id: participant.id,
      taskId: participant.taskId,
      agentId: participant.agentId,
      status: participant.status,
      completedAt: participant.completedAt,
      message: 'Work marked as complete',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /multi-party/:id/distribute - Distribute credits to participants (organizer only)
 */
multiPartyRouter.post('/:id/distribute', authenticate, async (req, res, next) => {
  try {
    const agent = req.agent!;
    const taskId = req.params.id;

    const task = await multiPartyService.distributeCredits(taskId, agent.id);

    res.json({
      ...serializeMultiPartyTask(task),
      message: 'Credits distributed to completed participants',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /multi-party/:id/cancel - Cancel the task (organizer only)
 */
multiPartyRouter.post('/:id/cancel', authenticate, async (req, res, next) => {
  try {
    const agent = req.agent!;
    const taskId = req.params.id;

    const task = await multiPartyService.cancelMultiPartyTask(taskId, agent.id);

    res.json({
      ...serializeMultiPartyTask(task),
      message: 'Task cancelled, credits refunded',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /multi-party/:id/milestones/:milestoneId - Update milestone status
 */
multiPartyRouter.post(
  '/:id/milestones/:milestoneId',
  authenticate,
  async (req, res, next) => {
    try {
      const body = updateMilestoneSchema.parse(req.body);
      const agent = req.agent!;
      const taskId = req.params.id;
      const milestoneId = req.params.milestoneId;

      const milestone = await multiPartyService.updateMilestoneStatus(
        taskId,
        milestoneId,
        agent.id,
        body.status
      );

      res.json({
        id: milestone.id,
        taskId: milestone.taskId,
        description: milestone.description,
        credits: milestone.credits.toString(),
        status: milestone.status,
        completedAt: milestone.completedAt,
        message: `Milestone ${body.status === 'COMPLETED' ? 'completed' : 'started'}`,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        next(new BadRequestError('Invalid request body', { errors: error.errors }));
        return;
      }
      next(error);
    }
  }
);

/**
 * POST /multi-party/:id/milestones/:milestoneId/approve - Approve milestone (organizer only)
 */
multiPartyRouter.post(
  '/:id/milestones/:milestoneId/approve',
  authenticate,
  async (req, res, next) => {
    try {
      const agent = req.agent!;
      const taskId = req.params.id;
      const milestoneId = req.params.milestoneId;

      const milestone = await multiPartyService.approveMilestone(
        taskId,
        milestoneId,
        agent.id
      );

      res.json({
        id: milestone.id,
        taskId: milestone.taskId,
        description: milestone.description,
        credits: milestone.credits.toString(),
        status: milestone.status,
        approvedAt: milestone.approvedAt,
        message: 'Milestone approved',
      });
    } catch (error) {
      next(error);
    }
  }
);
