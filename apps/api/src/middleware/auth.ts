import { Request, Response, NextFunction } from 'express';
import { prisma, Agent } from '@opentr8/database';
import { hashApiKey, UnauthorizedError } from '@opentr8/shared';

// Extend Express Request type to include agent
declare global {
  namespace Express {
    interface Request {
      agent?: Agent;
    }
  }
}

/**
 * Authentication middleware
 * Validates API key from Authorization header (Bearer token)
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedError('Missing Authorization header');
    }

    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedError('Invalid Authorization header format. Use: Bearer <api_key>');
    }

    // Hash the provided API key and look up agent
    const apiKeyHash = hashApiKey(token);
    const agent = await prisma.agent.findUnique({
      where: { apiKeyHash },
    });

    if (!agent) {
      throw new UnauthorizedError('Invalid API key');
    }

    // Attach agent to request
    req.agent = agent;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Optional authentication - doesn't fail if no auth provided
 */
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      next();
      return;
    }

    const [scheme, token] = authHeader.split(' ');

    if (scheme === 'Bearer' && token) {
      const apiKeyHash = hashApiKey(token);
      const agent = await prisma.agent.findUnique({
        where: { apiKeyHash },
      });
      if (agent) {
        req.agent = agent;
      }
    }

    next();
  } catch (error) {
    // Don't fail on optional auth errors
    next();
  }
}
