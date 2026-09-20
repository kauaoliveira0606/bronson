const AIRTABLE_TOKEN     = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE      = 'appiMw8gpaLv2WITA';
const EOD_TABLE          = 'Affiliate EOD';
const MARKETING_TABLE    = 'Marketing Daily Metrics';

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

// Airtable fields are typed as Text so reps can free-type ("$350"); strip
// everything but digits/./- before parsing. A missing/misnamed field then
// silently reads as 0 — this is why field-name casing must match exactly.
function num(v) {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function sumField(records, field) {
  return records.reduce((s, r) => s + num(r.fields[field]), 0);
}

// These fields are manually-entered daily rates/currency, not raw counts —
// average across days that actually reported the field rather than summing.
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

function nyWeekStartYMD() {
  const today = nyYMD(new Date());
  const [y, m, d] = today.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDaysYMD(today, -dow);
}

function resolveRange(key, customStart, customEnd) {
  const today = nyYMD(new Date());
  switch (key) {
    case 'Today':        return { start: today, end: today };
    case 'Yesterday':    { const y = addDaysYMD(today, -1); return { start: y, end: y }; }
    case 'This Week':    return { start: nyWeekStartYMD(), end: today };
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

function computeMetrics(eod, marketing) {
  // Tie-breaker: where a metric is tracked in both tables, Marketing Daily
  // Metrics wins as the source of truth. Affiliate EOD only fills in fields
  // Marketing doesn't track (Pick ups, Software pitched, HT pitched/booked,
  // set closed, HT cash collected).
  const softwareClosed  = sumField(marketing, 'Sales - Low Ticket (Sales team)');
  const cashLt           = sumField(marketing, 'Cash Collected - Low ticket');
  const outboundDials    = sumField(marketing, 'Dials');
  const optInsPaid       = sumField(marketing, 'Opt ins (Paid)');
  const optInsOrganic    = sumField(marketing, 'Opt ins (Organic)');
  const optInsTotal      = optInsPaid + optInsOrganic;

  const cashHt      = sumField(eod, 'cash collected high ticket');
  const pickUps     = sumField(eod, 'Pick ups');
  const softwarePitched = sumField(eod, 'Software pitched');
  const htPitched    = sumField(eod, 'high ticket call pitched');
  const newHtBooked  = sumField(eod, 'new high ticket calls booked');
  const setsClosed   = sumField(eod, 'set closed');

  const totalCashCollected = cashLt + cashHt;

  // Top-of-funnel fields (ad → landing page → VSL → opt-in → confirmation
  // email) are manually typed into Marketing Daily Metrics as already-computed
  // daily rates — surfaced as-is (averaged across the range), no formula.
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
    totalCashCollected,
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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'AIRTABLE_TOKEN not set' });

  const key = req.query.range || 'Yesterday';
  const range = resolveRange(key, req.query.start, req.query.end);

  try {
    const [eodAll, marketingAll] = await Promise.all([
      fetchAllRecords(EOD_TABLE),
      fetchAllRecords(MARKETING_TABLE),
    ]);

    const eod       = eodAll.filter(r => inRange(r.fields['Date'], range));
    const marketing = marketingAll.filter(r => inRange(r.fields['Date'], range));

    res.status(200).json({
      range,
      metrics: computeMetrics(eod, marketing),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

module.exports._internal = { computeMetrics, resolveRange, inRange, nyYMD, addDaysYMD };
