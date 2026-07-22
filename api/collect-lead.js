module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).end();

  const body = req.body || {};
  const { name, email, phone, webhook } = body;
  console.log('collect-lead:', JSON.stringify({ name, email, phone, webhook }));

  if (!email || !name || !phone) {
    console.log('Rejected: missing required fields');
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const urls = {
    lt:   'https://hooks.zapier.com/hooks/catch/22609617/432dfrr/',
    paid: 'https://hooks.zapier.com/hooks/catch/22609617/4423sfn/',
  };

  const url = urls[webhook];
  if (!url) {
    console.log('Unknown webhook:', webhook);
    return res.status(400).json({ error: 'Unknown webhook' });
  }

  try {
    const zRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, phone }),
    });
    console.log('Zapier response:', zRes.status, url);
  } catch (e) {
    console.error('Zapier call failed:', e);
  }

  res.status(200).json({ ok: true });
};
