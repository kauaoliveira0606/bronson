const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).end();

  if (!DISCORD_WEBHOOK) return res.status(500).json({ error: 'DISCORD_WEBHOOK_URL env var not set' });

  try {
    const { email, tab, action, fileName, fileType, fileBase64 } = req.body;

    if (!email) return res.status(400).json({ error: 'Missing email' });

    // Text-only message (e.g. access requests with no file)
    if (!fileBase64) {
      const content = tab === 'access-request'
        ? `🔔 **New Portal Access Request**\n**Email:** ${email}\nGo to the admin panel to approve.`
        : `📋 **New Submission**\n**Email:** ${email}\n**Tab:** ${tab}\n**Action:** ${action}`;
      const response = await fetch(DISCORD_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!response.ok) console.error('Discord error:', await response.text());
      return res.status(200).json({ ok: true });
    }

    const fileBuffer = Buffer.from(fileBase64, 'base64');
    const boundary = '----DiscordBoundary' + Date.now().toString(36);
    const content = `📸 **New Proof Submission**\n**Email:** ${email}\n**Tab:** ${tab}\n**Action:** ${action}`;

    const preamble = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="content"\r\n\r\n` +
      content +
      `\r\n--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${fileName || 'proof.png'}"\r\n` +
      `Content-Type: ${fileType || 'image/png'}\r\n\r\n`,
      'utf-8'
    );
    const epilogue = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
    const body = Buffer.concat([preamble, fileBuffer, epilogue]);

    const response = await fetch(DISCORD_WEBHOOK + '?wait=true', {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Discord error:', err);
      return res.status(502).json({ error: 'Discord delivery failed' });
    }

    const msg = await response.json();
    const proofUrl = msg?.attachments?.[0]?.url || null;
    res.status(200).json({ ok: true, proof_url: proofUrl });
  } catch (e) {
    console.error('discord-proof error:', e);
    res.status(500).json({ error: e.message });
  }
};
