import crypto from 'crypto';
import pool from '../db';

export type WebhookEvent =
  | 'card.created'
  | 'card.updated'
  | 'card.moved'
  | 'card.archived'
  | 'card.deleted'
  | 'comment.created'
  | 'board.created'
  | 'board.updated';

export interface WebhookPayload {
  event: WebhookEvent;
  timestamp: string;
  data: Record<string, any>;
}

interface Webhook {
  id: string;
  board_id: number | null;
  url: string;
  secret: string;
  events: string[];
  enabled: boolean;
}

// Retry delays in ms: 5s, 30s, 5min
const RETRY_DELAYS = [5000, 30000, 300000];
const MAX_ATTEMPTS = 3;

// Generate HMAC signature
function signPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

// Find matching webhooks for an event
async function findMatchingWebhooks(
  event: WebhookEvent,
  boardId?: number
): Promise<Webhook[]> {
  // Find global webhooks and board-specific webhooks that match this event
  const result = await pool.query(
    `SELECT * FROM webhooks
     WHERE enabled = TRUE
       AND $1 = ANY(events)
       AND (board_id IS NULL OR board_id = $2)`,
    [event, boardId || null]
  );
  return result.rows;
}

// Deliver webhook with retries
async function deliverWebhook(
  webhook: Webhook,
  event: WebhookEvent,
  payload: WebhookPayload,
  deliveryId: string,
  attempt: number = 1
): Promise<void> {
  const payloadStr = JSON.stringify(payload);
  const signature = signPayload(payloadStr, webhook.secret);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Pliny-Event': event,
        'X-Pliny-Delivery': deliveryId,
        'X-Pliny-Signature': `sha256=${signature}`,
        'User-Agent': 'Pliny-Webhooks/1.0',
      },
      body: payloadStr,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const responseBody = await response.text().catch(() => '');

    // Update delivery record
    await pool.query(
      `UPDATE webhook_deliveries
       SET status_code = $1, response_body = $2, delivered_at = CURRENT_TIMESTAMP, attempt = $3
       WHERE id = $4`,
      [response.status, responseBody.slice(0, 10000), attempt, deliveryId]
    );

    // If not successful and have retries left, schedule retry
    if (!response.ok && attempt < MAX_ATTEMPTS) {
      scheduleRetry(webhook, event, payload, deliveryId, attempt + 1);
    }
  } catch (err: any) {
    const errorMsg = err.name === 'AbortError' ? 'Request timeout' : err.message;

    // Update delivery with error
    await pool.query(
      `UPDATE webhook_deliveries
       SET error = $1, attempt = $2
       WHERE id = $3`,
      [errorMsg, attempt, deliveryId]
    );

    // Schedule retry if attempts remain
    if (attempt < MAX_ATTEMPTS) {
      scheduleRetry(webhook, event, payload, deliveryId, attempt + 1);
    }
  }
}

// Schedule a retry delivery
function scheduleRetry(
  webhook: Webhook,
  event: WebhookEvent,
  payload: WebhookPayload,
  deliveryId: string,
  attempt: number
): void {
  const delay = RETRY_DELAYS[attempt - 2] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
  setTimeout(() => {
    deliverWebhook(webhook, event, payload, deliveryId, attempt);
  }, delay);
}

// Main function to trigger webhook delivery
export async function triggerWebhook(
  event: WebhookEvent,
  data: Record<string, any>,
  boardId?: number
): Promise<void> {
  try {
    const webhooks = await findMatchingWebhooks(event, boardId);

    if (webhooks.length === 0) return;

    const payload: WebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      data,
    };

    for (const webhook of webhooks) {
      const deliveryId = crypto.randomUUID();

      // Create delivery record
      await pool.query(
        `INSERT INTO webhook_deliveries (id, webhook_id, event_type, payload)
         VALUES ($1, $2, $3, $4)`,
        [deliveryId, webhook.id, event, JSON.stringify(payload)]
      );

      // Fire and forget the delivery
      deliverWebhook(webhook, event, payload, deliveryId).catch(() => {});
    }
  } catch (err) {
    console.error('Error triggering webhooks:', err);
  }
}

// Re-deliver a specific delivery
export async function redeliverWebhook(deliveryId: string): Promise<void> {
  const result = await pool.query(
    `SELECT wd.*, w.url, w.secret, w.events
     FROM webhook_deliveries wd
     JOIN webhooks w ON wd.webhook_id = w.id
     WHERE wd.id = $1`,
    [deliveryId]
  );

  if (result.rows.length === 0) {
    throw new Error('Delivery not found');
  }

  const delivery = result.rows[0];
  const webhook: Webhook = {
    id: delivery.webhook_id,
    board_id: null,
    url: delivery.url,
    secret: delivery.secret,
    events: delivery.events,
    enabled: true,
  };

  const payload = typeof delivery.payload === 'string'
    ? JSON.parse(delivery.payload)
    : delivery.payload;

  // Create new delivery record for the redeliver
  const newDeliveryId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO webhook_deliveries (id, webhook_id, event_type, payload)
     VALUES ($1, $2, $3, $4)`,
    [newDeliveryId, webhook.id, delivery.event_type, JSON.stringify(payload)]
  );

  await deliverWebhook(webhook, delivery.event_type, payload, newDeliveryId);
}
