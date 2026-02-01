import {
  prisma,
  MultiPartyTask,
  MultiPartyParticipant,
  MultiPartyEscrow,
  MultiPartyMilestone,
  MultiPartyTaskStatus,
  MultiPartyRole,
  MultiPartyParticipantStatus,
  Prisma,
} from '@opentr8/database';
import {
  NotFoundError,
  ForbiddenError,
  InvalidStateError,
  ConflictError,
  InsufficientCreditsError,
  BadRequestError,
} from '@opentr8/shared';

// Types for service methods
export interface CreateMultiPartyTaskInput {
  description: string;
  totalCredits: bigint;
  deadline: Date;
  participants: {
    agentId: string;
    role: MultiPartyRole;
    creditShare: bigint;
  }[];
  milestones?: {
    description: string;
    credits: bigint;
  }[];
  metadata?: Record<string, unknown>;
}

export interface MultiPartyTaskWithRelations extends MultiPartyTask {
  organizer: { id: string; name: string };
  participants: (MultiPartyParticipant & {
    agent: { id: string; name: string };
  })[];
  escrow: MultiPartyEscrow | null;
  milestones: MultiPartyMilestone[];
}

/**
 * Multi-Party Escrow Service
 * Handles creation, management, and distribution of multi-party tasks
 */
export class MultiPartyService {
  /**
   * Create a multi-party task with participants and escrow
   */
  async createMultiPartyTask(
    organizerId: string,
    input: CreateMultiPartyTaskInput
  ): Promise<MultiPartyTaskWithRelations> {
    const { description, totalCredits, deadline, participants, milestones, metadata } = input;

    // Validate credit shares sum up to total credits
    const totalCreditShare = participants.reduce(
      (sum, p) => sum + p.creditShare,
      BigInt(0)
    );

    if (totalCreditShare > totalCredits) {
      throw new BadRequestError(
        `Total credit shares (${totalCreditShare}) exceed total credits (${totalCredits})`
      );
    }

    // Validate milestones credits if provided
    if (milestones && milestones.length > 0) {
      const totalMilestoneCredits = milestones.reduce(
        (sum, m) => sum + m.credits,
        BigInt(0)
      );

      if (totalMilestoneCredits > totalCredits) {
        throw new BadRequestError(
          `Total milestone credits (${totalMilestoneCredits}) exceed total credits (${totalCredits})`
        );
      }
    }

    // Check organizer balance
    const organizer = await prisma.agent.findUnique({
      where: { id: organizerId },
    });

    if (!organizer) {
      throw new NotFoundError('Agent', organizerId);
    }

    if (organizer.balance < totalCredits) {
      throw new InsufficientCreditsError(totalCredits, organizer.balance);
    }

    // Verify all participant agents exist
    const participantAgentIds = participants.map((p) => p.agentId);
    const existingAgents = await prisma.agent.findMany({
      where: { id: { in: participantAgentIds } },
      select: { id: true },
    });

    const existingAgentIds = new Set(existingAgents.map((a) => a.id));
    const missingAgents = participantAgentIds.filter(
      (id) => !existingAgentIds.has(id)
    );

    if (missingAgents.length > 0) {
      throw new NotFoundError('Agent', missingAgents.join(', '));
    }

    // Create task, escrow, participants, and milestones in transaction
    const task = await prisma.$transaction(async (tx) => {
      // Deduct credits from organizer
      const updatedOrganizer = await tx.agent.update({
        where: { id: organizerId },
        data: { balance: { decrement: totalCredits } },
      });

      // Create multi-party task
      const newTask = await tx.multiPartyTask.create({
        data: {
          description,
          totalCredits,
          deadline,
          organizerId,
          status: 'OPEN',
          metadata: metadata as Prisma.InputJsonValue,
        },
      });

      // Create escrow
      await tx.multiPartyEscrow.create({
        data: {
          taskId: newTask.id,
          totalAmount: totalCredits,
          status: 'LOCKED',
        },
      });

      // Create organizer as a participant (with ORGANIZER role)
      // Find if organizer is already in participants list
      const organizerParticipant = participants.find(
        (p) => p.agentId === organizerId
      );

      if (!organizerParticipant) {
        // Add organizer as participant with ORGANIZER role and 0 credit share
        await tx.multiPartyParticipant.create({
          data: {
            taskId: newTask.id,
            agentId: organizerId,
            role: 'ORGANIZER',
            creditShare: BigInt(0),
            status: 'ACCEPTED', // Organizer is automatically accepted
            acceptedAt: new Date(),
          },
        });
      }

      // Create other participants
      for (const participant of participants) {
        const isOrganizer = participant.agentId === organizerId;
        await tx.multiPartyParticipant.create({
          data: {
            taskId: newTask.id,
            agentId: participant.agentId,
            role: isOrganizer ? 'ORGANIZER' : participant.role,
            creditShare: participant.creditShare,
            status: isOrganizer ? 'ACCEPTED' : 'PENDING',
            acceptedAt: isOrganizer ? new Date() : null,
          },
        });
      }

      // Create milestones if provided
      if (milestones && milestones.length > 0) {
        for (let i = 0; i < milestones.length; i++) {
          await tx.multiPartyMilestone.create({
            data: {
              taskId: newTask.id,
              description: milestones[i].description,
              credits: milestones[i].credits,
              orderIndex: i,
              status: 'PENDING',
            },
          });
        }
      }

      // Record transaction
      await tx.transaction.create({
        data: {
          agentId: organizerId,
          type: 'LOCK',
          amount: -totalCredits,
          balance: updatedOrganizer.balance,
          taskId: newTask.id,
          description: `Credits locked for multi-party task: ${newTask.id}`,
        },
      });

      return newTask;
    });

    // Fetch and return the complete task with relations
    return this.getMultiPartyTask(task.id);
  }

  /**
   * Get a multi-party task by ID with all relations
   */
  async getMultiPartyTask(taskId: string): Promise<MultiPartyTaskWithRelations> {
    const task = await prisma.multiPartyTask.findUnique({
      where: { id: taskId },
      include: {
        organizer: { select: { id: true, name: true } },
        participants: {
          include: {
            agent: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        escrow: true,
        milestones: {
          orderBy: { orderIndex: 'asc' },
        },
      },
    });

    if (!task) {
      throw new NotFoundError('MultiPartyTask', taskId);
    }

    return task as MultiPartyTaskWithRelations;
  }

  /**
   * List multi-party tasks with filters
   */
  async listMultiPartyTasks(filters: {
    agentId?: string;
    status?: MultiPartyTaskStatus;
    asOrganizer?: boolean;
    asParticipant?: boolean;
    limit?: number;
  }): Promise<MultiPartyTaskWithRelations[]> {
    const where: Prisma.MultiPartyTaskWhereInput = {};

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.agentId) {
      if (filters.asOrganizer && !filters.asParticipant) {
        where.organizerId = filters.agentId;
      } else if (filters.asParticipant && !filters.asOrganizer) {
        where.participants = {
          some: { agentId: filters.agentId },
        };
      } else {
        // Both or neither - show all where agent is involved
        where.OR = [
          { organizerId: filters.agentId },
          { participants: { some: { agentId: filters.agentId } } },
        ];
      }
    }

    const tasks = await prisma.multiPartyTask.findMany({
      where,
      include: {
        organizer: { select: { id: true, name: true } },
        participants: {
          include: {
            agent: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        escrow: true,
        milestones: {
          orderBy: { orderIndex: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: filters.limit || 100,
    });

    return tasks as MultiPartyTaskWithRelations[];
  }

  /**
   * Invite a participant to a multi-party task
   */
  async inviteParticipant(
    taskId: string,
    organizerId: string,
    agentId: string,
    role: MultiPartyRole,
    creditShare: bigint
  ): Promise<MultiPartyParticipant> {
    const task = await prisma.multiPartyTask.findUnique({
      where: { id: taskId },
      include: {
        escrow: true,
        participants: true,
      },
    });

    if (!task) {
      throw new NotFoundError('MultiPartyTask', taskId);
    }

    // Check if requester is the organizer
    if (task.organizerId !== organizerId) {
      throw new ForbiddenError('Only the organizer can invite participants');
    }

    // Check task status
    if (task.status !== 'OPEN') {
      throw new InvalidStateError(task.status, 'invite participant');
    }

    // Check if agent already a participant
    const existingParticipant = task.participants.find(
      (p) => p.agentId === agentId
    );
    if (existingParticipant) {
      throw new ConflictError('Agent is already a participant in this task');
    }

    // Check if adding this credit share exceeds total credits
    const currentTotal = task.participants.reduce(
      (sum, p) => sum + p.creditShare,
      BigInt(0)
    );
    if (currentTotal + creditShare > task.totalCredits) {
      throw new BadRequestError(
        `Adding credit share ${creditShare} would exceed total credits (${task.totalCredits})`
      );
    }

    // Verify agent exists
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
    });

    if (!agent) {
      throw new NotFoundError('Agent', agentId);
    }

    // Create participant
    return prisma.multiPartyParticipant.create({
      data: {
        taskId,
        agentId,
        role,
        creditShare,
        status: 'PENDING',
      },
    });
  }

  /**
   * Accept an invitation to a multi-party task
   */
  async acceptInvitation(
    taskId: string,
    agentId: string
  ): Promise<MultiPartyParticipant> {
    const participant = await prisma.multiPartyParticipant.findUnique({
      where: {
        taskId_agentId: { taskId, agentId },
      },
      include: {
        task: true,
      },
    });

    if (!participant) {
      throw new NotFoundError(
        'MultiPartyParticipant',
        `taskId: ${taskId}, agentId: ${agentId}`
      );
    }

    // Check participant status
    if (participant.status !== 'PENDING') {
      throw new InvalidStateError(participant.status, 'accept invitation');
    }

    // Check task status
    if (participant.task.status !== 'OPEN') {
      throw new InvalidStateError(
        participant.task.status,
        'accept invitation (task must be OPEN)'
      );
    }

    // Update participant status
    const updatedParticipant = await prisma.multiPartyParticipant.update({
      where: { id: participant.id },
      data: {
        status: 'ACCEPTED',
        acceptedAt: new Date(),
      },
    });

    // Check if all participants have accepted - if so, move task to IN_PROGRESS
    await this.checkAndUpdateTaskStatus(taskId);

    return updatedParticipant;
  }

  /**
   * Decline an invitation to a multi-party task
   */
  async declineInvitation(
    taskId: string,
    agentId: string
  ): Promise<MultiPartyParticipant> {
    const participant = await prisma.multiPartyParticipant.findUnique({
      where: {
        taskId_agentId: { taskId, agentId },
      },
      include: {
        task: true,
      },
    });

    if (!participant) {
      throw new NotFoundError(
        'MultiPartyParticipant',
        `taskId: ${taskId}, agentId: ${agentId}`
      );
    }

    // Check participant status
    if (participant.status !== 'PENDING') {
      throw new InvalidStateError(participant.status, 'decline invitation');
    }

    // Update participant status
    return prisma.multiPartyParticipant.update({
      where: { id: participant.id },
      data: {
        status: 'DECLINED',
      },
    });
  }

  /**
   * Mark a participant's work as complete
   */
  async completeParticipantWork(
    taskId: string,
    agentId: string
  ): Promise<MultiPartyParticipant> {
    const participant = await prisma.multiPartyParticipant.findUnique({
      where: {
        taskId_agentId: { taskId, agentId },
      },
      include: {
        task: true,
      },
    });

    if (!participant) {
      throw new NotFoundError(
        'MultiPartyParticipant',
        `taskId: ${taskId}, agentId: ${agentId}`
      );
    }

    // Check participant status
    if (participant.status !== 'ACCEPTED') {
      throw new InvalidStateError(
        participant.status,
        'complete work (must be ACCEPTED)'
      );
    }

    // Check task status
    if (
      participant.task.status !== 'OPEN' &&
      participant.task.status !== 'IN_PROGRESS'
    ) {
      throw new InvalidStateError(
        participant.task.status,
        'complete work (task must be OPEN or IN_PROGRESS)'
      );
    }

    // Update participant status
    const updatedParticipant = await prisma.multiPartyParticipant.update({
      where: { id: participant.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    // Check if all participants have completed - if so, move task to COMPLETED
    await this.checkAndUpdateTaskStatus(taskId);

    return updatedParticipant;
  }

  /**
   * Distribute credits to all completed participants
   * Only the organizer can trigger this
   */
  async distributeCredits(
    taskId: string,
    organizerId: string
  ): Promise<MultiPartyTaskWithRelations> {
    const task = await prisma.multiPartyTask.findUnique({
      where: { id: taskId },
      include: {
        escrow: true,
        participants: {
          include: {
            agent: true,
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundError('MultiPartyTask', taskId);
    }

    // Check if requester is the organizer
    if (task.organizerId !== organizerId) {
      throw new ForbiddenError('Only the organizer can distribute credits');
    }

    // Check task status - can distribute when COMPLETED or IN_PROGRESS (for partial)
    if (
      task.status !== 'COMPLETED' &&
      task.status !== 'IN_PROGRESS' &&
      task.status !== 'OPEN'
    ) {
      throw new InvalidStateError(task.status, 'distribute credits');
    }

    // Check escrow exists and is locked
    if (!task.escrow || task.escrow.status === 'RELEASED') {
      throw new ConflictError('No locked escrow available for distribution');
    }

    // Get completed participants who haven't been paid
    const completedParticipants = task.participants.filter(
      (p) => p.status === 'COMPLETED' && p.creditShare > BigInt(0)
    );

    if (completedParticipants.length === 0) {
      throw new BadRequestError('No completed participants to pay');
    }

    // Calculate total to distribute
    const totalToDistribute = completedParticipants.reduce(
      (sum, p) => sum + p.creditShare,
      BigInt(0)
    );

    // Check we have enough in escrow
    const availableInEscrow =
      task.escrow.totalAmount - task.escrow.releasedAmount;
    if (totalToDistribute > availableInEscrow) {
      throw new BadRequestError(
        `Cannot distribute ${totalToDistribute} credits, only ${availableInEscrow} available in escrow`
      );
    }

    // Distribute credits in transaction
    await prisma.$transaction(async (tx) => {
      for (const participant of completedParticipants) {
        // Update agent balance
        const updatedAgent = await tx.agent.update({
          where: { id: participant.agentId },
          data: { balance: { increment: participant.creditShare } },
        });

        // Update participant status
        await tx.multiPartyParticipant.update({
          where: { id: participant.id },
          data: {
            status: 'PAID',
            paidAt: new Date(),
          },
        });

        // Record transaction
        await tx.transaction.create({
          data: {
            agentId: participant.agentId,
            type: 'EARN',
            amount: participant.creditShare,
            balance: updatedAgent.balance,
            taskId: taskId,
            description: `Credits earned from multi-party task: ${taskId}`,
          },
        });
      }

      // Update escrow
      const newReleasedAmount =
        task.escrow!.releasedAmount + totalToDistribute;
      const allReleased = newReleasedAmount >= task.escrow!.totalAmount;

      await tx.multiPartyEscrow.update({
        where: { id: task.escrow!.id },
        data: {
          releasedAmount: newReleasedAmount,
          status: allReleased ? 'RELEASED' : 'PARTIALLY_RELEASED',
          releasedAt: allReleased ? new Date() : null,
        },
      });

      // Update task status if all credits distributed
      if (allReleased) {
        await tx.multiPartyTask.update({
          where: { id: taskId },
          data: { status: 'DISTRIBUTED' },
        });
      }
    });

    return this.getMultiPartyTask(taskId);
  }

  /**
   * Cancel a multi-party task (organizer only, refunds credits)
   */
  async cancelMultiPartyTask(
    taskId: string,
    organizerId: string
  ): Promise<MultiPartyTaskWithRelations> {
    const task = await prisma.multiPartyTask.findUnique({
      where: { id: taskId },
      include: {
        escrow: true,
        participants: true,
      },
    });

    if (!task) {
      throw new NotFoundError('MultiPartyTask', taskId);
    }

    // Check if requester is the organizer
    if (task.organizerId !== organizerId) {
      throw new ForbiddenError('Only the organizer can cancel the task');
    }

    // Can only cancel OPEN tasks
    if (task.status !== 'OPEN') {
      throw new InvalidStateError(
        task.status,
        'cancel task (can only cancel OPEN tasks)'
      );
    }

    // Check if any work has been completed
    const completedParticipants = task.participants.filter(
      (p) => p.status === 'COMPLETED' || p.status === 'PAID'
    );
    if (completedParticipants.length > 0) {
      throw new ConflictError(
        'Cannot cancel task with completed or paid participants'
      );
    }

    // Refund credits to organizer
    await prisma.$transaction(async (tx) => {
      if (task.escrow && task.escrow.status === 'LOCKED') {
        const refundAmount =
          task.escrow.totalAmount - task.escrow.releasedAmount;

        // Update organizer balance
        const updatedOrganizer = await tx.agent.update({
          where: { id: organizerId },
          data: { balance: { increment: refundAmount } },
        });

        // Update escrow status
        await tx.multiPartyEscrow.update({
          where: { id: task.escrow.id },
          data: {
            status: 'REFUNDED',
            releasedAt: new Date(),
          },
        });

        // Record transaction
        await tx.transaction.create({
          data: {
            agentId: organizerId,
            type: 'UNLOCK',
            amount: refundAmount,
            balance: updatedOrganizer.balance,
            taskId: taskId,
            description: `Credits refunded for cancelled multi-party task: ${taskId}`,
          },
        });
      }

      // Update task status
      await tx.multiPartyTask.update({
        where: { id: taskId },
        data: { status: 'CANCELLED' },
      });
    });

    return this.getMultiPartyTask(taskId);
  }

  /**
   * Check and update task status based on participant statuses
   */
  private async checkAndUpdateTaskStatus(taskId: string): Promise<void> {
    const task = await prisma.multiPartyTask.findUnique({
      where: { id: taskId },
      include: {
        participants: true,
      },
    });

    if (!task) return;

    // Don't update if task is already in a terminal state
    if (
      task.status === 'COMPLETED' ||
      task.status === 'DISTRIBUTED' ||
      task.status === 'CANCELLED' ||
      task.status === 'EXPIRED'
    ) {
      return;
    }

    const nonOrganizerParticipants = task.participants.filter(
      (p) => p.role !== 'ORGANIZER'
    );

    // If no non-organizer participants, nothing to check
    if (nonOrganizerParticipants.length === 0) return;

    // Check if all non-organizer participants have accepted
    const allAccepted = nonOrganizerParticipants.every(
      (p) =>
        p.status === 'ACCEPTED' ||
        p.status === 'COMPLETED' ||
        p.status === 'PAID'
    );

    // Check if all non-organizer participants have completed
    const allCompleted = nonOrganizerParticipants.every(
      (p) => p.status === 'COMPLETED' || p.status === 'PAID'
    );

    let newStatus: MultiPartyTaskStatus | null = null;

    if (allCompleted) {
      newStatus = 'COMPLETED';
    } else if (allAccepted && task.status === 'OPEN') {
      newStatus = 'IN_PROGRESS';
    }

    if (newStatus && newStatus !== task.status) {
      await prisma.multiPartyTask.update({
        where: { id: taskId },
        data: { status: newStatus },
      });
    }
  }

  /**
   * Update milestone status
   */
  async updateMilestoneStatus(
    taskId: string,
    milestoneId: string,
    agentId: string,
    status: 'IN_PROGRESS' | 'COMPLETED'
  ): Promise<MultiPartyMilestone> {
    const task = await prisma.multiPartyTask.findUnique({
      where: { id: taskId },
      include: {
        participants: true,
        milestones: true,
      },
    });

    if (!task) {
      throw new NotFoundError('MultiPartyTask', taskId);
    }

    // Check if agent is a participant
    const participant = task.participants.find((p) => p.agentId === agentId);
    if (!participant) {
      throw new ForbiddenError('Only participants can update milestones');
    }

    const milestone = task.milestones.find((m) => m.id === milestoneId);
    if (!milestone) {
      throw new NotFoundError('MultiPartyMilestone', milestoneId);
    }

    // Validate status transition
    if (status === 'IN_PROGRESS' && milestone.status !== 'PENDING') {
      throw new InvalidStateError(milestone.status, 'start milestone');
    }

    if (status === 'COMPLETED' && milestone.status !== 'IN_PROGRESS') {
      throw new InvalidStateError(milestone.status, 'complete milestone');
    }

    return prisma.multiPartyMilestone.update({
      where: { id: milestoneId },
      data: {
        status,
        completedAt: status === 'COMPLETED' ? new Date() : null,
      },
    });
  }

  /**
   * Approve a milestone (organizer only)
   */
  async approveMilestone(
    taskId: string,
    milestoneId: string,
    organizerId: string
  ): Promise<MultiPartyMilestone> {
    const task = await prisma.multiPartyTask.findUnique({
      where: { id: taskId },
      include: {
        milestones: true,
      },
    });

    if (!task) {
      throw new NotFoundError('MultiPartyTask', taskId);
    }

    if (task.organizerId !== organizerId) {
      throw new ForbiddenError('Only the organizer can approve milestones');
    }

    const milestone = task.milestones.find((m) => m.id === milestoneId);
    if (!milestone) {
      throw new NotFoundError('MultiPartyMilestone', milestoneId);
    }

    if (milestone.status !== 'COMPLETED') {
      throw new InvalidStateError(milestone.status, 'approve milestone');
    }

    return prisma.multiPartyMilestone.update({
      where: { id: milestoneId },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
      },
    });
  }
}

// Export singleton instance
export const multiPartyService = new MultiPartyService();
