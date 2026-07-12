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
  const pad = n => String(n).padStart(2, '0');
  return `${sunday.getMonth()+1}/${pad(sunday.getDate())}-${sat.getMonth()+1}/${pad(sat.getDate())}`;
}

// Returns all plausible name variants for a week (padded, unpadded, space vs slash)
function getTabNameVariants(sunday) {
  const sat = new Date(sunday);
  sat.setDate(sat.getDate() + 6);
  const pad = n => String(n).padStart(2, '0');
  const sm = sunday.getMonth() + 1, sd = sunday.getDate();
  const em = sat.getMonth() + 1,   ed = sat.getDate();
  return [
    `${sm}/${pad(sd)}-${em}/${pad(ed)}`,   // 7/06-7/12  (original)
    `${sm}/${sd}-${em}/${ed}`,              // 7/6-7/12   (no leading zero)
    `${pad(sm)}/${pad(sd)}-${pad(em)}/${pad(ed)}`, // 07/06-07/12
    `${sm}/${pad(sd)} - ${em}/${pad(ed)}`, // 7/06 - 7/12 (with spaces)
    `${sm}/${sd} - ${em}/${ed}`,           // 7/6 - 7/12
  ];
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

// Discover sheet GIDs from the spreadsheet HTML view.
// gviz drops cells that contain < or > (it types columns as number and rejects non-numeric text).
// The export API reads raw text values correctly, but requires a numeric GID, not a sheet name.
async function discoverGidMap() {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 10000);
    const r = await fetch(
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/htmlview`,
      { signal: ctrl.signal }
    );
    clearTimeout(tid);
    if (!r.ok) return {};
    const html = await r.text();
    // Pattern: name: "6\/28-7\/04" ... gid: "1621000812"
    const re = /name:\s*"((?:[^"\\]|\\.)*)"\s*,\s*pageUrl[^}]*gid:\s*"(\d+)"/g;
    const map = {};
    let m;
    while ((m = re.exec(html)) !== null) {
      const name = m[1].replace(/\\\//g, '/').replace(/\\x3d/gi, '=');
      map[name] = m[2];
    }
    return map;
  } catch { return {}; }
}

async function fetchTabCsv(name, gid) {
  // Require a GID — gviz without one silently returns the first sheet regardless of name.
  if (!gid) return null;
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}&t=${Date.now()}`;
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 10000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) return null;
    const text = await r.text();
    if (text.trim().startsWith('google.visualization')) return null;
    if (text.trim().startsWith('<!DOCTYPE')) return null;
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
    if (found >= 1) { dateRowIdx = r; break; }
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
    const cut7  = new Date(today); cut7.setDate(today.getDate() - 7);
    const cut30 = new Date(today); cut30.setDate(today.getDate() - 29);

    // week=0 → current, week=1 → last week, week=2 → 2 weeks ago, etc.
    const weekOffset = Math.max(0, parseInt(req.query?.week || '0', 10) || 0);

    // Current Sunday (start of current week)
    const curSunday = new Date(today);
    curSunday.setDate(today.getDate() - today.getDay());

    // Shift the "current" week by offset
    const targetSunday = new Date(curSunday);
    targetSunday.setDate(curSunday.getDate() - weekOffset * 7);

    // Generate tab definitions going back far enough to cover the target week + context
    const tabCount = weekOffset + 27; // always fetch target week + 26 surrounding weeks
    const tabDefs = Array.from({ length: tabCount }, (_, i) => {
      const sun = new Date(targetSunday);
      sun.setDate(targetSunday.getDate() - i * 7);
      const sat = new Date(sun);
      sat.setDate(sun.getDate() + 6);
      return { variants: getTabNameVariants(sun), name: getTabName(sun), sunday: sun, saturday: sat };
    });

    // Discover GIDs so the export API can be used (preserves < > + in goal cells)
    const gidMap = await discoverGidMap();

    // Fetch all tabs in parallel — try each name variant until one succeeds
    const csvList = await Promise.all(tabDefs.map(async t => {
      for (const v of t.variants) {
        const csv = await fetchTabCsv(v, gidMap[v]);
        if (csv) return csv;
      }
      return null;
    }));

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

    // Target tab: the selected week (exact Sunday match)
    const targetTab = tabs.find(t => t.sunday.getTime() === targetSunday.getTime()) || null;

    // Raw CSV for target week — used as mainCsv even when parseTabData fails (new tab, sparse data)
    const targetCsvRaw = csvList[tabDefs.findIndex(t => t.sunday.getTime() === targetSunday.getTime())] || null;

    // For L7/L30/ALL accumulation, always use actual completed weeks relative to today
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
        .filter(([, d]) => d >= cut7 && d < today)
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

    // ── Include current (in-progress) week in all accumulators ──
    if (currentTab) {
      const { dateMap, metrics } = currentTab;

      // L7: daily columns from this week that have already passed
      const l7Cols = Object.entries(dateMap)
        .filter(([, d]) => d >= cut7 && d < today)
        .map(([c]) => +c);

      if (l7Cols.length > 0) {
        for (const [name, row] of Object.entries(metrics)) {
          if (SKIP.has(name.toLowerCase())) continue;
          for (const c of l7Cols) {
            addToAccum(L7, name, parseVal(row[c]));
          }
        }
        const bookedRow = metrics['Booked calls (high ticket)'] || [];
        const salesRow  = metrics['Sales - High Ticket']        || [];
        for (const c of l7Cols) {
          const b = parseVal(bookedRow[c]); if (!isNaN(b)) l7BookedHT += b;
          const s = parseVal(salesRow[c]);  if (!isNaN(s)) l7SalesHT  += s;
        }
        const wb9 = parseVal((metrics['Booked calls (high ticket)'] || [])[9]) || 0;
        const ws9 = parseVal((metrics['Show rate- High ticket']      || [])[9]) || 0;
        if (wb9 > 0 && !isNaN(ws9)) { L7.sw.num += ws9 * wb9; L7.sw.den += wb9; }
      }

      // L30 / ALL: use col9 running weekly summaries from the current tab
      const col9cur = name => parseVal((metrics[name] || [])[9]);
      const addCurCol9 = (accum) => {
        for (const [name] of Object.entries(metrics)) {
          if (SKIP.has(name.toLowerCase())) continue;
          addToAccum(accum, name, col9cur(name));
        }
        const wb9 = col9cur('Booked calls (high ticket)') || 0;
        const ws9 = col9cur('Show rate- High ticket')     || 0;
        const wc9 = col9cur('Close Rate - High Ticket')   || 0;
        if (wb9 > 0) {
          if (!isNaN(ws9)) { accum.sw.num += ws9 * wb9; accum.sw.den += wb9; }
          if (!isNaN(wc9)) { accum.cw.num += wc9 * wb9; accum.cw.den += wb9; }
        }
      };
      if (currentTab.sunday >= cut30) addCurCol9(L30);
      addCurCol9(ALL);
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

    // Main CSV: prefer raw target-week CSV (works even when parse fails), then fall back
    const mainCsv = (targetCsvRaw || targetTab?.csv || currentTab?.csv || completedTabs[0]?.csv || '').trim();

    // Debug mode: return date ranges and tab coverage
    if (req.query?.debug === '1') {
      const fmt = d => d ? d.toISOString().slice(0, 10) : 'null';
      const tabInfo = tabs.map(t => ({
        name: t.name,
        sunday: fmt(t.sunday),
        saturday: fmt(t.saturday),
        completed: t.saturday < today,
        l7Cols: Object.entries(t.dateMap)
          .filter(([, d]) => d >= cut7 && d < today)
          .map(([c, d]) => `col${c}=${fmt(d)}`)
      }));
      return res.status(200).json({
        today: fmt(today),
        cut7:  fmt(cut7),
        cut30: fmt(cut30),
        currentTab: currentTab ? currentTab.name : null,
        completedTabCount: completedTabs.length,
        tabs: tabInfo.slice(0, 8),
        l7Keys: Object.keys(L7.sums)
      });
    }

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
