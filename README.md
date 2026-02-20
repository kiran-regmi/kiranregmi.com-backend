# kiranregmi-backend v2.0

Express.js backend for kiranregmi.com — JWT auth, RBAC, audit logging, rate limiting.

## Directory Structure

```
kiranregmi-backend/
│
├── server.js                  ← Entry point — mounts all middleware & routes
│
├── config/
│   └── config.js              ← All environment variables & app settings
│
├── middleware/
│   ├── auth.js                ← JWT verification, RBAC requireRole(), logProtectedAccess()
│   └── rateLimiter.js         ← Login rate limiter (10/15min) + general API limiter
│
├── routes/
│   ├── authRoutes.js          ← POST /api/login, POST /api/logout
│   ├── questionRoutes.js      ← GET  /api/questions  (admin + user)
│   ├── docRoutes.js           ← GET  /api/secure-doc/:name  (admin only)
│   └── adminRoutes.js         ← GET  /api/admin/logs + /api/admin/stats  (admin only)
│
├── db/
│   ├── auditLogger.js         ← SQLite audit engine — log(), getLogs(), getStats()
│   └── audit.db               ← SQLite database file (auto-created on first run, not in git)
│
├── data/
│   ├── users.json             ← User accounts (hashed passwords)
│   ├── questions.json         ← SOC interview questions
│   └── projects.json          ← Project data
│
├── .env                       ← Secret environment variables (NOT in git)
├── .env.example               ← Template showing required vars (safe to commit)
├── .gitignore
└── package.json
```

## Files You Should NOT Commit to Git

```
.env
db/audit.db
node_modules/
```

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Create your .env file
```bash
cp .env.example .env
```
Then edit `.env` and set a real JWT_SECRET:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 3. Move your data files
```bash
mv users.json    data/
mv questions.json data/
mv projects.json  data/
```

### 4. Start the server
```bash
npm start
```

## Render Deployment

Set these environment variables in your Render service dashboard:
- `JWT_SECRET` — strong random 64+ char string
- `NODE_ENV` — `production`
- `PORT` — leave blank (Render sets this)

## API Endpoints

| Method | Endpoint | Auth | Role |
|--------|----------|------|------|
| POST | /api/login | None | — |
| POST | /api/logout | JWT | any |
| GET | /api/questions | JWT | admin, user |
| GET | /api/secure-doc/:name | JWT | admin |
| GET | /api/admin/logs | JWT | admin |
| GET | /api/admin/stats | JWT | admin |
| GET | /health | None | — |

## Audit Log Events

| Event | Trigger |
|-------|---------|
| LOGIN_SUCCESS | Successful login |
| LOGIN_FAILURE | Wrong password or unknown user |
| LOGOUT | Explicit logout |
| TOKEN_INVALID | Bad JWT signature |
| TOKEN_EXPIRED | JWT past expiry |
| UNAUTHORIZED | Request missing token |
| ACCESS_DENIED | Wrong role for route |
| PROTECTED_ACCESS | Authorized access to protected route |
| ADMIN_ACTION | Admin viewing logs, managing users |
| RATE_LIMITED | IP exceeded login attempt limit |
| SENSITIVE_API | Secure document accessed |

## Anomaly Detection

Entries are automatically flagged `suspicious = true` when:
- 5+ LOGIN_FAILURE events from the same IP in 15 minutes
- 3+ LOGIN_FAILURE events for the same email in 15 minutes
