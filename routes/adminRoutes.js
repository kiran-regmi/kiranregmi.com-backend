// routes/adminRoutes.js
// ─────────────────────────────────────────────────────────────
//  Admin-only routes
//  GET    /api/admin/logs           — paginated audit log
//  GET    /api/admin/stats          — summary stats
//  GET    /api/admin/users          — list all users
//  POST   /api/admin/users          — create new user
//  PATCH  /api/admin/users/:email   — update user profile/status
//  DELETE /api/admin/users/:email   — delete user
//  POST   /api/admin/users/:email/reset-password — admin password reset
// ─────────────────────────────────────────────────────────────

import express  from "express";
import fs       from "fs/promises";
import path     from "path";
import bcrypt   from "bcryptjs";
import { fileURLToPath } from "url";

import { authenticateToken, requireRole } from "../middleware/auth.js";
import { auditLog, EVENT }                from "../db/auditLogger.js";
import { getDb }                          from "../db/auditLogger.js";

const router     = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const USERS_FILE = path.join(__dirname, "../data/users.json");

// ── Helpers ──
async function readUsers()         { return JSON.parse(await fs.readFile(USERS_FILE, "utf-8")); }
async function writeUsers(users)   { await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), "utf-8"); }
function initials(name = "")      { return name.split(" ").map(w => w[0] || "").join("").slice(0, 2).toUpperCase() || "??"; }

// All admin routes require valid JWT + admin role
router.use(authenticateToken, requireRole(["admin"]));

// ─────────────────────────────────────────
//  GET /api/admin/stats
// ─────────────────────────────────────────
router.get("/stats", async (req, res) => {
  try {
    const db   = getDb();
    const row  = db.prepare(`
      SELECT
        COUNT(*)                                              AS total,
        SUM(outcome = 'failure')                             AS failures,
        SUM(suspicious = 1)                                  AS suspicious,
        SUM(timestamp >= datetime('now','-24 hours'))        AS last24h
      FROM audit_log
    `).get();
    res.json({
      total:      row.total      || 0,
      failures:   row.failures   || 0,
      suspicious: row.suspicious || 0,
      last24h:    row.last24h    || 0,
    });
  } catch (err) {
    res.status(500).json({ message: "Stats error" });
  }
});

// ─────────────────────────────────────────
//  GET /api/admin/logs
// ─────────────────────────────────────────
router.get("/logs", async (req, res) => {
  try {
    const db         = getDb();
    const limit      = Math.min(parseInt(req.query.limit)  || 25, 100);
    const offset     = parseInt(req.query.offset) || 0;
    const event_type = req.query.event_type || null;
    const outcome    = req.query.outcome    || null;
    const suspicious = req.query.suspicious === "true" ? 1 : null;
    const search     = req.query.search     || null;

    let where = ["1=1"];
    let params = [];
    if (event_type)           { where.push("event_type = ?");              params.push(event_type); }
    if (outcome)              { where.push("outcome = ?");                 params.push(outcome); }
    if (suspicious !== null)  { where.push("suspicious = ?");              params.push(suspicious); }
    if (search)               { where.push("(user_email LIKE ? OR ip_address LIKE ?)"); params.push(`%${search}%`, `%${search}%`); }

    const whereStr = where.join(" AND ");
    const total  = db.prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE ${whereStr}`).get(...params).c;
    const logs   = db.prepare(`SELECT * FROM audit_log WHERE ${whereStr} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

    res.json({ total, logs });
  } catch (err) {
    res.status(500).json({ message: "Log error" });
  }
});

// ─────────────────────────────────────────
//  GET /api/admin/users — list all users
// ─────────────────────────────────────────
router.get("/users", async (req, res) => {
  try {
    const users = await readUsers();
    // Strip password hashes before sending
    const safe = users.map(({ passwordHash, ...u }) => u);
    res.json({ users: safe, total: safe.length });
  } catch (err) {
    res.status(500).json({ message: "Failed to load users" });
  }
});

// ─────────────────────────────────────────
//  POST /api/admin/users — create new user
// ─────────────────────────────────────────
router.post("/users", async (req, res) => {
  const { email, password, role, fullName, phone, country, permissions } = req.body;

  if (!email || !password || !fullName) {
    return res.status(400).json({ message: "email, password, and fullName are required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ message: "Password must be at least 8 characters" });
  }

  const validRoles = ["admin", "user", "test", "kid", "adult"];
  if (role && !validRoles.includes(role)) {
    return res.status(400).json({ message: `Invalid role. Must be one of: ${validRoles.join(", ")}` });
  }

  try {
    const users = await readUsers();
    if (users.find(u => u.email === email)) {
      return res.status(409).json({ message: "User with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = {
      email,
      passwordHash,
      role: role || "user",
      permissions: permissions || ["soc-mastery"],
      profile: {
        fullName,
        phone:           phone    || "",
        country:         country  || "",
        avatarInitials:  initials(fullName),
        status:          "active",
        createdAt:       new Date().toISOString(),
        lastLogin:       null
      }
    };

    users.push(newUser);
    await writeUsers(users);

    auditLog({
      event_type: "ADMIN_ACTION",
      outcome:    "success",
      req,
      user_email: req.user.email,
      user_role:  req.user.role,
      metadata:   { action: "create_user", target: email, role: newUser.role }
    });

    const { passwordHash: _, ...safe } = newUser;
    res.status(201).json({ message: "User created", user: safe });

  } catch (err) {
    console.error("Create user error:", err);
    res.status(500).json({ message: "Failed to create user" });
  }
});

// ─────────────────────────────────────────
//  PATCH /api/admin/users/:email — update profile/status/permissions
// ─────────────────────────────────────────
router.patch("/users/:email", async (req, res) => {
  const targetEmail = decodeURIComponent(req.params.email);
  const { fullName, phone, country, status, role, permissions } = req.body;

  // Prevent admin from accidentally removing themselves
  if (targetEmail === req.user.email && status === "suspended") {
    return res.status(400).json({ message: "Cannot suspend your own account" });
  }

  try {
    const users = await readUsers();
    const idx   = users.findIndex(u => u.email === targetEmail);
    if (idx === -1) return res.status(404).json({ message: "User not found" });

    const user = users[idx];
    user.profile = user.profile || {};

    if (fullName    !== undefined) { user.profile.fullName = fullName; user.profile.avatarInitials = initials(fullName); }
    if (phone       !== undefined)  user.profile.phone       = phone;
    if (country     !== undefined)  user.profile.country     = country;
    if (status      !== undefined)  user.profile.status      = status;
    if (role        !== undefined)  user.role                = role;
    if (permissions !== undefined)  user.permissions         = permissions;

    users[idx] = user;
    await writeUsers(users);

    auditLog({
      event_type: "ADMIN_ACTION",
      outcome:    "success",
      req,
      user_email: req.user.email,
      user_role:  req.user.role,
      metadata:   { action: "update_user", target: targetEmail, changes: Object.keys(req.body) }
    });

    const { passwordHash, ...safe } = user;
    res.json({ message: "User updated", user: safe });

  } catch (err) {
    res.status(500).json({ message: "Failed to update user" });
  }
});

// ─────────────────────────────────────────
//  DELETE /api/admin/users/:email — remove user
// ─────────────────────────────────────────
router.delete("/users/:email", async (req, res) => {
  const targetEmail = decodeURIComponent(req.params.email);

  if (targetEmail === req.user.email) {
    return res.status(400).json({ message: "Cannot delete your own account" });
  }

  try {
    const users  = await readUsers();
    const idx    = users.findIndex(u => u.email === targetEmail);
    if (idx === -1) return res.status(404).json({ message: "User not found" });

    users.splice(idx, 1);
    await writeUsers(users);

    // Also delete their progress file if it exists
    try {
      const safe = targetEmail.replace(/[^a-zA-Z0-9@._-]/g, "_");
      await fs.unlink(path.join(__dirname, `../data/progress/${safe}.json`));
    } catch {}

    auditLog({
      event_type: "ADMIN_ACTION",
      outcome:    "success",
      req,
      user_email: req.user.email,
      user_role:  req.user.role,
      metadata:   { action: "delete_user", target: targetEmail }
    });

    res.json({ message: "User deleted" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete user" });
  }
});

// ─────────────────────────────────────────
//  POST /api/admin/users/:email/reset-password
// ─────────────────────────────────────────
router.post("/users/:email/reset-password", async (req, res) => {
  const targetEmail = decodeURIComponent(req.params.email);
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ message: "New password must be at least 8 characters" });
  }

  try {
    const users = await readUsers();
    const idx   = users.findIndex(u => u.email === targetEmail);
    if (idx === -1) return res.status(404).json({ message: "User not found" });

    users[idx].passwordHash = await bcrypt.hash(newPassword, 10);
    await writeUsers(users);

    auditLog({
      event_type: "ADMIN_ACTION",
      outcome:    "success",
      req,
      user_email: req.user.email,
      user_role:  req.user.role,
      metadata:   { action: "reset_password", target: targetEmail }
    });

    res.json({ message: "Password reset successfully" });
  } catch (err) {
    res.status(500).json({ message: "Failed to reset password" });
  }
});

export default router;