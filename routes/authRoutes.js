// routes/authRoutes.js
// ─────────────────────────────────────────────────────────────
//  Authentication routes
//  POST /api/login    — issue JWT token
//  POST /api/logout   — log out (client discards token)
//  GET  /api/verify   — verify token is still valid
//  GET  /api/me       — return current user profile
// ─────────────────────────────────────────────────────────────

import express from "express";
import fs from "fs/promises";
import path from "path";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { fileURLToPath } from "url";

import { config }           from "../config/config.js";
import { loginLimiter }     from "../middleware/rateLimiter.js";
import { auditLog, EVENT }  from "../db/auditLogger.js";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const USERS_FILE = path.join(__dirname, "../data/users.json");

// ── Helper: read users file ──
async function readUsers() {
  const raw = await fs.readFile(USERS_FILE, "utf-8");
  return JSON.parse(raw);
}

// ── Helper: write users file ──
async function writeUsers(users) {
  await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
}

// ─────────────────────────────────────────
//  POST /api/login
// ─────────────────────────────────────────
router.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {
    const users = await readUsers();
    const userIdx = users.findIndex(u => u.email === email);

    if (userIdx === -1) {
      auditLog({
        event_type: EVENT.LOGIN_FAILURE,
        outcome:    "failure",
        req,
        user_email: email,
        metadata:   { reason: "user_not_found" },
      });
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const user = users[userIdx];

    // Check account status
    if (user.profile?.status === "suspended") {
      auditLog({
        event_type: EVENT.LOGIN_FAILURE,
        outcome:    "failure",
        req,
        user_email: email,
        metadata:   { reason: "account_suspended" },
      });
      return res.status(403).json({ message: "Account suspended. Contact admin." });
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

    // Update lastLogin timestamp
    users[userIdx].profile = users[userIdx].profile || {};
    users[userIdx].profile.lastLogin = new Date().toISOString();
    await writeUsers(users);

    // Issue 24h token
    const token = jwt.sign(
      {
        email:       user.email,
        role:        user.role,
        permissions: user.permissions,
        fullName:    user.profile?.fullName || "",
        initials:    user.profile?.avatarInitials || email.substring(0, 2).toUpperCase()
      },
      config.jwtSecret,
      { expiresIn: "24h" }
    );

    auditLog({
      event_type: EVENT.LOGIN_SUCCESS,
      outcome:    "success",
      req,
      user_email: user.email,
      user_role:  user.role,
    });

    res.json({
      token,
      role:        user.role,
      email:       user.email,
      fullName:    user.profile?.fullName || "",
      initials:    user.profile?.avatarInitials || email.substring(0, 2).toUpperCase(),
      permissions: user.permissions
    });

  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error during login" });
  }
});

// ─────────────────────────────────────────
//  POST /api/logout
// ─────────────────────────────────────────
router.post("/logout", authenticateToken, (req, res) => {
  auditLog({
    event_type: EVENT.LOGOUT,
    outcome:    "success",
    req,
    user_email: req.user.email,
    user_role:  req.user.role,
  });
  res.json({ message: "Logged out successfully" });
});

// ─────────────────────────────────────────
//  GET /api/verify — token validity check
// ─────────────────────────────────────────
router.get("/verify", authenticateToken, (req, res) => {
  // authenticateToken already validated the JWT
  // If we reach here, token is valid
  res.json({
    valid:       true,
    email:       req.user.email,
    role:        req.user.role,
    permissions: req.user.permissions || [],
    fullName:    req.user.fullName    || "",
    initials:    req.user.initials    || req.user.email.substring(0, 2).toUpperCase()
  });
});

// ─────────────────────────────────────────
//  GET /api/me — current user full profile
// ─────────────────────────────────────────
router.get("/me", authenticateToken, async (req, res) => {
  try {
    const users = await readUsers();
    const user  = users.find(u => u.email === req.user.email);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Return profile without passwordHash
    const { passwordHash, ...safe } = user;
    res.json(safe);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

export default router;