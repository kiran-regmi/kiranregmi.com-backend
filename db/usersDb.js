// db/usersDb.js
// ─────────────────────────────────────────────────────────────
//  SQLite-backed user storage — replaces data/users.json.
//  Uses its own database file (db/app.db) rather than assuming
//  db/auditLogger.js's connection, to avoid schema/driver conflicts.
//  Requires: npm install better-sqlite3
//
//  On first run, if the `users` table is empty and data/users.json
//  still exists, it auto-migrates every record over once. Safe to
//  leave users.json in place afterward (it's just never read again
//  once the table has rows) -- or delete it once you've confirmed
//  the migration worked.
// ─────────────────────────────────────────────────────────────

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const DB_PATH        = path.join(__dirname, "app.db");
const LEGACY_USERS_JSON = path.join(__dirname, "../data/users.json");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL"); // safe concurrent reads/writes, matters once signups are public

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    email          TEXT UNIQUE NOT NULL,
    passwordHash   TEXT NOT NULL,
    role           TEXT NOT NULL DEFAULT 'student',
    permissions    TEXT NOT NULL DEFAULT '[]',
    fullName       TEXT DEFAULT '',
    avatarInitials TEXT DEFAULT '',
    phone          TEXT DEFAULT '',
    country        TEXT DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'active',
    createdAt      TEXT NOT NULL,
    lastLogin      TEXT
  );
`);

// ── One-time migration from the old JSON file, if needed ──
function migrateFromJsonIfNeeded() {
  const countRow = db.prepare("SELECT COUNT(*) AS c FROM users").get();
  if (countRow.c > 0) return; // already have data, never overwrite

  if (!fs.existsSync(LEGACY_USERS_JSON)) return; // nothing to migrate

  try {
    const legacyUsers = JSON.parse(fs.readFileSync(LEGACY_USERS_JSON, "utf-8"));
    const insert = db.prepare(`
      INSERT INTO users (email, passwordHash, role, permissions, fullName, avatarInitials, phone, country, status, createdAt, lastLogin)
      VALUES (@email, @passwordHash, @role, @permissions, @fullName, @avatarInitials, @phone, @country, @status, @createdAt, @lastLogin)
    `);
    const insertMany = db.transaction((rows) => {
      for (const r of rows) insert.run(r);
    });

    const mapped = legacyUsers.map(u => ({
      email:          u.email,
      passwordHash:   u.passwordHash,
      role:           u.role || "student",
      permissions:    JSON.stringify(u.permissions || []),
      fullName:       u.profile?.fullName || "",
      avatarInitials: u.profile?.avatarInitials || "",
      phone:          u.profile?.phone || "",
      country:        u.profile?.country || "",
      status:         u.profile?.status || "active",
      createdAt:      u.profile?.createdAt || new Date().toISOString(),
      lastLogin:      u.profile?.lastLogin || null,
    }));

    insertMany(mapped);
    console.log(`✅ Migrated ${mapped.length} user(s) from data/users.json into db/app.db`);
  } catch (err) {
    console.error("⚠️  User migration from JSON failed (continuing with empty table):", err.message);
  }
}

migrateFromJsonIfNeeded();

// ── Row <-> API shape helpers ──
// Mirrors the { email, role, permissions, profile: {...} } shape authRoutes.js already
// expects, so the rest of the app doesn't need to change how it reads a user object.
function rowToUser(row) {
  if (!row) return null;
  return {
    email:        row.email,
    passwordHash: row.passwordHash,
    role:         row.role,
    permissions:  JSON.parse(row.permissions || "[]"),
    profile: {
      fullName:       row.fullName,
      avatarInitials: row.avatarInitials,
      phone:          row.phone,
      country:        row.country,
      status:         row.status,
      createdAt:      row.createdAt,
      lastLogin:      row.lastLogin,
    },
  };
}

export function getUserByEmail(email) {
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  return rowToUser(row);
}

export function emailExists(email) {
  return !!db.prepare("SELECT 1 FROM users WHERE email = ?").get(email);
}

export function createUser({ email, passwordHash, role = "student", fullName = "" }) {
  const avatarInitials = fullName.trim()
    ? fullName.trim().split(" ").map(w => w[0] || "").join("").slice(0, 2).toUpperCase()
    : email.substring(0, 2).toUpperCase();

  db.prepare(`
    INSERT INTO users (email, passwordHash, role, permissions, fullName, avatarInitials, createdAt)
    VALUES (@email, @passwordHash, @role, '[]', @fullName, @avatarInitials, @createdAt)
  `).run({
    email, passwordHash, role, fullName, avatarInitials,
    createdAt: new Date().toISOString(),
  });

  return getUserByEmail(email);
}

export function updateLastLogin(email) {
  db.prepare("UPDATE users SET lastLogin = ? WHERE email = ?")
    .run(new Date().toISOString(), email);
}

export function updateProfile(email, { fullName, phone, country }) {
  const avatarInitials = fullName.trim()
    ? fullName.trim().split(" ").map(w => w[0] || "").join("").slice(0, 2).toUpperCase()
    : "??";

  db.prepare(`
    UPDATE users
    SET fullName = ?, phone = COALESCE(NULLIF(?, ''), phone), country = COALESCE(NULLIF(?, ''), country), avatarInitials = ?
    WHERE email = ?
  `).run(fullName.trim(), phone?.trim() || "", country?.trim() || "", avatarInitials, email);

  return getUserByEmail(email);
}

export default db;
