import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@opentr8/database';
import {
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  TEMPLATE_CATEGORIES,
  TEMPLATE_CATEGORY_LABELS,
  isValidTemplateCategory,
  TemplateCategory,
} from '@opentr8/shared';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import { isValidJsonSchema, clearValidatorCache } from '../services/schema-validator.js';

export const templatesRouter = Router();

// Validation schemas
const createTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: z.string().refine((val) => isValidTemplateCategory(val), {
    message: `Category must be one of: ${TEMPLATE_CATEGORIES.join(', ')}`,
  }),
  inputSchema: z.record(z.unknown()),
  outputSchema: z.record(z.unknown()),
  defaultCredits: z.number().int().nonnegative().optional(),
  defaultDeadlineHours: z.number().int().positive().optional(),
  isPublic: z.boolean().optional(),
});

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  category: z
    .string()
    .refine((val) => isValidTemplateCategory(val), {
      message: `Category must be one of: ${TEMPLATE_CATEGORIES.join(', ')}`,
    })
    .optional(),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
  defaultCredits: z.number().int().nonnegative().optional(),
  defaultDeadlineHours: z.number().int().positive().optional(),
  isPublic: z.boolean().optional(),
});

/**
 * POST /templates - Create a new task template
 */
templatesRouter.post('/', authenticate, async (req, res, next) => {
  try {
    const body = createTemplateSchema.parse(req.body);
    const agent = req.agent!;

    // Validate JSON schemas are valid
    isValidJsonSchema(body.inputSchema);
    isValidJsonSchema(body.outputSchema);

    const template = await prisma.taskTemplate.create({
      data: {
        name: body.name,
        description: body.description,
        category: body.category,
        inputSchema: body.inputSchema,
        outputSchema: body.outputSchema,
        defaultCredits: BigInt(body.defaultCredits || 0),
        defaultDeadlineHours: body.defaultDeadlineHours || 72,
        isPublic: body.isPublic || false,
        creatorId: agent.id,
      },
      include: {
        creator: { select: { id: true, name: true } },
      },
    });

    res.status(201).json({
      id: template.id,
      name: template.name,
      description: template.description,
      category: template.category,
      inputSchema: template.inputSchema,
      outputSchema: template.outputSchema,
      defaultCredits: template.defaultCredits.toString(),
      defaultDeadlineHours: template.defaultDeadlineHours,
      isPublic: template.isPublic,
      creator: template.creator,
      usageCount: template.usageCount,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
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
 * GET /templates - List templates (filter: category, isPublic, mine)
 */
templatesRouter.get('/', optionalAuth, async (req, res, next) => {
  try {
    const category = req.query.category as string | undefined;
    const isPublic = req.query.isPublic === 'true' ? true : req.query.isPublic === 'false' ? false : undefined;
    const mine = req.query.mine === 'true';
    const agent = req.agent;

    // Validate category if provided
    if (category && !isValidTemplateCategory(category)) {
      throw new BadRequestError(`Invalid category. Must be one of: ${TEMPLATE_CATEGORIES.join(', ')}`);
    }

    const where: Record<string, unknown> = {};

    if (category) {
      where.category = category;
    }

    if (isPublic !== undefined) {
      where.isPublic = isPublic;
    }

    if (mine && agent) {
      where.creatorId = agent.id;
    } else if (!mine) {
      // If not filtering by 'mine', show public templates OR user's own templates
      if (agent) {
        where.OR = [{ isPublic: true }, { creatorId: agent.id }];
      } else {
        where.isPublic = true;
      }
    }

    const templates = await prisma.taskTemplate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        creator: { select: { id: true, name: true } },
      },
    });

    res.json({
      templates: templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        category: t.category,
        defaultCredits: t.defaultCredits.toString(),
        defaultDeadlineHours: t.defaultDeadlineHours,
        isPublic: t.isPublic,
        creator: t.creator,
        usageCount: t.usageCount,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /templates/categories - List available template categories
 */
templatesRouter.get('/categories', (_req, res) => {
  res.json({
    categories: TEMPLATE_CATEGORIES.map((cat) => ({
      value: cat,
      label: TEMPLATE_CATEGORY_LABELS[cat as TemplateCategory],
    })),
  });
});

/**
 * GET /templates/popular - Get popular templates by usage count
 */
templatesRouter.get('/popular', async (_req, res, next) => {
  try {
    const templates = await prisma.taskTemplate.findMany({
      where: { isPublic: true },
      orderBy: { usageCount: 'desc' },
      take: 20,
      include: {
        creator: { select: { id: true, name: true } },
      },
    });

    res.json({
      templates: templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        category: t.category,
        defaultCredits: t.defaultCredits.toString(),
        defaultDeadlineHours: t.defaultDeadlineHours,
        isPublic: t.isPublic,
        creator: t.creator,
        usageCount: t.usageCount,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /templates/:id - Get template details
 */
templatesRouter.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const template = await prisma.taskTemplate.findUnique({
      where: { id: req.params.id },
      include: {
        creator: { select: { id: true, name: true } },
      },
    });

    if (!template) {
      throw new NotFoundError('TaskTemplate', req.params.id);
    }

    // Check access: must be public or owned by the requesting agent
    const agent = req.agent;
    if (!template.isPublic && (!agent || template.creatorId !== agent.id)) {
      throw new NotFoundError('TaskTemplate', req.params.id);
    }

    res.json({
      id: template.id,
      name: template.name,
      description: template.description,
      category: template.category,
      inputSchema: template.inputSchema,
      outputSchema: template.outputSchema,
      defaultCredits: template.defaultCredits.toString(),
      defaultDeadlineHours: template.defaultDeadlineHours,
      isPublic: template.isPublic,
      creator: template.creator,
      usageCount: template.usageCount,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /templates/:id - Update template (creator only)
 */
templatesRouter.patch('/:id', authenticate, async (req, res, next) => {
  try {
    const body = updateTemplateSchema.parse(req.body);
    const agent = req.agent!;

    const template = await prisma.taskTemplate.findUnique({
      where: { id: req.params.id },
    });

    if (!template) {
      throw new NotFoundError('TaskTemplate', req.params.id);
    }

    if (template.creatorId !== agent.id) {
      throw new ForbiddenError('Only the template creator can update this template');
    }

    // Validate JSON schemas if provided
    if (body.inputSchema) {
      isValidJsonSchema(body.inputSchema);
    }
    if (body.outputSchema) {
      isValidJsonSchema(body.outputSchema);
    }

    // Clear validator cache if schemas are updated
    if (body.inputSchema || body.outputSchema) {
      clearValidatorCache(template.id);
    }

    const updatedTemplate = await prisma.taskTemplate.update({
      where: { id: req.params.id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.category !== undefined && { category: body.category }),
        ...(body.inputSchema !== undefined && { inputSchema: body.inputSchema }),
        ...(body.outputSchema !== undefined && { outputSchema: body.outputSchema }),
        ...(body.defaultCredits !== undefined && { defaultCredits: BigInt(body.defaultCredits) }),
        ...(body.defaultDeadlineHours !== undefined && { defaultDeadlineHours: body.defaultDeadlineHours }),
        ...(body.isPublic !== undefined && { isPublic: body.isPublic }),
      },
      include: {
        creator: { select: { id: true, name: true } },
      },
    });

    res.json({
      id: updatedTemplate.id,
      name: updatedTemplate.name,
      description: updatedTemplate.description,
      category: updatedTemplate.category,
      inputSchema: updatedTemplate.inputSchema,
      outputSchema: updatedTemplate.outputSchema,
      defaultCredits: updatedTemplate.defaultCredits.toString(),
      defaultDeadlineHours: updatedTemplate.defaultDeadlineHours,
      isPublic: updatedTemplate.isPublic,
      creator: updatedTemplate.creator,
      usageCount: updatedTemplate.usageCount,
      createdAt: updatedTemplate.createdAt,
      updatedAt: updatedTemplate.updatedAt,
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
 * DELETE /templates/:id - Delete template (creator only)
 */
templatesRouter.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const agent = req.agent!;

    const template = await prisma.taskTemplate.findUnique({
      where: { id: req.params.id },
    });

    if (!template) {
      throw new NotFoundError('TaskTemplate', req.params.id);
    }

    if (template.creatorId !== agent.id) {
      throw new ForbiddenError('Only the template creator can delete this template');
    }

    // Clear validator cache
    clearValidatorCache(template.id);

    await prisma.taskTemplate.delete({
      where: { id: req.params.id },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});
