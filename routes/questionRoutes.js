// routes/questionRoutes.js
// ─────────────────────────────────────────────────────────────
//  Questions API — admin and user roles only
// ─────────────────────────────────────────────────────────────

import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

import { authenticateToken, requireRole, logProtectedAccess } from "../middleware/auth.js";

const router = express.Router();
const __filename   = fileURLToPath(import.meta.url);
const __dirname    = path.dirname(__filename);
const QUESTIONS_FILE = path.join(__dirname, "../data/questions.json");

// GET /api/questions — admin + user only
router.get(
  "/",
  authenticateToken,
  requireRole(["admin", "user"]),
  logProtectedAccess,
  async (req, res) => {
    try {
      const data      = await fs.readFile(QUESTIONS_FILE, "utf-8");
      const questions = JSON.parse(data);
      res.json({ success: true, questions });
    } catch (err) {
      console.error("Questions error:", err);
      res.status(500).json({ message: "Server error loading questions" });
    }
  }
);

export default router;
