const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE  = 'appiMw8gpaLv2WITA';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const records = [];
    let offset = '';
    do {
      const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent('Affiliates PCN')}?pageSize=100${offset ? '&offset=' + encodeURIComponent(offset) : ''}`;
      const r = await fetch(url, { headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` } });
      const data = await r.json();
      if (data.error) return res.status(500).json({ error: typeof data.error === 'string' ? data.error : JSON.stringify(data.error) });
      (data.records || []).forEach(rec => records.push(rec.fields));
      offset = data.offset || '';
    } while (offset);

    const counts = {};
    records.forEach(f => {
      const plan = (f['plan?'] || 'Unknown').trim();
      counts[plan] = (counts[plan] || 0) + 1;
    });

    const total = records.length;
    const breakdown = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([plan, count]) => ({ plan, count, pct: total > 0 ? Math.round((count / total) * 100) : 0 }));

    res.status(200).json({ total, breakdown });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
