/**
 * Test TWP scraper locally before deploying to Render
 * 
 * Usage:
 *   TWP_USERNAME="your@email.com" TWP_PASSWORD="yourpassword" node test-twp.js
 */

const axios   = require('axios');
const cheerio = require('cheerio');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

const TWP_BASE = 'https://twpstudentportal.com';
const LOGIN_URL = `${TWP_BASE}/wp-login.php`;
const CAL_URL   = `${TWP_BASE}/my-calendar-month/`;

async function test() {
  const username = process.env.TWP_USERNAME;
  const password = process.env.TWP_PASSWORD;

  if (!username || !password) {
    console.error('❌ Set TWP_USERNAME and TWP_PASSWORD env vars');
    process.exit(1);
  }

  console.log('🔐 Logging in as', username, '...');

  const jar = new CookieJar();
  const client = wrapper(axios.create({
    jar, withCredentials: true, maxRedirects: 5, timeout: 15000,
    headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120.0' }
  }));

  // Login
  const params = new URLSearchParams();
  params.append('log', username);
  params.append('pwd', password);
  params.append('wp-submit', 'Log In');
  params.append('redirect_to', CAL_URL);
  params.append('testcookie', '1');

  const loginRes = await client.post(LOGIN_URL, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': `${TWP_BASE}/?login=1` }
  });

  if (loginRes.data.includes('Error logging in')) {
    console.error('❌ Login failed — check credentials');
    process.exit(1);
  }
  console.log('✅ Login successful');

  // Fetch calendar
  console.log('📅 Fetching calendar...');
  const calRes = await client.get(CAL_URL, { headers: { Referer: TWP_BASE } });

  if (calRes.data.includes('wp-login')) {
    console.error('❌ Redirected to login — session not saved');
    process.exit(1);
  }

  const $ = cheerio.load(calRes.data);
  console.log('\n📄 Page title:', $('title').text().trim());
  console.log('📄 Calendar heading:', $('.mc-calendar caption, h1, h2').first().text().trim());

  // Show all links that look like events
  const links = [];
  $('a').each(function() {
    const text = $(this).text().trim();
    const href = $(this).attr('href') || '';
    if (text.length > 3 && !href.includes('wp-login') && !href.includes('resources') && !href.includes('support')) {
      links.push({ text, href });
    }
  });

  console.log('\n🔗 Potential event links found:', links.length);
  links.slice(0, 20).forEach(l => console.log(' -', l.text, '→', l.href));

  // Show all td cells
  let cellsWithContent = 0;
  $('td').each(function() {
    const text = $(this).text().trim();
    if (text.length > 5) cellsWithContent++;
  });
  console.log('\n📊 Table cells with content:', cellsWithContent);

  // Save raw HTML for inspection
  const fs = require('fs');
  fs.writeFileSync('/tmp/twp-calendar.html', calRes.data);
  console.log('\n💾 Raw HTML saved to /tmp/twp-calendar.html — inspect to tune selectors');
  console.log('\n✅ Test complete');
}

test().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});