// routes/briefingRoutes.js
// ─────────────────────────────────────────────────────────────
//  AI Briefing — Anthropic Claude proxy
//  POST /api/briefing
//  Auth: JWT required
//  The ANTHROPIC_API_KEY lives here on the server — never
//  exposed to the browser.
// ─────────────────────────────────────────────────────────────

import express from "express";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();

// ── POST /api/briefing ────────────────────────────────────────
// Body: { prompt: string }
// Returns: { content: string }
// ─────────────────────────────────────────────────────────────
router.post("/", authenticateToken, async (req, res) => {
  const { prompt } = req.body;

  if (!prompt || typeof prompt !== "string" || prompt.length > 4000) {
    return res.status(400).json({ message: "Invalid prompt" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[BRIEFING] ANTHROPIC_API_KEY not set in environment");
    return res.status(503).json({ message: "AI service not configured on server" });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":         "application/json",
        "x-api-key":            apiKey,
        "anthropic-version":    "2023-06-01",
      },
      body: JSON.stringify({
        model:      "claude-opus-4-6",
        max_tokens: 1500,
        messages:   [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("[BRIEFING] Anthropic error:", response.status, err);
      return res.status(502).json({ message: "AI service error — try again shortly" });
    }

    const data = await response.json();
    const content = data.content?.[0]?.text || "";

    return res.json({ content });

  } catch (err) {
    console.error("[BRIEFING] Fetch error:", err.message);
    return res.status(500).json({ message: "Failed to reach AI service" });
  }
});

export default router;