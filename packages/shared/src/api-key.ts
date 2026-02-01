import { randomBytes, createHash } from 'crypto';

const API_KEY_PREFIX = 'otr8_';
const API_KEY_LENGTH = 32;

/**
 * Generate a new API key for an agent
 * Format: otr8_<random_hex>
 */
export function generateApiKey(): string {
  const randomPart = randomBytes(API_KEY_LENGTH).toString('hex');
  return `${API_KEY_PREFIX}${randomPart}`;
}

/**
 * Hash an API key for secure storage
 * Uses SHA-256 for consistent hashing
 */
export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Validate API key format
 */
export function isValidApiKeyFormat(apiKey: string): boolean {
  if (!apiKey.startsWith(API_KEY_PREFIX)) {
    return false;
  }
  const randomPart = apiKey.slice(API_KEY_PREFIX.length);
  return randomPart.length === API_KEY_LENGTH * 2 && /^[a-f0-9]+$/.test(randomPart);
}

/**
 * Mask API key for display (show first 8 chars + last 4)
 */
export function maskApiKey(apiKey: string): string {
  if (apiKey.length < 16) return '****';
  return `${apiKey.slice(0, 12)}...${apiKey.slice(-4)}`;
}
