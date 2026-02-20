// middleware/auth.js
// ─────────────────────────────────────────────────────────────
//  Authentication & Authorization middleware
//  - authenticateToken: validates JWT, attaches user to req
//  - requireRole:       RBAC guard for route-level access control
// ─────────────────────────────────────────────────────────────

import jwt from "jsonwebtoken";
import { config } from "../config/config.js";
import { auditLog, EVENT } from "../db/auditLogger.js";

// ── Verify JWT and attach decoded user to req.user ──
export function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    auditLog({
      event_type: EVENT.UNAUTHORIZED,
      outcome:    "failure",
      req,
      metadata:   { reason: "missing_token" },
    });
    return res.status(401).json({ message: "Missing auth token" });
  }

  jwt.verify(token, config.jwtSecret, (err, user) => {
    if (err) {
      const isExpired = err.name === "TokenExpiredError";
      auditLog({
        event_type: isExpired ? EVENT.TOKEN_EXPIRED : EVENT.TOKEN_INVALID,
        outcome:    "failure",
        req,
        metadata:   { error: err.message },
      });
      return res.status(403).json({
        message: isExpired ? "Token expired — please log in again" : "Invalid token"
      });
    }

    req.user = user; // { email, role, iat, exp }
    next();
  });
}

// ── RBAC: only allow specified roles through ──
export function requireRole(allowedRoles = []) {
  return (req, res, next) => {
    const { role, email } = req.user;

    if (!allowedRoles.includes(role)) {
      auditLog({
        event_type: EVENT.ACCESS_DENIED,
        outcome:    "failure",
        req,
        user_email: email,
        user_role:  role,
        metadata:   { required: allowedRoles, actual: role },
      });
      return res.status(403).json({
        message: `Access denied — requires role: ${allowedRoles.join(" or ")}`
      });
    }

    next();
  };
}

// ── Log every authorized access to a protected route ──
export function logProtectedAccess(req, res, next) {
  auditLog({
    event_type: EVENT.PROTECTED_ACCESS,
    outcome:    "success",
    req,
    user_email: req.user?.email,
    user_role:  req.user?.role,
  });
  next();
}
