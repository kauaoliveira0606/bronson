const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'AIRTABLE_TOKEN not set' });

  try {
    // List every base this token can see, so we can find the "Section 8 Playbook"
    // base by name instead of assuming the koconsultings base ID applies.
    const basesRes = await fetch('https://api.airtable.com/v0/meta/bases', {
      headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` },
    });
    const basesData = await basesRes.json();
    const bases = basesData.bases || [];

    const targetBase = bases.find(b => /section\s*8/i.test(b.name)) || null;
    const AIRTABLE_BASE = req.query.base || targetBase?.id || null;

    if (!AIRTABLE_BASE) {
      return res.status(200).json({ bases, error: 'No base matching "Section 8" found and no ?base= override given' });
    }

    // Full base schema — every table and every field, straight from Airtable's
    // metadata API. This tells us definitively what tables/fields actually exist
    // rather than guessing from other files' usage.
    const schemaRes = await fetch(`https://api.airtable.com/v0/meta/bases/${AIRTABLE_BASE}/tables`, {
      headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` },
    });
    const schemaData = await schemaRes.json();
    const tables = (schemaData.tables || []).map(t => ({
      id: t.id,
      name: t.name,
      fields: (t.fields || []).map(f => ({ name: f.name, type: f.type })),
    }));

    // Raw recent records from whichever table is requested (defaults to Affiliate
    // EOD), so we can see real field names + values in use, not just schema names.
    const targetTable = req.query.table || 'Affiliate EOD';
    const recordsRes = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(targetTable)}?pageSize=10&sort[0][field]=Date&sort[0][direction]=desc`,
      { headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` } }
    );
    const recordsData = await recordsRes.json();

    res.status(200).json({
      bases,
      usedBase: AIRTABLE_BASE,
      tables,
      queriedTable: targetTable,
      queriedTableSchema: tables.find(t => t.name === targetTable) || null,
      recentRecords: (recordsData.records || []).map(r => r.fields),
      recordsError: recordsData.error || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
