// Lead magnet "Save My Seat" posts here; forwards to n8n (workflow uJpsrm8K9Faehv4d),
// which registers the lead with WebinarJam and answers with { ok }.
const WEBHOOK = 'https://kauaoliveira06.app.n8n.cloud/webhook/magnet-register';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const body = req.body || {};
  const clean = (v, max) => String(v || '').trim().slice(0, max);
  const payload = {
    firstName: clean(body.firstName, 80),
    lastName: clean(body.lastName, 80),
    email: clean(body.email, 200),
    phone: clean(body.phone, 40),
  };
  if (!payload.firstName || !payload.phone || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    return res.status(400).json({ ok: false, error: 'missing_details' });
  }

  try {
    const r = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (!data.ok) console.error('magnet-register not registered', data.errors);
    return res.status(data.ok ? 200 : 502).json({ ok: !!data.ok });
  } catch (err) {
    console.error('magnet-register failed', err);
    return res.status(502).json({ ok: false });
  }
}
