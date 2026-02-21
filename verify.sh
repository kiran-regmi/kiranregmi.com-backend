#!/bin/bash
# ─────────────────────────────────────────────────────────────
#  kiranregmi-backend — Deployment Verification Script
#  Run this from your terminal after deployment:
#  bash verify.sh
# ─────────────────────────────────────────────────────────────

BASE_URL="https://kiranregmi-com-backend.onrender.com"
PASS=0
FAIL=0
WARN=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅ PASS${NC} — $1"; ((PASS++)); }
fail() { echo -e "  ${RED}❌ FAIL${NC} — $1"; ((FAIL++)); }
warn() { echo -e "  ${YELLOW}⚠️  WARN${NC} — $1"; ((WARN++)); }
header() { echo -e "\n${CYAN}${BOLD}$1${NC}"; echo "  ────────────────────────────────"; }

echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  kiranregmi-backend — Deployment Verification     ${NC}"
echo -e "${BOLD}  Target: $BASE_URL ${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"

# ─────────────────────────────────────────
#  TEST 1 — Health Checks
# ─────────────────────────────────────────
header "TEST 1 — Health Checks"

ROOT=$(curl -s --max-time 10 "$BASE_URL/")
if echo "$ROOT" | grep -q '"version":"2.0"'; then
  pass "GET / returns version 2.0"
elif echo "$ROOT" | grep -q "running"; then
  warn "GET / responded but version is not 2.0 — old server.js may still be deployed"
else
  fail "GET / not responding — check Render deploy logs"
fi

HEALTH=$(curl -s --max-time 10 "$BASE_URL/health")
if echo "$HEALTH" | grep -q '"status":"healthy"'; then
  pass "GET /health returns healthy"
else
  fail "GET /health not responding"
fi

# ─────────────────────────────────────────
#  TEST 2 — Security Headers (Helmet.js)
# ─────────────────────────────────────────
header "TEST 2 — Security Headers (Helmet.js)"

HEADERS=$(curl -sI --max-time 10 "$BASE_URL/")

if echo "$HEADERS" | grep -qi "x-frame-options"; then
  pass "X-Frame-Options header present"
else
  fail "X-Frame-Options missing — Helmet.js may not be active"
fi

if echo "$HEADERS" | grep -qi "x-content-type-options"; then
  pass "X-Content-Type-Options header present"
else
  fail "X-Content-Type-Options missing"
fi

if echo "$HEADERS" | grep -qi "strict-transport-security"; then
  pass "Strict-Transport-Security (HSTS) header present"
else
  warn "HSTS header missing — may be handled by Render/proxy layer"
fi

# ─────────────────────────────────────────
#  TEST 3 — Login Endpoint
# ─────────────────────────────────────────
header "TEST 3 — Authentication"

# Wrong credentials
BAD_LOGIN=$(curl -s --max-time 10 -X POST "$BASE_URL/api/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"fake@test.com","password":"wrongpassword"}')

if echo "$BAD_LOGIN" | grep -q '"Invalid credentials"'; then
  pass "Login with wrong credentials returns 'Invalid credentials'"
elif echo "$BAD_LOGIN" | grep -q "Invalid"; then
  pass "Login with wrong credentials returns error (generic message)"
else
  fail "Login with wrong credentials — unexpected response: $BAD_LOGIN"
fi

# Missing fields
EMPTY_LOGIN=$(curl -s --max-time 10 -X POST "$BASE_URL/api/login" \
  -H "Content-Type: application/json" \
  -d '{}')

if echo "$EMPTY_LOGIN" | grep -qi "required\|missing\|invalid"; then
  pass "Login with empty body returns validation error"
else
  warn "Login with empty body — check input validation: $EMPTY_LOGIN"
fi

# Prompt user to enter real credentials for full test
echo ""
echo -e "  ${YELLOW}Enter your admin email to test successful login (or press Enter to skip):${NC}"
read -r ADMIN_EMAIL
if [ -n "$ADMIN_EMAIL" ]; then
  echo -e "  ${YELLOW}Enter your admin password:${NC}"
  read -rs ADMIN_PASS
  echo ""

  LOGIN_RESP=$(curl -s --max-time 10 -X POST "$BASE_URL/api/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}")

  if echo "$LOGIN_RESP" | grep -q '"token"'; then
    pass "Successful login returns JWT token"
    TOKEN=$(echo "$LOGIN_RESP" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
    ROLE=$(echo "$LOGIN_RESP"  | grep -o '"role":"[^"]*"'  | cut -d'"' -f4)
    echo -e "  ${CYAN}→ Role: $ROLE${NC}"
    echo -e "  ${CYAN}→ Token: ${TOKEN:0:40}...${NC}"
  else
    fail "Login failed — response: $LOGIN_RESP"
    TOKEN=""
  fi
else
  warn "Skipped successful login test"
  TOKEN=""
fi

# ─────────────────────────────────────────
#  TEST 4 — Protected Routes
# ─────────────────────────────────────────
header "TEST 4 — Protected Routes (RBAC)"

# No token
NO_TOKEN=$(curl -s --max-time 10 "$BASE_URL/api/questions" \
  -H "Content-Type: application/json")

if echo "$NO_TOKEN" | grep -q '"Missing auth token"\|401'; then
  pass "GET /api/questions without token returns 401"
else
  fail "GET /api/questions without token — unexpected: $NO_TOKEN"
fi

# Bad token
BAD_TOKEN=$(curl -s --max-time 10 "$BASE_URL/api/questions" \
  -H "Authorization: Bearer thisisafaketoken123")

if echo "$BAD_TOKEN" | grep -qi "invalid\|expired\|403"; then
  pass "GET /api/questions with bad token returns 403"
else
  fail "Bad token not rejected — unexpected: $BAD_TOKEN"
fi

# Valid token (if we got one)
if [ -n "$TOKEN" ]; then
  QUESTIONS=$(curl -s --max-time 10 "$BASE_URL/api/questions" \
    -H "Authorization: Bearer $TOKEN")

  if echo "$QUESTIONS" | grep -q '"success":true'; then
    pass "GET /api/questions with valid token returns data"
  else
    fail "GET /api/questions with valid token failed — $QUESTIONS"
  fi
fi

# ─────────────────────────────────────────
#  TEST 5 — Rate Limiting
# ─────────────────────────────────────────
header "TEST 5 — Rate Limiting (Login)"

echo -e "  Sending 12 rapid failed login attempts..."
RATE_HIT=false
for i in {1..12}; do
  RESP=$(curl -s --max-time 5 -X POST "$BASE_URL/api/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"ratelimit@test.com","password":"wrongpass"}')
  if echo "$RESP" | grep -qi "too many\|429\|rate"; then
    RATE_HIT=true
    pass "Rate limiter triggered after $i attempts — returns 429"
    break
  fi
done
if [ "$RATE_HIT" = false ]; then
  fail "Rate limiter never triggered after 12 attempts — check middleware"
fi

# ─────────────────────────────────────────
#  TEST 6 — Admin Audit Logs
# ─────────────────────────────────────────
header "TEST 6 — Audit Log API"

if [ -n "$TOKEN" ] && [ "$ROLE" = "admin" ]; then
  STATS=$(curl -s --max-time 10 "$BASE_URL/api/admin/stats" \
    -H "Authorization: Bearer $TOKEN")

  if echo "$STATS" | grep -q '"total"'; then
    TOTAL=$(echo "$STATS" | grep -o '"total":[0-9]*' | cut -d: -f2)
    FAILURES=$(echo "$STATS" | grep -o '"failures":[0-9]*' | cut -d: -f2)
    SUSPICIOUS=$(echo "$STATS" | grep -o '"suspicious":[0-9]*' | cut -d: -f2)
    pass "GET /api/admin/stats accessible"
    echo -e "  ${CYAN}→ Total log entries:  $TOTAL${NC}"
    echo -e "  ${CYAN}→ Failed attempts:    $FAILURES${NC}"
    echo -e "  ${CYAN}→ Suspicious flags:   $SUSPICIOUS${NC}"
  else
    fail "GET /api/admin/stats failed — $STATS"
  fi

  LOGS=$(curl -s --max-time 10 "$BASE_URL/api/admin/logs?limit=5" \
    -H "Authorization: Bearer $TOKEN")

  if echo "$LOGS" | grep -q '"logs"'; then
    pass "GET /api/admin/logs returns log entries"
    COUNT=$(echo "$LOGS" | grep -o '"total":[0-9]*' | cut -d: -f2)
    echo -e "  ${CYAN}→ Total audit entries in DB: $COUNT${NC}"
  else
    fail "GET /api/admin/logs failed — $LOGS"
  fi
elif [ -n "$TOKEN" ]; then
  warn "Logged in as '$ROLE' — admin/stats tests require admin role"
else
  warn "Skipped audit log tests — no valid token"
fi

# ─────────────────────────────────────────
#  TEST 7 — 404 Handler
# ─────────────────────────────────────────
header "TEST 7 — Error Handling"

NOT_FOUND=$(curl -s --max-time 10 "$BASE_URL/api/doesnotexist")
if echo "$NOT_FOUND" | grep -qi "not found\|404"; then
  pass "Unknown route returns 404 JSON"
else
  warn "Unknown route response: $NOT_FOUND"
fi

# ─────────────────────────────────────────
#  SUMMARY
# ─────────────────────────────────────────
TOTAL_TESTS=$((PASS + FAIL + WARN))
echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  VERIFICATION SUMMARY${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
echo -e "  ${GREEN}✅ PASSED:  $PASS${NC}"
echo -e "  ${RED}❌ FAILED:  $FAIL${NC}"
echo -e "  ${YELLOW}⚠️  WARNINGS: $WARN${NC}"
echo -e "  Total tests: $TOTAL_TESTS"
echo ""

if [ $FAIL -eq 0 ]; then
  echo -e "  ${GREEN}${BOLD}🎉 All critical tests passed — deployment verified!${NC}"
else
  echo -e "  ${RED}${BOLD}🔧 $FAIL test(s) failed — check Render deploy logs and file paths${NC}"
  echo ""
  echo -e "  ${YELLOW}Common fixes:${NC}"
  echo -e "  • Version still shows old — redeploy or check build logs in Render"
  echo -e "  • Helmet headers missing — ensure 'helmet' is in package.json and npm install ran"
  echo -e "  • Rate limiter not triggering — ensure 'express-rate-limit' installed"
  echo -e "  • Admin routes failing — check data/ folder has users.json"
fi
echo ""
