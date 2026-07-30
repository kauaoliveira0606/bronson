const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE  = 'appiMw8gpaLv2WITA';
const GHL_KEY        = process.env.GHL_API_KEY;
const LOCATION_ID    = process.env.GHL_LOCATION_ID;
const GHL_BASE       = 'https://services.leadconnectorhq.com';
const GHL_HEADERS    = { 'Authorization': `Bearer ${GHL_KEY}`, 'Version': '2021-07-28' };

async function getFirstOutboundCall(contactId, createdAt) {
  try {
    const r = await fetch(`${GHL_BASE}/conversations/search?locationId=${LOCATION_ID}&contactId=${contactId}`, { headers: GHL_HEADERS });
    const d = await r.json();
    const convId = d.conversations?.[0]?.id;
    if (!convId) return null;

    const r2 = await fetch(`${GHL_BASE}/conversations/${convId}/messages?limit=100`, { headers: GHL_HEADERS });
    const d2 = await r2.json();
    const msgs = d2.messages?.messages || [];

    const calls = msgs
      .filter(m => m.messageType === 'TYPE_CALL' && m.direction === 'outbound')
      .map(m => new Date(m.dateAdded))
      .filter(d => d >= new Date(createdAt))
      .sort((a, b) => a - b);

    return calls[0] || null;
  } catch { return null; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!AIRTABLE_TOKEN || !GHL_KEY) return res.status(500).json({ error: 'Missing env vars' });

  // Fetch all pending Speed to Lead records (no First Call At)
  const formula = encodeURIComponent(`AND({Status}="Pending",{Contact ID}!="")`);
  const r = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent('Speed to Lead')}?filterByFormula=${formula}&pageSize=100`,
    { headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` } }
  );
  const data = await r.json();
  const pending = data.records || [];

  if (pending.length === 0) return res.status(200).json({ synced: 0, message: 'No pending records' });

  let synced = 0;

  // Process in batches of 5 to avoid hammering GHL API
  for (let i = 0; i < pending.length; i += 5) {
    const batch = pending.slice(i, i + 5);
    await Promise.all(batch.map(async rec => {
      const contactId = rec.fields['Contact ID'];
      const createdAt = rec.fields['Created At'];
      if (!contactId || !createdAt) return;

      const callTime = await getFirstOutboundCall(contactId, createdAt);
      if (!callTime) return;

      const minutes = parseFloat(((callTime - new Date(createdAt)) / 60000).toFixed(1));
      const status  = minutes <= 5 ? 'Under 5 min' : minutes <= 60 ? 'Under 1 Hour' : 'Over 1 Hour';

      await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent('Speed to Lead')}/${rec.id}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { 'First Call At': callTime.toISOString(), 'Minutes to Call': minutes, 'Status': status } }),
      });
      synced++;
    }));
  }

  res.status(200).json({ synced, total: pending.length });
};
