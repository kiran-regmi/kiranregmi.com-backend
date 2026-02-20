// db/auditLogger.js
// ─────────────────────────────────────────────────────────────
//  Audit Logging Engine — SQLite-backed structured event log
//  Logs: auth events, protected access, admin actions, anomalies
// ─────────────────────────────────────────────────────────────

import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// DB file lives in /db/ folder
const DB_PATH = path.join(__dirname, "audit.db");

// ── Open / create database ──
const db = new Database(DB_PATH);

// ── Enable WAL mode for better concurrent read performance ──
db.pragma("journal_mode = WAL");

// ── Create audit_logs table if it doesn't exist ──
db.exec(`
  CREATE TABLE IF NOT EXISTS audit_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   TEXT    NOT NULL DEFAULT (datetime('now')),
    event_type  TEXT    NOT NULL,
    outcome     TEXT    NOT NULL CHECK(outcome IN ('success','failure','blocked')),
    user_email  TEXT,
    user_role   TEXT,
    ip_address  TEXT,
    user_agent  TEXT,
    endpoint    TEXT,
    method      TEXT,
    metadata    TEXT,
    suspicious  INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_timestamp   ON audit_logs(timestamp);
  CREATE INDEX IF NOT EXISTS idx_event_type  ON audit_logs(event_type);
  CREATE INDEX IF NOT EXISTS idx_ip_address  ON audit_logs(ip_address);
  CREATE INDEX IF NOT EXISTS idx_suspicious  ON audit_logs(suspicious);
`);

// ── Event type constants ──
export const EVENT = {
  LOGIN_SUCCESS:    "LOGIN_SUCCESS",
  LOGIN_FAILURE:    "LOGIN_FAILURE",
  LOGOUT:           "LOGOUT",
  TOKEN_INVALID:    "TOKEN_INVALID",
  TOKEN_EXPIRED:    "TOKEN_EXPIRED",
  ACCESS_DENIED:    "ACCESS_DENIED",       // 403 — wrong role
  UNAUTHORIZED:     "UNAUTHORIZED",        // 401 — no token
  PROTECTED_ACCESS: "PROTECTED_ACCESS",    // authorized access to protected route
  ADMIN_ACTION:     "ADMIN_ACTION",        // admin-only operations
  RATE_LIMITED:     "RATE_LIMITED",        // too many requests
  SENSITIVE_API:    "SENSITIVE_API",       // /api/secure-doc etc.
};

// ── Anomaly thresholds ──
const ANOMALY_RULES = {
  failedLoginsPerIP:    5,   // 5+ failures from same IP in 15 min → suspicious
  failedLoginsPerUser:  3,   // 3+ failures for same email in 15 min → suspicious
};

// ── Prepared statements ──
const insertLog = db.prepare(`
  INSERT INTO audit_logs
    (event_type, outcome, user_email, user_role, ip_address, user_agent, endpoint, method, metadata, suspicious)
  VALUES
    (@event_type, @outcome, @user_email, @user_role, @ip_address, @user_agent, @endpoint, @method, @metadata, @suspicious)
`);

const countRecentByIP = db.prepare(`
  SELECT COUNT(*) AS cnt FROM audit_logs
  WHERE ip_address = ? AND event_type = 'LOGIN_FAILURE'
    AND timestamp >= datetime('now', '-15 minutes')
`);

const countRecentByEmail = db.prepare(`
  SELECT COUNT(*) AS cnt FROM audit_logs
  WHERE user_email = ? AND event_type = 'LOGIN_FAILURE'
    AND timestamp >= datetime('now', '-15 minutes')
`);

// ── Helper: extract real IP (handles Render/Vercel proxies) ──
function getClientIP(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
    req.headers["x-real-ip"] ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

// ── Helper: check if this entry looks suspicious ──
function isSuspicious(event_type, ip_address, user_email) {
  if (event_type !== EVENT.LOGIN_FAILURE) return false;

  const byIP    = countRecentByIP.get(ip_address);
  const byEmail = user_email ? countRecentByEmail.get(user_email) : { cnt: 0 };

  return (
    byIP.cnt   >= ANOMALY_RULES.failedLoginsPerIP   ||
    byEmail.cnt >= ANOMALY_RULES.failedLoginsPerUser
  );
}

// ── MAIN LOG FUNCTION ──
export function auditLog({
  event_type,
  outcome,
  req,
  user_email = null,
  user_role  = null,
  metadata   = null,
}) {
  try {
    const ip_address = req ? getClientIP(req) : "internal";
    const user_agent = req?.headers?.["user-agent"]?.slice(0, 200) || null;
    const endpoint   = req ? req.originalUrl || req.url : null;
    const method     = req?.method || null;
    const suspicious = isSuspicious(event_type, ip_address, user_email) ? 1 : 0;

    insertLog.run({
      event_type,
      outcome,
      user_email,
      user_role,
      ip_address,
      user_agent,
      endpoint,
      method,
      metadata: metadata ? JSON.stringify(metadata) : null,
      suspicious,
    });

    // Console output in dev
    const flag = suspicious ? "🚨 SUSPICIOUS" : outcome === "failure" ? "⚠️" : "✅";
    console.log(`[AUDIT] ${flag} ${event_type} | ${outcome} | ${user_email || "anonymous"} | ${ip_address}`);

  } catch (err) {
    // Never crash the app because of logging failure
    console.error("[AUDIT] Logging failed:", err.message);
  }
}

// ── QUERY FUNCTIONS (for admin viewer) ──

export function getLogs({ limit = 100, offset = 0, event_type, outcome, suspicious, search } = {}) {
  let where = [];
  let params = [];

  if (event_type)  { where.push("event_type = ?");  params.push(event_type); }
  if (outcome)     { where.push("outcome = ?");      params.push(outcome); }
  if (suspicious !== undefined) { where.push("suspicious = ?"); params.push(suspicious ? 1 : 0); }
  if (search)      {
    where.push("(user_email LIKE ? OR ip_address LIKE ? OR endpoint LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = db.prepare(`
    SELECT * FROM audit_logs
    ${whereClause}
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const total = db.prepare(`
    SELECT COUNT(*) AS cnt FROM audit_logs ${whereClause}
  `).get(...params).cnt;

  return { logs: rows, total };
}

export function getStats() {
  return {
    total:       db.prepare("SELECT COUNT(*) AS n FROM audit_logs").get().n,
    failures:    db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE outcome = 'failure'").get().n,
    suspicious:  db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE suspicious = 1").get().n,
    last24h:     db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE timestamp >= datetime('now','-24 hours')").get().n,
    topIPs:      db.prepare("SELECT ip_address, COUNT(*) AS cnt FROM audit_logs GROUP BY ip_address ORDER BY cnt DESC LIMIT 5").all(),
    eventBreakdown: db.prepare("SELECT event_type, COUNT(*) AS cnt FROM audit_logs GROUP BY event_type ORDER BY cnt DESC").all(),
  };
}

export default db;
