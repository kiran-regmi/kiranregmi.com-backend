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

// Role → destination (enforced on frontend):
// owner → office.html     (kiran@kiranregmi.com)
// admin → admin.html      (admin@kiranregmi.com)
// user/kid/test/adult → dashboard.html
//
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

    // Update lastLogin timestamp — non-fatal, login succeeds even if write fails
    try {
      users[userIdx].profile = users[userIdx].profile || {};
      users[userIdx].profile.lastLogin = new Date().toISOString();
      await writeUsers(users);
    } catch (writeErr) {
      console.warn("Could not update lastLogin (non-fatal):", writeErr.message);
    }

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

// ─────────────────────────────────────────
//  PATCH /api/me — self-update profile (any authenticated user)
//  Only allows: fullName, phone, country — cannot change role/permissions/status
// ─────────────────────────────────────────
router.patch("/me", authenticateToken, async (req, res) => {
  const { fullName, phone, country } = req.body;

  if (!fullName || !fullName.trim()) {
    return res.status(400).json({ message: "Full name is required" });
  }

  try {
    const users = JSON.parse(await fs.readFile(USERS_FILE, "utf-8"));
    const idx   = users.findIndex(u => u.email === req.user.email);
    if (idx === -1) return res.status(404).json({ message: "User not found" });

    users[idx].profile = users[idx].profile || {};
    users[idx].profile.fullName       = fullName.trim();
    users[idx].profile.phone          = phone?.trim()   || users[idx].profile.phone   || "";
    users[idx].profile.country        = country?.trim() || users[idx].profile.country || "";
    users[idx].profile.avatarInitials = fullName.trim().split(" ")
      .map(w => w[0] || "").join("").slice(0, 2).toUpperCase() || "??";

    await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");

    auditLog({
      event_type: EVENT.ADMIN_ACTION,
      outcome:    "success",
      req,
      user_email: req.user.email,
      user_role:  req.user.role,
      metadata:   { action: "self_update_profile" }
    });

    const { passwordHash, ...safe } = users[idx];
    res.json({ message: "Profile updated", user: safe });
  } catch (err) {
    console.error("Profile update error:", err);
    res.status(500).json({ message: "Failed to update profile" });
  }
});

export default router;