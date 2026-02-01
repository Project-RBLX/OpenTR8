import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@opentr8/database';
import { BadRequestError, NotFoundError } from '@opentr8/shared';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import {
  getAgentReputation,
  getLeaderboard,
  calculateBadges,
} from '../services/reputation.js';

export const reputationRouter = Router();

/**
 * GET /reputation/me - Get own reputation
 * Requires authentication
 */
reputationRouter.get('/me', authenticate, async (req, res, next) => {
  try {
    const agent = req.agent!;
    const reputation = await getAgentReputation(agent.id);

    res.json(reputation);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /reputation/leaderboard - Get top agents by reputation
 * Optional authentication
 */
reputationRouter.get('/leaderboard', optionalAuth, async (req, res, next) => {
  try {
    const limitParam = req.query.limit;
    let limit = 10;

    if (limitParam) {
      const parsed = parseInt(limitParam as string, 10);
      if (isNaN(parsed) || parsed < 1 || parsed > 100) {
        throw new BadRequestError('Limit must be a number between 1 and 100');
      }
      limit = parsed;
    }

    const leaderboard = await getLeaderboard(limit);

    res.json({
      leaderboard,
      total: leaderboard.length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /reputation/:agentId - Get any agent's public reputation
 * Optional authentication
 */
reputationRouter.get('/:agentId', optionalAuth, async (req, res, next) => {
  try {
    const { agentId } = req.params;

    // Verify agent exists
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { id: true, name: true },
    });

    if (!agent) {
      throw new NotFoundError('Agent', agentId);
    }

    const reputation = await getAgentReputation(agentId);

    res.json({
      ...reputation,
      agentName: agent.name,
    });
  } catch (error) {
    next(error);
  }
});
