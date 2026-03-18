/**
 * Market Data + AI Trade Setups Route (ES Module)
 * File: routes/marketRoutes.js
 * Focus: Micro futures — small account
 */

import express from 'express';
import YahooFinance from 'yahoo-finance2';

const router = express.Router();
const yahooFinance = new YahooFinance();

router.get('/ping', (_req, res) => {
  res.json({ ok: true, message: 'market routes working' });
});

// Yahoo Finance carries full contract prices — same chart/levels, trade the micro.
const FUTURES = [
  { symbol: 'ES=F', short: 'MES', name: 'Micro S&P 500',    micro: 'MES', tv: 'CME_MINI:ES1!',  margin: '~$40',  tick: '$1.25/tick' },
  { symbol: 'NQ=F', short: 'MNQ', name: 'Micro Nasdaq 100', micro: 'MNQ', tv: 'CME_MINI:NQ1!',  margin: '~$40',  tick: '$0.50/tick' },
  { symbol: 'GC=F', short: 'MGC', name: 'Micro Gold',       micro: 'MGC', tv: 'COMEX:GC1!',     margin: '~$100', tick: '$1.00/tick' },
  { symbol: 'CL=F', short: 'MCL', name: 'Micro Crude Oil',  micro: 'MCL', tv: 'NYMEX:CL1!',     margin: '~$50',  tick: '$1.00/tick' },
];

function isDST(date) {
  const jan = new Date(date.getFullYear(), 0, 1).getTimezoneOffset();
  const jul = new Date(date.getFullYear(), 6, 1).getTimezoneOffset();
  return Math.max(jan, jul) !== date.getTimezoneOffset();
}

function getSession() {
  const now = new Date();
  const etOffset = isDST(now) ? -4 : -5;
  const etHour = (now.getUTCHours() + etOffset + 24) % 24;
  const etTime = etHour + now.getUTCMinutes() / 60;
  const dow = now.getUTCDay();
  if (dow === 0 || dow === 6) return { session: 'weekend',    label: 'Weekend',     safe: false };
  if (etTime >= 6   && etTime < 9.25) return { session: 'premarket',  label: 'Pre-Market',  safe: true  };
  if (etTime >= 9.5 && etTime < 16  ) return { session: 'rth',        label: 'RTH',         safe: false };
  if (etTime >= 16  && etTime < 18  ) return { session: 'afterhours', label: 'After Hours',  safe: true  };
  return { session: 'overnight', label: 'Overnight', safe: true };
}

let _quotesCache = { data: null, at: 0 };
const QUOTE_TTL = 5 * 60 * 1000;

async function fetchQuotes() {
  const results = await Promise.allSettled(FUTURES.map(f => yahooFinance.quote(f.symbol)));
  return results.map((result, i) => {
    const f = FUTURES[i];
    const tvUrl = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(f.tv)}`;
    if (result.status === 'fulfilled' && result.value) {
      const q = result.value;
      return {
        symbol: f.symbol, short: f.short, name: f.name,
        micro: f.micro, margin: f.margin, tick: f.tick,
        tvSymbol: f.tv, tvUrl,
        price: q.regularMarketPrice, open: q.regularMarketOpen,
        high: q.regularMarketDayHigh, low: q.regularMarketDayLow,
        prevClose: q.regularMarketPreviousClose,
        change: q.regularMarketChange, changePct: q.regularMarketChangePercent,
        volume: q.regularMarketVolume, currency: q.currency || 'USD',
        quoteTime: q.regularMarketTime
          ? new Date(q.regularMarketTime * 1000).toISOString() : new Date().toISOString(),
      };
    }
    return { symbol: f.symbol, short: f.short, name: f.name, micro: f.micro, margin: f.margin, tick: f.tick, tvUrl, price: null };
  });
}

router.get('/session', (_req, res) => {
  res.json({ ok: true, data: getSession(), timestamp: new Date().toISOString() });
});

router.get('/quotes', async (req, res) => {
  try {
    if (_quotesCache.data && (Date.now() - _quotesCache.at) < QUOTE_TTL)
      return res.json({ ok: true, cached: true, data: _quotesCache.data });
    const quotes = await fetchQuotes();
    const data = { quotes, session: getSession(), fetchedAt: new Date().toISOString(), count: quotes.filter(q => q.price).length };
    _quotesCache = { data, at: Date.now() };
    res.json({ ok: true, cached: false, data });
  } catch (err) {
    console.error('[quotes error]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/setups', async (req, res) => {
  try {
    const groqKey = req.body?.groqKey;
    if (!groqKey) return res.status(400).json({ ok: false, error: 'groqKey required' });

    if (!_quotesCache.data || (Date.now() - _quotesCache.at) > QUOTE_TTL) {
      const quotes = await fetchQuotes();
      _quotesCache = { data: { quotes, session: getSession(), fetchedAt: new Date().toISOString(), count: quotes.filter(q => q.price).length }, at: Date.now() };
    }

    const session = getSession();
    const validQuotes = (_quotesCache.data?.quotes || []).filter(q => q.price);
    if (!validQuotes.length) return res.status(503).json({ ok: false, error: 'No market data available.' });

    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago'
    });
    const timeET = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short'
    });

    const marketContext = validQuotes.map(q => {
      const chg = q.changePct ? (q.changePct > 0 ? '+' : '') + q.changePct.toFixed(2) + '%' : 'N/A';
      const vs = q.prevClose ? (q.price > q.prevClose ? 'ABOVE' : 'BELOW') + ' prev close ' + q.prevClose.toFixed(2) : '';
      return `${q.short} (${q.name}):
  Price: ${q.price?.toFixed(2)} (${chg}) | ${vs}
  Session H: ${q.high?.toFixed(2)} | Session L: ${q.low?.toFixed(2)} | Prev Close: ${q.prevClose?.toFixed(2)}
  Volume: ${q.volume?.toLocaleString() || 'N/A'}`;
    }).join('\n\n');

    const rthNote = session.session === 'rth'
      ? 'NOTE: RTH session — data may be 15 min delayed. State this in rationale.'
      : `Session: ${session.label}`;

    const prompt = `You are an expert futures day trading coach. Trader has a small account and trades MICRO contracts only (MES, MNQ, MGC, MCL).

${today} | ${timeET} | ${rthNote}

LIVE MARKET DATA (Yahoo Finance):
${marketContext}

Generate one detailed trade setup per instrument using ONLY the real prices above.

RULES:
- Calculate ALL price levels mathematically from the real H/L/PrevClose data
- RATIONALE must explain: where price is relative to prev close, what H/L tells us, and why this direction
- Each of the 3 confirmations must be a specific, actionable chart signal
- If no clear setup exists, DIRECTION: WAIT with explanation

Format — one block per instrument, separated by ---:
DIRECTION: [LONG or SHORT or WAIT]
ASSET: [Micro symbol — e.g. "MES — Micro S&P 500"]
BASIS: [e.g. "ES at 5,684.25 | H:5,692 L:5,668 PrevClose:5,671"]
RATIONALE: [2 sentences: where price closed relative to prev close, what overnight H/L structure tells us, and the setup reason]
ENTRY: [exact price level]
TARGET: [TP1] / [TP2]
STOP: [exact price level]
TIMEFRAME: [15min or 1H]
RR: [ratio e.g. 1:2.5]
C1: [confirmation 1 — specific candle pattern or price action signal]
C2: [confirmation 2 — volume or momentum signal]
C3: [confirmation 3 — indicator or structural confirmation e.g. VWAP, EMA, key level hold]
---
(4 setups: MES, MNQ, MGC, MCL)`;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1200,
        temperature: 0.2
      })
    });

    if (!groqRes.ok) {
      const e = await groqRes.json();
      throw new Error(e.error?.message || `Groq ${groqRes.status}`);
    }

    const setupText = (await groqRes.json()).choices[0].message.content;
    const tvLinks = {};
    validQuotes.forEach(q => { tvLinks[q.short] = q.tvUrl; });

    res.json({
      ok: true,
      data: {
        setups: setupText, quotes: validQuotes, session, tvLinks,
        generatedAt: new Date().toISOString(), generatedAtET: timeET,
        dataSource: 'Yahoo Finance',
        disclaimer: session.session === 'rth'
          ? '⚠ RTH — Verify price before entry.'
          : '✅ Near real-time. Verify before entry.',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
      }
    });

  } catch (err) {
    console.error('[setups error]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;