const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE  = 'appiMw8gpaLv2WITA';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const table = req.query.table || 'Affiliate EOD';
  const sort = req.query.sort || '';
  try {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(table)}?pageSize=5${sort}`;
    const r = await fetch(url, { headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` } });
    const data = await r.json();
    if (data.error) return res.status(500).json({ error: data.error });
    res.status(200).json({ records: (data.records || []).map(rec => rec.fields) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
