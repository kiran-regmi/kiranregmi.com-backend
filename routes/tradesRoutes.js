// routes/tradesRoutes.js
// ─────────────────────────────────────────────────────────────
//  Trade data proxy — reads/writes the Daily-Logs Google Sheet.
//  GET  /api/trades  — public, read-only, powers trading.html's live dashboard
//  POST /api/trades  — owner-only, appends a new day's row to the sheet
//
//  Setup required (see bottom of this file for the full checklist):
//   1. npm install googleapis
//   2. A Google Cloud service account with Sheets API enabled
//   3. The Daily-Logs sheet shared with that service account's email as Editor
//   4. Three new env vars in Render: GOOGLE_SERVICE_ACCOUNT_EMAIL,
//      GOOGLE_SERVICE_ACCOUNT_KEY, GOOGLE_SHEET_ID
// ─────────────────────────────────────────────────────────────

import express from "express";
import { google } from "googleapis";

import { config }             from "../config/config.js";
import { authenticateToken, requireRole } from "../middleware/auth.js";
import { auditLog, EVENT }    from "../db/auditLogger.js";

const router = express.Router();

function getSheetsClient() {
  const auth = new google.auth.JWT(
    config.google.serviceAccountEmail,
    null,
    config.google.privateKey,
    ["https://www.googleapis.com/auth/spreadsheets"]
  );
  return google.sheets({ version: "v4", auth });
}

// Column order matches the Daily-Logs sheet exactly:
// Date, Day, Trades, Wins, Losses, Win %, Contracts, Symbols Traded, Gross P/L, Broker Fees, Net P/L, Remarks
const RANGE_READ  = `${config.google.sheetTab}!A2:L`;
const RANGE_WRITE = `${config.google.sheetTab}!A:L`;

// ─────────────────────────────────────────
//  GET /api/trades — public
// ─────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: config.google.sheetId,
      range: RANGE_READ,
    });

    const rows = result.data.values || [];
    const days = rows
      .filter(r => r[0] && r[0] !== "TOTAL")
      .map(r => ({
        date:      r[0]  || "",
        day:       r[1]  || "",
        trades:    Number(r[2]  || 0),
        wins:      Number(r[3]  || 0),
        losses:    Number(r[4]  || 0),
        contracts: r[6] ? Number(r[6]) : null,
        symbols:   r[7]  || "",
        gross:     Number(r[8]  || 0),
        fees:      Number(r[9]  || 0),
        net:       Number(r[10] || 0),
        remark:    r[11] || "",
      }));

    res.json({ days, count: days.length });
  } catch (err) {
    console.error("Trades fetch error:", err);
    res.status(502).json({ message: "Failed to load trade data from Google Sheets" });
  }
});

// ─────────────────────────────────────────
//  POST /api/trades — owner only, appends one day's row
// ─────────────────────────────────────────
router.post("/", authenticateToken, requireRole(["owner"]), async (req, res) => {
  const { date, day, trades, wins, losses, contracts, symbols, gross, fees, net, remark } = req.body;

  if (!date || trades == null || gross == null || fees == null || net == null) {
    return res.status(400).json({ message: "date, trades, gross, fees, and net are required" });
  }

  try {
    const sheets = getSheetsClient();
    await sheets.spreadsheets.values.append({
      spreadsheetId: config.google.sheetId,
      range: RANGE_WRITE,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[
          date,
          day || "",
          trades,
          wins || 0,
          losses || 0,
          "", // Win % — left as a formula column in the sheet itself, not written here
          contracts ?? "",
          symbols || "",
          gross,
          fees,
          net,
          remark || "",
        ]],
      },
    });

    auditLog({
      event_type: EVENT.ADMIN_ACTION,
      outcome:    "success",
      req,
      user_email: req.user.email,
      user_role:  req.user.role,
      metadata:   { action: "add_trade_day", date },
    });

    res.status(201).json({ message: "Trade day added" });
  } catch (err) {
    console.error("Trades write error:", err);
    res.status(502).json({ message: "Failed to write trade data to Google Sheets" });
  }
});

export default router;

// ─────────────────────────────────────────
//  SETUP CHECKLIST (do this once)
// ─────────────────────────────────────────
// 1. Google Cloud Console → create/select a project → enable "Google Sheets API"
// 2. IAM & Admin → Service Accounts → Create Service Account → create a JSON key
//    for it and download it
// 3. Open the JSON key file. You need two fields from it:
//      - "client_email"  → GOOGLE_SERVICE_ACCOUNT_EMAIL
//      - "private_key"   → GOOGLE_SERVICE_ACCOUNT_KEY
//    The private_key contains literal "\n" sequences -- when you paste it into
//    Render's env var box, paste it exactly as-is (Render preserves the string;
//    config.js below un-escapes it back into real newlines at runtime).
// 4. Open your Daily-Logs Google Sheet → Share → paste in the client_email
//    address → give it Editor access.
// 5. Get the Sheet ID from its URL:
//    https://docs.google.com/spreadsheets/d/THIS_PART_HERE/edit
// 6. In Render's dashboard → your backend service → Environment → add:
//      GOOGLE_SERVICE_ACCOUNT_EMAIL = client_email from the JSON key
//      GOOGLE_SERVICE_ACCOUNT_KEY   = private_key from the JSON key
//      GOOGLE_SHEET_ID              = the sheet ID from step 5
//      GOOGLE_SHEET_TAB             = Daily-Logs   (or whatever your tab is named)
// 7. npm install googleapis (in the backend project)
// 8. Add this router in server.js (see note in that file's diff)
