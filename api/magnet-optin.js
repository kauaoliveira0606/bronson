// Lead magnet opt-in pages post here; forwards the lead to n8n (workflow SBHfns2ozopRrn9w),
// which handles GHL, the Lead Magnet pipeline, Discord and Kit.
const WEBHOOK = 'https://kauaoliveira06.app.n8n.cloud/webhook/magnet-optin';
const MAGNETS = ['ab-test', 'product-scorecard', 'profit-margin', 'subscription-vs-one-time', 'brand-name-generator'];

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const body = req.body || {};
  const clean = (v, max) => String(v || '').trim().slice(0, max);
  const payload = {
    magnet: clean(body.magnet, 40),
    firstName: clean(body.firstName, 80),
    lastName: clean(body.lastName, 80),
    email: clean(body.email, 200),
    phone: clean(body.phone, 40),
  };

  const valid = MAGNETS.includes(payload.magnet) && payload.firstName && payload.lastName && payload.phone
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email);
  if (!valid) return res.status(400).json({ ok: false, error: 'missing_details' });

  try {
    const r = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error('n8n responded ' + r.status);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('magnet-optin failed', err);
    return res.status(502).json({ ok: false });
  }
}
