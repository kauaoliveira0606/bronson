const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE  = 'appiMw8gpaLv2WITA';
const GHL_KEY        = process.env.GHL_API_KEY;
const LOCATION_ID    = process.env.GHL_LOCATION_ID;
const GHL_BASE       = 'https://services.leadconnectorhq.com';
const GHL_HEADERS    = { 'Authorization': `Bearer ${GHL_KEY}`, 'Version': '2021-07-28' };

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const out = {};

  // 1. Check Airtable Speed to Lead records (all, no date filter)
  try {
    const r = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent('Speed to Lead')}?pageSize=10&sort[0][field]=Created%20At&sort[0][direction]=desc`,
      { headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` } }
    );
    const d = await r.json();
    out.airtable_stl_count = d.records?.length ?? 'error';
    out.airtable_stl_sample = (d.records || []).slice(0, 5).map(r => ({
      id: r.id,
      contactId: r.fields['Contact ID'],
      name: r.fields['Name'],
      createdAt: r.fields['Created At'],
      firstCallAt: r.fields['First Call At'],
      status: r.fields['Status'],
    }));
    out.airtable_error = d.error || null;
  } catch (e) {
    out.airtable_error = e.message;
  }

  // 2. Check GHL users
  try {
    const r = await fetch(`${GHL_BASE}/users/?locationId=${LOCATION_ID}`, { headers: GHL_HEADERS });
    const d = await r.json();
    out.ghl_users = (d.users || []).map(u => ({ id: u.id, name: u.name || u.firstName, email: u.email }));
  } catch (e) {
    out.ghl_users_error = e.message;
  }

  // 3. Check GHL conversations from today
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const r = await fetch(
      `${GHL_BASE}/conversations/search?locationId=${LOCATION_ID}&limit=20&startDate=${todayStart.getTime()}`,
      { headers: GHL_HEADERS }
    );
    const d = await r.json();
    out.ghl_convs_today = (d.conversations || []).slice(0, 10).map(c => ({
      id: c.id,
      contactId: c.contactId,
      lastMessageType: c.lastMessageType,
      lastMessageDate: c.lastMessageDate,
    }));
    out.ghl_convs_total = d.conversations?.length ?? 0;
    out.ghl_convs_error = d.message || null;
  } catch (e) {
    out.ghl_convs_error = e.message;
  }

  // 4. Check GHL webhook log table
  try {
    const r = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent('GHL Webhook Log')}?pageSize=5&sort[0][field]=Received%20At&sort[0][direction]=desc`,
      { headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}` } }
    );
    const d = await r.json();
    out.webhook_log_count = d.records?.length ?? 'error';
    out.webhook_log_sample = (d.records || []).map(r => ({
      receivedAt: r.fields['Received At'],
      payload: r.fields['Payload']?.slice(0, 300),
    }));
  } catch (e) {
    out.webhook_log_error = e.message;
  }

  res.status(200).json(out);
};
