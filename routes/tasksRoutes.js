// routes/tasksRoutes.js
// ─────────────────────────────────────────────────────────────
//  Per-user task storage
//  GET    /api/tasks          — load user's tasks
//  POST   /api/tasks          — save/replace user's tasks
//  DELETE /api/tasks          — clear all tasks for user
// ─────────────────────────────────────────────────────────────

import express from "express";
import fs      from "fs/promises";
import path    from "path";
import { fileURLToPath } from "url";

import { authenticateToken } from "../middleware/auth.js";
import { auditLog, EVENT }   from "../db/auditLogger.js";

const router     = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const TASKS_DIR  = path.join(__dirname, "../data/tasks");

// Ensure tasks directory exists
async function ensureDir() {
  try { await fs.mkdir(TASKS_DIR, { recursive: true }); } catch {}
}

// Safe filename from email
function safeFile(email) {
  return path.join(TASKS_DIR, email.replace(/[^a-zA-Z0-9@._-]/g, "_") + ".json");
}

// All routes require valid JWT
router.use(authenticateToken);

// ─────────────────────────────────────────
//  GET /api/tasks
// ─────────────────────────────────────────
router.get("/", async (req, res) => {
  await ensureDir();
  try {
    const file = safeFile(req.user.email);
    const raw  = await fs.readFile(file, "utf-8");
    res.json(JSON.parse(raw));
  } catch {
    // No file yet — return empty
    res.json({ tasks: [], updatedAt: null });
  }
});

// ─────────────────────────────────────────
//  POST /api/tasks — full replace (client is source of truth)
// ─────────────────────────────────────────
router.post("/", async (req, res) => {
  await ensureDir();
  const { tasks } = req.body;

  if (!Array.isArray(tasks)) {
    return res.status(400).json({ message: "tasks must be an array" });
  }

  // Validate each task has minimum required fields
  for (const t of tasks) {
    if (!t.id || typeof t.text !== "string") {
      return res.status(400).json({ message: "Each task requires id and text" });
    }
  }

  try {
    const payload = { tasks, updatedAt: new Date().toISOString() };
    await fs.writeFile(safeFile(req.user.email), JSON.stringify(payload, null, 2), "utf-8");
    res.json({ message: "Tasks saved", count: tasks.length });
  } catch (err) {
    console.error("Tasks save error:", err);
    res.status(500).json({ message: "Failed to save tasks" });
  }
});

// ─────────────────────────────────────────
//  DELETE /api/tasks — clear all tasks
// ─────────────────────────────────────────
router.delete("/", async (req, res) => {
  await ensureDir();
  try {
    await fs.writeFile(safeFile(req.user.email), JSON.stringify({ tasks: [], updatedAt: new Date().toISOString() }, null, 2));

    auditLog({
      event_type: "ADMIN_ACTION",
      outcome:    "success",
      req,
      user_email: req.user.email,
      user_role:  req.user.role,
      metadata:   { action: "clear_tasks" }
    });

    res.json({ message: "Tasks cleared" });
  } catch (err) {
    res.status(500).json({ message: "Failed to clear tasks" });
  }
});

export default router;