/**
 * TWP Student Portal — Calendar Scraper Route
 * Add this file to your Render backend (kiranregmi-com-backend)
 * 
 * Setup:
 *   1. npm install axios cheerio tough-cookie axios-cookiejar-support
 *   2. Add to your server.js:
 *        const twpRoute = require('./twp-route');
 *        app.use('/api/twp', twpRoute);
 *   3. Set env vars on Render:
 *        TWP_USERNAME=your_twp_email
 *        TWP_PASSWORD=your_twp_password
 * 
 * Endpoints:
 *   GET /api/twp/events?month=2026-03   → returns events for that month
 *   GET /api/twp/events                 → returns events for current + next month
 */

const express  = require('express');
const axios    = require('axios');
const cheerio  = require('cheerio');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

const router = express.Router();

const TWP_BASE     = 'https://twpstudentportal.com';
const LOGIN_URL    = `${TWP_BASE}/wp-login.php`;
const CAL_URL      = `${TWP_BASE}/my-calendar-month/`;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache

// In-memory cache (resets on Render redeploy, which is fine)
let _cache = { events: null, fetchedAt: 0, cookies: null };

/* ── helpers ── */
function buildAxios() {
  const jar = new CookieJar();
  const client = wrapper(axios.create({
    jar,
    withCredentials: true,
    maxRedirects: 5,
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    }
  }));
  return { client, jar };
}

async function loginTWP(client) {
  const username = process.env.TWP_USERNAME;
  const password = process.env.TWP_PASSWORD;

  if (!username || !password) {
    throw new Error('TWP_USERNAME and TWP_PASSWORD env vars not set on Render');
  }

  // 1. GET login page to grab nonce/redirect fields
  const loginPage = await client.get(`${TWP_BASE}/?login=1`);
  const $l = cheerio.load(loginPage.data);

  // 2. Build form data — WordPress login
  const params = new URLSearchParams();
  params.append('log', username);
  params.append('pwd', password);
  params.append('wp-submit', 'Log In');
  params.append('redirect_to', CAL_URL);
  params.append('testcookie', '1');

  // 3. POST login
  const loginRes = await client.post(LOGIN_URL, params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': `${TWP_BASE}/?login=1`,
    }
  });

  // Check we got past the login
  if (loginRes.data.includes('Error logging in') || loginRes.data.includes('incorrect')) {
    throw new Error('TWP login failed — check TWP_USERNAME and TWP_PASSWORD on Render');
  }

  return true;
}

async function scrapeCalendar(client, monthStr) {
  // monthStr format: "2026-03"
  let url = CAL_URL;
  if (monthStr) {
    const [year, month] = monthStr.split('-');
    url = `${CAL_URL}?month=${month}&yr=${year}`;
  }

  const res = await client.get(url, {
    headers: { 'Referer': TWP_BASE }
  });

  const $ = cheerio.load(res.data);

  // Redirect to login = session failed
  if (res.data.includes('wp-login') || res.data.includes('Error logging in')) {
    throw new Error('Session expired — need to re-login');
  }

  const events = [];

  // The TWP portal uses a standard WordPress "My Calendar" plugin
  // Events appear as <td> cells with class "has-events" or event <a> links
  // We try multiple selectors to be robust

  // Strategy 1: .mc-events or .has-events li links
  $('[class*="has-event"] a, .mc-event a, .event-title a, td.calendar-day a').each(function() {
    const title = $(this).text().trim();
    const href  = $(this).attr('href') || '';
    if (!title) return;

    // Try to get the date from parent td
    const td = $(this).closest('td');
    const dayNum = td.find('.mc-day, .day-number, [class*="date"]').first().text().trim()
      || td.attr('data-date') || '';

    events.push({ title, href, day: dayNum });
  });

  // Strategy 2: grab date + event text from table cells directly
  $('td').each(function() {
    const cell = $(this);
    // Look for a date number in the cell
    const dateEl = cell.find('.mc-day, .day, [class*="date-number"]').first();
    if (!dateEl.length) return;
    const dayNum = dateEl.text().trim();
    if (!dayNum || isNaN(dayNum)) return;

    // Look for event links in this cell
    cell.find('a').each(function() {
      const title = $(this).text().trim();
      if (title && title !== dayNum && title.length > 2) {
        events.push({ title, day: dayNum, href: $(this).attr('href') || '' });
      }
    });
  });

  // Strategy 3: any list items with event-like classes
  $('li[class*="event"], .event-item, [class*="calendar-event"]').each(function() {
    const title = $(this).find('a, .event-title').first().text().trim() || $(this).text().trim();
    if (title && title.length > 2) {
      events.push({ title, day: '', href: '' });
    }
  });

  // Deduplicate
  const seen = new Set();
  const unique = events.filter(e => {
    const key = e.title + e.day;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Get the current year/month being displayed
  const calTitle = $('.mc-calendar caption, .calendar-title, h1, h2').first().text().trim();
  const pageMonth = monthStr || new Date().toISOString().slice(0, 7);

  return {
    month: pageMonth,
    title: calTitle,
    events: unique,
    scraped_at: new Date().toISOString(),
    raw_event_count: unique.length
  };
}

/* ── Route ── */
router.get('/events', async (req, res) => {
  try {
    const monthParam = req.query.month || null; // e.g. "2026-03"

    // Use cache if fresh (and no specific month requested)
    if (!monthParam && _cache.events && (Date.now() - _cache.fetchedAt) < CACHE_TTL_MS) {
      return res.json({ ok: true, cached: true, data: _cache.events });
    }

    const { client } = buildAxios();
    await loginTWP(client);

    // Scrape current month + next month if no specific month
    let data;
    if (monthParam) {
      data = await scrapeCalendar(client, monthParam);
    } else {
      const now = new Date();
      const m1 = now.toISOString().slice(0, 7);
      const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const m2 = next.toISOString().slice(0, 7);
      const [r1, r2] = await Promise.all([
        scrapeCalendar(client, m1),
        scrapeCalendar(client, m2)
      ]);
      data = {
        months: [r1, r2],
        scraped_at: new Date().toISOString(),
        total_events: r1.events.length + r2.events.length
      };
      // Update cache
      _cache = { events: data, fetchedAt: Date.now() };
    }

    res.json({ ok: true, cached: false, data });
  } catch (err) {
    console.error('[TWP proxy error]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Force cache refresh
router.post('/refresh', async (req, res) => {
  _cache = { events: null, fetchedAt: 0 };
  res.json({ ok: true, message: 'Cache cleared — next GET /api/twp/events will re-scrape' });
});

module.exports = router;