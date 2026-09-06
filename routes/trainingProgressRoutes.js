// routes/trainingProgressRoutes.js
// ─────────────────────────────────────────────────────────────
//  Education-section progress tracking for visitor ("student") accounts.
//  Mirrors the GET/POST/DELETE shape your existing progressRoutes.js already
//  uses for SOC mastery sync -- this is the same idea, scoped to trading
//  education content instead. New table, same db/app.db as usersDb.js.
//
//  GET    /api/training-progress            — list current user's completed lessons
//  POST   /api/training-progress            — mark a lesson complete { lessonId }
//  DELETE /api/training-progress/:lessonId  — unmark a lesson
// ─────────────────────────────────────────────────────────────

import express from "express";
import db from "../db/usersDb.js"; // same SQLite connection/file
import { authenticateToken } from "../middleware/auth.js";
import { auditLog, EVENT } from "../db/auditLogger.js";

const router = express.Router();

db.exec(`
  CREATE TABLE IF NOT EXISTS training_progress (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    userEmail    TEXT NOT NULL,
    lessonId     TEXT NOT NULL,
    completedAt  TEXT NOT NULL,
    UNIQUE(userEmail, lessonId)
  );
`);

// ─────────────────────────────────────────
//  GET /api/training-progress
// ─────────────────────────────────────────
router.get("/", authenticateToken, (req, res) => {
  try {
    const rows = db.prepare(
      "SELECT lessonId, completedAt FROM training_progress WHERE userEmail = ? ORDER BY completedAt ASC"
    ).all(req.user.email);
    res.json({ completed: rows });
  } catch (err) {
    console.error("Progress fetch error:", err);
    res.status(500).json({ message: "Failed to load progress" });
  }
});

// ─────────────────────────────────────────
//  POST /api/training-progress — mark a lesson complete
// ─────────────────────────────────────────
router.post("/", authenticateToken, (req, res) => {
  const { lessonId } = req.body;
  if (!lessonId) return res.status(400).json({ message: "lessonId is required" });

  try {
    db.prepare(`
      INSERT INTO training_progress (userEmail, lessonId, completedAt)
      VALUES (?, ?, ?)
      ON CONFLICT(userEmail, lessonId) DO UPDATE SET completedAt = excluded.completedAt
    `).run(req.user.email, lessonId, new Date().toISOString());

    auditLog({
      event_type: EVENT.PROTECTED_ACCESS,
      outcome:    "success",
      req,
      user_email: req.user.email,
      user_role:  req.user.role,
      metadata:   { action: "lesson_completed", lessonId },
    });

    res.status(201).json({ message: "Progress saved" });
  } catch (err) {
    console.error("Progress save error:", err);
    res.status(500).json({ message: "Failed to save progress" });
  }
});

// ─────────────────────────────────────────
//  DELETE /api/training-progress/:lessonId — unmark a lesson
// ─────────────────────────────────────────
router.delete("/:lessonId", authenticateToken, (req, res) => {
  try {
    db.prepare("DELETE FROM training_progress WHERE userEmail = ? AND lessonId = ?")
      .run(req.user.email, req.params.lessonId);
    res.json({ message: "Progress removed" });
  } catch (err) {
    console.error("Progress delete error:", err);
    res.status(500).json({ message: "Failed to remove progress" });
  }
});

export default router;
