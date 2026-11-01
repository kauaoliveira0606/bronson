// One-click masterclass registration for /magnet-masterclass. The page passes the name,
// email and phone the lead already gave us; this registers them through the WebinarJam API
// for the next scheduled session. The n8n poller (bVSWLTEH1cHOsNDH) picks them up from there.
// WebinarJam requires first name, email and phone. Anything else failing here makes the page
// fall back to the WebinarJam registration page, so nobody gets stuck.

const WEBINAR_ID = '2';
const API = 'https://api.webinarjam.com/webinarjam';
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

async function wj(path, fields) {
  const r = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ api_key: process.env.WEBINARJAM_API_KEY, webinar_id: WEBINAR_ID, ...fields }),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok && data.status === 'success', data };
}

// Schedule dates are New York wall-clock strings ("2026-11-04 19:00"), so they compare as text.
function nextSchedule(schedules, now) {
  const p = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(now).forEach((x) => { p[x.type] = x.value; });
  const nowNy = p.year + '-' + p.month + '-' + p.day + ' ' + p.hour + ':' + p.minute;
  return (schedules || [])
    .filter((s) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s.date || '') && s.date > nowNy)
    .sort((a, b) => (a.date < b.date ? -1 : 1))[0];
}

// US/Canada numbers only; other countries go through the WebinarJam page, which asks for the code.
function usPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits[0] === '1') return digits.slice(1);
  return '';
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const body = req.body || {};
  const firstName = String(body.fname || '').trim().slice(0, 80);
  const email = String(body.email || '').trim().slice(0, 200);
  const phone = usPhone(body.phone);
  if (!firstName || !phone || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: 'missing_details' });
  }

  try {
    const webinar = await wj('/webinar', {});
    const session = nextSchedule(webinar.data.webinar && webinar.data.webinar.schedules, new Date());
    if (!session) return res.status(502).json({ ok: false, error: 'no_session' });

    const fields = {
      first_name: firstName,
      email,
      phone_country_code: '+1',
      phone,
      schedule: String(session.schedule),
    };
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (ip) fields.ip_address = ip;
    UTM_KEYS.forEach((k) => { if (body[k]) fields[k] = String(body[k]).slice(0, 200); });

    const reg = await wj('/register', fields);
    if (!reg.ok) {
      console.error('WebinarJam register failed', reg.data && reg.data.message, reg.data && reg.data.errors);
      return res.status(502).json({ ok: false, error: 'register_failed' });
    }
    return res.status(200).json({ ok: true, session: session.date });
  } catch (err) {
    console.error('WebinarJam register error', err);
    return res.status(502).json({ ok: false, error: 'register_failed' });
  }
}
