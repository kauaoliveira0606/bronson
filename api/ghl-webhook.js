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
  const type = body.type || body.event || '';

  // New lead came in — log to Speed to Lead
  if (type === 'ContactCreated' || type === 'contact.created') {
    const c = body.contact || body;
    const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unknown';
    await airtablePost('Speed to Lead', {
      'Contact ID': String(c.id || c.contactId || ''),
      'Name':       name,
      'Phone':      c.phone || '',
      'Created At': new Date().toISOString(),
      'Status':     'Pending',
    });
  }

  // Outbound call made — log dial + update speed to lead
  const isCall = [
    'OutboundCall', 'outbound_call', 'CallStatusUpdated',
    'call_status_updated', 'NoteAdded', 'OutboundCallConnected',
  ].includes(type);

  if (isCall) {
    const contactId = String(body.contactId || body.contact?.id || '');
    const repName   = body.userName || body.user?.name || body.assignedTo || 'Unknown';
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
          'Status':          minutesToCall <= 5 ? 'Under 5 min' : 'Over 5 min',
        });
      }
    }
  }

  res.status(200).json({ ok: true });
};
