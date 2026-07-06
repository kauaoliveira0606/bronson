const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE  = 'appiMw8gpaLv2WITA';
const AIRTABLE_TABLE = 'Affiliate EOD';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'AIRTABLE_TOKEN not set' });

  const filter = req.query.filter || 'today';
  let formula = '';
  const today = new Date().toISOString().slice(0, 10);

  if (filter === 'today') {
    formula = `?filterByFormula=IS_SAME({Date},"${today}","day")`;
  } else if (filter === 'week') {
    const start = new Date();
    start.setDate(start.getDate() - start.getDay());
    formula = `?filterByFormula=IS_AFTER({Date},"${start.toISOString().slice(0, 10)}")`;
  }

  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}${formula}&sort[0][field]=Date&sort[0][direction]=desc&sort[1][field]=Rep%20Name&sort[1][direction]=asc`;

  const r = await fetch(url, {
    headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` },
  });
  const data = await r.json();
  res.status(200).json(data.records || []);
};
