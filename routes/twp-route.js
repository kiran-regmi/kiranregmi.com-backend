/**
 * TWP Student Portal — Calendar Scraper Route (ES Module)
 * File: routes/twp-route.js
 */

import express from 'express';
import axios from 'axios';
import { load } from 'cheerio';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';

const router = express.Router();

const TWP_BASE  = 'https://twpstudentportal.com';
const LOGIN_URL = `${TWP_BASE}/wp-login.php`;
const CAL_URL   = `${TWP_BASE}/my-calendar-month/`;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

let _cache = { data: null, at: 0 };

function buildClient() {
  const jar = new CookieJar();
  const client = wrapper(axios.create({
    jar,
    withCredentials: true,
    maxRedirects: 5,
    timeout: 20000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    }
  }));
  return client;
}

async function loginTWP(client) {
  const username = process.env.TWP_USERNAME;
  const password = process.env.TWP_PASSWORD;

  if (!username || !password) {
    throw new Error('TWP_USERNAME and TWP_PASSWORD env vars not set on Render');
  }

  const params = new URLSearchParams();
  params.append('log', username);
  params.append('pwd', password);
  params.append('wp-submit', 'Log In');
  params.append('redirect_to', CAL_URL);
  params.append('testcookie', '1');

  const res = await client.post(LOGIN_URL, params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': `${TWP_BASE}/?login=1`,
    }
  });

  if (res.data.includes('Error logging in') || res.data.includes('incorrect')) {
    throw new Error('TWP login failed — check TWP_USERNAME and TWP_PASSWORD on Render');
  }
  return true;
}

async function scrapeMonth(client, monthStr) {
  const [year, month] = monthStr.split('-');
  const url = `${CAL_URL}?month=${month}&yr=${year}`;

  const res = await client.get(url, { headers: { Referer: TWP_BASE } });

  if (res.data.includes('wp-login') || res.data.includes('Error logging in')) {
    throw new Error('Session expired — re-login needed');
  }

  const $ = load(res.data);
  const events = [];
  const seen = new Set();

  // Strategy 1: cells with has-event class
  $('[class*="has-event"], [class*="has_event"]').each(function () {
    const cell = $(this);
    const dayNum = cell.find('[class*="day"], [class*="date"]').first().text().trim()
      || cell.attr('data-day') || '';
    cell.find('a').each(function () {
      const title = $(this).text().trim();
      const key = `${dayNum}:${title}`;
      if (title.length > 2 && !seen.has(key)) {
        seen.add(key);
        events.push({ title, day: dayNum });
      }
    });
  });

  // Strategy 2: table cells with day numbers and links
  $('td').each(function () {
    const cell = $(this);
    const dayNum = cell.find('.mc-day, .day-number, [class*="date"]').first().text().trim()
      || cell.attr('data-day') || '';
    if (!dayNum || isNaN(parseInt(dayNum))) return;
    cell.find('a').each(function () {
      const title = $(this).text().trim();
      const key = `${dayNum}:${title}`;
      if (title.length > 2 && title !== dayNum && !seen.has(key)) {
        seen.add(key);
        events.push({ title, day: dayNum });
      }
    });
  });

  // Strategy 3: event title elements
  $('[class*="event-title"], [class*="event_title"], .event a').each(function () {
    const title = $(this).text().trim();
    const key = `:${title}`;
    if (title.length > 2 && !seen.has(key)) {
      seen.add(key);
      events.push({ title, day: '' });
    }
  });

  return {
    month: monthStr,
    events,
    scraped_at: new Date().toISOString()
  };
}

// GET /api/twp/events
// GET /api/twp/events?month=2026-03
router.get('/events', async (req, res) => {
  try {
    const monthParam = req.query.month || null;

    // Return cache if fresh and no specific month requested
    if (!monthParam && _cache.data && (Date.now() - _cache.at) < CACHE_TTL) {
      return res.json({ ok: true, cached: true, data: _cache.data });
    }

    const client = buildClient();
    await loginTWP(client);

    let data;
    if (monthParam) {
      data = await scrapeMonth(client, monthParam);
    } else {
      const now  = new Date();
      const m1   = now.toISOString().slice(0, 7);
      const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const m2   = next.toISOString().slice(0, 7);
      const [r1, r2] = await Promise.all([
        scrapeMonth(client, m1),
        scrapeMonth(client, m2)
      ]);
      data = {
        months: [r1, r2],
        total_events: r1.events.length + r2.events.length,
        scraped_at: new Date().toISOString()
      };
      _cache = { data, at: Date.now() };
    }

    res.json({ ok: true, cached: false, data });
  } catch (err) {
    console.error('[TWP error]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/twp/refresh — force cache clear
router.post('/refresh', (_req, res) => {
  _cache = { data: null, at: 0 };
  res.json({ ok: true, message: 'Cache cleared — next request will re-scrape' });
});

export default router;