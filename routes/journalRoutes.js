// routes/journalRoutes.js
// ─────────────────────────────────────────────────────────────
//  Daily Journal — per-trade detail from the Trade-Summary tab.
//  Unlike tradesRoutes.js (Daily-Logs), this ENTIRE route is owner-only —
//  the journal itself is private, not just the write side. Same Google
//  Sheets proxy pattern as tradesRoutes.js, different tab and auth.
//
//  GET  /api/journal — owner-only, reads Trade-Summary
//  POST /api/journal — owner-only, appends a new trade row
// ─────────────────────────────────────────────────────────────

import express from "express";
import { google } from "googleapis";

import { config }             from "../config/config.js";
import { authenticateToken, requireRole } from "../middleware/auth.js";
import { auditLog, EVENT }    from "../db/auditLogger.js";

const router = express.Router();

function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: config.google.serviceAccountEmail,
    key: config.google.privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

// Column order matches the Trade-Summary tab exactly:
// Date, Day, Ticker, Entry Side, Entry Price, Filled/Target Price,
// Stop Loss Price, +/- Point, # of Contracts, Result, +/- P/L, Trade Fees,
// Detail, SetUp
const JOURNAL_TAB = "Trade-Summary";
const RANGE_READ  = `${JOURNAL_TAB}!A2:N`;
const RANGE_WRITE = `${JOURNAL_TAB}!A:N`;

// Every route below requires being logged in AND being the owner --
// this journal is private, unlike the public Daily-Logs dashboard data.
router.use(authenticateToken, requireRole(["owner"]));

// ─────────────────────────────────────────
//  GET /api/journal
// ─────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: config.google.sheetId,
      range: RANGE_READ,
      valueRenderOption: "UNFORMATTED_VALUE",
    });

    const rows = result.data.values || [];
    const trades = rows
      .filter(r => r[0])
      .map(r => ({
        date:       r[0]  || "",
        day:        r[1]  || "",
        ticker:     r[2]  || "",
        entrySide:  r[3]  || "",
        entryPrice: r[4] != null ? Number(r[4]) : null,
        exitPrice:  r[5] != null ? Number(r[5]) : null,
        stopPrice:  r[6] != null ? Number(r[6]) : null,
        points:     r[7] != null ? Number(r[7]) : null,
        contracts:  r[8] != null ? Number(r[8]) : null,
        result:     r[9]  || "",
        pnl:        r[10] != null ? Number(r[10]) : null,
        fees:       r[11] != null ? Number(r[11]) : null,
        detail:     r[12] || "",
        setup:      r[13] || "",
      }));

    res.json({ trades, count: trades.length });
  } catch (err) {
    console.error("Journal fetch error:", err);
    res.status(502).json({ message: "Failed to load journal data from Google Sheets" });
  }
});

// ─────────────────────────────────────────
//  POST /api/journal — append one trade
// ─────────────────────────────────────────
router.post("/", async (req, res) => {
  const {
    date, day, ticker, entrySide, entryPrice, exitPrice,
    stopPrice, points, contracts, result, pnl, fees, detail, setup,
  } = req.body;

  if (!date || !ticker || entryPrice == null || exitPrice == null) {
    return res.status(400).json({ message: "date, ticker, entryPrice, and exitPrice are required" });
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
          date, day || "", ticker, entrySide || "",
          entryPrice, exitPrice, stopPrice ?? "",
          points ?? "", contracts ?? "", result || "",
          pnl ?? "", fees ?? "", detail || "", setup || "",
        ]],
      },
    });

    auditLog({
      event_type: EVENT.ADMIN_ACTION,
      outcome:    "success",
      req,
      user_email: req.user.email,
      user_role:  req.user.role,
      metadata:   { action: "add_journal_trade", date, ticker },
    });

    res.status(201).json({ message: "Trade added to journal" });
  } catch (err) {
    console.error("Journal write error:", err);
    res.status(502).json({ message: "Failed to write trade to Google Sheets" });
  }
});

export default router;
