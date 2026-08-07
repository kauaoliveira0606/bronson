const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE  = 'appiMw8gpaLv2WITA';
const GHL_KEY        = process.env.GHL_API_KEY;
const LOCATION_ID    = process.env.GHL_LOCATION_ID;
const GHL_BASE       = 'https://services.leadconnectorhq.com';
const GHL_HEADERS    = { 'Authorization': `Bearer ${GHL_KEY}`, 'Version': '2021-07-28' };

async function getFirstCallAt(contactId, createdAt) {
  const r = await fetch(`${GHL_BASE}/conversations/search?locationId=${LOCATION_ID}&contactId=${contactId}&limit=20`, { headers: GHL_HEADERS });
  const d = await r.json();
  const convs = d.conversations || [];
  if (!convs.length) return null;

  const earliest = new Date(new Date(createdAt).getTime() - 5 * 60 * 1000);
  const allCalls = [];

  await Promise.all(convs.map(async conv => {
    const r2 = await fetch(`${GHL_BASE}/conversations/${conv.id}/messages?limit=100`, { headers: GHL_HEADERS });
    const d2 = await r2.json();
    const msgs = d2.messages?.messages || [];
    for (const m of msgs) {
      if (m.messageType === 'TYPE_CALL' && m.direction === 'outbound') {
        const t = new Date(m.dateAdded);
        if (t >= earliest) allCalls.push(t);
      }
    }
  }));

  allCalls.sort((a, b) => a - b);
  return allCalls[0] || null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const formula = encodeURIComponent(`AND({Status}="Pending",{Contact ID}!="")`);
  const r = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent('Speed to Lead')}?filterByFormula=${formula}&pageSize=5&sort[0][field]=Created%20At&sort[0][direction]=desc`,
    { headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` } }
  );
  const data = await r.json();
  const records = data.records || [];

  const results = await Promise.all(records.map(async rec => {
    const contactId = rec.fields['Contact ID'];
    const createdAt = rec.fields['Created At'];
    const name      = rec.fields['Name'];

    // Actually run the lookup
    let callFound = null;
    let lookupError = null;
    try {
      callFound = await getFirstCallAt(contactId, createdAt);
    } catch(e) {
      lookupError = e.message;
    }

    // If call found, attempt the Airtable PATCH and report result
    let patchStatus = null;
    if (callFound) {
      const minutes = parseFloat(((callFound - new Date(createdAt)) / 60000).toFixed(1));
      const status  = minutes <= 5 ? 'Under 5 min' : minutes <= 60 ? 'Under 1 Hour' : 'Over 1 Hour';
      const patchRes = await fetch(
        `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent('Speed to Lead')}/${rec.id}`,
        {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { 'First Call At': callFound.toISOString(), 'Minutes to Call': minutes, 'Status': status } }),
        }
      );
      const patchBody = await patchRes.json();
      patchStatus = { httpStatus: patchRes.status, body: patchBody };
    }

    return { name, contactId, createdAt, callFound: callFound?.toISOString() || null, lookupError, patchStatus };
  }));

  res.status(200).json({ results });
};
