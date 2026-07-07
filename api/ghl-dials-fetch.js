const GHL_KEY      = process.env.GHL_API_KEY;
const LOCATION_ID  = process.env.GHL_LOCATION_ID;
const GHL_BASE     = 'https://services.leadconnectorhq.com';
const GHL_HEADERS  = { 'Authorization': `Bearer ${GHL_KEY}`, 'Version': '2021-07-28' };

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!GHL_KEY) return res.status(500).json({ error: 'GHL_API_KEY not set' });

  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const startTs = todayStart.getTime();

    // Fetch users so we can map userId → name
    const usersRes = await fetch(`${GHL_BASE}/users/?locationId=${LOCATION_ID}`, { headers: GHL_HEADERS });
    const usersData = await usersRes.json();
    const userMap = {};
    for (const u of usersData.users || []) userMap[u.id] = u.name || u.firstName || u.email || u.id;

    // Fetch all TYPE_CALL conversations updated today
    let allConvs = [];
    let nextUrl = `${GHL_BASE}/conversations/search?locationId=${LOCATION_ID}&limit=100&startDate=${startTs}`;
    while (nextUrl) {
      const r = await fetch(nextUrl, { headers: GHL_HEADERS });
      const d = await r.json();
      const convs = (d.conversations || []).filter(c => c.lastMessageType === 'TYPE_CALL');
      allConvs = allConvs.concat(convs);
      nextUrl = d.meta?.nextPageUrl || null;
      if (allConvs.length >= 500) break;
    }

    // For each conversation, get messages from today and count outbound calls per rep
    const repDials = {};    // userId → { name, dials, contacts: Set }
    const contactCalls = {}; // contactId → call count today (for double dial)

    await Promise.all(allConvs.map(async conv => {
      const r = await fetch(`${GHL_BASE}/conversations/${conv.id}/messages?limit=100`, { headers: GHL_HEADERS });
      const d = await r.json();
      const msgs = d.messages?.messages || [];

      for (const msg of msgs) {
        if (msg.messageType !== 'TYPE_CALL') continue;
        if (msg.direction !== 'outbound') continue;
        const msgDate = new Date(msg.dateAdded);
        if (msgDate < todayStart) continue;

        const uid = msg.userId || 'unknown';
        if (!repDials[uid]) repDials[uid] = { name: userMap[uid] || uid, dials: 0, contacts: new Set() };
        repDials[uid].dials++;
        repDials[uid].contacts.add(conv.contactId);

        contactCalls[conv.contactId] = (contactCalls[conv.contactId] || 0) + 1;
      }
    }));

    const result = Object.values(repDials)
      .map(r => ({ rep: r.name, dials: r.dials, uniqueContacts: r.contacts.size }))
      .sort((a, b) => b.dials - a.dials);

    const doubleDials = Object.values(contactCalls).filter(c => c >= 2).length;

    res.status(200).json({ reps: result, doubleDials, totalDials: result.reduce((s, r) => s + r.dials, 0) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
