import { Router } from 'express';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { prisma } from '@opentr8/database';
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
} from '@opentr8/shared';
import { authenticate } from '../middleware/auth.js';
import { TASK_EVENTS } from '../services/events.js';

export const webhooksRouter = Router();

// Validation schemas
const createWebhookSchema = z.object({
  url: z.string().url().max(2048),
  events: z.array(z.enum(TASK_EVENTS as [string, ...string[]])).min(1),
});

const updateWebhookSchema = z.object({
  url: z.string().url().max(2048).optional(),
  events: z.array(z.enum(TASK_EVENTS as [string, ...string[]])).min(1).optional(),
  active: z.boolean().optional(),
});

/**
 * Generate a secure random secret for webhook signing
 */
function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('hex')}`;
}

/**
 * POST /webhooks - Register a new webhook
 */
webhooksRouter.post('/', authenticate, async (req, res, next) => {
  try {
    const body = createWebhookSchema.parse(req.body);
    const agent = req.agent!;

    // Generate secret for HMAC signing
    const secret = generateWebhookSecret();

    const webhook = await prisma.webhook.create({
      data: {
        agentId: agent.id,
        url: body.url,
        events: body.events,
        secret,
        active: true,
      },
    });

    res.status(201).json({
      id: webhook.id,
      url: webhook.url,
      events: webhook.events,
      secret, // Only shown once during creation!
      active: webhook.active,
      createdAt: webhook.createdAt,
      message: 'Save your webhook secret - it will not be shown again!',
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
 * GET /webhooks - List agent's webhooks
 */
webhooksRouter.get('/', authenticate, async (req, res, next) => {
  try {
    const agent = req.agent!;

    const webhooks = await prisma.webhook.findMany({
      where: { agentId: agent.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        url: true,
        events: true,
        active: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { deliveries: true },
        },
      },
    });

    res.json({
      webhooks: webhooks.map((w) => ({
        id: w.id,
        url: w.url,
        events: w.events,
        active: w.active,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
        deliveryCount: w._count.deliveries,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /webhooks/:id - Get webhook details
 */
webhooksRouter.get('/:id', authenticate, async (req, res, next) => {
  try {
    const agent = req.agent!;
    const webhookId = req.params.id;

    const webhook = await prisma.webhook.findUnique({
      where: { id: webhookId },
      include: {
        _count: {
          select: { deliveries: true },
        },
      },
    });

    if (!webhook) {
      throw new NotFoundError('Webhook', webhookId);
    }

    if (webhook.agentId !== agent.id) {
      throw new ForbiddenError('You do not have access to this webhook');
    }

    res.json({
      id: webhook.id,
      url: webhook.url,
      events: webhook.events,
      active: webhook.active,
      createdAt: webhook.createdAt,
      updatedAt: webhook.updatedAt,
      deliveryCount: webhook._count.deliveries,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /webhooks/:id - Update webhook
 */
webhooksRouter.patch('/:id', authenticate, async (req, res, next) => {
  try {
    const body = updateWebhookSchema.parse(req.body);
    const agent = req.agent!;
    const webhookId = req.params.id;

    // Check webhook exists and belongs to agent
    const webhook = await prisma.webhook.findUnique({
      where: { id: webhookId },
    });

    if (!webhook) {
      throw new NotFoundError('Webhook', webhookId);
    }

    if (webhook.agentId !== agent.id) {
      throw new ForbiddenError('You do not have access to this webhook');
    }

    // Update webhook
    const updatedWebhook = await prisma.webhook.update({
      where: { id: webhookId },
      data: {
        ...(body.url !== undefined && { url: body.url }),
        ...(body.events !== undefined && { events: body.events }),
        ...(body.active !== undefined && { active: body.active }),
      },
    });

    res.json({
      id: updatedWebhook.id,
      url: updatedWebhook.url,
      events: updatedWebhook.events,
      active: updatedWebhook.active,
      createdAt: updatedWebhook.createdAt,
      updatedAt: updatedWebhook.updatedAt,
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
 * DELETE /webhooks/:id - Delete webhook
 */
webhooksRouter.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const agent = req.agent!;
    const webhookId = req.params.id;

    // Check webhook exists and belongs to agent
    const webhook = await prisma.webhook.findUnique({
      where: { id: webhookId },
    });

    if (!webhook) {
      throw new NotFoundError('Webhook', webhookId);
    }

    if (webhook.agentId !== agent.id) {
      throw new ForbiddenError('You do not have access to this webhook');
    }

    // Delete webhook (cascade deletes deliveries)
    await prisma.webhook.delete({
      where: { id: webhookId },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

/**
 * GET /webhooks/:id/deliveries - Get delivery history
 */
webhooksRouter.get('/:id/deliveries', authenticate, async (req, res, next) => {
  try {
    const agent = req.agent!;
    const webhookId = req.params.id;

    // Parse pagination params
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const cursor = req.query.cursor as string | undefined;

    // Check webhook exists and belongs to agent
    const webhook = await prisma.webhook.findUnique({
      where: { id: webhookId },
    });

    if (!webhook) {
      throw new NotFoundError('Webhook', webhookId);
    }

    if (webhook.agentId !== agent.id) {
      throw new ForbiddenError('You do not have access to this webhook');
    }

    // Fetch deliveries with cursor-based pagination
    const deliveries = await prisma.webhookDelivery.findMany({
      where: { webhookId },
      orderBy: { createdAt: 'desc' },
      take: limit + 1, // Fetch one extra to check if there are more
      ...(cursor && {
        cursor: { id: cursor },
        skip: 1, // Skip the cursor item
      }),
      select: {
        id: true,
        event: true,
        status: true,
        attempts: true,
        lastAttemptAt: true,
        response: true,
        createdAt: true,
      },
    });

    // Determine if there are more results
    const hasMore = deliveries.length > limit;
    const results = hasMore ? deliveries.slice(0, -1) : deliveries;
    const nextCursor = hasMore ? results[results.length - 1]?.id : undefined;

    res.json({
      deliveries: results.map((d) => ({
        id: d.id,
        event: d.event,
        status: d.status,
        attempts: d.attempts,
        lastAttemptAt: d.lastAttemptAt,
        response: d.response,
        createdAt: d.createdAt,
      })),
      pagination: {
        hasMore,
        nextCursor,
      },
    });
  } catch (error) {
    next(error);
  }
});
