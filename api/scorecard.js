// Reads Google Sheet directly — no Apps Script dependency.
// New weekly tabs are picked up automatically based on date.

const SHEET_ID = '1li-TafeNH-7v6B4lDCDF9jB52vtYh_6w3UE1v0V3f4A';

const MONTHS_ARR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_IDX = Object.fromEntries(MONTHS_ARR.map((m, i) => [m, i]));

// Rate metrics: average across periods, not sum
const RATE_METRICS = new Set([
  'cost per lead (meta)', 'landing page connect rate',
  'opt in rate (opt ins vs views)', 'opt in rate',
  'vsl play rate', 'vsl engagement rate', 'confirmation email open rate',
  'connection rate (response rate)', 'connection rate',
  'close rate - low ticket',
  'funnel conversion rate (lt sales/opt ins)', 'funnel conversion rate',
]);

// Derived post-accumulation — skip in daily/col9 loops
const SKIP = new Set([
  'roas - total', 'roas - low ticket', 'total cash collected',
  'cpa - low ticket', 'close rate - high ticket', 'show rate- high ticket',
]);

const r2 = v => parseFloat(v.toFixed(2));

function getTabName(sunday) {
  const sat = new Date(sunday);
  sat.setDate(sat.getDate() + 6);
  const sm = MONTHS_ARR[sunday.getMonth()];
  const em = MONTHS_ARR[sat.getMonth()];
  return sm === em
    ? `${sm} ${sunday.getDate()}-${sat.getDate()}`
    : `${sm} ${sunday.getDate()}-${em} ${sat.getDate()}`;
}

function parseCsv(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const row = [];
    let inQ = false, cur = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (c === ',' && !inQ) {
        row.push(cur); cur = '';
      } else {
        cur += c;
      }
    }
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

// Parse "Jun-21" → Date object using tab's reference year
function parseSheetDate(s, refYear) {
  const m = (s || '').trim().match(/^([A-Za-z]+)-(\d+)$/);
  if (!m) return null;
  const mo = MONTHS_IDX[m[1]];
  if (mo === undefined) return null;
  return new Date(refYear, mo, parseInt(m[2], 10));
}

// Parse a spreadsheet cell value to a JS number (handles $, %, commas, errors)
function parseVal(s) {
  if (!s || typeof s !== 'string') return NaN;
  const t = s.trim();
  if (!t || t.startsWith('#') || t === '-%' || t === '-') return NaN;
  const clean = t.replace(/[$,]/g, '');
  if (clean.endsWith('%')) {
    const n = parseFloat(clean);
    return isNaN(n) ? NaN : n / 100;
  }
  return parseFloat(clean);
}

async function fetchTabCsv(name) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}`;
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 10000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) return null;
    const text = await r.text();
    // gviz returns error JSON when sheet doesn't exist
    if (text.trim().startsWith('google.visualization')) return null;
    return text;
  } catch { return null; }
}

function parseTabData(csvText, sunday) {
  const rows = parseCsv(csvText);
  const refYear = sunday.getFullYear();

  // Find date header row: row where >=3 of cols 1-7 look like "Jun-21"
  let dateRowIdx = -1;
  const dateMap = {}; // col index → Date
  for (let r = 0; r < Math.min(rows.length, 6); r++) {
    const row = rows[r];
    let found = 0;
    for (let c = 1; c <= 7; c++) {
      const d = parseSheetDate(row[c], refYear);
      if (d) { dateMap[c] = d; found++; }
    }
    if (found >= 3) { dateRowIdx = r; break; }
  }
  if (dateRowIdx < 0) return null;

  // Index metric rows by name
  const metrics = {}; // name → row array
  for (let r = dateRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const name = (row[0] || '').trim();
    if (name && !metrics[name]) metrics[name] = row;
  }

  // Fingerprint for formula-linked duplicate detection (Ad Spend daily values)
  const adRow = metrics['Ad Spend Meta'] || [];
  const fingerprint = [1, 2, 3, 4, 5, 6, 7].map(c => (adRow[c] || '').replace(/[$,]/g, '').trim()).join('|');

  return { dateMap, metrics, fingerprint };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cut7  = new Date(today); cut7.setDate(today.getDate() - 6);
    const cut30 = new Date(today); cut30.setDate(today.getDate() - 29);

    // Current Sunday (start of current week)
    const curSunday = new Date(today);
    curSunday.setDate(today.getDate() - today.getDay());

    // Generate tab definitions for past 26 weeks (newest first)
    const tabDefs = Array.from({ length: 26 }, (_, i) => {
      const sun = new Date(curSunday);
      sun.setDate(curSunday.getDate() - i * 7);
      const sat = new Date(sun);
      sat.setDate(sun.getDate() + 6);
      return { name: getTabName(sun), sunday: sun, saturday: sat };
    });

    // Fetch all tabs in parallel
    const csvList = await Promise.all(tabDefs.map(t => fetchTabCsv(t.name)));

    // Parse and filter valid tabs
    const tabs = tabDefs
      .map((def, i) => {
        const csv  = csvList[i];
        if (!csv) return null;
        const data = parseTabData(csv, def.sunday);
        if (!data) return null;
        return { ...def, csv, ...data };
      })
      .filter(Boolean);

    // Split current week from completed weeks FIRST (before fingerprinting)
    // Current week tab has formula-linked cells → same fingerprint as previous real week
    const currentTab = tabs.find(t => t.saturday >= today) || null;
    const pastTabs   = tabs.filter(t => t.saturday < today);

    // De-duplicate completed tabs: skip formula-linked copies (same Ad Spend fingerprint)
    const seenFp = new Set();
    const completedTabs = pastTabs.filter(t => {
      const fp = t.fingerprint;
      if (!fp || fp.replace(/\|/g, '') === '') return true; // no ad spend — keep
      if (seenFp.has(fp)) return false;
      seenFp.add(fp);
      return true;
    });

    // Per-period accumulators
    const mk = () => ({ sums: {}, cnts: {}, sw: { num: 0, den: 0 }, cw: { num: 0, den: 0 } });
    const L7 = mk(), L30 = mk(), ALL = mk();
    // L7 also tracks raw daily booked/sales for HT close rate derivation
    let l7BookedHT = 0, l7SalesHT = 0;

    function addToAccum(accum, name, v) {
      if (isNaN(v) || v === 0) return;
      accum.sums[name] = (accum.sums[name] || 0) + v;
      accum.cnts[name] = (accum.cnts[name] || 0) + 1;
    }

    for (const tab of completedTabs) {
      const { dateMap, metrics } = tab;

      // ── LAST7: daily columns filtered by date ──
      const l7Cols = Object.entries(dateMap)
        .filter(([, d]) => d >= cut7 && d <= today)
        .map(([c]) => +c);

      if (l7Cols.length > 0) {
        for (const [name, row] of Object.entries(metrics)) {
          if (SKIP.has(name.toLowerCase())) continue;
          for (const c of l7Cols) {
            addToAccum(L7, name, parseVal(row[c]));
          }
        }
        // Track HT booked/sales separately for close rate
        const bookedRow = metrics['Booked calls (high ticket)'] || [];
        const salesRow  = metrics['Sales - High Ticket']        || [];
        for (const c of l7Cols) {
          const b = parseVal(bookedRow[c]); if (!isNaN(b)) l7BookedHT += b;
          const s = parseVal(salesRow[c]);  if (!isNaN(s)) l7SalesHT  += s;
        }
        // Show rate HT for L7: weighted by col9 booked
        const wb9 = parseVal((metrics['Booked calls (high ticket)'] || [])[9]) || 0;
        const ws9 = parseVal((metrics['Show rate- High ticket']      || [])[9]) || 0;
        if (wb9 > 0 && !isNaN(ws9)) { L7.sw.num += ws9 * wb9; L7.sw.den += wb9; }
      }

      // ── LAST30 and ALLTIME: use col9 weekly summaries ──
      const col9 = name => parseVal((metrics[name] || [])[9]);

      const addCol9ToAccum = (accum) => {
        for (const [name, row] of Object.entries(metrics)) {
          if (SKIP.has(name.toLowerCase())) continue;
          addToAccum(accum, name, col9(name));
        }
        // Show rate HT: weighted by col9 booked
        const wb9 = col9('Booked calls (high ticket)') || 0;
        const ws9 = col9('Show rate- High ticket')     || 0;
        const wc9 = col9('Close Rate - High Ticket')   || 0;
        if (wb9 > 0) {
          if (!isNaN(ws9)) { accum.sw.num += ws9 * wb9; accum.sw.den += wb9; }
          if (!isNaN(wc9)) { accum.cw.num += wc9 * wb9; accum.cw.den += wb9; }
        }
      };

      if (tab.saturday >= cut30) addCol9ToAccum(L30);
      addCol9ToAccum(ALL);
    }

    // ── Derive computed metrics ──
    function derive(accum, period) {
      const g = k => accum.sums[k] || 0;
      const adSpend   = g('Ad Spend Meta');
      const cashLT    = g('Cash Collected - Low ticket');
      const cashHT    = g('Cash Collected - High Ticket');
      const salesLT   = g('Sales - Low Ticket');
      const salesHT   = g('Sales - High Ticket');
      const totalCash = cashLT + cashHT;

      if (cashLT || cashHT)             accum.sums['Total Cash Collected']    = r2(totalCash);
      if (adSpend > 0 && salesLT > 0)   accum.sums['CPA - Low ticket']        = r2(adSpend / salesLT);
      if (adSpend > 0 && totalCash > 0) accum.sums['Roas - Total']            = r2(totalCash / adSpend);
      if (adSpend > 0 && cashLT > 0)    accum.sums['Roas - Low ticket']       = r2(cashLT / adSpend);

      // Close Rate HT: daily for L7 (preserves 50% behavior), col9-weighted for L30/ALL
      if (period === 'L7') {
        if (l7BookedHT > 0) accum.sums['Close Rate - High Ticket'] = r2(l7SalesHT / l7BookedHT);
      } else {
        if (accum.cw.den > 0) accum.sums['Close Rate - High Ticket'] = r2(accum.cw.num / accum.cw.den);
        else if (salesHT > 0 && g('Booked calls (high ticket)') > 0)
          accum.sums['Close Rate - High Ticket'] = r2(salesHT / g('Booked calls (high ticket)'));
      }

      // Show Rate HT: weighted col9 average for all periods
      if (accum.sw.den > 0) accum.sums['Show rate- High ticket'] = r2(accum.sw.num / accum.sw.den);
    }

    derive(L7,  'L7');
    derive(L30, 'L30');
    derive(ALL, 'ALL');

    // ── Build output section ──
    function buildSection(accum) {
      return Object.entries(accum.sums).map(([name, total]) => {
        const isRate = RATE_METRICS.has(name.toLowerCase());
        const count  = accum.cnts[name] || 1;
        const val    = isRate ? total / count : total;
        return `${name},${r2(val)}`;
      }).join('\n');
    }

    // Main CSV: current week's raw tab (for dashboard's daily view)
    const mainCsv = (currentTab || completedTabs[0])?.csv?.trim() || '';

    const out = mainCsv
      + '\n__LAST7__\n'   + buildSection(L7)
      + '\n__LAST30__\n'  + buildSection(L30)
      + '\n__ALLTIME__\n' + buildSection(ALL);

    res.setHeader('Content-Type', 'text/plain');
    return res.status(200).send(out);

  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
};
