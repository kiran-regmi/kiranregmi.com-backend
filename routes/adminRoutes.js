// routes/adminRoutes.js
// ─────────────────────────────────────────────────────────────
//  Admin-only routes for audit log viewer
//  GET /api/admin/logs   — paginated log query
//  GET /api/admin/stats  — summary statistics
// ─────────────────────────────────────────────────────────────

import express from "express";
import { authenticateToken, requireRole } from "../middleware/auth.js";
import { getLogs, getStats, auditLog, EVENT } from "../db/auditLogger.js";

const router = express.Router();

// All admin routes require admin role
router.use(authenticateToken, requireRole(["admin"]));

// ── GET /api/admin/logs ──
// Query params: limit, offset, event_type, outcome, suspicious, search
router.get("/logs", (req, res) => {
  try {
    const {
      limit      = 50,
      offset     = 0,
      event_type,
      outcome,
      suspicious,
      search
    } = req.query;

    const result = getLogs({
      limit:      Math.min(parseInt(limit), 200), // cap at 200
      offset:     parseInt(offset),
      event_type: event_type || undefined,
      outcome:    outcome    || undefined,
      suspicious: suspicious !== undefined ? suspicious === "true" : undefined,
      search:     search     || undefined,
    });

    auditLog({
      event_type: EVENT.ADMIN_ACTION,
      outcome:    "success",
      req,
      user_email: req.user.email,
      user_role:  req.user.role,
      metadata:   { action: "view_audit_logs", filters: req.query },
    });

    res.json(result);
  } catch (err) {
    console.error("Admin logs error:", err);
    res.status(500).json({ message: "Error fetching logs" });
  }
});

// ── GET /api/admin/stats ──
router.get("/stats", (req, res) => {
  try {
    const stats = getStats();
    res.json(stats);
  } catch (err) {
    console.error("Admin stats error:", err);
    res.status(500).json({ message: "Error fetching stats" });
  }
});

export default router;
