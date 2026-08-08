const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE  = 'app22YDOcrHhq1Q1j'; // Section 8 Playbook
const AIRTABLE_TABLE = 'Affiliate EOD';

function nyTodayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function nyWeekStartISO() {
  const nyStr = nyTodayISO();
  const [y, m, d] = nyStr.split('-').map(Number);
  const today = new Date(y, m - 1, d);
  const start = new Date(today);
  start.setDate(today.getDate() - today.getDay());
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'AIRTABLE_TOKEN not set' });

  const filter = req.query.filter || 'today';
  let formula = '';

  if (filter === 'today') {
    formula = `?filterByFormula=${encodeURIComponent(`IS_SAME({Date},"${nyTodayISO()}","day")`)}`;
  } else if (filter === 'week') {
    formula = `?filterByFormula=${encodeURIComponent(`IS_AFTER({Date},"${nyWeekStartISO()}")`)}`;
  }

  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(AIRTABLE_TABLE)}${formula}${formula ? '&' : '?'}sort[0][field]=Date&sort[0][direction]=desc&pageSize=100`;

  const r = await fetch(url, { headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` } });
  const data = await r.json();
  const raw = data.records || [];

  if (req.query.debug === '1') return res.status(200).json({ raw: raw.map(rec => rec.fields) });
  if (data.error) return res.status(500).json({ error: data.error });

  const records = raw.map(rec => {
    const f = rec.fields;
    return {
      name:              f['Your name'] || 'Unknown',
      date:              f['Date'] || null,
      outboundDials:     Number(f['Outbound dials']) || 0,
      cashHighTicket:    Number(f['Cash collected high ticket']) || 0,
      cashLowTicket:     Number(f['Cash collected low ticket']) || 0,
    };
  });

  const totals = records.reduce((acc, r) => {
    acc.outboundDials  += r.outboundDials;
    acc.cashHighTicket += r.cashHighTicket;
    acc.cashLowTicket  += r.cashLowTicket;
    return acc;
  }, { outboundDials: 0, cashHighTicket: 0, cashLowTicket: 0 });
  totals.cashTotal = totals.cashHighTicket + totals.cashLowTicket;

  // Per-rep rollup (a rep may have multiple submissions in a given window)
  const repMap = {};
  for (const r of records) {
    if (!repMap[r.name]) repMap[r.name] = { name: r.name, outboundDials: 0, cashHighTicket: 0, cashLowTicket: 0 };
    repMap[r.name].outboundDials  += r.outboundDials;
    repMap[r.name].cashHighTicket += r.cashHighTicket;
    repMap[r.name].cashLowTicket  += r.cashLowTicket;
  }
  const reps = Object.values(repMap)
    .map(r => ({ ...r, cashTotal: r.cashHighTicket + r.cashLowTicket }))
    .sort((a, b) => b.cashTotal - a.cashTotal);

  res.status(200).json({ filter, totals, reps, records });
};
