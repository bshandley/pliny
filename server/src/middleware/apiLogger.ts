import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export interface ApiEvent {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  userId: number | null;
  tokenId?: string;
  requestBody?: unknown;
  responseBody?: unknown;
  fnName?: string;
}

// Ring buffer for API events (500 events max)
const MAX_EVENTS = 500;
const eventBuffer: ApiEvent[] = [];
let bufferIndex = 0;
let totalEvents = 0;

// Subscribers for real-time streaming
type EventSubscriber = (event: ApiEvent) => void;
const subscribers = new Set<EventSubscriber>();

export function subscribeToApiEvents(callback: EventSubscriber): () => void {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

export function getRecentApiEvents(limit = 100): ApiEvent[] {
  const events: ApiEvent[] = [];
  const count = Math.min(limit, Math.min(totalEvents, MAX_EVENTS));

  // Read from newest to oldest
  for (let i = 0; i < count; i++) {
    const idx = (bufferIndex - 1 - i + MAX_EVENTS) % MAX_EVENTS;
    if (eventBuffer[idx]) {
      events.push(eventBuffer[idx]);
    }
  }

  return events;
}

function addEvent(event: ApiEvent): void {
  eventBuffer[bufferIndex] = event;
  bufferIndex = (bufferIndex + 1) % MAX_EVENTS;
  totalEvents++;

  // Notify subscribers
  for (const subscriber of subscribers) {
    try {
      subscriber(event);
    } catch {
      // Ignore subscriber errors
    }
  }
}

// Redact sensitive fields from request/response bodies
const REDACT_KEYS = new Set([
  'password', 'newPassword', 'new_password', 'currentPassword', 'current_password',
  'secret', 'client_secret', 'token', 'totp_code', 'smtp_password',
]);

function redactSensitiveFields(body: unknown): unknown {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const clone: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const key of Object.keys(clone)) {
    if (REDACT_KEYS.has(key)) {
      clone[key] = '[REDACTED]';
    }
  }
  return clone;
}

// Truncate response body to 10KB
function truncateBody(body: unknown): unknown {
  if (body === undefined || body === null) return body;

  const str = typeof body === 'string' ? body : JSON.stringify(body);
  if (str.length <= 10240) {
    return body;
  }

  return {
    _truncated: true,
    _originalSize: str.length,
    _preview: str.slice(0, 10240),
  };
}

// Global flag to enable/disable logging
let loggingEnabled = true;

export function setApiLoggingEnabled(enabled: boolean): void {
  loggingEnabled = enabled;
}

export function isApiLoggingEnabled(): boolean {
  return loggingEnabled;
}

// Middleware to log API requests
export function apiLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip if logging is disabled
  if (!loggingEnabled) {
    return next();
  }

  // Skip if X-Pliny-No-Log header is set
  if (req.headers['x-plank-no-log']) {
    return next();
  }

  // Skip non-API routes
  if (!req.path.startsWith('/api')) {
    return next();
  }

  // Skip the dev console endpoint itself to prevent recursion
  if (req.path.startsWith('/api/dev/')) {
    return next();
  }

  const startTime = Date.now();
  const eventId = crypto.randomUUID();

  // Capture request body (clone and redact sensitive fields)
  const requestBody = req.body && Object.keys(req.body).length > 0
    ? redactSensitiveFields(JSON.parse(JSON.stringify(req.body)))
    : undefined;

  // Intercept response to capture body and status
  const originalJson = res.json.bind(res);
  let responseBody: unknown;

  res.json = function(body: any) {
    responseBody = body;
    return originalJson(body);
  };

  // Log when response finishes
  res.on('finish', () => {
    const event: ApiEvent = {
      id: eventId,
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - startTime,
      userId: (req as any).user?.id ? parseInt((req as any).user.id, 10) : null,
      tokenId: (req as any).apiTokenId,
      requestBody: truncateBody(requestBody),
      responseBody: truncateBody(redactSensitiveFields(responseBody)),
      fnName: req.headers['x-client-fn'] as string | undefined,
    };

    addEvent(event);
  });

  next();
}
