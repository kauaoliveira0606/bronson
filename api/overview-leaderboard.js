const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE  = 'appiMw8gpaLv2WITA';
const EOD_TABLE       = 'Affiliate EOD';

async function fetchAllRecords(table) {
  let all = [], offset = null;
  do {
    const params = new URLSearchParams({ pageSize: '100' });
    if (offset) params.set('offset', offset);
    const r = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(table)}?${params}`, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
    });
    const d = await r.json();
    if (d.error) throw new Error(`${table}: ${JSON.stringify(d.error)}`);
    all = all.concat(d.records || []);
    offset = d.offset || null;
  } while (offset);
  return all;
}

function num(v) {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function nyYMD(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(date);
}

function addDaysYMD(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function resolveRange(key, customStart, customEnd) {
  const today = nyYMD(new Date());
  switch (key) {
    case 'Today':        return { start: today, end: today };
    case 'Yesterday':    { const y = addDaysYMD(today, -1); return { start: y, end: y }; }
    case 'Last 7 Days':  return { start: addDaysYMD(today, -6), end: today };
    case 'Last 30 Days': return { start: addDaysYMD(today, -29), end: today };
    case 'All Time':     return { start: '0000-01-01', end: '9999-12-31' };
    case 'Custom':       return { start: customStart || today, end: customEnd || today };
    default:              return { start: today, end: today };
  }
}

function inRange(dateStr, range) {
  const d = String(dateStr || '').slice(0, 10);
  if (!d) return false;
  return d >= range.start && d <= range.end;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'AIRTABLE_TOKEN not set' });

  const key = req.query.range || 'Today';
  const range = resolveRange(key, req.query.start, req.query.end);

  try {
    const all = await fetchAllRecords(EOD_TABLE);
    const rows = all.filter(r => inRange(r.fields['Date'], range));

    const byRep = {};
    for (const r of rows) {
      const rep = String(r.fields['Your name'] ?? 'Unknown');
      if (!byRep[rep]) byRep[rep] = { softwareClosed: 0, outboundDials: 0, cashCollected: 0 };
      byRep[rep].softwareClosed += num(r.fields['software closed']);
      byRep[rep].outboundDials  += num(r.fields['Outbound dials']);
      byRep[rep].cashCollected  += num(r.fields['Cash collected affiliate']) + num(r.fields['cash collected high ticket']);
    }

    const leaderboard = Object.entries(byRep)
      .map(([rep, s]) => ({ rep, ...s }))
      .sort((a, b) => b.softwareClosed - a.softwareClosed);

    res.status(200).json({ leaderboard });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
