const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE  = 'appiMw8gpaLv2WITA';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'AIRTABLE_TOKEN not set' });

  const today = new Date().toISOString().slice(0, 10);
  const formula = encodeURIComponent(`IS_SAME({Timestamp},"${today}","day")`);

  const r = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent('GHL Calls')}?filterByFormula=${formula}&pageSize=100`,
    { headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` } }
  );
  const data = await r.json();

  const reps = {};
  for (const record of data.records || []) {
    const rep = record.fields['Rep Name'] || 'Unknown';
    reps[rep] = (reps[rep] || 0) + 1;
  }

  const result = Object.entries(reps)
    .map(([rep, dials]) => ({ rep, dials }))
    .sort((a, b) => b.dials - a.dials);

  res.status(200).json(result);
};
