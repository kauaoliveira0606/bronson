const DISCORD_WEBHOOK  = process.env.DISCORD_WEBHOOK_URL;
const AIRTABLE_TOKEN   = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE    = 'appiMw8gpaLv2WITA';
const AIRTABLE_TABLE   = 'Affiliate EOD';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).end();

  const { rep_name, report_date, dials, pickups, pitched, closed } = req.body;
  if (!rep_name || !report_date) return res.status(400).json({ error: 'Missing fields' });

  // Write to Airtable
  if (AIRTABLE_TOKEN) {
    await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          'Your name':        rep_name,
          'Date':            report_date,
          'Outbound Dials':  Number(dials)   || 0,
          'Pick ups':         Number(pickups) || 0,
          'Software Pitched': Number(pitched) || 0,
          'Software Closed':  Number(closed)  || 0,
        },
      }),
    }).catch(e => console.error('Airtable write error:', e));
  }

  // Send to Discord
  if (DISCORD_WEBHOOK) {
    const pickup_rate = dials > 0 ? ((pickups / dials) * 100).toFixed(1) : '0.0';
    const close_rate  = pitched > 0 ? ((closed / pitched) * 100).toFixed(1) : '0.0';
    const content =
      `📊 **EOD Report — ${rep_name}** · ${report_date}\n` +
      `> 📞 Outbound Dials: **${dials}**\n` +
      `> ✅ Pickups: **${pickups}** (${pickup_rate}% pickup rate)\n` +
      `> 🎯 Software Pitched: **${pitched}**\n` +
      `> 💰 Software Closed: **${closed}** (${close_rate}% close rate)`;
    await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }).catch(() => {});
  }

  res.status(200).json({ ok: true });
};
