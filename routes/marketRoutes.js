/**
 * Market Data + AI Trade Setups Route (ES Module)
 * File: routes/marketRoutes.js
 */

import express from 'express';

const router = express.Router();

// ── yahoo-finance2 v3 — must instantiate with new YahooFinance() ──
import { YahooFinance } from 'yahoo-finance2';
const yahooFinance = new YahooFinance();

// ── PING ──────────────────────────────────────────────────────
router.get('/ping', (_req, res) => {
  res.json({ ok: true, message: 'market routes working' });
});

// ── SYMBOLS ──────────────────────────────────────────────────
const FUTURES = [
  { symbol: 'ES=F',    name: 'S&P 500 Futures',    short: 'ES',  tv: 'CME_MINI:ES1!'  },
  { symbol: 'NQ=F',    name: 'Nasdaq 100 Futures',  short: 'NQ',  tv: 'CME_MINI:NQ1!'  },
  { symbol: 'GC=F',    name: 'Gold Futures',         short: 'GC',  tv: 'COMEX:GC1!'     },
  { symbol: 'CL=F',    name: 'Crude Oil Futures',    short: 'CL',  tv: 'NYMEX:CL1!'     },
  { symbol: '6E=F',    name: 'Euro FX Futures',      short: '6E',  tv: 'CME:6E1!'       },
  { symbol: 'ZB=F',    name: '30Y T-Bond Futures',   short: 'ZB',  tv: 'CBOT:ZB1!'      },
  { symbol: 'BTC-USD', name: 'Bitcoin',              short: 'BTC', tv: 'BINANCE:BTCUSDT'},
  { symbol: 'RTY=F',   name: 'Russell 2000 Futures', short: 'RTY', tv: 'CME_MINI:RTY1!' },
];

// ── SESSION DETECTION ─────────────────────────────────────────
function isDST(date) {
  const jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
  return Math.max(jan, jul) !== date.getTimezoneOffset();
}

function getSession() {
  const now = new Date();
  const etOffset = isDST(now) ? -4 : -5;
  const etHour = (now.getUTCHours() + etOffset + 24) % 24;
  const etMin  = now.getUTCMinutes();
  const etTime = etHour + etMin / 60;
  const dow = now.getUTCDay();

  if (dow === 0 || dow === 6) {
    return { session: 'weekend', label: 'Weekend', safe: false,
      warning: 'Markets closed — weekend.' };
  }
  if (etTime >= 6 && etTime < 9.25) {
    return { session: 'premarket', label: 'Pre-Market', safe: true, warning: null,
      note: 'Pre-market data is near real-time. Good time for setup planning.' };
  }
  if (etTime >= 9.5 && etTime < 16) {
    return { session: 'rth', label: 'RTH (Regular Trading Hours)', safe: false,
      warning: '⚠ RTH ACTIVE — Yahoo Finance data may be 15 min delayed. Always verify price on your chart before entering any trade.',
      note: 'Confirm entry/stop levels on TradingView or your broker platform.' };
  }
  if (etTime >= 16 && etTime < 18) {
    return { session: 'afterhours', label: 'After Hours', safe: true, warning: null,
      note: 'After-hours session. Setups based on closing prices.' };
  }
  return { session: 'overnight', label: 'Overnight / Globex', safe: true, warning: null,
    note: 'Overnight futures session. Prices are active — good for gap analysis.' };
}

// ── CACHE ─────────────────────────────────────────────────────
let _quotesCache = { data: null, at: 0 };
const QUOTE_TTL = 5 * 60 * 1000;

// ── GET /api/market/session ───────────────────────────────────
router.get('/session', (_req, res) => {
  res.json({ ok: true, data: getSession(), timestamp: new Date().toISOString() });
});

// ── GET /api/market/quotes ────────────────────────────────────
router.get('/quotes', async (req, res) => {
  try {
    if (_quotesCache.data && (Date.now() - _quotesCache.at) < QUOTE_TTL) {
      return res.json({ ok: true, cached: true, data: _quotesCache.data });
    }

    
    const session = getSession();

    const results = await Promise.allSettled(
      FUTURES.map(f => yahooFinance.quote(f.symbol))
    );

    const quotes = results.map((result, i) => {
      const f = FUTURES[i];
      const tvUrl = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(f.tv)}`;
      if (result.status === 'fulfilled' && result.value) {
        const q = result.value;
        return {
          symbol: f.symbol, short: f.short, name: f.name, tvSymbol: f.tv, tvUrl,
          price:     q.regularMarketPrice,
          open:      q.regularMarketOpen,
          high:      q.regularMarketDayHigh,
          low:       q.regularMarketDayLow,
          prevClose: q.regularMarketPreviousClose,
          change:    q.regularMarketChange,
          changePct: q.regularMarketChangePercent,
          volume:    q.regularMarketVolume,
          currency:  q.currency || 'USD',
          quoteTime: q.regularMarketTime
            ? new Date(q.regularMarketTime * 1000).toISOString()
            : new Date().toISOString(),
        };
      }
      return { symbol: f.symbol, short: f.short, name: f.name, tvSymbol: f.tv, tvUrl,
        error: result.reason?.message || 'Failed to fetch', price: null };
    });

    const data = { quotes, session, fetchedAt: new Date().toISOString(),
      count: quotes.filter(q => q.price).length };
    _quotesCache = { data, at: Date.now() };
    res.json({ ok: true, cached: false, data });

  } catch (err) {
    console.error('[Market quotes error]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── POST /api/market/setups ───────────────────────────────────
router.post('/setups', async (req, res) => {
  try {
    const groqKey = req.body?.groqKey;
    if (!groqKey) return res.status(400).json({ ok: false, error: 'groqKey required' });

    // Fetch quotes fresh if cache is stale
    if (!_quotesCache.data || (Date.now() - _quotesCache.at) > QUOTE_TTL) {
      
      const results = await Promise.allSettled(FUTURES.map(f => yahooFinance.quote(f.symbol)));
      const quotes = results.map((result, i) => {
        const f = FUTURES[i];
        const tvUrl = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(f.tv)}`;
        if (result.status === 'fulfilled' && result.value) {
          const q = result.value;
          return {
            symbol: f.symbol, short: f.short, name: f.name, tvSymbol: f.tv, tvUrl,
            price: q.regularMarketPrice, open: q.regularMarketOpen,
            high: q.regularMarketDayHigh, low: q.regularMarketDayLow,
            prevClose: q.regularMarketPreviousClose, change: q.regularMarketChange,
            changePct: q.regularMarketChangePercent, volume: q.regularMarketVolume,
            currency: q.currency || 'USD',
            quoteTime: q.regularMarketTime
              ? new Date(q.regularMarketTime * 1000).toISOString() : new Date().toISOString(),
          };
        }
        return { symbol: f.symbol, short: f.short, name: f.name, tvUrl, price: null };
      });
      const session2 = getSession();
      _quotesCache = { data: { quotes, session: session2, fetchedAt: new Date().toISOString(),
        count: quotes.filter(q => q.price).length }, at: Date.now() };
    }

    const session = getSession();
    const validQuotes = (_quotesCache.data?.quotes || []).filter(q => q.price);

    if (!validQuotes.length) {
      return res.status(503).json({ ok: false, error: 'Could not fetch live market data.' });
    }

    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      timeZone: 'America/Chicago'
    });
    const timeET = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short'
    });

    const marketContext = validQuotes.map(q => {
      const chg = q.changePct ? (q.changePct > 0 ? '+' : '') + q.changePct.toFixed(2) + '%' : 'N/A';
      const range = (q.high && q.low) ? `H:${q.high.toFixed(2)} / L:${q.low.toFixed(2)}` : '';
      const prev = q.prevClose ? `PrevClose:${q.prevClose.toFixed(2)}` : '';
      return `${q.short} (${q.name}): ${q.price?.toFixed(2)} (${chg}) | ${range} | ${prev}`;
    }).join('\n');

    const sessionWarning = session.session === 'rth'
      ? '\nNOTE: RTH session — 15-min delayed data. Trader must verify price before execution.'
      : `\nSession: ${session.label}`;

    const prompt = `You are an expert futures day trading coach analyzing REAL live market data.

Today: ${today} | Time: ${timeET}${sessionWarning}

CURRENT LIVE MARKET DATA (from Yahoo Finance):
${marketContext}

Using ONLY these real prices as your basis, generate 8 high-probability trade setups.
Calculate ALL entry, target, and stop levels mathematically from the real prices above.
Use proper market structure: key S/R based on today's range, previous close, round numbers, and fibonacci levels.

Format EXACTLY — one setup per block, separated by ---:
DIRECTION: [LONG or SHORT]
ASSET: [symbol and full name, e.g. "ES1! — S&P 500 Futures"]
PRICE_BASIS: [the current price you used, e.g. "Based on ES at 5,842.25"]
SETUP: [2 sentences: market structure rationale using real high/low/prev close levels]
ENTRY: [specific price level — must be near current price]
TARGET: [TP1] / [TP2]
STOP: [stop loss level — logical distance from entry]
TIMEFRAME: [15min / 1H / Daily]
RISK_REWARD: [ratio, e.g. 1:2.5]
CONFIDENCE: [High / Medium]
TV_NOTE: [one sentence on what to look for on the chart to confirm entry]
---
(8 total setups: ES, NQ, GC, CL, 6E, ZB, BTC, RTY)`;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2000,
        temperature: 0.3
      })
    });

    if (!groqRes.ok) {
      const errData = await groqRes.json();
      throw new Error(errData.error?.message || `Groq error ${groqRes.status}`);
    }

    const groqData = await groqRes.json();
    const setupText = groqData.choices[0].message.content;
    const tvLinks = {};
    validQuotes.forEach(q => { tvLinks[q.short] = q.tvUrl; });

    res.json({
      ok: true,
      data: {
        setups: setupText,
        quotes: validQuotes,
        session,
        tvLinks,
        generatedAt: new Date().toISOString(),
        generatedAtET: timeET,
        dataSource: 'Yahoo Finance',
        disclaimer: session.session === 'rth'
          ? '⚠ RTH SESSION: Data may be 15 min delayed. ALWAYS verify price on your broker platform before entering.'
          : '✅ Pre/After-market: Data is near real-time. Still verify before entry.',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
      }
    });

  } catch (err) {
    console.error('[Market setups error]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;