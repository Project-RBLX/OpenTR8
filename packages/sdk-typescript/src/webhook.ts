import * as crypto from 'crypto';
import type { WebhookEvent } from './types.js';

/**
 * Verifies the signature of a webhook payload
 *
 * @param payload - The raw webhook payload string
 * @param signature - The signature from the X-OpenTR8-Signature header
 * @param secret - The webhook secret from your webhook registration
 * @returns true if the signature is valid, false otherwise
 *
 * @example
 * ```typescript
 * import { verifyWebhookSignature } from '@opentr8/sdk';
 *
 * const isValid = verifyWebhookSignature(
 *   req.body,
 *   req.headers['x-opentr8-signature'],
 *   process.env.WEBHOOK_SECRET
 * );
 * ```
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  if (!payload || !signature || !secret) {
    return false;
  }

  try {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    const signatureBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

/**
 * Parses a webhook event payload
 *
 * @param payload - The raw webhook payload string or object
 * @returns The parsed webhook event
 * @throws Error if the payload is invalid
 *
 * @example
 * ```typescript
 * import { parseWebhookEvent } from '@opentr8/sdk';
 *
 * const event = parseWebhookEvent(req.body);
 * console.log(event.type); // e.g., 'task.completed'
 * ```
 */
export function parseWebhookEvent(payload: string | object): WebhookEvent {
  let parsed: unknown;

  if (typeof payload === 'string') {
    try {
      parsed = JSON.parse(payload);
    } catch {
      throw new Error('Invalid webhook payload: failed to parse JSON');
    }
  } else {
    parsed = payload;
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid webhook payload: expected an object');
  }

  const event = parsed as Record<string, unknown>;

  if (typeof event.id !== 'string') {
    throw new Error('Invalid webhook payload: missing or invalid "id" field');
  }

  if (typeof event.type !== 'string') {
    throw new Error('Invalid webhook payload: missing or invalid "type" field');
  }

  if (typeof event.timestamp !== 'string') {
    throw new Error('Invalid webhook payload: missing or invalid "timestamp" field');
  }

  if (!event.data || typeof event.data !== 'object') {
    throw new Error('Invalid webhook payload: missing or invalid "data" field');
  }

  return {
    id: event.id,
    type: event.type,
    timestamp: event.timestamp,
    data: event.data as Record<string, unknown>,
  };
}
