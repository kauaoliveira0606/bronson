const SB_URL = 'https://gpthswrobafxtmsuouph.supabase.co/rest/v1';
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).end();

  if (!SB_SERVICE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY not configured' });

  try {
    const { email, prog, activity } = req.body;
    if (!email) return res.status(400).json({ error: 'Missing email' });

    const response = await fetch(
      `${SB_URL}/profiles?email=eq.${encodeURIComponent(email)}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SB_SERVICE_KEY,
          'Authorization': `Bearer ${SB_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ prog: prog || {}, activity: activity || {} }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      console.error('Supabase update error:', response.status, err);
      return res.status(502).json({ error: 'Database update failed' });
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('save-progress error:', e);
    res.status(500).json({ error: e.message });
  }
};
