// routes/authRoutes.js
// ─────────────────────────────────────────────────────────────
//  Authentication routes: /api/login, /api/logout
// ─────────────────────────────────────────────────────────────

import express from "express";
import fs from "fs/promises";
import path from "path";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { fileURLToPath } from "url";

import { config }    from "../config/config.js";
import { loginLimiter } from "../middleware/rateLimiter.js";
import { auditLog, EVENT } from "../db/auditLogger.js";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const USERS_FILE = path.join(__dirname, "../data/users.json");

// ── POST /api/login ──
router.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body;

  // Basic input validation
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {
    const users = JSON.parse(await fs.readFile(USERS_FILE, "utf-8"));
    const user  = users.find(u => u.email === email);

    // User not found — log failure (generic message to prevent email enumeration)
    if (!user) {
      auditLog({
        event_type: EVENT.LOGIN_FAILURE,
        outcome:    "failure",
        req,
        user_email: email,
        metadata:   { reason: "user_not_found" },
      });
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatch) {
      auditLog({
        event_type: EVENT.LOGIN_FAILURE,
        outcome:    "failure",
        req,
        user_email: email,
        user_role:  user.role,
        metadata:   { reason: "wrong_password" },
      });
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Success — issue token
    const token = jwt.sign(
      { email: user.email, role: user.role },
      config.jwtSecret,
      { expiresIn: config.tokenExpiry }
    );

    auditLog({
      event_type: EVENT.LOGIN_SUCCESS,
      outcome:    "success",
      req,
      user_email: user.email,
      user_role:  user.role,
    });

    res.json({ token, role: user.role });

  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error during login" });
  }
});

// ── POST /api/logout ──
router.post("/logout", authenticateToken, (req, res) => {
  auditLog({
    event_type: EVENT.LOGOUT,
    outcome:    "success",
    req,
    user_email: req.user.email,
    user_role:  req.user.role,
  });
  // JWT is stateless — client should discard token
  res.json({ message: "Logged out successfully" });
});

export default router;
