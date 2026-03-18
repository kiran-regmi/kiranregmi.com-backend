/**
 * Market Data + AI Trade Setups Route (ES Module)
 * File: routes/marketRoutes.js
 * Focus: Micro futures for small accounts
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
  const etMin  = now.getUTCMinutes();
  const etTime = etHour + etMin / 60;
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

    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' });
    const timeET = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' });

    const marketContext = validQuotes.map(q => {
      const chg = q.changePct ? (q.changePct > 0 ? '+' : '') + q.changePct.toFixed(2) + '%' : 'N/A';
      return `${q.short} (${q.name}): ${q.price?.toFixed(2)} (${chg}) | H:${q.high?.toFixed(2)} L:${q.low?.toFixed(2)} | Prev:${q.prevClose?.toFixed(2)}`;
    }).join('\n');

    const rthNote = session.session === 'rth' ? 'RTH — data may be 15 min delayed.' : `Session: ${session.label}`;

    const prompt = `Futures trading coach. Trader uses MICRO contracts, small account.
${today} | ${timeET} | ${rthNote}

LIVE PRICES:
${marketContext}

Generate one setup per instrument. Levels must come directly from the prices above.
Rationale: ONE sentence only using actual H/L/PrevClose numbers. No filler.

Format, separated by ---:
DIRECTION: [LONG or SHORT]
ASSET: [e.g. "MES — Micro S&P 500"]
BASIS: [e.g. "ES at 5,684.25"]
RATIONALE: [one sentence, real numbers only]
ENTRY: [price]
TARGET: [TP1] / [TP2]
STOP: [price]
TIMEFRAME: [15min or 1H]
RR: [ratio]
CONFIRM: [one chart signal]
---
(4 setups: MES, MNQ, MGC, MCL)`;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 600,
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