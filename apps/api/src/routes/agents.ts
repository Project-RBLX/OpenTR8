import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@opentr8/database';
import {
  generateApiKey,
  hashApiKey,
  maskApiKey,
  loadConfig,
  BadRequestError,
  NotFoundError,
} from '@opentr8/shared';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import { getAgentReputation } from '../services/reputation.js';

export const agentsRouter = Router();
const config = loadConfig();

// Validation schemas
const createAgentSchema = z.object({
  name: z.string().min(1).max(100),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * POST /agents - Register a new agent
 * Returns API key (only shown once!)
 */
agentsRouter.post('/', async (req, res, next) => {
  try {
    const body = createAgentSchema.parse(req.body);

    // Generate API key
    const apiKey = generateApiKey();
    const apiKeyHash = hashApiKey(apiKey);

    // Create agent with initial credits
    const agent = await prisma.$transaction(async (tx) => {
      const newAgent = await tx.agent.create({
        data: {
          name: body.name,
          apiKey: maskApiKey(apiKey), // Store masked version for display
          apiKeyHash,
          balance: config.initialAgentCredits,
          metadata: body.metadata,
        },
      });

      // Record initial credit transaction
      await tx.transaction.create({
        data: {
          agentId: newAgent.id,
          type: 'CREDIT',
          amount: config.initialAgentCredits,
          balance: config.initialAgentCredits,
          description: 'Initial credit grant',
        },
      });

      return newAgent;
    });

    res.status(201).json({
      id: agent.id,
      name: agent.name,
      apiKey, // Only time the full key is returned!
      balance: agent.balance.toString(),
      createdAt: agent.createdAt,
      message: 'Save your API key - it will not be shown again!',
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
 * GET /agents/me - Get current agent info
 * Requires authentication
 */
agentsRouter.get('/me', authenticate, async (req, res, next) => {
  try {
    const agent = req.agent!;

    // Get reputation for current agent
    const reputation = await getAgentReputation(agent.id);

    res.json({
      id: agent.id,
      name: agent.name,
      balance: agent.balance.toString(),
      metadata: agent.metadata,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
      reputation,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /agents/:id - Get public agent profile with reputation
 * Optional authentication
 */
agentsRouter.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const { id } = req.params;

    const agent = await prisma.agent.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        metadata: true,
        createdAt: true,
      },
    });

    if (!agent) {
      throw new NotFoundError('Agent', id);
    }

    // Get reputation
    const reputation = await getAgentReputation(id);

    res.json({
      id: agent.id,
      name: agent.name,
      metadata: agent.metadata,
      createdAt: agent.createdAt,
      reputation,
    });
  } catch (error) {
    next(error);
  }
});
