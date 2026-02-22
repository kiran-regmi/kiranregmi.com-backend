// cloudflareRoutes.js
// Fetches live firewall/security events from Cloudflare GraphQL API
// ES Module format — matches server.js import/export syntax

import express from 'express';
const router  = express.Router();

const CF_TOKEN   = process.env.CLOUDFLARE_API_TOKEN;
const CF_ZONE_ID = process.env.CLOUDFLARE_ZONE_ID;
const GQL_URL    = 'https://api.cloudflare.com/client/v4/graphql';

const COUNTRY_COORDS = {
  US:{lat:37.09,lng:-95.71}, CN:{lat:35.86,lng:104.19}, RU:{lat:61.52,lng:105.31},
  DE:{lat:51.16,lng:10.45},  FR:{lat:46.22,lng:2.21},   NL:{lat:52.13,lng:5.29},
  GB:{lat:55.37,lng:-3.43},  JP:{lat:36.20,lng:138.25}, KR:{lat:35.90,lng:127.76},
  BR:{lat:-14.23,lng:-51.92},IN:{lat:20.59,lng:78.96},  CA:{lat:56.13,lng:-106.34},
  AU:{lat:-25.27,lng:133.77},SG:{lat:1.35,lng:103.81},  HK:{lat:22.39,lng:114.10},
  UA:{lat:48.37,lng:31.16},  PL:{lat:51.91,lng:19.14},  SE:{lat:60.12,lng:18.64},
  IT:{lat:41.87,lng:12.56},  ES:{lat:40.46,lng:-3.74},  TR:{lat:38.96,lng:35.24},
  IR:{lat:32.42,lng:53.68},  SA:{lat:23.88,lng:45.07},  AE:{lat:23.42,lng:53.84},
  EG:{lat:26.82,lng:30.80},  PK:{lat:30.37,lng:69.34},  IN:{lat:20.59,lng:78.96},
};

function getCoords(cc) { return COUNTRY_COORDS[cc] || { lat:0, lng:0 }; }

// GET /api/cloudflare/events
router.get('/events', async (req, res) => {
  if (!CF_TOKEN || !CF_ZONE_ID)
    return res.status(500).json({ error: 'Cloudflare credentials not configured' });

  const since = new Date(Date.now() - 24*60*60*1000).toISOString();
  const until = new Date().toISOString();

  const query = `{
    viewer {
      zones(filter: { zoneTag: "${CF_ZONE_ID}" }) {
        firewallEventsAdaptive(
          filter: { datetime_geq: "${since}", datetime_leq: "${until}" }
          limit: 100
          orderBy: [datetime_DESC]
        ) {
          action clientIP clientCountryName clientRequestPath
          clientRequestHTTPMethodName ruleId source datetime
        }
      }
    }
  }`;

  try {
    const r    = await fetch(GQL_URL, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${CF_TOKEN}` },
      body: JSON.stringify({ query })
    });
    const data = await r.json();
    if (data.errors) return res.status(500).json({ error:'Cloudflare API error', details:data.errors });

    const raw      = data?.data?.viewer?.zones?.[0]?.firewallEventsAdaptive || [];
    const enriched = raw.map(e => ({
      action:e.action, ip:e.clientIP, country:e.clientCountryName||'Unknown',
      path:e.clientRequestPath, method:e.clientRequestHTTPMethodName,
      rule:e.ruleId||e.source||'managed', timestamp:e.datetime,
      coords:getCoords(e.clientCountryName)
    }));

    const blocked    = enriched.filter(e=>e.action==='block').length;
    const challenged = enriched.filter(e=>['challenge','jschallenge','managed_challenge'].includes(e.action)).length;
    const labyrinth  = enriched.filter(e=>e.action==='labyrinth').length;

    const cc = {};
    enriched.forEach(e=>{ if(e.country&&e.country!=='Unknown') cc[e.country]=(cc[e.country]||0)+1; });
    const topCountries = Object.entries(cc).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([country,count])=>({country,count}));

    res.json({ success:true, summary:{ total:enriched.length, blocked, challenged, labyrinth, topCountries, since, until }, events:enriched });
  } catch(err) {
    console.error('CF fetch error:', err);
    res.status(500).json({ error:'Failed to fetch Cloudflare events' });
  }
});

// GET /api/cloudflare/stats
router.get('/stats', async (req, res) => {
  if (!CF_TOKEN || !CF_ZONE_ID)
    return res.status(500).json({ error: 'Cloudflare credentials not configured' });

  const since = new Date(Date.now() - 24*60*60*1000).toISOString();
  const until = new Date().toISOString();
  const query = `{ viewer { zones(filter: { zoneTag: "${CF_ZONE_ID}" }) {
    firewallEventsAdaptive(filter:{ datetime_geq:"${since}", datetime_leq:"${until}" } limit:500 orderBy:[datetime_DESC])
    { action clientCountryName datetime }
  }}}`;

  try {
    const r      = await fetch(GQL_URL, {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${CF_TOKEN}`},
      body:JSON.stringify({query})
    });
    const data   = await r.json();
    const events = data?.data?.viewer?.zones?.[0]?.firewallEventsAdaptive || [];
    const cc = {};
    events.forEach(e=>{ if(e.clientCountryName) cc[e.clientCountryName]=(cc[e.clientCountryName]||0)+1; });
    const top = Object.entries(cc).sort((a,b)=>b[1]-a[1])[0];
    res.json({
      success:true, total:events.length,
      blocked:events.filter(e=>e.action==='block').length,
      labyrinth:events.filter(e=>e.action==='labyrinth').length,
      topThreatCountry: top ? top[0] : 'N/A', since, until
    });
  } catch(err) {
    res.status(500).json({ error:'Failed to fetch stats' });
  }
});

export default router;