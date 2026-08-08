const AIRTABLE_TOKEN  = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE   = 'app22YDOcrHhq1Q1j'; // Section 8 Playbook
const AIRTABLE_TABLE  = 'Affiliate EOD';
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL_SECTION8;

function yesterdayEST() {
  const nyStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const [y, m, d] = nyStr.split('-').map(Number);
  const prev = new Date(y, m - 1, d - 1);
  return {
    iso:     `${prev.getFullYear()}-${String(prev.getMonth()+1).padStart(2,'0')}-${String(prev.getDate()).padStart(2,'0')}`,
    display: prev.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
  };
}

const MEDALS = ['🥇', '🥈', '🥉'];

function buildRanking(reps, key, format) {
  return [...reps]
    .sort((a, b) => b[key] - a[key])
    .filter(r => r[key] > 0)
    .map((r, i) => `${MEDALS[i] || `${i+1}.`} ${r.name} — ${format(r[key])}`)
    .join('\n') || 'No submissions yet';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'AIRTABLE_TOKEN not set' });
  if (!DISCORD_WEBHOOK) return res.status(500).json({ error: 'DISCORD_WEBHOOK_URL_SECTION8 not set' });

  const { iso, display } = yesterdayEST();

  const formula = encodeURIComponent(`IS_SAME({Date},"${iso}","day")`);
  const r = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(AIRTABLE_TABLE)}?filterByFormula=${formula}&pageSize=100`,
    { headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` } }
  );
  const data = await r.json();
  const records = data.records || [];

  if (req.query.debug === '1') return res.status(200).json({ iso, records: records.map(rec => rec.fields) });

  if (!records.length) {
    return res.status(200).json({ ok: true, message: `No EOD submissions found for ${iso}` });
  }

  // Aggregate by rep name (handle duplicate submissions by summing)
  const repMap = {};
  for (const rec of records) {
    const f     = rec.fields;
    const name  = f['Your name'] || 'Unknown';
    const cash  = (Number(f['Cash collected high ticket']) || 0) + (Number(f['Cash collected low ticket']) || 0);
    const dials = Number(f['Outbound dials']) || 0;
    if (!repMap[name]) repMap[name] = { name, cash: 0, dials: 0 };
    repMap[name].cash  += cash;
    repMap[name].dials += dials;
  }
  const reps = Object.values(repMap);

  const cashRanking  = buildRanking(reps, 'cash',  v => `$${v.toLocaleString()}`);
  const dialsRanking = buildRanking(reps, 'dials', v => v.toLocaleString());

  const totalCash  = reps.reduce((s, r) => s + r.cash,  0);
  const totalDials = reps.reduce((s, r) => s + r.dials, 0);

  const embed = {
    title:  `🏠 Section 8 Playbook Daily Leaderboard — ${display}`,
    color:  0x22c55e,
    fields: [
      { name: '💰 Cash Collected',  value: cashRanking,  inline: true },
      { name: '📞 Outbound Dials',  value: dialsRanking, inline: true },
    ],
    footer: { text: `Team total: $${totalCash.toLocaleString()} collected · ${totalDials.toLocaleString()} dials` },
  };

  const discordRes = await fetch(DISCORD_WEBHOOK, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ embeds: [embed] }),
  });

  if (!discordRes.ok) {
    const err = await discordRes.text();
    return res.status(500).json({ error: 'Discord post failed', detail: err });
  }

  res.status(200).json({ ok: true, reps: reps.length, totalCash, totalDials });
};
