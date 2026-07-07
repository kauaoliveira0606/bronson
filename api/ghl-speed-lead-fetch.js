const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE  = 'appiMw8gpaLv2WITA';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'AIRTABLE_TOKEN not set' });

  const today = new Date().toISOString().slice(0, 10);
  const formula = encodeURIComponent(`IS_SAME({Created At},"${today}","day")`);

  const r = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent('Speed to Lead')}?filterByFormula=${formula}&sort[0][field]=Created%20At&sort[0][direction]=desc&pageSize=100`,
    { headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` } }
  );
  const data = await r.json();
  res.status(200).json(data.records || []);
};
