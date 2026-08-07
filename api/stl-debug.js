const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE  = 'appiMw8gpaLv2WITA';
const GHL_KEY        = process.env.GHL_API_KEY;
const LOCATION_ID    = process.env.GHL_LOCATION_ID;
const GHL_BASE       = 'https://services.leadconnectorhq.com';
const GHL_HEADERS    = { 'Authorization': `Bearer ${GHL_KEY}`, 'Version': '2021-07-28' };

// Returns raw diagnostic data for the first 5 "Not Called" STL records today
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Pull today's STL records with no First Call At
  const formula = encodeURIComponent(`AND({Status}="Pending",{Contact ID}!="")`);
  const r = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent('Speed to Lead')}?filterByFormula=${formula}&pageSize=5&sort[0][field]=Created%20At&sort[0][direction]=desc`,
    { headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` } }
  );
  const data = await r.json();
  const records = data.records || [];

  const results = await Promise.all(records.map(async rec => {
    const contactId = rec.fields['Contact ID'];
    const createdAt = rec.fields['Created At'];
    const name      = rec.fields['Name'];

    // Step 1: search conversations for this contact
    const convRes = await fetch(
      `${GHL_BASE}/conversations/search?locationId=${LOCATION_ID}&contactId=${contactId}&limit=20`,
      { headers: GHL_HEADERS }
    );
    const convData = await convRes.json();
    const convs = convData.conversations || [];

    // Step 2: for each conversation, get call messages
    const convDetails = await Promise.all(convs.map(async conv => {
      const msgRes = await fetch(`${GHL_BASE}/conversations/${conv.id}/messages?limit=100`, { headers: GHL_HEADERS });
      const msgData = await msgRes.json();
      const allMsgs = msgData.messages?.messages || [];
      const callMsgs = allMsgs.filter(m => m.messageType === 'TYPE_CALL');
      return {
        convId: conv.id,
        totalMessages: allMsgs.length,
        callMessages: callMsgs.map(m => ({
          direction: m.direction,
          dateAdded: m.dateAdded,
          duration: m.meta?.call?.duration ?? null,
          status: m.meta?.call?.status ?? null,
        })),
      };
    }));

    return {
      name,
      contactId,
      createdAt,
      conversationsFound: convs.length,
      conversations: convDetails,
    };
  }));

  res.status(200).json({ pendingChecked: records.length, results });
};
