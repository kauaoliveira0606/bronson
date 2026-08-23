const GHL_KEY     = process.env.GHL_API_KEY;
const LOCATION_ID = process.env.GHL_LOCATION_ID;
const GHL_BASE    = 'https://services.leadconnectorhq.com';
const GHL_HEADERS = { 'Authorization': `Bearer ${GHL_KEY}`, 'Version': '2021-07-28' };

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!GHL_KEY) return res.status(500).json({ error: 'GHL_API_KEY not set' });
  try {
    const r = await fetch(`${GHL_BASE}/opportunities/pipelines?locationId=${LOCATION_ID}`, { headers: GHL_HEADERS });
    const data = await r.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
