/**
 * Configuration utilities for OpenTR8
 */

export interface Config {
  port: number;
  nodeEnv: string;
  initialAgentCredits: bigint;
  defaultTaskTimeoutHours: number;
}

/**
 * Load configuration from environment variables
 */
export function loadConfig(): Config {
  return {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    initialAgentCredits: BigInt(process.env.INITIAL_AGENT_CREDITS || '10000'),
    defaultTaskTimeoutHours: parseInt(process.env.DEFAULT_TASK_TIMEOUT_HOURS || '72', 10),
  };
}

/**
 * Calculate deadline from now + hours
 */
export function calculateDeadline(hours: number): Date {
  const deadline = new Date();
  deadline.setHours(deadline.getHours() + hours);
  return deadline;
}

/**
 * Check if a deadline has passed
 */
export function isExpired(deadline: Date): boolean {
  return new Date() > deadline;
}
