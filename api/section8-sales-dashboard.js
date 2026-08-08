const AIRTABLE_TOKEN   = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE    = 'app22YDOcrHhq1Q1j'; // Section 8 Playbook
const CLOSER_TABLE     = 'EOD Closer';
const AFFILIATE_TABLE  = 'Affiliate EOD';

function nyTodayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function nyWeekStartISO() {
  const [y, m, d] = nyTodayISO().split('-').map(Number);
  const today = new Date(y, m - 1, d);
  const start = new Date(today);
  start.setDate(today.getDate() - today.getDay());
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
}

async function fetchAllRecords(table, formula) {
  let all = [];
  let offset = null;
  do {
    const params = new URLSearchParams({ pageSize: '100' });
    if (formula) params.set('filterByFormula', formula);
    if (offset) params.set('offset', offset);
    const r = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(table)}?${params}`, {
      headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` },
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
  return b > 0 ? a / b : 0;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'AIRTABLE_TOKEN not set' });

  const filter = req.query.filter || 'today';
  let dateFormula = null;
  if (filter === 'today') dateFormula = `IS_SAME({Date},"${nyTodayISO()}","day")`;
  else if (filter === 'week') dateFormula = `IS_AFTER({Date},"${nyWeekStartISO()}")`;
  // filter === 'all' -> no date formula

  try {
    const [closerRecs, affiliateRecs] = await Promise.all([
      fetchAllRecords(CLOSER_TABLE, dateFormula),
      fetchAllRecords(AFFILIATE_TABLE, dateFormula),
    ]);

    if (req.query.debug === '1') {
      return res.status(200).json({
        filter,
        closerRaw: closerRecs.map(r => r.fields),
        affiliateRaw: affiliateRecs.map(r => r.fields),
      });
    }

    // ---- Closer-side rollup ----
    let callsBooked = 0, callsShowed = 0, offersMade = 0, dealsClosed = 0;
    let closerCash = 0, closerRevenue = 0;
    const closerMap = {}; // name -> { name, cash, dealsClosed, callsBooked }

    for (const rec of closerRecs) {
      const f = rec.fields;
      const name = f['Closer Name'] || 'Unknown';
      const cash = num(f['Total Cash Collected']);
      const revenue = num(f['Total Revenue']);
      const booked = num(f['Calls Booked']);
      const showed = num(f['Calls Showed']);
      const offers = num(f['Offers Made']);
      const closed = num(f['Deals Closed']);

      callsBooked += booked;
      callsShowed += showed;
      offersMade  += offers;
      dealsClosed += closed;
      closerCash    += cash;
      closerRevenue += revenue;

      if (!closerMap[name]) closerMap[name] = { name, cash: 0, revenue: 0, dealsClosed: 0, callsBooked: 0 };
      closerMap[name].cash        += cash;
      closerMap[name].revenue     += revenue;
      closerMap[name].dealsClosed += closed;
      closerMap[name].callsBooked += booked;
    }

    // ---- Affiliate-side rollup (also serves as the "setter" side for this dashboard) ----
    let outboundDials = 0, pickUps = 0, softwarePitched = 0, softwareClosed = 0;
    let affiliateCashLow = 0, affiliateCashHigh = 0, affiliateRevenueHigh = 0;
    const setterMap = {}; // name -> { name, cash, dials }
    const cashByDay = {}; // date -> { closer, affiliate }

    for (const rec of affiliateRecs) {
      const f = rec.fields;
      const name = f['Your name'] || 'Unknown';
      const dials = num(f['Outbound dials']);
      const pickups = num(f['Pick ups']);
      const pitched = num(f['Software pitched']);
      const closed = num(f['software closed']);
      const cashLow = num(f['Cash collected low ticket']);
      const cashHigh = num(f['Cash collected high ticket']);
      const revenueHigh = num(f['revenue high ticket']);
      const date = f['Date'] || null;

      outboundDials   += dials;
      pickUps         += pickups;
      softwarePitched += pitched;
      softwareClosed  += closed;
      affiliateCashLow  += cashLow;
      affiliateCashHigh += cashHigh;
      affiliateRevenueHigh += revenueHigh;

      const cash = cashLow + cashHigh;
      if (!setterMap[name]) setterMap[name] = { name, cash: 0, dials: 0 };
      setterMap[name].cash  += cash;
      setterMap[name].dials += dials;

      if (date) {
        if (!cashByDay[date]) cashByDay[date] = { date, closer: 0, affiliate: 0 };
        cashByDay[date].affiliate += cash;
      }
    }

    for (const rec of closerRecs) {
      const f = rec.fields;
      const date = f['Date'] || null;
      if (!date) continue;
      if (!cashByDay[date]) cashByDay[date] = { date, closer: 0, affiliate: 0 };
      cashByDay[date].closer += num(f['Total Cash Collected']);
    }

    const affiliateCash = affiliateCashLow + affiliateCashHigh;
    const totalCashCollected = closerCash + affiliateCash;
    const totalRevenue = closerRevenue + affiliateRevenueHigh;

    const closerLeaderboard = Object.values(closerMap).sort((a, b) => b.cash - a.cash);
    const setterLeaderboard = Object.values(setterMap).sort((a, b) => b.cash - a.cash);
    const cashByDaySeries = Object.values(cashByDay)
      .map(d => ({ ...d, total: d.closer + d.affiliate }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.status(200).json({
      filter,
      metrics: {
        callsBooked,
        liveCalls: callsShowed,
        revenue: totalRevenue,
        cashCollected: totalCashCollected,
        cashCollectedPerBookedCall: div(totalCashCollected, callsBooked),
        showRate: div(callsShowed, callsBooked),
        closeRate: div(dealsClosed, offersMade),
        affiliateCloses: softwareClosed,
        affiliateCloseRate: div(softwareClosed, softwarePitched),
        outboundDials,
        pickUps,
        pickUpRate: div(pickUps, outboundDials),
      },
      breakdown: {
        closerCash, closerRevenue, affiliateCash, affiliateRevenueHigh,
        callsBooked, callsShowed, offersMade, dealsClosed,
        softwarePitched, softwareClosed,
      },
      closerLeaderboard,
      setterLeaderboard,
      cashCollectedByDay: cashByDaySeries,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
