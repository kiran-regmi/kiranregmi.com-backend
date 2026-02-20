// server.js
// ─────────────────────────────────────────────────────────────
//  kiranregmi-backend — Main entry point
//  Version: 2.0 | February 2026
//
//  Stack: Node.js · Express · JWT · bcryptjs · SQLite (audit)
//  Hosted: Render.com
// ─────────────────────────────────────────────────────────────

import express  from "express";
import cors     from "cors";
import helmet   from "helmet";

import { config }      from "./config/config.js";
import { apiLimiter }  from "./middleware/rateLimiter.js";

// ── Routes ──
import authRoutes     from "./routes/authRoutes.js";
import questionRoutes from "./routes/questionRoutes.js";
import docRoutes      from "./routes/docRoutes.js";
import adminRoutes    from "./routes/adminRoutes.js";

const app = express();

// ─────────────────────────────────────────
//  SECURITY MIDDLEWARE
// ─────────────────────────────────────────

// Helmet — sets secure HTTP headers (CSP, HSTS, X-Frame-Options, etc.)
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "https://cdn.tailwindcss.com", "https://cdnjs.cloudflare.com"],
      styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc:    ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      imgSrc:     ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://kiranregmi-backend.onrender.com"],
    }
  }
}));

// CORS — only allow kiranregmi.com origins
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || config.allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS blocked: ${origin}`));
    }
  },
  credentials: true
}));

// Parse JSON bodies
app.use(express.json({ limit: "10kb" })); // 10kb limit prevents large payload attacks

// General API rate limit
app.use("/api", apiLimiter);

// ─────────────────────────────────────────
//  ROUTES
// ─────────────────────────────────────────

app.use("/api",               authRoutes);      // POST /api/login, /api/logout
app.use("/api/questions",     questionRoutes);  // GET  /api/questions
app.use("/api/secure-doc",    docRoutes);       // GET  /api/secure-doc/:name
app.use("/api/admin",         adminRoutes);     // GET  /api/admin/logs, /api/admin/stats

// ─────────────────────────────────────────
//  HEALTH CHECK
// ─────────────────────────────────────────

app.get("/", (req, res) => {
  res.json({
    status:  "ok",
    service: "kiranregmi-backend",
    version: "2.0",
    env:     config.nodeEnv,
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// ─────────────────────────────────────────
//  404 & ERROR HANDLERS
// ─────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// Global error handler — never expose stack traces in production
app.use((err, req, res, next) => {
  console.error("[ERROR]", err.message);
  res.status(err.status || 500).json({
    message: config.isDev ? err.message : "Internal server error"
  });
});

// ─────────────────────────────────────────
//  START
// ─────────────────────────────────────────

app.listen(config.port, () => {
  console.log(`✅ kiranregmi-backend v2.0 running on port ${config.port}`);
  console.log(`🌍 Environment: ${config.nodeEnv}`);
  console.log(`🔐 Audit logging: SQLite @ db/audit.db`);
});
