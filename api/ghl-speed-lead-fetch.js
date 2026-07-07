const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE  = 'appiMw8gpaLv2WITA';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'AIRTABLE_TOKEN not set' });

  const filter = req.query.filter || 'today';
  const now    = new Date();
  let cutoff   = new Date();

  if (filter === '3days') cutoff.setDate(now.getDate() - 2);
  else if (filter === '7days') cutoff.setDate(now.getDate() - 6);
  else cutoff.setHours(0, 0, 0, 0); // today

  const formula = encodeURIComponent(`IS_AFTER({Created At},"${cutoff.toISOString()}")`);
  const r = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent('Speed to Lead')}?filterByFormula=${formula}&sort[0][field]=Created%20At&sort[0][direction]=desc&pageSize=100`,
    { headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` } }
  );
  const data = await r.json();
  const records = data.records || [];

  const total     = records.length;
  const called    = records.filter(rec => rec.fields['First Call At']);
  const notCalled = records.filter(rec => !rec.fields['First Call At']);
  const under5    = called.filter(rec => (rec.fields['Minutes to Call'] || 0) <= 5);
  const under60   = called.filter(rec => { const m = rec.fields['Minutes to Call'] || 0; return m > 5 && m <= 60; });
  const over60    = called.filter(rec => (rec.fields['Minutes to Call'] || 0) > 60);

  const avgMinutes = called.length > 0
    ? called.reduce((sum, rec) => sum + (rec.fields['Minutes to Call'] || 0), 0) / called.length
    : null;

  const pct = (n) => total > 0 ? ((n / total) * 100).toFixed(1) : '0.0';

  res.status(200).json({
    total,
    avgMinutes:  avgMinutes !== null ? parseFloat(avgMinutes.toFixed(1)) : null,
    under5:      { count: under5.length,    pct: pct(under5.length) },
    under60:     { count: under60.length,   pct: pct(under60.length) },
    over60:      { count: over60.length,    pct: pct(over60.length) },
    notCalled:   { count: notCalled.length, pct: pct(notCalled.length) },
    records: records.map(rec => ({
      name:        rec.fields['Name']           || '—',
      phone:       rec.fields['Phone']          || '—',
      createdAt:   rec.fields['Created At']     || null,
      firstCallAt: rec.fields['First Call At']  || null,
      minutes:     rec.fields['Minutes to Call'] ?? null,
      status:      rec.fields['Status']         || 'Pending',
    })),
  });
};
