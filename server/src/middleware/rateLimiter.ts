import rateLimit from 'express-rate-limit';

// Auth endpoints — brute force protection
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Registration — prevent account spam
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: 'Too many accounts created from this IP. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// File uploads (CSV, Trello import) — prevent abuse
export const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  message: { error: 'Too many upload requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Forgot password — prevent abuse
export const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: { error: 'Too many reset requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API — loose ceiling, just blocks hammering
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300,
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for WebSocket upgrade requests
    return req.headers.upgrade === 'websocket';
  },
});
