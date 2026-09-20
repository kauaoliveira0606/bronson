const AIRTABLE_TOKEN  = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE   = 'appiMw8gpaLv2WITA';
const LEADS_TABLE      = 'Leads';
const MARKETING_TABLE  = 'Marketing Daily Metrics';

async function fetchAllRecords(table) {
  let all = [], offset = null;
  do {
    const params = new URLSearchParams({ pageSize: '100' });
    if (offset) params.set('offset', offset);
    const r = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(table)}?${params}`, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
    });
    const d = await r.json();
    if (d.error) throw new Error(`${table}: ${JSON.stringify(d.error)}`);
    all = all.concat(d.records || []);
    offset = d.offset || null;
  } while (offset);
  return all;
}

function num(v) {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function div(a, b) {
  return b > 0 ? a / b : null;
}

function nyYMD(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(date);
}

function addDaysYMD(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function resolveRange(key, customStart, customEnd) {
  const today = nyYMD(new Date());
  switch (key) {
    case 'Today':        return { start: today, end: today };
    case 'Yesterday':    { const y = addDaysYMD(today, -1); return { start: y, end: y }; }
    case 'Last 7 Days':  return { start: addDaysYMD(today, -6), end: today };
    case 'Last 30 Days': return { start: addDaysYMD(today, -29), end: today };
    case 'All Time':     return { start: '0000-01-01', end: '9999-12-31' };
    case 'Custom':       return { start: customStart || today, end: customEnd || today };
    default:              return { start: today, end: today };
  }
}

function inRange(dateStr, range) {
  const d = String(dateStr || '').slice(0, 10);
  if (!d) return false;
  return d >= range.start && d <= range.end;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'AIRTABLE_TOKEN not set' });

  const key = req.query.range || 'Yesterday';
  const range = resolveRange(key, req.query.start, req.query.end);

  try {
    const [leadsAll, marketingAll] = await Promise.all([
      fetchAllRecords(LEADS_TABLE),
      fetchAllRecords(MARKETING_TABLE),
    ]);

    const leads     = leadsAll.filter(r => inRange(r.fields['Created At'], range));
    const marketing = marketingAll.filter(r => inRange(r.fields['Date'], range));

    const byDay = {};
    let paidLeads = 0, organicLeads = 0, unlabeled = 0;
    let cashPaid = 0, cashOrganic = 0;

    for (const rec of leads) {
      const day = String(rec.fields['Created At'] ?? '').slice(0, 10);
      const source = String(rec.fields['Source'] ?? '').toLowerCase();
      const cash = num(rec.fields['Cash Collected']);
      if (!byDay[day]) byDay[day] = { paid: 0, organic: 0 };
      if (source === 'paid') {
        paidLeads++;
        cashPaid += cash;
        if (day) byDay[day].paid++;
      } else if (source === 'organic') {
        organicLeads++;
        cashOrganic += cash;
        if (day) byDay[day].organic++;
      } else {
        unlabeled++;
      }
    }

    const rows = Object.keys(byDay)
      .sort((a, b) => b.localeCompare(a))
      .map(day => ({ date: day, paid: byDay[day].paid, organic: byDay[day].organic, total: byDay[day].paid + byDay[day].organic }));

    const adSpendMeta = marketing.reduce((s, r) => s + num(r.fields['Ad Spend Meta']), 0);
    const paidRoas = div(cashPaid, adSpendMeta);
    const costPerPaidLead = div(adSpendMeta, paidLeads);

    const manualOptInsPaid    = marketing.reduce((s, r) => s + num(r.fields['Opt ins (Paid)']), 0);
    const manualOptInsOrganic = marketing.reduce((s, r) => s + num(r.fields['Opt ins (Organic)']), 0);

    // Cross-check tracked lead counts against the manually-typed opt-in
    // numbers from Marketing Daily Metrics — catches broken webhooks/Zaps.
    const mismatch = manualOptInsPaid > 0 || manualOptInsOrganic > 0
      ? Math.abs(paidLeads - manualOptInsPaid) > 0 || Math.abs(organicLeads - manualOptInsOrganic) > 0
      : false;

    res.status(200).json({
      rows, paidLeads, organicLeads, unlabeled, cashPaid, cashOrganic,
      adSpendMeta, paidRoas, costPerPaidLead, manualOptInsPaid, manualOptInsOrganic, mismatch,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
