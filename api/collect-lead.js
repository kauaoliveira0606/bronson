module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).end();

  const body = req.body || {};
  const { name, email, phone, webhook } = body;
  console.log('collect-lead:', JSON.stringify({ name, email, phone, webhook }));

  // Masterclass form only: phone is optional, and a partial (filled in but never
  // submitted) capture just needs an email.
  const partial = webhook === 'masterclass' && body.partial === true;
  if (!email || (!name && !partial) || (!phone && webhook !== 'masterclass')) {
    console.log('Rejected: missing required fields');
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const urls = {
    lt:   'https://kauaoliveira06.app.n8n.cloud/webhook/free-course-lt-optin',
    paid: 'https://kauaoliveira06.app.n8n.cloud/webhook/free-course-paid-optin',
    masterclass: 'https://kauaoliveira06.app.n8n.cloud/webhook/masterclass-optin',
    // Encore sessions (AEvent). n8n HiYBMTsmhwFh0tRb registers them in AEvent, then GHL + Discord.
    encore: 'https://kauaoliveira06.app.n8n.cloud/webhook/encore-optin',
  };

  const url = urls[webhook];
  if (!url) {
    console.log('Unknown webhook:', webhook);
    return res.status(400).json({ error: 'Unknown webhook' });
  }

  const payload = webhook === 'encore'
    ? {
        name, email, phone: phone || '',
        masterclassDate: body.masterclassDate, masterclassLabel: body.masterclassLabel, pageUrl: body.pageUrl, source: 'encore',
        utm_source: body.utm_source, utm_medium: body.utm_medium, utm_campaign: body.utm_campaign, utm_term: body.utm_term, utm_content: body.utm_content,
      }
    : webhook === 'masterclass'
    ? {
        name: name || '', email, phone: phone || '',
        capital: body.capital || '',
        partial,
        smsMarketingConsent: !partial && !!body.smsMarketingConsent,
        smsTransactionalConsent: !partial && !!body.smsTransactionalConsent,
        masterclassDate: body.masterclassDate, masterclassLabel: body.masterclassLabel, pageUrl: body.pageUrl, source: 'masterclass',
      }
    : { name, email, phone };

  // Encore: n8n answers right after AEvent registers them, with their personal join link.
  if (webhook === 'encore') {
    try {
      const nRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(25000),
      });
      const data = await nRes.json().catch(() => ({}));
      if (!nRes.ok) return res.status(502).json({ error: 'register_failed' });
      return res.status(200).json({ ok: true, joinURL: typeof data.joinURL === 'string' ? data.joinURL : '' });
    } catch (e) {
      console.error('Encore n8n call failed:', e);
      return res.status(502).json({ error: 'register_failed' });
    }
  }

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
