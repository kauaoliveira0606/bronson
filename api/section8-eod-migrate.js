const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID  = 'app22YDOcrHhq1Q1j'; // Section 8 Playbook
const TABLE_ID = 'tblezCVnizBHKPL4Q'; // Affiliate EOD

const RENAMES = {
  'cash collected high ticket': 'Cash collected high ticket',
  'Cash collected affiliate':   'Cash collected low ticket',
};

const KEEP = new Set(['Your name', 'Outbound dials', 'Date', 'Cash collected high ticket', 'Cash collected low ticket']);

const META = 'https://api.airtable.com/v0/meta';
const HEADERS = { 'Authorization': `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' };

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'AIRTABLE_TOKEN not set' });

  try {
    const schemaRes = await fetch(`${META}/bases/${BASE_ID}/tables`, { headers: HEADERS });
    const schemaData = await schemaRes.json();
    const table = (schemaData.tables || []).find(t => t.id === TABLE_ID);
    if (!table) return res.status(404).json({ error: 'Affiliate EOD table not found' });

    if (req.query.confirm !== '1') {
      // Dry run: show exactly what would happen, do nothing.
      const plan = table.fields.map(f => {
        if (f.id === table.primaryFieldId) return { field: f.name, action: 'keep (primary field)' };
        if (RENAMES[f.name]) return { field: f.name, action: `rename to "${RENAMES[f.name]}"` };
        if (KEEP.has(f.name)) return { field: f.name, action: 'keep' };
        return { field: f.name, action: 'DELETE' };
      });
      return res.status(200).json({ dryRun: true, plan, note: 'Re-run with ?confirm=1 to apply' });
    }

    const results = [];
    for (const f of table.fields) {
      if (f.id === table.primaryFieldId) { results.push({ field: f.name, action: 'skipped (primary)' }); continue; }

      if (RENAMES[f.name]) {
        const r = await fetch(`${META}/bases/${BASE_ID}/tables/${TABLE_ID}/fields/${f.id}`, {
          method: 'PATCH', headers: HEADERS, body: JSON.stringify({ name: RENAMES[f.name] }),
        });
        results.push({ field: f.name, action: 'renamed', status: r.status, body: await r.json() });
        continue;
      }

      if (KEEP.has(f.name)) { results.push({ field: f.name, action: 'kept' }); continue; }

      const r = await fetch(`${META}/bases/${BASE_ID}/tables/${TABLE_ID}/fields/${f.id}`, {
        method: 'DELETE', headers: HEADERS,
      });
      results.push({ field: f.name, action: 'deleted', status: r.status, body: await r.json() });
    }

    res.status(200).json({ applied: true, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
