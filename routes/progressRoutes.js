// routes/progressRoutes.js
// ─────────────────────────────────────────────────────────────
//  Per-user SOC Mastery progress sync
//  GET  /api/progress       — load this user's saved state
//  POST /api/progress       — save this user's state
//  DELETE /api/progress     — reset this user's progress
// ─────────────────────────────────────────────────────────────

import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import { authenticateToken } from "../middleware/auth.js";
import { auditLog, EVENT }   from "../db/auditLogger.js";

const router  = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PROGRESS_DIR = path.join(__dirname, "../data/progress");

// ── Ensure progress directory exists ──
async function ensureDir() {
  try { await fs.mkdir(PROGRESS_DIR, { recursive: true }); } catch {}
}

// ── Safe email → filename (no path traversal) ──
function progressFile(email) {
  const safe = email.replace(/[^a-zA-Z0-9@._-]/g, "_");
  return path.join(PROGRESS_DIR, `${safe}.json`);
}

// ── GET /api/progress — load saved state ──
router.get("/", authenticateToken, async (req, res) => {
  await ensureDir();
  const file = progressFile(req.user.email);
  try {
    const raw  = await fs.readFile(file, "utf-8");
    const data = JSON.parse(raw);
    return res.json({ success: true, data });
  } catch {
    // No saved progress yet — return empty state
    return res.json({
      success: true,
      data: {
        learned:    {},
        streak:     0,
        notes:      {},
        weakSpots:  {},
        domainScores: {},
        congratsShown: false,
        darkMode:   false,
        lastSaved:  null
      }
    });
  }
});

// ── POST /api/progress — save state ──
router.post("/", authenticateToken, async (req, res) => {
  await ensureDir();

  const { learned, streak, notes, weakSpots, domainScores, congratsShown, darkMode } = req.body;

  // Basic validation
  if (typeof learned !== "object" || learned === null) {
    return res.status(400).json({ message: "Invalid progress data" });
  }

  const payload = {
    learned:      learned      || {},
    streak:       streak       || 0,
    notes:        notes        || {},
    weakSpots:    weakSpots    || {},
    domainScores: domainScores || {},
    congratsShown: !!congratsShown,
    darkMode:     !!darkMode,
    lastSaved:    new Date().toISOString()
  };

  try {
    const file = progressFile(req.user.email);
    await fs.writeFile(file, JSON.stringify(payload, null, 2), "utf-8");

    auditLog({
      event_type: "PROGRESS_SAVED",
      outcome:    "success",
      req,
      user_email: req.user.email,
      user_role:  req.user.role,
      metadata:   {
        learnedCount: Object.keys(payload.learned).length,
        notesCount:   Object.keys(payload.notes).length,
        streak:       payload.streak
      }
    });

    return res.json({ success: true, lastSaved: payload.lastSaved });
  } catch (err) {
    console.error("Progress save error:", err);
    return res.status(500).json({ message: "Failed to save progress" });
  }
});

// ── DELETE /api/progress — reset progress (user resets their own) ──
router.delete("/", authenticateToken, async (req, res) => {
  const file = progressFile(req.user.email);
  try {
    await fs.unlink(file);
    auditLog({
      event_type: "PROGRESS_RESET",
      outcome:    "success",
      req,
      user_email: req.user.email,
      user_role:  req.user.role,
    });
    return res.json({ success: true, message: "Progress reset" });
  } catch {
    return res.json({ success: true, message: "No progress to reset" });
  }
});

export default router;