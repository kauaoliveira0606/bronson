// Fetches raw data from Apps Script, re-derives all computed metrics server-side.
// Fix bugs here — no need to touch Apps Script ever again.

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwHAMESpD4IeLxksOWpt6WuYkT-hZZPUSb0oZENNvSadYnWRRrZ8X-pyKwZt0OzXIAClw/exec';

const r2 = v => parseFloat(v.toFixed(2));

function parseSection(lines, start, end) {
  const pairs = [];
  const map   = {};
  const limit = end > -1 ? end : lines.length;
  for (let i = start + 1; i < limit; i++) {
    const line  = lines[i].trim();
    if (!line) continue;
    const comma = line.indexOf(',');
    if (comma < 0) continue;
    const name = line.slice(0, comma).trim();
    const val  = parseFloat(line.slice(comma + 1));
    if (name && !isNaN(val)) {
      pairs.push([name, val]);
      map[name.toLowerCase()] = val;
    }
  }
  return { pairs, map };
}

// Re-derive all computed metrics from raw accumulated values
function derivedMetrics(map) {
  const g = k => map[k] || 0;
  const adSpend   = g('ad spend meta');
  const cashLT    = g('cash collected - low ticket');
  const cashHT    = g('cash collected - high ticket');
  const salesLT   = g('sales - low ticket');
  const salesHT   = g('sales - high ticket');
  const bookedHT  = g('booked calls (high ticket)');
  const showRate  = g('show rate- high ticket');
  const totalCash = cashLT + cashHT;

  const out = {};
  if (cashLT || cashHT)             out['Total Cash Collected']    = r2(totalCash);
  if (adSpend > 0 && salesLT > 0)   out['CPA - Low ticket']        = r2(adSpend / salesLT);
  if (adSpend > 0 && totalCash > 0) out['Roas - Total']            = r2(totalCash / adSpend);
  if (adSpend > 0 && cashLT > 0)    out['Roas - Low ticket']       = r2(cashLT / adSpend);
  if (bookedHT > 0)                 out['Close Rate - High Ticket'] = r2(salesHT / bookedHT);
  if (showRate > 0)                 out['Show rate- High ticket']   = r2(showRate);
  return out;
}

const DERIVED_LOWER = new Set([
  'cpa - low ticket', 'roas - total', 'roas - low ticket',
  'total cash collected', 'close rate - high ticket', 'show rate- high ticket',
]);

function buildSection(section, patch) {
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

    const l7Idx  = lines.findIndex(l => l.trim() === '__LAST7__');
    const l30Idx = lines.findIndex(l => l.trim() === '__LAST30__');
    const atIdx  = lines.findIndex(l => l.trim() === '__ALLTIME__');

    const mainEnd = l7Idx > -1 ? l7Idx : l30Idx > -1 ? l30Idx : atIdx > -1 ? atIdx : lines.length;
    const mainCsv = lines.slice(0, mainEnd).join('\n');

    const s7   = parseSection(lines, l7Idx,  l30Idx);
    const s30  = parseSection(lines, l30Idx, atIdx);
    const sAll = parseSection(lines, atIdx,  -1);

    const out = mainCsv
      + '\n__LAST7__\n'   + buildSection(s7,   derivedMetrics(s7.map))
      + '\n__LAST30__\n'  + buildSection(s30,  derivedMetrics(s30.map))
      + '\n__ALLTIME__\n' + buildSection(sAll, derivedMetrics(sAll.map));

    res.setHeader('Content-Type', 'text/plain');
    res.status(200).send(out);
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
};
