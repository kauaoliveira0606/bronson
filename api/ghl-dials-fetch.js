const GHL_KEY      = process.env.GHL_API_KEY;
const LOCATION_ID  = process.env.GHL_LOCATION_ID;
const GHL_BASE     = 'https://services.leadconnectorhq.com';
const GHL_HEADERS  = { 'Authorization': `Bearer ${GHL_KEY}`, 'Version': '2021-07-28' };

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!GHL_KEY) return res.status(500).json({ error: 'GHL_API_KEY not set' });

  try {
    const filter = req.query.filter || 'today';
    const now    = new Date();
    const nyNow  = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const offset = now.getTime() - nyNow.getTime();

    // Set time window — today or yesterday
    const todayMid = new Date(nyNow); todayMid.setHours(0, 0, 0, 0);
    const todayStart = new Date(todayMid.getTime() + offset);
    let periodStart = todayStart;
    let periodEnd   = null;
    if (filter === 'yesterday') {
      const yestMid = new Date(nyNow); yestMid.setDate(nyNow.getDate() - 1); yestMid.setHours(0, 0, 0, 0);
      periodStart = new Date(yestMid.getTime() + offset);
      periodEnd   = todayStart;
    }

    // Fetch users so we can map userId → name
    const usersRes = await fetch(`${GHL_BASE}/users/?locationId=${LOCATION_ID}`, { headers: GHL_HEADERS });
    const usersData = await usersRes.json();
    const userMap = {};
    for (const u of usersData.users || []) userMap[u.id] = u.name || u.firstName || u.email || u.id;

    // Fetch recent conversations without startDate filter — startDate filters on
    // conversation createdAt, not message timestamps, so leads from prior days
    // whose conversations were created before today would be missed entirely.
    // We rely solely on the per-message dateAdded check below to scope to today.
    let allConvs = [];
    let nextUrl = `${GHL_BASE}/conversations/search?locationId=${LOCATION_ID}&limit=100`;
    while (nextUrl) {
      const r = await fetch(nextUrl, { headers: GHL_HEADERS });
      const d = await r.json();
      allConvs = allConvs.concat(d.conversations || []);
      nextUrl = d.meta?.nextPageUrl || null;
      if (allConvs.length >= 1000) break;
    }

    // For each conversation, get messages from today and count outbound calls per rep
    const repDials = {};    // userId → { name, dials, pickups, convs2min, contacts: Set }
    const contactCalls = {}; // contactId → call count today (for double dial)
    const debugSamples = []; // raw call messages for ?debug=1

    await Promise.all(allConvs.map(async conv => {
      const r = await fetch(`${GHL_BASE}/conversations/${conv.id}/messages?limit=100`, { headers: GHL_HEADERS });
      const d = await r.json();
      const msgs = d.messages?.messages || [];

      for (const msg of msgs) {
        if (msg.messageType !== 'TYPE_CALL') continue;
        if (msg.direction !== 'outbound') continue;
        const msgDate = new Date(msg.dateAdded);
        if (msgDate < periodStart) continue;
        if (periodEnd && msgDate >= periodEnd) continue;

        if (debugSamples.length < 10) debugSamples.push(msg);

        const uid      = msg.userId || 'unknown';
        const duration = msg.meta?.call?.duration ?? null;
        const isPickup = duration !== null && duration >= 20;
        const isLong   = duration !== null && duration >= 120;

        if (!repDials[uid]) repDials[uid] = { name: userMap[uid] || uid, dials: 0, pickups: 0, convs2min: 0, contacts: new Set() };
        repDials[uid].dials++;
        repDials[uid].contacts.add(conv.contactId);
        if (isPickup) repDials[uid].pickups++;
        if (isLong)   repDials[uid].convs2min++;

        contactCalls[conv.contactId] = (contactCalls[conv.contactId] || 0) + 1;
      }
    }));

    if (req.query.debug === '1') return res.status(200).json({ samples: debugSamples, userMap });

    const result = Object.values(repDials)
      .map(r => ({ rep: r.name, dials: r.dials, pickups: r.pickups, convs2min: r.convs2min, uniqueContacts: r.contacts.size }))
      .sort((a, b) => b.dials - a.dials);

    const doubleDials      = Object.values(contactCalls).filter(c => c >= 2).length;
    const totalDials       = result.reduce((s, r) => s + r.dials, 0);
    const totalPickups     = result.reduce((s, r) => s + r.pickups, 0);
    const totalConvs2min   = result.reduce((s, r) => s + r.convs2min, 0);

    res.status(200).json({ reps: result, doubleDials, totalDials, totalPickups, totalConvs2min });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
