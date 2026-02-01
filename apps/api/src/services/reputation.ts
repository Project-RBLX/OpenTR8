import { prisma, Reputation, ReputationTier, Task } from '@opentr8/database';
import {
  eventEmitter,
  TaskEventType,
  TaskWithRelations,
  TASK_EVENTS,
} from './events.js';

// Tier thresholds
const TIER_THRESHOLDS = {
  BRONZE: { minTasks: 5 },
  SILVER: { minTasks: 20, minSuccessRate: 0.9 },
  GOLD: { minTasks: 50, minSuccessRate: 0.95, minVolume: BigInt(10000) },
  PLATINUM: { minTasks: 100, minSuccessRate: 0.98, minVolume: BigInt(100000) },
};

// Badge definitions
const BADGE_DEFINITIONS = {
  trusted: {
    check: (rep: Reputation) => rep.successRate >= 0.95 && rep.tasksCompleted >= 10,
    description: 'Maintains 95%+ success rate with 10+ completed tasks',
  },
  'fast-responder': {
    check: (rep: Reputation) => rep.avgResponseTime > 0 && rep.avgResponseTime <= 2 && rep.tasksAccepted >= 5,
    description: 'Average response time under 2 hours with 5+ tasks accepted',
  },
  'high-volume': {
    check: (rep: Reputation) => rep.totalVolumeEarned >= BigInt(50000),
    description: 'Has earned 50,000+ credits',
  },
  reliable: {
    check: (rep: Reputation) => rep.disputeRate <= 0.02 && rep.tasksCompleted >= 20,
    description: 'Dispute rate under 2% with 20+ completed tasks',
  },
  'top-requester': {
    check: (rep: Reputation) => rep.totalVolumeSpent >= BigInt(50000),
    description: 'Has spent 50,000+ credits as requester',
  },
  veteran: {
    check: (rep: Reputation) => rep.tasksCompleted + rep.tasksRequested >= 100,
    description: '100+ total tasks (as worker or requester)',
  },
};

export type ReputationEvent =
  | 'task.created'
  | 'task.accepted'
  | 'task.completed'
  | 'task.approved'
  | 'task.cancelled'
  | 'task.expired'
  | 'task.disputed';

export interface TaskEventData {
  taskId: string;
  credits: bigint;
  requesterId: string;
  workerId?: string | null;
  createdAt: Date;
  acceptedAt?: Date | null;
}

/**
 * Calculate the tier based on reputation metrics
 */
export function calculateTier(reputation: Reputation): ReputationTier {
  const totalTasks = reputation.tasksCompleted;
  const successRate = reputation.successRate;
  const totalVolume = reputation.totalVolumeEarned;

  // Check from highest to lowest tier
  if (
    totalTasks >= TIER_THRESHOLDS.PLATINUM.minTasks &&
    successRate >= TIER_THRESHOLDS.PLATINUM.minSuccessRate &&
    totalVolume >= TIER_THRESHOLDS.PLATINUM.minVolume
  ) {
    return 'PLATINUM';
  }

  if (
    totalTasks >= TIER_THRESHOLDS.GOLD.minTasks &&
    successRate >= TIER_THRESHOLDS.GOLD.minSuccessRate &&
    totalVolume >= TIER_THRESHOLDS.GOLD.minVolume
  ) {
    return 'GOLD';
  }

  if (
    totalTasks >= TIER_THRESHOLDS.SILVER.minTasks &&
    successRate >= TIER_THRESHOLDS.SILVER.minSuccessRate
  ) {
    return 'SILVER';
  }

  if (totalTasks >= TIER_THRESHOLDS.BRONZE.minTasks) {
    return 'BRONZE';
  }

  return 'NEW';
}

/**
 * Calculate badges earned by an agent
 */
export function calculateBadges(reputation: Reputation): string[] {
  const badges: string[] = [];

  for (const [badge, def] of Object.entries(BADGE_DEFINITIONS)) {
    if (def.check(reputation)) {
      badges.push(badge);
    }
  }

  return badges;
}

/**
 * Get or create reputation record for an agent
 */
export async function getOrCreateReputation(agentId: string): Promise<Reputation> {
  let reputation = await prisma.reputation.findUnique({
    where: { agentId },
  });

  if (!reputation) {
    reputation = await prisma.reputation.create({
      data: { agentId },
    });
  }

  return reputation;
}

/**
 * Calculate success rate (approved / completed)
 */
function calculateSuccessRate(tasksApproved: number, tasksCompleted: number): number {
  if (tasksCompleted === 0) return 0;
  return tasksApproved / tasksCompleted;
}

/**
 * Calculate dispute rate (disputed / total)
 */
function calculateDisputeRate(
  tasksDisputed: number,
  tasksCompleted: number,
  tasksRequested: number
): number {
  const total = tasksCompleted + tasksRequested;
  if (total === 0) return 0;
  return tasksDisputed / total;
}

/**
 * Calculate average response time
 */
function calculateAvgResponseTime(totalResponseTime: number, tasksAccepted: number): number {
  if (tasksAccepted === 0) return 0;
  return totalResponseTime / tasksAccepted;
}

/**
 * Update reputation based on task events
 */
export async function updateReputation(
  agentId: string,
  event: ReputationEvent,
  taskData: TaskEventData
): Promise<Reputation> {
  // Get or create reputation
  const reputation = await getOrCreateReputation(agentId);

  // Build update data based on event
  const updateData: Parameters<typeof prisma.reputation.update>[0]['data'] = {
    updatedAt: new Date(),
  };

  switch (event) {
    case 'task.created':
      // Requester created a task
      updateData.tasksRequested = { increment: 1 };
      updateData.totalVolumeSpent = { increment: taskData.credits };
      break;

    case 'task.accepted':
      // Worker accepted a task - update response time
      if (taskData.createdAt && taskData.acceptedAt) {
        const responseTimeHours =
          (taskData.acceptedAt.getTime() - taskData.createdAt.getTime()) / (1000 * 60 * 60);
        updateData.tasksAccepted = { increment: 1 };
        updateData.totalResponseTime = { increment: responseTimeHours };
      }
      break;

    case 'task.completed':
      // Worker marked task as completed
      updateData.tasksCompleted = { increment: 1 };
      break;

    case 'task.approved':
      // Task was approved - credits released to worker
      updateData.tasksApproved = { increment: 1 };
      updateData.totalVolumeEarned = { increment: taskData.credits };
      break;

    case 'task.cancelled':
      // Requester cancelled the task
      updateData.tasksCancelled = { increment: 1 };
      // Refund volume spent
      updateData.totalVolumeSpent = { decrement: taskData.credits };
      break;

    case 'task.expired':
      // Task expired
      updateData.tasksExpired = { increment: 1 };
      break;

    case 'task.disputed':
      // Task was disputed
      updateData.tasksDisputed = { increment: 1 };
      break;
  }

  // Update reputation
  const updatedReputation = await prisma.reputation.update({
    where: { agentId },
    data: updateData,
  });

  // Recalculate rates and tier
  const successRate = calculateSuccessRate(
    updatedReputation.tasksApproved,
    updatedReputation.tasksCompleted
  );
  const disputeRate = calculateDisputeRate(
    updatedReputation.tasksDisputed,
    updatedReputation.tasksCompleted,
    updatedReputation.tasksRequested
  );
  const avgResponseTime = calculateAvgResponseTime(
    updatedReputation.totalResponseTime,
    updatedReputation.tasksAccepted
  );

  // Create temp object with updated rates for tier calculation
  const tempReputation = {
    ...updatedReputation,
    successRate,
    disputeRate,
    avgResponseTime,
  };

  const newTier = calculateTier(tempReputation);

  // Final update with calculated values
  const finalReputation = await prisma.reputation.update({
    where: { agentId },
    data: {
      successRate,
      disputeRate,
      avgResponseTime,
      tier: newTier,
    },
  });

  return finalReputation;
}

/**
 * Update both requester and worker reputation on task state changes
 */
export async function updateReputationsForTask(
  event: ReputationEvent,
  task: Task & { escrow?: { amount: bigint } | null }
): Promise<void> {
  const taskData: TaskEventData = {
    taskId: task.id,
    credits: task.credits,
    requesterId: task.requesterId,
    workerId: task.workerId,
    createdAt: task.createdAt,
    acceptedAt: task.acceptedAt,
  };

  switch (event) {
    case 'task.created':
      // Update requester reputation
      await updateReputation(task.requesterId, event, taskData);
      break;

    case 'task.accepted':
      // Update worker reputation for response time
      if (task.workerId) {
        await updateReputation(task.workerId, event, taskData);
      }
      break;

    case 'task.completed':
      // Update worker reputation
      if (task.workerId) {
        await updateReputation(task.workerId, event, taskData);
      }
      break;

    case 'task.approved':
      // Update worker reputation (earned credits)
      if (task.workerId) {
        await updateReputation(task.workerId, event, taskData);
      }
      break;

    case 'task.cancelled':
      // Update requester reputation
      await updateReputation(task.requesterId, event, taskData);
      break;

    case 'task.expired':
      // Update requester reputation
      await updateReputation(task.requesterId, event, taskData);
      break;

    case 'task.disputed':
      // Update both worker and requester
      if (task.workerId) {
        await updateReputation(task.workerId, event, taskData);
      }
      await updateReputation(task.requesterId, event, taskData);
      break;
  }
}

/**
 * Get agent reputation with badges
 */
export async function getAgentReputation(agentId: string) {
  const reputation = await getOrCreateReputation(agentId);
  const badges = calculateBadges(reputation);

  return {
    agentId: reputation.agentId,
    tier: reputation.tier,
    stats: {
      tasksCompleted: reputation.tasksCompleted,
      tasksRequested: reputation.tasksRequested,
      successRate: reputation.successRate,
      disputeRate: reputation.disputeRate,
      avgResponseTimeHours: reputation.avgResponseTime,
      totalVolumeEarned: reputation.totalVolumeEarned.toString(),
      totalVolumeSpent: reputation.totalVolumeSpent.toString(),
    },
    badges,
    updatedAt: reputation.updatedAt,
  };
}

/**
 * Get leaderboard - top agents by tier and volume
 */
export async function getLeaderboard(limit: number = 10) {
  const reputations = await prisma.reputation.findMany({
    orderBy: [
      { tier: 'desc' },
      { totalVolumeEarned: 'desc' },
      { successRate: 'desc' },
    ],
    take: limit,
    include: {
      agent: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  return reputations.map((rep, index) => ({
    rank: index + 1,
    agentId: rep.agentId,
    agentName: rep.agent.name,
    tier: rep.tier,
    stats: {
      tasksCompleted: rep.tasksCompleted,
      successRate: rep.successRate,
      totalVolumeEarned: rep.totalVolumeEarned.toString(),
    },
    badges: calculateBadges(rep),
  }));
}

/**
 * Process a task event and update reputation
 */
async function processTaskEvent(
  event: TaskEventType,
  task: TaskWithRelations
): Promise<void> {
  try {
    await updateReputationsForTask(event as ReputationEvent, task);
    console.log(`Reputation updated for ${event} event on task ${task.id}`);
  } catch (error) {
    console.error(`Error updating reputation for ${event} event:`, error);
  }
}

/**
 * Initialize reputation service
 * Subscribes to all task events and handles reputation updates
 */
export function initializeReputationService(): void {
  // Subscribe to all task events
  for (const event of TASK_EVENTS) {
    eventEmitter.on(event, (task: TaskWithRelations) => {
      processTaskEvent(event, task).catch((error) => {
        console.error(`Error processing ${event} event for reputation: ${error}`);
      });
    });
  }

  console.log('Reputation service initialized');
}
