import { prisma, TaskStatus } from '@opentr8/database';

/**
 * Process expired tasks:
 * 1. OPEN tasks past deadline -> EXPIRED (refund to requester)
 * 2. COMPLETED tasks past deadline -> EXPIRED (auto-release to worker)
 *
 * The logic:
 * - If task is OPEN and expired: no one took it, refund requester
 * - If task is COMPLETED and expired: requester didn't respond, pay worker
 */
export async function processExpiredTasks(): Promise<number> {
  const now = new Date();

  // Find tasks that need processing
  const expiredTasks = await prisma.task.findMany({
    where: {
      deadline: { lt: now },
      status: {
        in: ['OPEN', 'COMPLETED'] as TaskStatus[],
      },
    },
    include: {
      escrow: true,
    },
  });

  let processed = 0;

  for (const task of expiredTasks) {
    if (!task.escrow) {
      console.warn(`Task ${task.id} has no escrow, skipping`);
      continue;
    }

    try {
      if (task.status === 'OPEN') {
        // No one accepted, refund to requester
        await refundToRequester(task.id, task.requesterId, task.escrow.id, task.escrow.amount);
        processed++;
      } else if (task.status === 'COMPLETED' && task.workerId) {
        // Worker completed but requester didn't approve, auto-release to worker
        await releaseToWorker(task.id, task.workerId, task.escrow.id, task.escrow.amount);
        processed++;
      }
    } catch (error) {
      console.error(`Error processing expired task ${task.id}:`, error);
    }
  }

  return processed;
}

async function refundToRequester(
  taskId: string,
  requesterId: string,
  escrowId: string,
  amount: bigint
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Refund credits to requester
    const requester = await tx.agent.update({
      where: { id: requesterId },
      data: { balance: { increment: amount } },
    });

    // Update escrow
    await tx.escrow.update({
      where: { id: escrowId },
      data: {
        status: 'REFUNDED',
        releasedAt: new Date(),
      },
    });

    // Update task
    await tx.task.update({
      where: { id: taskId },
      data: { status: 'EXPIRED' },
    });

    // Record transaction
    await tx.transaction.create({
      data: {
        agentId: requesterId,
        type: 'UNLOCK',
        amount: amount,
        balance: requester.balance,
        taskId: taskId,
        description: `Credits refunded for expired task (no takers): ${taskId}`,
      },
    });

    console.log(`Refunded ${amount} credits to requester ${requesterId} for expired task ${taskId}`);
  });
}

async function releaseToWorker(
  taskId: string,
  workerId: string,
  escrowId: string,
  amount: bigint
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Release credits to worker
    const worker = await tx.agent.update({
      where: { id: workerId },
      data: { balance: { increment: amount } },
    });

    // Update escrow
    await tx.escrow.update({
      where: { id: escrowId },
      data: {
        status: 'RELEASED',
        releasedAt: new Date(),
      },
    });

    // Update task
    await tx.task.update({
      where: { id: taskId },
      data: {
        status: 'EXPIRED',
        approvedAt: new Date(), // Auto-approved
      },
    });

    // Record transaction
    await tx.transaction.create({
      data: {
        agentId: workerId,
        type: 'EARN',
        amount: amount,
        balance: worker.balance,
        taskId: taskId,
        description: `Credits auto-released for expired task (no response): ${taskId}`,
      },
    });

    console.log(`Auto-released ${amount} credits to worker ${workerId} for expired task ${taskId}`);
  });
}
