import { Router } from 'express';
import { prisma } from '@opentr8/database';
import { authenticate } from '../middleware/auth.js';

export const walletRouter = Router();

/**
 * GET /wallet - Get current wallet balance
 */
walletRouter.get('/', authenticate, async (req, res, next) => {
  try {
    const agent = req.agent!;

    // Get fresh balance
    const freshAgent = await prisma.agent.findUnique({
      where: { id: agent.id },
      select: { balance: true },
    });

    res.json({
      balance: freshAgent?.balance.toString() || '0',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /wallet/transactions - Get transaction history
 */
walletRouter.get('/transactions', authenticate, async (req, res, next) => {
  try {
    const agent = req.agent!;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const transactions = await prisma.transaction.findMany({
      where: { agentId: agent.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    const total = await prisma.transaction.count({
      where: { agentId: agent.id },
    });

    res.json({
      transactions: transactions.map((t) => ({
        id: t.id,
        type: t.type,
        amount: t.amount.toString(),
        balance: t.balance.toString(),
        taskId: t.taskId,
        description: t.description,
        createdAt: t.createdAt,
      })),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + transactions.length < total,
      },
    });
  } catch (error) {
    next(error);
  }
});
