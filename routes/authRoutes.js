// routes/authRoutes.js
// ─────────────────────────────────────────────────────────────
//  Authentication routes
//  POST /api/login    — issue JWT token
//  POST /api/signup   — create a new account (role: student) + issue JWT
//  POST /api/logout   — log out (client discards token)
//  GET  /api/verify   — verify token is still valid
//  GET  /api/me       — return current user profile
//  PATCH /api/me      — self-update profile
//
//  v2.2: migrated from data/users.json (flat file) to SQLite (db/usersDb.js).
//  A flat file with read-modify-write on every login was fine for a small,
//  hand-managed set of accounts, but risks a race/corruption once strangers
//  can sign themselves up concurrently. See db/usersDb.js for the migration.
// ─────────────────────────────────────────────────────────────

import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { config }            from "../config/config.js";
import { loginLimiter }      from "../middleware/rateLimiter.js";
import { auditLog, EVENT }   from "../db/auditLogger.js";
import { authenticateToken } from "../middleware/auth.js";
import {
  getUserByEmail,
  emailExists,
  createUser,
  updateLastLogin,
  updateProfile,
} from "../db/usersDb.js";

const router = express.Router();

// Role → destination (enforced on frontend):
// owner → office.html     (kiran@kiranregmi.com)
// admin → admin.html      (admin@kiranregmi.com)
// user/kid/test/adult/student → dashboard.html
//
// NOTE: EVENT.SIGNUP is referenced below. If db/auditLogger.js's EVENT export
// doesn't already have a SIGNUP constant, add one (it's likely just a string
// like "signup" alongside the existing LOGIN_SUCCESS/LOGIN_FAILURE entries) --
// I don't have that file's contents to confirm the exact shape.

// ─────────────────────────────────────────
//  POST /api/login
// ─────────────────────────────────────────
router.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {
    const user = getUserByEmail(email);

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

    // Non-fatal — login still succeeds even if this write fails
    try {
      updateLastLogin(email);
    } catch (writeErr) {
      console.warn("Could not update lastLogin (non-fatal):", writeErr.message);
    }

    const token = jwt.sign(
      {
        email:       user.email,
        role:        user.role,
        permissions: user.permissions,
        fullName:    user.profile?.fullName || "",
        initials:    user.profile?.avatarInitials || email.substring(0, 2).toUpperCase(),
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
      permissions: user.permissions,
    });

  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error during login" });
  }
});

// ─────────────────────────────────────────
//  POST /api/signup — new: education-section visitor accounts
//  Always creates role "student" — cannot self-assign owner/admin/etc.
// ─────────────────────────────────────────
router.post("/signup", loginLimiter, async (req, res) => {
  const { email, password, fullName } = req.body;

  if (!email || !password || !fullName?.trim()) {
    return res.status(400).json({ message: "Full name, email, and password are required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ message: "Password must be at least 8 characters" });
  }

  try {
    if (emailExists(email)) {
      auditLog({
        event_type: EVENT.SIGNUP,
        outcome:    "failure",
        req,
        user_email: email,
        metadata:   { reason: "email_already_exists" },
      });
      // Deliberately vague message -- don't confirm/deny which emails already have accounts
      return res.status(400).json({ message: "Could not create account with those details" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = createUser({ email, passwordHash, role: "student", fullName: fullName.trim() });

    const token = jwt.sign(
      {
        email:       user.email,
        role:        user.role,
        permissions: user.permissions,
        fullName:    user.profile.fullName,
        initials:    user.profile.avatarInitials,
      },
      config.jwtSecret,
      { expiresIn: "24h" }
    );

    auditLog({
      event_type: EVENT.SIGNUP,
      outcome:    "success",
      req,
      user_email: user.email,
      user_role:  user.role,
    });

    res.status(201).json({
      token,
      role:        user.role,
      email:       user.email,
      fullName:    user.profile.fullName,
      initials:    user.profile.avatarInitials,
      permissions: user.permissions,
    });

  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ message: "Server error during signup" });
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
  res.json({
    valid:       true,
    email:       req.user.email,
    role:        req.user.role,
    permissions: req.user.permissions || [],
    fullName:    req.user.fullName    || "",
    initials:    req.user.initials    || req.user.email.substring(0, 2).toUpperCase(),
  });
});

// ─────────────────────────────────────────
//  GET /api/me — current user full profile
// ─────────────────────────────────────────
router.get("/me", authenticateToken, async (req, res) => {
  try {
    const user = getUserByEmail(req.user.email);
    if (!user) return res.status(404).json({ message: "User not found" });

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
    const user = updateProfile(req.user.email, { fullName, phone, country });
    if (!user) return res.status(404).json({ message: "User not found" });

    auditLog({
      event_type: EVENT.ADMIN_ACTION,
      outcome:    "success",
      req,
      user_email: req.user.email,
      user_role:  req.user.role,
      metadata:   { action: "self_update_profile" },
    });

    const { passwordHash, ...safe } = user;
    res.json({ message: "Profile updated", user: safe });
  } catch (err) {
    console.error("Profile update error:", err);
    res.status(500).json({ message: "Failed to update profile" });
  }
});

export default router;
