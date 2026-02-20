// middleware/rateLimiter.js
// ─────────────────────────────────────────────────────────────
//  Rate limiting middleware using express-rate-limit
//  - loginLimiter:  hardened limit for /api/login (brute force protection)
//  - apiLimiter:    general limit for all API routes
// ─────────────────────────────────────────────────────────────

import rateLimit from "express-rate-limit";
import { config } from "../config/config.js";
import { auditLog, EVENT } from "../db/auditLogger.js";

// ── Login endpoint — tight limit ──
export const loginLimiter = rateLimit({
  windowMs: config.loginRateLimit.windowMs,  // 15 minutes
  max:      config.loginRateLimit.max,        // 10 attempts
  standardHeaders: true,
  legacyHeaders:   false,
  message: {
    message: "Too many login attempts — please try again in 15 minutes."
  },
  handler(req, res, next, options) {
    auditLog({
      event_type: EVENT.RATE_LIMITED,
      outcome:    "blocked",
      req,
      metadata: {
        endpoint: req.originalUrl,
        limit:    options.max,
        window:   "15min",
      },
    });
    res.status(429).json(options.message);
  },
});

// ── General API limit ──
export const apiLimiter = rateLimit({
  windowMs: config.apiRateLimit.windowMs,  // 1 minute
  max:      config.apiRateLimit.max,        // 60 requests
  standardHeaders: true,
  legacyHeaders:   false,
  message: {
    message: "Too many requests — slow down."
  },
});
