// server.js
// ─────────────────────────────────────────────────────────────
//  kiranregmi-backend — Main entry point
//  Version: 2.2 | September 2026
//
//  Stack: Node.js · Express · JWT · bcryptjs · SQLite (audit + users/training)
//  Hosted: Render.com
//  Changes v2.2:
//    - Added tradesRoutes: Google Sheets proxy for trading.html dashboard
//    - Added trainingProgressRoutes: education-section lesson tracking
//    - authRoutes now backed by SQLite (db/usersDb.js) instead of data/users.json,
//      with a new POST /api/signup for education-section visitor accounts
//  Changes v2.1:
//    - Added progressRoutes for per-user SOC mastery sync
//    - Token expiry updated to 24h (see authRoutes.js)
//    - Added /api/verify and /api/me endpoints
//    - Added /api/admin/users management endpoints
// ─────────────────────────────────────────────────────────────

import express  from "express";
import cors     from "cors";
import helmet   from "helmet";

import { config }      from "./config/config.js";
import { apiLimiter }  from "./middleware/rateLimiter.js";
import cloudflareRoutes from "./routes/cloudflareRoutes.js";

// ── Routes ──
import authRoutes     from "./routes/authRoutes.js";
import questionRoutes from "./routes/questionRoutes.js";
import docRoutes      from "./routes/docRoutes.js";
import adminRoutes    from "./routes/adminRoutes.js";
import progressRoutes from "./routes/progressRoutes.js";
import tasksRoutes    from "./routes/tasksRoutes.js";
import briefingRoutes from "./routes/briefingRoutes.js";
import twpRoute       from './routes/twp-route.js';
import marketRoutes   from './routes/marketRoutes.js';
import tradesRoutes           from "./routes/tradesRoutes.js";
import trainingProgressRoutes from "./routes/trainingProgressRoutes.js";
import newsRoutes    from "./routes/newsRoutes.js";
import journalRoutes from "./routes/journalRoutes.js";

const app = express();
app.set("trust proxy", 1);

// ─────────────────────────────────────────
//  SECURITY MIDDLEWARE
// ─────────────────────────────────────────

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "https://cdn.tailwindcss.com", "https://cdnjs.cloudflare.com"],
      styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc:    ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      imgSrc:     ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://kiranregmi-com-backend.onrender.com"],
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

app.use(express.json({ limit: "10kb" }));
app.use("/api", apiLimiter);

// ─────────────────────────────────────────
//  ROUTES
// ─────────────────────────────────────────

app.use("/api",               authRoutes);      // POST /api/login, /api/signup, /api/logout, GET /api/verify, /api/me
app.use("/api/questions",     questionRoutes);  // GET  /api/questions
app.use("/api/secure-doc",    docRoutes);       // GET  /api/secure-doc/:name
app.use("/api/admin",         adminRoutes);     // GET  /api/admin/logs, /api/admin/stats, /api/admin/users
app.use("/api/cloudflare",    cloudflareRoutes);// GET  /api/cloudflare/events, /api/cloudflare/stats
app.use("/api/progress",      progressRoutes);  // GET/POST/DELETE /api/progress
app.use("/api/tasks",         tasksRoutes);     // GET/POST/DELETE /api/tasks
app.use("/api/briefing",      briefingRoutes);  // POST /api/briefing (Anthropic proxy)
app.use("/api/twp",           twpRoute); 
app.use("/api/market",        marketRoutes);    // Market data route (GET/POST /api/market)
app.use("/api/trades",            tradesRoutes);            // GET (public) / POST (owner-only) trading.html data
app.use("/api/training-progress", trainingProgressRoutes);  // GET/POST/DELETE education-section lesson completion
app.use("/api/news",    newsRoutes);
app.use("/api/journal", journalRoutes);

// ─────────────────────────────────────────
//  HEALTH CHECK
// ─────────────────────────────────────────

app.get("/", (req, res) => {
  res.json({
    status:  "ok",
    service: "kiranregmi-backend",
    version: "2.2",
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
  console.log(`✅ kiranregmi-backend v2.2 running on port ${config.port}`);
  console.log(`🌍 Environment: ${config.nodeEnv}`);
  console.log(`🔐 Audit logging: SQLite @ db/audit.db`);
  console.log(`👤 Users + training progress: SQLite @ db/app.db`);
  console.log(`📊 Progress sync: data/progress/`);
});
