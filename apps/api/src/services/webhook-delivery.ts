import { createHmac } from 'crypto';
import { prisma, Webhook, WebhookDeliveryStatus } from '@opentr8/database';
import {
  eventEmitter,
  TaskEventType,
  TaskWithRelations,
  createEventPayload,
  TASK_EVENTS,
  WebhookEventPayload,
} from './events.js';

// Retry configuration
const MAX_ATTEMPTS = 3;
const INITIAL_BACKOFF_MS = 1000; // 1 second
const BACKOFF_MULTIPLIER = 2;

// Delivery timeout
const DELIVERY_TIMEOUT_MS = 30000; // 30 seconds

/**
 * Generate HMAC-SHA256 signature for webhook payload
 */
export function generateSignature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Calculate backoff delay for retry attempt
 */
function calculateBackoff(attempt: number): number {
  return INITIAL_BACKOFF_MS * Math.pow(BACKOFF_MULTIPLIER, attempt - 1);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Deliver a webhook with retry logic
 */
async function deliverWebhook(
  webhook: Webhook,
  payload: WebhookEventPayload,
  deliveryId: string
): Promise<void> {
  const payloadString = JSON.stringify(payload);
  const signature = generateSignature(payloadString, webhook.secret);

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // Update attempt count
      await prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          attempts: attempt,
          lastAttemptAt: new Date(),
        },
      });

      // Make the HTTP request with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-OpenTR8-Signature': signature,
          'X-OpenTR8-Event': payload.event,
          'X-OpenTR8-Delivery-Id': deliveryId,
          'X-OpenTR8-Timestamp': payload.timestamp,
          'User-Agent': 'OpenTR8-Webhooks/1.0',
        },
        body: payloadString,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Check response status
      if (response.ok) {
        // Success - update delivery record
        let responseBody: string | null = null;
        try {
          responseBody = await response.text();
        } catch {
          // Ignore response body read errors
        }

        await prisma.webhookDelivery.update({
          where: { id: deliveryId },
          data: {
            status: 'SUCCESS' as WebhookDeliveryStatus,
            response: {
              statusCode: response.status,
              body: responseBody?.substring(0, 1000), // Truncate response
            },
          },
        });

        console.log(
          `Webhook delivered successfully: ${deliveryId} to ${webhook.url}`
        );
        return;
      }

      // Non-2xx response - record and retry
      let responseBody: string | null = null;
      try {
        responseBody = await response.text();
      } catch {
        // Ignore response body read errors
      }

      lastError = new Error(
        `HTTP ${response.status}: ${responseBody?.substring(0, 200) || 'No response body'}`
      );

      console.warn(
        `Webhook delivery attempt ${attempt}/${MAX_ATTEMPTS} failed for ${deliveryId}: ${lastError.message}`
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.warn(
        `Webhook delivery attempt ${attempt}/${MAX_ATTEMPTS} failed for ${deliveryId}: ${lastError.message}`
      );
    }

    // Wait before retry (except on last attempt)
    if (attempt < MAX_ATTEMPTS) {
      const backoff = calculateBackoff(attempt);
      await sleep(backoff);
    }
  }

  // All attempts failed
  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: 'FAILED' as WebhookDeliveryStatus,
      response: {
        error: lastError?.message || 'Unknown error',
      },
    },
  });

  console.error(
    `Webhook delivery failed after ${MAX_ATTEMPTS} attempts: ${deliveryId}`
  );
}

/**
 * Process a task event and deliver to matching webhooks
 */
async function processTaskEvent(
  event: TaskEventType,
  task: TaskWithRelations
): Promise<void> {
  // Find all active webhooks that subscribe to this event
  // Check both requester and worker (if exists)
  const agentIds = [task.requesterId];
  if (task.workerId) {
    agentIds.push(task.workerId);
  }

  const webhooks = await prisma.webhook.findMany({
    where: {
      agentId: { in: agentIds },
      active: true,
      events: { has: event },
    },
  });

  if (webhooks.length === 0) {
    return;
  }

  // Create payload
  const payload = createEventPayload(event, task);

  // Create delivery records and dispatch deliveries
  const deliveryPromises = webhooks.map(async (webhook) => {
    // Create delivery record
    const delivery = await prisma.webhookDelivery.create({
      data: {
        webhookId: webhook.id,
        event,
        payload: payload as unknown as Record<string, unknown>,
        status: 'PENDING' as WebhookDeliveryStatus,
      },
    });

    // Deliver asynchronously (don't await)
    deliverWebhook(webhook, payload, delivery.id).catch((error) => {
      console.error(`Unhandled error in webhook delivery: ${error}`);
    });
  });

  await Promise.all(deliveryPromises);
}

/**
 * Initialize webhook delivery service
 * Subscribes to all task events and handles deliveries
 */
export function initializeWebhookDelivery(): void {
  // Subscribe to all task events
  for (const event of TASK_EVENTS) {
    eventEmitter.on(event, (task: TaskWithRelations) => {
      processTaskEvent(event, task).catch((error) => {
        console.error(`Error processing ${event} event: ${error}`);
      });
    });
  }

  console.log('Webhook delivery service initialized');
}

/**
 * Manually trigger webhook delivery (for testing or retry)
 */
export async function retryWebhookDelivery(deliveryId: string): Promise<void> {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { webhook: true },
  });

  if (!delivery) {
    throw new Error(`Delivery ${deliveryId} not found`);
  }

  if (!delivery.webhook.active) {
    throw new Error('Webhook is not active');
  }

  // Reset status and retry
  await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: 'PENDING' as WebhookDeliveryStatus,
      attempts: 0,
      response: null,
    },
  });

  await deliverWebhook(
    delivery.webhook,
    delivery.payload as unknown as WebhookEventPayload,
    deliveryId
  );
}
