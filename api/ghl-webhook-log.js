const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE  = 'appiMw8gpaLv2WITA';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const body = req.body || {};

  if (AIRTABLE_TOKEN) {
    await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent('GHL Webhook Log')}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { 'Payload': JSON.stringify(body), 'Received At': new Date().toISOString() } }),
    }).catch(() => {});
  }

  res.status(200).json({ ok: true, received: body });
};
