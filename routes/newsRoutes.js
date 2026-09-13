// routes/newsRoutes.js
// ─────────────────────────────────────────────────────────────
//  Live news aggregator for news.html — fetches CNBC and Investing.com RSS
//  on every request and parses them fresh. Nothing is stored; matches the
//  "real-time, no archive" requirement for the Daily News page.
//  GET /api/news — public
//
//  Uses axios + cheerio, both already dependencies in this project (no new
//  packages needed). cheerio parses the RSS XML the same way it'd parse HTML.
// ─────────────────────────────────────────────────────────────

import express from "express";
import axios from "axios";
import * as cheerio from "cheerio";

const router = express.Router();

const FEEDS = [
  { url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", source: "CNBC" },
  { url: "https://www.cnbc.com/id/20409666/device/rss/rss.html",  source: "CNBC" },
  { url: "https://www.investing.com/rss/news_25.rss",             source: "Investing.com" },
  { url: "https://www.investing.com/rss/news_1.rss",              source: "Investing.com" },
];

const MAX_ITEMS_PER_FEED = 8;
const MAX_TOTAL_ITEMS = 25;

function formatDate(pubDate) {
  const d = new Date(pubDate);
  if (isNaN(d.getTime())) return pubDate; // fall back to raw string if unparseable
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
    timeZoneName: "short",
  });
}

async function fetchFeed({ url, source }) {
  try {
    const res = await axios.get(url, {
      timeout: 6000,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; kiranregmi.com news widget)" },
    });
    const $ = cheerio.load(res.data, { xmlMode: true });
    const items = [];

    $("item").slice(0, MAX_ITEMS_PER_FEED).each((_, el) => {
      const title = $(el).find("title").first().text().trim();
      const link = $(el).find("link").first().text().trim();
      const pubDate = $(el).find("pubDate").first().text().trim();
      if (title && link) {
        items.push({
          title,
          link,
          source,
          date: formatDate(pubDate),
          _sortTime: new Date(pubDate).getTime() || 0,
        });
      }
    });

    return items;
  } catch (err) {
    console.warn(`News feed failed (${source}, ${url}):`, err.message);
    return []; // one feed failing shouldn't take down the whole response
  }
}

// ─────────────────────────────────────────
//  GET /api/news — public
// ─────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const results = await Promise.all(FEEDS.map(fetchFeed));
    const allItems = results.flat();

    if (allItems.length === 0) {
      return res.status(502).json({ message: "Failed to load news from any source right now" });
    }

    allItems.sort((a, b) => b._sortTime - a._sortTime);
    const items = allItems.slice(0, MAX_TOTAL_ITEMS).map(({ _sortTime, ...rest }) => rest);

    res.json({ items, count: items.length });
  } catch (err) {
    console.error("News aggregation error:", err);
    res.status(502).json({ message: "Failed to load news right now" });
  }
});

export default router;
