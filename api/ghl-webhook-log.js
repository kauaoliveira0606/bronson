const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const body = req.body || {};

  // Log raw payload to Discord so we can see exactly what GHL sends
  if (DISCORD_WEBHOOK) {
    await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '🔍 **GHL Webhook Raw Payload:**\n```json\n' + JSON.stringify(body, null, 2).slice(0, 1800) + '\n```'
      }),
    }).catch(() => {});
  }

  res.status(200).json({ ok: true, received: body });
};
