// api/meta-insights.js
// Meta Ads insights for the Berlin dashboard (koconsultings.com/bronson/ads):
// campaign, ad set and ad level, one row per day, straight from the Graph API.
// Uses this project's META_ACCESS_TOKEN / META_AD_ACCOUNT_ID; the token never
// leaves this server. Callers must send x-berlin-key (checked by hash).

const crypto = require('crypto');

const KEY_SHA256 = '87c09caab812dc2d596ac637c89d4b9ee567f3d8451a6bdecb98b428fca559b9';
const GRAPH = 'https://graph.facebook.com/v21.0';
const LEVELS = ['campaign', 'adset', 'ad'];
const FIELDS = [
  'campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name',
  'spend', 'impressions', 'reach', 'clicks', 'inline_link_clicks', 'frequency',
  'actions', 'video_thruplay_watched_actions',
].join(',');

function authorized(req) {
  const key = req.headers['x-berlin-key'];
  if (!key || typeof key !== 'string') return false;
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(KEY_SHA256));
}

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const action = (row, type) => {
  const a = (row.actions || []).find((x) => x.action_type === type);
  return a ? Number(a.value) || 0 : 0;
};

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' });

  const token = process.env.META_ACCESS_TOKEN;
  let account = process.env.META_AD_ACCOUNT_ID || '';
  if (!token || !account) return res.status(500).json({ error: 'Meta credentials not configured' });
  if (!account.startsWith('act_')) account = `act_${account}`;

  const level = LEVELS.includes(req.query.level) ? req.query.level : 'ad';
  const { since, until } = req.query;
  if (!isDate(since) || !isDate(until)) return res.status(400).json({ error: 'since and until must be YYYY-MM-DD' });

  const params = new URLSearchParams({
    level,
    fields: FIELDS,
    time_range: JSON.stringify({ since, until }),
    time_increment: '1',
    limit: '500',
    access_token: token,
  });
  // Statuses: status lookups come from the entity, not insights.
  let url = `${GRAPH}/${account}/insights?${params}`;
  const rows = [];
  try {
    for (let page = 0; url && page < 40; page++) {
      const r = await fetch(url);
      const body = await r.json();
      if (!r.ok) return res.status(502).json({ error: 'Meta API error', detail: body.error ? { message: body.error.message, code: body.error.code } : null });
      for (const x of body.data || []) {
        rows.push({
          date: x.date_start,
          campaignId: x.campaign_id || null,
          campaignName: x.campaign_name || null,
          adsetId: x.adset_id || null,
          adsetName: x.adset_name || null,
          adId: x.ad_id || null,
          adName: x.ad_name || null,
          spend: Number(x.spend) || 0,
          impressions: Number(x.impressions) || 0,
          reach: Number(x.reach) || 0,
          clicks: Number(x.clicks) || 0,
          linkClicks: Number(x.inline_link_clicks) || 0,
          frequency: x.frequency ? Number(x.frequency) : null,
          lpViews: action(x, 'landing_page_view'),
          video3s: action(x, 'video_view'),
          thruplays: ((x.video_thruplay_watched_actions || [])[0] || {}).value ? Number(x.video_thruplay_watched_actions[0].value) : 0,
          leads: action(x, 'lead'),
          registrations: action(x, 'offsite_conversion.fb_pixel_complete_registration') || action(x, 'complete_registration'),
          purchases: action(x, 'offsite_conversion.fb_pixel_purchase') || action(x, 'purchase'),
        });
      }
      url = body.paging && body.paging.next ? body.paging.next : null;
    }

    // Current status + daily budget per entity at this level.
    const idKey = level === 'campaign' ? 'campaignId' : level === 'adset' ? 'adsetId' : 'adId';
    const ids = [...new Set(rows.map((r) => r[idKey]).filter(Boolean))];
    const meta = {};
    for (let i = 0; i < ids.length; i += 50) {
      const q = new URLSearchParams({ ids: ids.slice(i, i + 50).join(','), fields: level === 'ad' ? 'effective_status' : 'effective_status,daily_budget', access_token: token });
      const r = await fetch(`${GRAPH}/?${q}`);
      if (!r.ok) break;
      const body = await r.json();
      for (const [id, v] of Object.entries(body)) {
        meta[id] = { status: v.effective_status || null, dailyBudget: v.daily_budget ? Number(v.daily_budget) / 100 : null };
      }
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ level, since, until, rows, entities: meta });
  } catch (err) {
    return res.status(500).json({ error: 'Failed', message: err.message });
  }
};
