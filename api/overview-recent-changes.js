const AIRTABLE_TOKEN  = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE   = 'appiMw8gpaLv2WITA';
const EOD_TABLE        = 'Affiliate EOD';
const MARKETING_TABLE  = 'Marketing Daily Metrics';

function num(v) {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function sumField(records, field) {
  return records.reduce((s, r) => s + num(r.fields[field]), 0);
}

function avgField(records, field) {
  const present = records.filter(r => r.fields[field] !== undefined && r.fields[field] !== null && r.fields[field] !== '');
  if (!present.length) return null;
  return present.reduce((s, r) => s + num(r.fields[field]), 0) / present.length;
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

function dateFormula(date) {
  return `DATETIME_FORMAT({Date}, 'YYYY-MM-DD')='${date}'`;
}

async function fetchDay(table, date) {
  const params = new URLSearchParams({ pageSize: '100', filterByFormula: dateFormula(date) });
  const r = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(table)}?${params}`, {
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
  });
  const d = await r.json();
  if (d.error) throw new Error(`${table}: ${JSON.stringify(d.error)}`);
  return d.records || [];
}

// Same tie-breaker and field set as api/overview-metrics.js — keep both in
// sync any time a metric is added, or Recent Changes silently shows "—" for
// that metric (this happened once on the original build: a field was added
// to the main endpoint but forgotten here).
function computeMetrics(eod, marketing) {
  const softwareClosed  = sumField(marketing, 'Sales - Low Ticket (Sales team)');
  const cashLt           = sumField(marketing, 'Cash Collected - Low ticket');
  const outboundDials    = sumField(marketing, 'Dials');
  const optInsPaid       = sumField(marketing, 'Opt ins (Paid)');
  const optInsOrganic    = sumField(marketing, 'Opt ins (Organic)');
  const optInsTotal      = optInsPaid + optInsOrganic;

  const cashHt       = sumField(eod, 'cash collected high ticket');
  const pickUps      = sumField(eod, 'Pick ups');
  const softwarePitched = sumField(eod, 'Software pitched');
  const htPitched     = sumField(eod, 'high ticket call pitched');
  const newHtBooked   = sumField(eod, 'new high ticket calls booked');
  const setsClosed    = sumField(eod, 'set closed');

  const costPerLeadMeta            = avgField(marketing, 'Cost per Lead (Meta)');
  const landingPageConnectRate     = avgField(marketing, 'Landing Page Connect Rate');
  const optInRate                  = avgField(marketing, 'Opt in rate (opt ins vs views)');
  const vslViews                   = sumField(marketing, 'VSL Views');
  const vslPlayRate                = avgField(marketing, 'VSL Play Rate');
  const vslEngagementRate          = avgField(marketing, 'VSL Engagement Rate');
  const confirmationEmailOpenRate  = avgField(marketing, 'Confirmation Email open rate');
  const connectionRateOnDials      = avgField(marketing, 'Connection rate (On total dials)');
  const closeRateLowTicket         = avgField(marketing, 'Close rate - Low ticket');
  const funnelConversionRate       = avgField(marketing, 'Funnel Conversion rate (Lt Sales/opt ins)');

  return {
    sales: softwareClosed,
    totalCashCollected: cashLt + cashHt,
    cashCollectedLowTicket: cashLt,
    cashCollectedHighTicket: cashHt,
    pickupRate: div(pickUps, outboundDials),
    connectionRate: div(pickUps, optInsTotal),
    pickups: pickUps,
    softwarePitched,
    pitchRate: div(softwarePitched, pickUps),
    cashPerOptInPaid: div(cashLt, optInsPaid),
    aovLowTicket: div(cashLt, softwareClosed),
    aovHighTicket: div(cashHt, setsClosed),
    htPitchRate: div(htPitched, softwareClosed),
    upsellBookingRate: div(newHtBooked, htPitched),
    costPerLeadMeta,
    landingPageConnectRate,
    optInRate,
    vslViews,
    vslPlayRate,
    vslEngagementRate,
    confirmationEmailOpenRate,
    connectionRateOnDials,
    closeRateLowTicket,
    funnelConversionRate,
  };
}

async function dayData(date) {
  const [marketing, eod] = await Promise.all([
    fetchDay(MARKETING_TABLE, date),
    fetchDay(EOD_TABLE, date),
  ]);

  const hasSubmission = marketing.length > 0 || eod.length > 0;
  const changesNote = marketing[0] ? String(marketing[0].fields['Changes Made Today'] ?? '').trim() : '';

  return {
    date,
    hasSubmission,
    hasMarketingSubmission: marketing.length > 0,
    changesNote,
    metrics: computeMetrics(eod, marketing),
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'AIRTABLE_TOKEN not set' });

  try {
    const today = nyYMD(new Date());
    const dates = [today, addDaysYMD(today, -1), addDaysYMD(today, -2), addDaysYMD(today, -3)];
    const [d0, d1, d2, d3] = await Promise.all(dates.map(dayData));
    res.status(200).json({ days: [d0, d1, d2], baseline: d3 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
