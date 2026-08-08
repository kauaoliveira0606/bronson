const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE  = 'appiMw8gpaLv2WITA';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const r = await fetch(
    `https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE}/tables`,
    { headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` } }
  );
  const data = await r.json();
  const names = (data.tables || []).map(t => t.name);
  res.status(200).json({ tables: names, raw: data.error || null });
};
