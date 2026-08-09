const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE  = 'appiMw8gpaLv2WITA';
const AIRTABLE_TABLE = 'Leads';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'AIRTABLE_TOKEN not set' });

  const days = parseInt(req.query.days || '1', 10);
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = new Date();
  if (days > 0) cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  let records = [], offset = null;
  do {
    let url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(AIRTABLE_TABLE)}?pageSize=100&sort[0][field]=Created At&sort[0][direction]=desc`;
    if (offset) url += `&offset=${offset}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
    const data = await r.json();
    if (data.error) return res.status(500).json(data);
    records = records.concat(data.records || []);
    offset = data.offset;
  } while (offset);

  // group by day and source
  const byDay = {};
  for (const rec of records) {
    const raw = rec.fields['Created At'] || '';
    const day = raw.slice(0, 10);
    if (!day) continue;
    if (days === 0 && day !== today) continue;
    if (days > 0 && day < cutoffStr) continue;
    const source = (rec.fields['Source'] || '').toLowerCase();
    if (!byDay[day]) byDay[day] = { paid: 0, organic: 0 };
    if (source === 'paid') byDay[day].paid++;
    else if (source === 'organic') byDay[day].organic++;
  }

  // sort days descending and return as array
  const rows = Object.keys(byDay).sort((a, b) => b.localeCompare(a)).map(day => ({
    date: day,
    paid: byDay[day].paid,
    organic: byDay[day].organic,
    total: byDay[day].paid + byDay[day].organic,
  }));

  res.status(200).json({ rows });
};
