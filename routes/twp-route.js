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
const CACHE_TTL = 60 * 60 * 1000;

let _cache = { data: null, at: 0 };

function buildClient() {
  const jar = new CookieJar();
  return wrapper(axios.create({
    jar,
    withCredentials: true,
    maxRedirects: 10,
    timeout: 25000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
    }
  }));
}

async function loginTWP(client) {
  const username = process.env.TWP_USERNAME;
  const password = process.env.TWP_PASSWORD;
  if (!username || !password) {
    throw new Error('TWP_USERNAME and TWP_PASSWORD env vars not set on Render');
  }

  // Step 1: Fetch the login page to grab cookies + hidden fields
  console.log('[TWP] Fetching login page...');
  const loginPageRes = await client.get(`${TWP_BASE}/?login=1`, {
    headers: { 'Referer': TWP_BASE }
  });

  const $page = load(loginPageRes.data);

  // Extract hidden fields (nonce, redirect, etc)
  const hiddenFields = {};
  $page('form input[type="hidden"]').each(function () {
    const name = $page(this).attr('name');
    const val  = $page(this).attr('value') || '';
    if (name) hiddenFields[name] = val;
  });

  const formAction = $page('form').attr('action') || LOGIN_URL;
  console.log('[TWP] Form action:', formAction);
  console.log('[TWP] Hidden fields found:', Object.keys(hiddenFields));

  // Step 2: POST with credentials + all hidden fields
  const params = new URLSearchParams();
  params.append('log', username);
  params.append('pwd', password);
  params.append('wp-submit', 'Log In');
  params.append('redirect_to', CAL_URL);
  params.append('testcookie', '1');
  for (const [k, v] of Object.entries(hiddenFields)) {
    params.append(k, v);
  }

  console.log('[TWP] Posting login to:', formAction);
  const loginRes = await client.post(formAction, params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': `${TWP_BASE}/?login=1`,
      'Origin': TWP_BASE,
    }
  });

  const body = loginRes.data;
  const finalUrl = loginRes.request?.res?.responseUrl || '';
  console.log('[TWP] After login URL:', finalUrl);

  if (
    body.includes('Error logging in') ||
    body.includes('incorrect') ||
    body.includes('login_error') ||
    finalUrl.includes('wp-login.php')
  ) {
    const $err = load(body);
    const errMsg = $err('#login_error').text().trim() || 'Invalid credentials';
    throw new Error(`TWP login failed: ${errMsg}`);
  }

  console.log('[TWP] Login successful');
  return true;
}

async function scrapeMonth(client, monthStr) {
  const [year, month] = monthStr.split('-');
  const url = `${CAL_URL}?month=${month}&yr=${year}`;

  console.log('[TWP] Scraping:', url);
  const res = await client.get(url, { headers: { Referer: TWP_BASE } });

  if (res.data.includes('wp-login') || res.data.includes('Error logging in')) {
    throw new Error('Session expired after login');
  }

  const $ = load(res.data);
  const events = [];
  const seen = new Set();

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

  $('[class*="event-title"], [class*="event_title"], .event a').each(function () {
    const title = $(this).text().trim();
    const key = `:${title}`;
    if (title.length > 2 && !seen.has(key)) {
      seen.add(key);
      events.push({ title, day: '' });
    }
  });

  console.log(`[TWP] Found ${events.length} events for ${monthStr}`);
  return { month: monthStr, events, scraped_at: new Date().toISOString() };
}

// GET /api/twp/events
router.get('/events', async (req, res) => {
  try {
    const monthParam = req.query.month || null;
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
      const [r1, r2] = await Promise.all([scrapeMonth(client, m1), scrapeMonth(client, m2)]);
      data = { months: [r1, r2], total_events: r1.events.length + r2.events.length, scraped_at: new Date().toISOString() };
      _cache = { data, at: Date.now() };
    }
    res.json({ ok: true, cached: false, data });
  } catch (err) {
    console.error('[TWP error]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/twp/refresh
router.post('/refresh', (_req, res) => {
  _cache = { data: null, at: 0 };
  res.json({ ok: true, message: 'Cache cleared' });
});

// GET /api/twp/test — inspect login form structure (for debugging)
router.get('/test', async (req, res) => {
  try {
    const client = buildClient();
    const r = await client.get(`${TWP_BASE}/?login=1`);
    const $ = load(r.data);
    const forms = [];
    $('form').each(function () {
      const fields = [];
      $(this).find('input').each(function () {
        fields.push({
          name: $(this).attr('name'),
          type: $(this).attr('type'),
          value: $(this).attr('type') === 'password' ? '***' : $(this).attr('value')
        });
      });
      forms.push({ action: $(this).attr('action'), method: $(this).attr('method'), fields });
    });
    res.json({ ok: true, page_title: $('title').text(), forms });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;