const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE  = 'appiMw8gpaLv2WITA';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const r = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent('GHL Calls')}?pageSize=5&sort[0][field]=Timestamp&sort[0][direction]=desc`,
    { headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` } }
  );
  const data = await r.json();
  res.status(200).json({
    total: data.records?.length ?? 0,
    fields: data.records?.[0]?.fields ? Object.keys(data.records[0].fields) : [],
    sample: (data.records || []).map(r => r.fields),
    error: data.error || null,
  });
};
