import {
  prisma,
  Dispute,
  DisputeEvidence,
  DisputeComment,
  DisputeStatus,
  DisputeResolution,
  Task,
  Prisma,
} from '@opentr8/database';
import {
  NotFoundError,
  ForbiddenError,
  InvalidStateError,
  ConflictError,
} from '@opentr8/shared';
import { eventEmitter, TaskWithRelations } from './events.js';

// 24 hours in milliseconds for dispute window
const DISPUTE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Dispute service - handles all dispute-related business logic
 */
export class DisputeService {
  /**
   * Check if a task can be disputed
   * - Task must be COMPLETED
   * - Must be within deadline + 24 hours
   */
  canDispute(task: Task): { canDispute: boolean; reason?: string } {
    if (task.status !== 'COMPLETED') {
      return {
        canDispute: false,
        reason: `Task must be in COMPLETED status, currently: ${task.status}`,
      };
    }

    const disputeDeadline = new Date(task.deadline.getTime() + DISPUTE_WINDOW_MS);
    if (new Date() > disputeDeadline) {
      return {
        canDispute: false,
        reason: `Dispute window has closed. Deadline was ${disputeDeadline.toISOString()}`,
      };
    }

    return { canDispute: true };
  }

  /**
   * Open a dispute on a task
   */
  async openDispute(
    taskId: string,
    initiatorId: string,
    reason: string
  ): Promise<Dispute> {
    // Fetch task with escrow
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        escrow: true,
        requester: { select: { id: true, name: true } },
        worker: { select: { id: true, name: true } },
        dispute: true,
      },
    });

    if (!task) {
      throw new NotFoundError('Task', taskId);
    }

    // Check if initiator is a party to the task
    if (task.requesterId !== initiatorId && task.workerId !== initiatorId) {
      throw new ForbiddenError('Only the task requester or worker can open a dispute');
    }

    // Check if task already has a dispute
    if (task.dispute) {
      throw new ConflictError('Task already has an active dispute');
    }

    // Check if task can be disputed
    const { canDispute, reason: cannotReason } = this.canDispute(task);
    if (!canDispute) {
      throw new InvalidStateError(task.status, `open dispute: ${cannotReason}`);
    }

    // Create dispute and update task status in transaction
    const dispute = await prisma.$transaction(async (tx) => {
      // Create the dispute
      const newDispute = await tx.dispute.create({
        data: {
          taskId,
          initiatorId,
          reason,
          status: 'OPENED',
        },
      });

      // Update task status to DISPUTED
      await tx.task.update({
        where: { id: taskId },
        data: { status: 'DISPUTED' },
      });

      return newDispute;
    });

    // Emit task.disputed event
    const updatedTask = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        requester: { select: { id: true, name: true } },
        worker: { select: { id: true, name: true } },
      },
    });

    if (updatedTask) {
      eventEmitter.emitTaskEvent('task.disputed', updatedTask as TaskWithRelations);
    }

    return dispute;
  }

  /**
   * Get dispute by ID with full details
   */
  async getDispute(disputeId: string): Promise<Dispute & {
    task: Task;
    evidence: DisputeEvidence[];
    comments: DisputeComment[];
  }> {
    const dispute = await prisma.dispute.findUnique({
      where: { id: disputeId },
      include: {
        task: {
          include: {
            requester: { select: { id: true, name: true } },
            worker: { select: { id: true, name: true } },
            escrow: true,
          },
        },
        initiator: { select: { id: true, name: true } },
        arbiter: { select: { id: true, name: true } },
        evidence: {
          include: {
            submittedBy: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        comments: {
          include: {
            author: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!dispute) {
      throw new NotFoundError('Dispute', disputeId);
    }

    return dispute as Dispute & {
      task: Task;
      evidence: DisputeEvidence[];
      comments: DisputeComment[];
    };
  }

  /**
   * Get dispute by task ID
   */
  async getDisputeByTaskId(taskId: string): Promise<Dispute | null> {
    return prisma.dispute.findUnique({
      where: { taskId },
      include: {
        task: true,
        initiator: { select: { id: true, name: true } },
        arbiter: { select: { id: true, name: true } },
        evidence: {
          include: {
            submittedBy: { select: { id: true, name: true } },
          },
        },
        comments: {
          include: {
            author: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  /**
   * List disputes with filters
   */
  async listDisputes(filters: {
    agentId?: string;
    status?: DisputeStatus;
    myDisputes?: boolean;
    limit?: number;
  }): Promise<Dispute[]> {
    const where: Prisma.DisputeWhereInput = {};

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.myDisputes && filters.agentId) {
      // Disputes where the agent is either the initiator, requester, or worker
      where.OR = [
        { initiatorId: filters.agentId },
        { task: { requesterId: filters.agentId } },
        { task: { workerId: filters.agentId } },
      ];
    }

    return prisma.dispute.findMany({
      where,
      include: {
        task: {
          include: {
            requester: { select: { id: true, name: true } },
            worker: { select: { id: true, name: true } },
          },
        },
        initiator: { select: { id: true, name: true } },
        arbiter: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: filters.limit || 100,
    });
  }

  /**
   * Submit evidence for a dispute
   */
  async submitEvidence(
    disputeId: string,
    agentId: string,
    content: string,
    attachments: string[] = []
  ): Promise<DisputeEvidence> {
    const dispute = await prisma.dispute.findUnique({
      where: { id: disputeId },
      include: {
        task: true,
      },
    });

    if (!dispute) {
      throw new NotFoundError('Dispute', disputeId);
    }

    // Check if agent is a party to the dispute
    const task = dispute.task;
    if (task.requesterId !== agentId && task.workerId !== agentId) {
      throw new ForbiddenError('Only the task requester or worker can submit evidence');
    }

    // Check dispute status - can only submit during OPENED or EVIDENCE phase
    if (dispute.status !== 'OPENED' && dispute.status !== 'EVIDENCE') {
      throw new InvalidStateError(dispute.status, 'submit evidence');
    }

    // Create evidence
    const evidence = await prisma.disputeEvidence.create({
      data: {
        disputeId,
        submittedById: agentId,
        content,
        attachments,
      },
    });

    // Check if we should transition to EVIDENCE status
    // (After first evidence submission or automatically after some time)
    if (dispute.status === 'OPENED') {
      // Check if both parties have submitted evidence
      const evidenceCount = await prisma.disputeEvidence.groupBy({
        by: ['submittedById'],
        where: { disputeId },
      });

      const requesterSubmitted = evidenceCount.some(
        (e) => e.submittedById === task.requesterId
      );
      const workerSubmitted = evidenceCount.some(
        (e) => e.submittedById === task.workerId
      );

      if (requesterSubmitted && workerSubmitted) {
        await prisma.dispute.update({
          where: { id: disputeId },
          data: { status: 'EVIDENCE' },
        });
      }
    }

    return evidence;
  }

  /**
   * Add a comment to a dispute
   */
  async addComment(
    disputeId: string,
    authorId: string,
    content: string
  ): Promise<DisputeComment> {
    const dispute = await prisma.dispute.findUnique({
      where: { id: disputeId },
      include: { task: true },
    });

    if (!dispute) {
      throw new NotFoundError('Dispute', disputeId);
    }

    // Check if dispute is not resolved
    if (dispute.status === 'RESOLVED') {
      throw new InvalidStateError(dispute.status, 'add comment');
    }

    // Check if author is a party to the dispute or an arbiter
    const task = dispute.task;
    const isParty =
      task.requesterId === authorId ||
      task.workerId === authorId ||
      dispute.arbiterId === authorId;

    if (!isParty) {
      throw new ForbiddenError('Only dispute participants can add comments');
    }

    return prisma.disputeComment.create({
      data: {
        disputeId,
        authorId,
        content,
      },
    });
  }

  /**
   * Resolve a dispute and distribute escrow
   */
  async resolveDispute(
    disputeId: string,
    resolution: DisputeResolution,
    arbiterId: string
  ): Promise<Dispute> {
    const dispute = await prisma.dispute.findUnique({
      where: { id: disputeId },
      include: {
        task: {
          include: {
            escrow: true,
          },
        },
      },
    });

    if (!dispute) {
      throw new NotFoundError('Dispute', disputeId);
    }

    // Check dispute status
    if (dispute.status === 'RESOLVED') {
      throw new InvalidStateError(dispute.status, 'resolve (already resolved)');
    }

    const task = dispute.task;
    const escrow = task.escrow;

    if (!escrow || escrow.status !== 'LOCKED') {
      throw new ConflictError('No locked escrow found for this task');
    }

    if (!task.workerId) {
      throw new ConflictError('Task has no worker assigned');
    }

    const escrowAmount = escrow.amount;

    // Resolve dispute and distribute escrow in transaction
    const resolvedDispute = await prisma.$transaction(async (tx) => {
      // Calculate distribution based on resolution
      let requesterAmount = BigInt(0);
      let workerAmount = BigInt(0);

      switch (resolution) {
        case 'REQUESTER_WINS':
          requesterAmount = escrowAmount;
          break;
        case 'WORKER_WINS':
          workerAmount = escrowAmount;
          break;
        case 'SPLIT':
          // 50/50 split - handle odd amounts by giving extra to worker
          requesterAmount = escrowAmount / BigInt(2);
          workerAmount = escrowAmount - requesterAmount;
          break;
      }

      // Update requester balance if they win anything
      if (requesterAmount > BigInt(0)) {
        const requester = await tx.agent.update({
          where: { id: task.requesterId },
          data: { balance: { increment: requesterAmount } },
        });

        await tx.transaction.create({
          data: {
            agentId: task.requesterId,
            type: 'UNLOCK',
            amount: requesterAmount,
            balance: requester.balance,
            taskId: task.id,
            description: `Dispute resolved in your favor: ${disputeId}`,
          },
        });
      }

      // Update worker balance if they win anything
      if (workerAmount > BigInt(0)) {
        const worker = await tx.agent.update({
          where: { id: task.workerId! },
          data: { balance: { increment: workerAmount } },
        });

        await tx.transaction.create({
          data: {
            agentId: task.workerId!,
            type: 'EARN',
            amount: workerAmount,
            balance: worker.balance,
            taskId: task.id,
            description: `Dispute resolved in your favor: ${disputeId}`,
          },
        });
      }

      // Update escrow status
      const escrowStatus = resolution === 'REQUESTER_WINS' ? 'REFUNDED' : 'RELEASED';
      await tx.escrow.update({
        where: { id: escrow.id },
        data: {
          status: escrowStatus,
          releasedAt: new Date(),
        },
      });

      // Update dispute status
      const updatedDispute = await tx.dispute.update({
        where: { id: disputeId },
        data: {
          status: 'RESOLVED',
          resolution,
          arbiterId,
          resolvedAt: new Date(),
        },
      });

      return updatedDispute;
    });

    return resolvedDispute;
  }

  /**
   * Transition dispute to ARBITRATION status
   */
  async moveToArbitration(
    disputeId: string,
    arbiterId?: string
  ): Promise<Dispute> {
    const dispute = await prisma.dispute.findUnique({
      where: { id: disputeId },
    });

    if (!dispute) {
      throw new NotFoundError('Dispute', disputeId);
    }

    if (dispute.status !== 'OPENED' && dispute.status !== 'EVIDENCE') {
      throw new InvalidStateError(
        dispute.status,
        'move to arbitration (must be in OPENED or EVIDENCE status)'
      );
    }

    return prisma.dispute.update({
      where: { id: disputeId },
      data: {
        status: 'ARBITRATION',
        arbiterId,
      },
    });
  }
}

// Export singleton instance
export const disputeService = new DisputeService();
