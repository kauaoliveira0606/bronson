const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE  = 'appiMw8gpaLv2WITA';

async function airtablePost(table, fields) {
  return fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(table)}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
}

async function airtablePatch(table, id, fields) {
  return fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(table)}/${id}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
}

async function findSpeedRecord(contactId) {
  const r = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent('Speed to Lead')}?filterByFormula=${encodeURIComponent(`{Contact ID}="${contactId}"`)}&maxRecords=1`,
    { headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` } }
  );
  const data = await r.json();
  return data.records?.[0] || null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).end();

  const body = req.body || {};
  // GHL sends contact_id for ContactCreated, no type field
  const isContactCreated = body.contact_id && (body.full_name || body.first_name) && !body.duration && !body.call_status && !body.direction;
  const isCall = body.direction || body.call_status || body.duration != null || body.type === 'OutboundCall' || body.type === 'CallStatusUpdated';

  // New lead came in — log to Speed to Lead
  if (isContactCreated) {
    const name = body.full_name || body.first_name || 'Unknown';
    await airtablePost('Speed to Lead', {
      'Contact ID': String(body.contact_id || ''),
      'Name':       name,
      'Phone':      body.phone || '',
      'Created At': body.date_created || new Date().toISOString(),
      'Status':     'Pending',
    });
  }

  if (isCall) {
    const contactId = String(body.contact_id || body.contactId || body.contact?.id || '');
    const repName   = body.userName || body.user?.name || body.userId || 'Unknown';
    const repId     = body.userId   || body.user?.id   || '';
    const duration  = Number(body.duration) || 0;
    const now       = new Date();

    // Log the dial
    await airtablePost('GHL Calls', {
      'Contact ID': contactId,
      'Rep Name':   repName,
      'Rep ID':     repId,
      'Timestamp':  now.toISOString(),
      'Duration':   duration,
    });

    // Update speed to lead if first call to this contact
    if (contactId) {
      const record = await findSpeedRecord(contactId);
      if (record && !record.fields['First Call At']) {
        const createdAt      = new Date(record.fields['Created At']);
        const minutesToCall  = parseFloat(((now - createdAt) / 60000).toFixed(1));
        await airtablePatch('Speed to Lead', record.id, {
          'First Call At':   now.toISOString(),
          'Minutes to Call': minutesToCall,
          'Status':          minutesToCall <= 5 ? 'Under 5 min' : minutesToCall <= 60 ? 'Under 1 Hour' : 'Over 1 Hour',
        });
      }
    }
  }

  // Log anything unrecognized so we can inspect the payload
  if (!isContactCreated && !isCall) {
    await airtablePost('GHL Webhook Log', {
      'Payload':     JSON.stringify(body),
      'Received At': new Date().toISOString(),
    }).catch(() => {});
  }

  res.status(200).json({ ok: true });
};
