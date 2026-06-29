const CLOSE_KEY = 'api_3xHOjxlKYnGOvHz5YEcXdL.1Bnd9EgXsYa05oQloxvuAH';
const AUTH = 'Basic ' + Buffer.from(CLOSE_KEY + ':').toString('base64');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { since, cursor } = req.query;
  let url = 'https://api.close.com/api/v1/lead/?_limit=100&_fields=id,display_name,status_label,date_created&_order_by=-date_created';
  if (since)  url += '&date_created__gt=' + encodeURIComponent(since);
  if (cursor) url += '&_cursor='          + encodeURIComponent(cursor);

  try {
    const upstream = await fetch(url, { headers: { Authorization: AUTH } });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
