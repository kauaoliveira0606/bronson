module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).end();

  const body = req.body || {};
  const { name, email, phone, webhook } = body;
  console.log('collect-lead:', JSON.stringify({ name, email, phone, webhook }));

  // Phone is optional on the masterclass form only.
  if (!email || !name || (!phone && webhook !== 'masterclass')) {
    console.log('Rejected: missing required fields');
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const urls = {
    lt:   'https://kauaoliveira06.app.n8n.cloud/webhook/free-course-lt-optin',
    paid: 'https://kauaoliveira06.app.n8n.cloud/webhook/free-course-paid-optin',
  };

  // Masterclass registrations: no destination wired yet. Until MASTERCLASS_WEBHOOK_URL
  // is set, registrations are only written to the function logs.
  if (webhook === 'masterclass') urls.masterclass = process.env.MASTERCLASS_WEBHOOK_URL;

  const url = urls[webhook];
  if (!url) {
    if (webhook === 'masterclass') {
      console.log('MASTERCLASS LEAD (no webhook set):', JSON.stringify(body));
      return res.status(200).json({ ok: true });
    }
    console.log('Unknown webhook:', webhook);
    return res.status(400).json({ error: 'Unknown webhook' });
  }

  const payload = webhook === 'masterclass'
    ? {
        name, email, phone: phone || '',
        smsMarketingConsent: !!body.smsMarketingConsent,
        smsTransactionalConsent: !!body.smsTransactionalConsent,
        masterclassDate: body.masterclassDate, pageUrl: body.pageUrl, source: 'masterclass',
      }
    : { name, email, phone };

  try {
    const zRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    console.log('Zapier response:', zRes.status, url);
  } catch (e) {
    console.error('Zapier call failed:', e);
  }

  res.status(200).json({ ok: true });
};
