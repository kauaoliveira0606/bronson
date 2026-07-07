const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE  = 'appiMw8gpaLv2WITA';
const GHL_KEY        = process.env.GHL_API_KEY;
const LOCATION_ID    = process.env.GHL_LOCATION_ID;
const GHL_BASE       = 'https://services.leadconnectorhq.com';
const GHL_HEADERS    = { 'Authorization': `Bearer ${GHL_KEY}`, 'Version': '2021-07-28' };

// Get the earliest outbound call timestamp for a contact from GHL
async function getFirstCallAt(contactId, createdAt) {
  try {
    const r = await fetch(`${GHL_BASE}/contacts/${contactId}/conversations`, { headers: GHL_HEADERS });
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
  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'AIRTABLE_TOKEN not set' });

  const filter = req.query.filter || 'today';
  const now    = new Date();
  let cutoff   = new Date();

  if (filter === '3days') cutoff.setDate(now.getDate() - 2);
  else if (filter === '7days') cutoff.setDate(now.getDate() - 6);
  else cutoff.setHours(0, 0, 0, 0);

  const formula = encodeURIComponent(`IS_AFTER({Created At},"${cutoff.toISOString()}")`);
  const r = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent('Speed to Lead')}?filterByFormula=${formula}&sort[0][field]=Created%20At&sort[0][direction]=desc&pageSize=100`,
    { headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` } }
  );
  const data = await r.json();
  const raw = data.records || [];

  // For each record, check GHL directly if no First Call At yet
  const records = await Promise.all(raw.map(async rec => {
    const f = rec.fields;
    let firstCallAt = f['First Call At'] || null;
    let minutes     = f['Minutes to Call'] ?? null;
    let status      = f['Status'] || 'Pending';

    if (!firstCallAt && f['Contact ID'] && GHL_KEY) {
      const callTime = await getFirstCallAt(f['Contact ID'], f['Created At']);
      if (callTime) {
        firstCallAt  = callTime.toISOString();
        minutes      = parseFloat(((callTime - new Date(f['Created At'])) / 60000).toFixed(1));
        status       = minutes <= 5 ? 'Under 5 min' : minutes <= 60 ? 'Under 1 Hour' : 'Over 1 Hour';

        // Update Airtable record so future fetches don't need to re-check GHL
        fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent('Speed to Lead')}/${rec.id}`, {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { 'First Call At': firstCallAt, 'Minutes to Call': minutes, 'Status': status } }),
        }).catch(() => {});
      }
    }

    return {
      name:        f['Name']      || '—',
      phone:       f['Phone']     || '—',
      createdAt:   f['Created At']|| null,
      firstCallAt,
      minutes,
      status,
    };
  }));

  const total     = records.length;
  const called    = records.filter(r => r.firstCallAt);
  const notCalled = records.filter(r => !r.firstCallAt);
  const under5    = called.filter(r => (r.minutes || 0) <= 5);
  const under60   = called.filter(r => { const m = r.minutes || 0; return m > 5 && m <= 60; });
  const over60    = called.filter(r => (r.minutes || 0) > 60);
  const avgMinutes = called.length > 0
    ? called.reduce((sum, r) => sum + (r.minutes || 0), 0) / called.length
    : null;
  const pct = n => total > 0 ? ((n / total) * 100).toFixed(1) : '0.0';

  res.status(200).json({
    total,
    avgMinutes:  avgMinutes !== null ? parseFloat(avgMinutes.toFixed(1)) : null,
    under5:    { count: under5.length,    pct: pct(under5.length) },
    under60:   { count: under60.length,   pct: pct(under60.length) },
    over60:    { count: over60.length,    pct: pct(over60.length) },
    notCalled: { count: notCalled.length, pct: pct(notCalled.length) },
    records,
  });
};
