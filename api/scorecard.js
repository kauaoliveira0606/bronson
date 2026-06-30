// All scorecard computation lives here. Apps Script is a dumb data pipe.
// To fix any metric: edit this file and push. Never touch Apps Script again.
//
// Apps Script just dumps raw sheet data in __SHEET__ sections.
// This function does: date filtering, accumulation, rate averaging, derived metrics.

// UPDATE THIS when the user deploys the new minimal Apps Script:
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwHAMESpD4IeLxksOWpt6WuYkT-hZZPUSb0oZENNvSadYnWRRrZ8X-pyKwZt0OzXIAClw/exec';

const r2 = v => parseFloat(v.toFixed(2));

// Metrics that should be averaged (not summed) across periods
const RATE_METRICS = new Set([
  'cost per lead (meta)', 'landing page connect rate',
  'opt in rate (opt ins vs views)', 'opt in rate',
  'vsl play rate', 'vsl engagement rate', 'confirmation email open rate',
  'connection rate (response rate)', 'connection rate',
  'close rate - low ticket',
  'funnel conversion rate (lt sales/opt ins)', 'funnel conversion rate',
]);

// Metrics derived post-accumulation — skip in regular loop
const SKIP = new Set([
  'roas - total', 'roas - low ticket', 'total cash collected',
  'cpa - low ticket', 'close rate - high ticket', 'show rate- high ticket',
]);

function parseRawDump(text) {
  const sheets = [];
  for (const chunk of text.split('__SHEET__\n')) {
    const lines = chunk.trim().split('\n').filter(Boolean);
    if (lines.length >= 4) sheets.push(lines);
  }
  return sheets;
}

function processSheets(sheets) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cut7  = new Date(today); cut7.setDate(today.getDate() - 6);
  const cut30 = new Date(today); cut30.setDate(today.getDate() - 29);

  const sum7 = {}, sum30 = {}, sumAll = {};
  const cnt7 = {}, cnt30 = {}, cntAll = {};

  // Show rate: weighted by booked calls per week (uses weekly summary col 9)
  const sw7   = { num: 0, den: 0 };
  const sw30  = { num: 0, den: 0 };
  const swAll = { num: 0, den: 0 };

  // Track "most recent" sheet for the current-week CSV output
  let currentSheetLines = sheets[sheets.length - 1];

  for (const lines of sheets) {
    // Find date header row (cols 1-7 have yyyy-MM-dd strings)
    let dateRow = -1;
    const dateMap = {}; // col index → Date
    for (let r = 0; r < Math.min(lines.length, 6); r++) {
      const cols = lines[r].split(',');
      let found = 0;
      for (let c = 1; c <= 7; c++) {
        if (/^\d{4}-\d{2}-\d{2}$/.test((cols[c] || '').trim())) {
          dateMap[c] = new Date(cols[c].trim());
          found++;
        }
      }
      if (found > 0) { dateRow = r; break; }
    }
    if (dateRow < 0) continue;

    const cols7 = [], cols30 = [], colsAll = [];
    for (const [c, d] of Object.entries(dateMap)) {
      const ci = +c;
      colsAll.push(ci);
      if (d >= cut30) cols30.push(ci);
      if (d >= cut7)  cols7.push(ci);
    }
    if (!colsAll.length) continue;

    // Index metric rows and accumulate
    const rowOf = {};
    for (let r = dateRow + 1; r < lines.length; r++) {
      const cols = lines[r].split(',');
      const name = cols[0].trim();
      if (!name) continue;
      if (!rowOf[name]) rowOf[name] = r;
      if (SKIP.has(name.toLowerCase())) continue;

      const accum = (sb, cb, idxs) => {
        for (const c of idxs) {
          const v = parseFloat(cols[c]);
          if (isNaN(v) || v === 0) continue;
          sb[name] = (sb[name] || 0) + v;
          cb[name] = (cb[name] || 0) + 1;
        }
      };
      accum(sumAll, cntAll, colsAll);
      if (cols30.length) accum(sum30, cnt30, cols30);
      if (cols7.length)  accum(sum7,  cnt7,  cols7);
    }

    // Weekly summary (col 9) for show rate + booked HT
    const getCol9 = metricName => {
      const r = rowOf[metricName];
      if (r === undefined) return 0;
      const v = parseFloat(lines[r].split(',')[9]);
      return isNaN(v) ? 0 : v;
    };

    const wBooked = getCol9('Booked calls (high ticket)');
    const wShow   = getCol9('Show rate- High ticket');
    if (wBooked > 0) {
      swAll.num += wShow * wBooked; swAll.den += wBooked;
      if (cols30.length) { sw30.num += wShow * wBooked; sw30.den += wBooked; }
      if (cols7.length)  { sw7.num  += wShow * wBooked; sw7.den  += wBooked; }
    }
  }

  return { sum7, sum30, sumAll, cnt7, cnt30, cntAll, sw7, sw30, swAll, currentSheetLines };
}

function deriveMetrics(sums, cnts, sw) {
  const g = k => sums[k] || 0;
  const adSpend   = g('Ad Spend Meta');
  const cashLT    = g('Cash Collected - Low ticket');
  const cashHT    = g('Cash Collected - High Ticket');
  const salesLT   = g('Sales - Low Ticket');
  const salesHT   = g('Sales - High Ticket');
  // Use weekly-summary-based booked count (more complete) if available
  const bookedHT  = sw.den > 0 ? sw.den : g('Booked calls (high ticket)');
  const totalCash = cashLT + cashHT;

  if (cashLT || cashHT)             sums['Total Cash Collected']    = r2(totalCash);
  if (adSpend > 0 && salesLT > 0)   sums['CPA - Low ticket']        = r2(adSpend / salesLT);
  if (adSpend > 0 && totalCash > 0) sums['Roas - Total']            = r2(totalCash / adSpend);
  if (adSpend > 0 && cashLT > 0)    sums['Roas - Low ticket']       = r2(cashLT / adSpend);
  if (bookedHT > 0)                 sums['Close Rate - High Ticket'] = r2(salesHT / bookedHT);
  if (sw.den > 0)                   sums['Show rate- High ticket']   = r2(sw.num / sw.den);
}

function buildSection(sums, cnts) {
  return Object.entries(sums).map(([name, total]) => {
    const isRate = RATE_METRICS.has(name.toLowerCase());
    const count  = cnts[name] || 1;
    const val    = isRate ? total / count : total;
    return `${name},${r2(val)}`;
  }).join('\n');
}

// ── Fallback: old-format Apps Script (returns __LAST7__ sections, not __SHEET__ dump) ──
function parseSection(lines, start, end) {
  const pairs = [], map = {};
  const limit = end > -1 ? end : lines.length;
  for (let i = start + 1; i < limit; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const comma = line.indexOf(',');
    if (comma < 0) continue;
    const name = line.slice(0, comma).trim();
    const val  = parseFloat(line.slice(comma + 1));
    if (name && !isNaN(val)) { pairs.push([name, val]); map[name.toLowerCase()] = val; }
  }
  return { pairs, map };
}

const DERIVED_LOWER = new Set([
  'cpa - low ticket', 'roas - total', 'roas - low ticket',
  'total cash collected', 'close rate - high ticket', 'show rate- high ticket',
]);

function patchDerivedInSection(section) {
  const g = k => section.map[k] || 0;
  const adSpend   = g('ad spend meta');
  const cashLT    = g('cash collected - low ticket');
  const cashHT    = g('cash collected - high ticket');
  const salesLT   = g('sales - low ticket');
  const salesHT   = g('sales - high ticket');
  const bookedHT  = g('booked calls (high ticket)');
  const showRate  = g('show rate- high ticket');
  const totalCash = cashLT + cashHT;

  const patch = {};
  if (cashLT || cashHT)             patch['Total Cash Collected']    = r2(totalCash);
  if (adSpend > 0 && salesLT > 0)   patch['CPA - Low ticket']        = r2(adSpend / salesLT);
  if (adSpend > 0 && totalCash > 0) patch['Roas - Total']            = r2(totalCash / adSpend);
  if (adSpend > 0 && cashLT > 0)    patch['Roas - Low ticket']       = r2(cashLT / adSpend);
  if (bookedHT > 0)                 patch['Close Rate - High Ticket'] = r2(salesHT / bookedHT);
  if (showRate > 0)                 patch['Show rate- High ticket']   = r2(showRate);

  const base  = section.pairs.filter(([n]) => !DERIVED_LOWER.has(n.toLowerCase()));
  const extra = Object.entries(patch);
  return [...base, ...extra].map(([n, v]) => `${n},${v}`).join('\n');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const raw   = await fetch(SCRIPT_URL + '?t=' + Date.now()).then(r => r.text());
    const lines = raw.split('\n');

    // Detect format: new (has __SHEET__ markers) vs old (__LAST7__ sections)
    if (raw.includes('__SHEET__')) {
      // New format: full raw dump — do all computation here
      const sheets = parseRawDump(raw);
      const { sum7, sum30, sumAll, cnt7, cnt30, cntAll, sw7, sw30, swAll, currentSheetLines } = processSheets(sheets);

      deriveMetrics(sum7,   cnt7,   sw7);
      deriveMetrics(sum30,  cnt30,  sw30);
      deriveMetrics(sumAll, cntAll, swAll);

      const mainCsv = currentSheetLines.join('\n');
      const out = mainCsv
        + '\n__LAST7__\n'   + buildSection(sum7,   cnt7)
        + '\n__LAST30__\n'  + buildSection(sum30,  cnt30)
        + '\n__ALLTIME__\n' + buildSection(sumAll, cntAll);

      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send(out);
    }

    // Old format fallback: re-derive what we can from accumulated sections
    const l7Idx  = lines.findIndex(l => l.trim() === '__LAST7__');
    const l30Idx = lines.findIndex(l => l.trim() === '__LAST30__');
    const atIdx  = lines.findIndex(l => l.trim() === '__ALLTIME__');
    const mainEnd = l7Idx > -1 ? l7Idx : l30Idx > -1 ? l30Idx : atIdx > -1 ? atIdx : lines.length;
    const mainCsv = lines.slice(0, mainEnd).join('\n');

    const s7   = parseSection(lines, l7Idx,  l30Idx);
    const s30  = parseSection(lines, l30Idx, atIdx);
    const sAll = parseSection(lines, atIdx,  -1);

    const out = mainCsv
      + '\n__LAST7__\n'   + patchDerivedInSection(s7)
      + '\n__LAST30__\n'  + patchDerivedInSection(s30)
      + '\n__ALLTIME__\n' + patchDerivedInSection(sAll);

    res.setHeader('Content-Type', 'text/plain');
    res.status(200).send(out);
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
};
