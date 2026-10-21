// Latest masterclass registrants from WebinarJam, for the "X registered" popup on
// /masterclass and /masterclass-paid. Returns first names and signup times only.
const WEBINAR_ID = 2;

// WebinarJam's signup_date is New York time, e.g. "Wed, 21 Oct 2026, 07:26 AM".
function parseNyDate(text) {
  const m = /(\d{1,2}) (\w{3}) (\d{4}), (\d{1,2}):(\d{2}) (AM|PM)/.exec(text || '');
  if (!m) return null;
  const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  let hour = Number(m[4]) % 12;
  if (m[6] === 'PM') hour += 12;
  const asUtc = Date.UTC(Number(m[3]), months[m[2]], Number(m[1]), hour, Number(m[5]));
  // New York's offset at that moment.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric'
  }).formatToParts(new Date(asUtc));
  const p = {};
  parts.forEach(function (x) { p[x.type] = x.value; });
  const nyAsUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  return asUtc + (asUtc - nyAsUtc);
}

// First word of the first name, capitalised; null for anything that isn't a plain name.
function cleanName(raw) {
  const first = String(raw || '').trim().split(/\s+/)[0] || '';
  if (!/^[A-Za-zÀ-ÿ'-]{2,20}$/.test(first) || /^test/i.test(first)) return null;
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

module.exports = async function handler(req, res) {
  const key = process.env.WEBINARJAM_API_KEY;
  if (!key) return res.status(500).json({ error: 'Missing WEBINARJAM_API_KEY' });

  try {
    const url = 'https://api.webinarjam.com/webinarjam/registrants?api_key=' + encodeURIComponent(key) +
      '&webinar_id=' + WEBINAR_ID + '&page=1';
    const r = await fetch(url, { method: 'POST' });
    const data = await r.json();
    const rows = (data.registrants && data.registrants.data) || [];
    const out = [];
    rows.forEach(function (row) {
      const name = cleanName(row.first_name);
      const at = parseNyDate(row.signup_date);
      if (!name || !at) return;
      out.push({ name: name, at: at });
    });
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ registrants: out });
  } catch (err) {
    console.log('recent-registrants error:', err && err.message);
    return res.status(502).json({ error: 'WebinarJam request failed' });
  }
};
