# TWP Calendar Proxy — Setup Guide

## How it works
Your Render backend logs into twpstudentportal.com using your credentials,
scrapes the calendar page, and returns events as clean JSON.
office.html then reads from your own backend (no CORS issues).

---

## Step 1 — Add files to your backend repo

Copy `twp-route.js` into your backend project root (same folder as server.js / index.js).

---

## Step 2 — Install dependencies

In your backend project:
```bash
npm install axios cheerio tough-cookie axios-cookiejar-support
```

---

## Step 3 — Register the route in server.js

Add these lines to your existing `server.js` or `index.js`:

```javascript
const twpRoute = require('./twp-route');
app.use('/api/twp', twpRoute);
```

Make sure it's AFTER your CORS middleware so office.html can reach it.

---

## Step 4 — Set env vars on Render

In your Render dashboard → your backend service → Environment:

| Key           | Value                    |
|---------------|--------------------------|
| TWP_USERNAME  | your TWP login email     |
| TWP_PASSWORD  | your TWP login password  |

---

## Step 5 — Test locally first (optional)

```bash
TWP_USERNAME="your@email.com" TWP_PASSWORD="yourpassword" node test-twp.js
```

This will:
- Log into TWP
- Fetch the calendar page
- Print all found links/events
- Save raw HTML to /tmp/twp-calendar.html so you can inspect the DOM

If events are found → deploy to Render.
If nothing found → share /tmp/twp-calendar.html with me and I'll tune the selectors.

---

## Step 6 — Deploy to Render

Push your changes. Render auto-deploys.

Test the endpoint:
```
https://kiranregmi-com-backend.onrender.com/api/twp/events
https://kiranregmi-com-backend.onrender.com/api/twp/events?month=2026-03
```

---

## Step 7 — Wire into office.html

I'll add a "Sync TWP" button to the TWP section of My Day that calls this endpoint
and imports events directly into your local calendar storage.

---

## API Response

```json
{
  "ok": true,
  "cached": false,
  "data": {
    "months": [
      {
        "month": "2026-03",
        "events": [
          { "title": "Market Structure Live", "day": "17", "href": "..." },
          { "title": "Trading Lab", "day": "19", "href": "..." }
        ],
        "scraped_at": "2026-03-17T..."
      }
    ],
    "total_events": 12
  }
}
```

---

## Caching
Events are cached for 1 hour in memory. Force refresh:
```
POST https://kiranregmi-com-backend.onrender.com/api/twp/refresh
```

---

## Notes
- Render free tier sleeps after 15 min inactivity — first call may take ~10s to wake up
- The scraper handles both the standard WordPress "My Calendar" plugin layout
  and custom TWP portal layouts
- If the portal updates their HTML, share the raw page and I'll update selectors