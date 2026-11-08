// Masterclass registration for /masterclass, /masterclass-paid and /magnet-masterclass. The page
// passes name, email, phone and UTMs; this registers them through the WebinarJam API for the next
// scheduled session. The n8n poller (bVSWLTEH1cHOsNDH) picks them up from there.
// WebinarJam requires first name, email and phone. Anything else failing here makes the page
// show an error or fall back, so nobody gets stuck.
// If WebinarJam stays down (or has no upcoming session) the lead goes in Masterclass Form Log and
// still reaches the confirmation page. A Vercel cron GETs this route every 5 minutes to register them.
// The WebinarJam API does not store UTMs, so they go to Airtable first and the poller merges
// them in by email. That is what makes an ad sign-up count as paid.

const WEBINAR_ID = '2';
const UTM_TABLE = 'https://api.airtable.com/v0/appiMw8gpaLv2WITA/Masterclass%20Form%20UTMs';
const LOG_TABLE = 'https://api.airtable.com/v0/appiMw8gpaLv2WITA/Masterclass%20Form%20Log';
const GIVE_UP_AFTER = 2016; // 7 days of 5-minute retries
const API = 'https://api.webinarjam.com/webinarjam';
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Runs fn up to 3 times. fn returns { ok } or throws; the last result is returned.
async function withRetries(fn) {
  let last = { ok: false, error: 'not_run' };
  for (let i = 0; i < 3; i++) {
    if (i) await wait(500 * i);
    try {
      last = await fn();
      if (last.ok) return last;
    } catch (err) {
      last = { ok: false, error: err.message };
    }
  }
  return last;
}

function wj(path, fields) {
  return withRetries(async () => {
    const r = await fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ api_key: process.env.WEBINARJAM_API_KEY, webinar_id: WEBINAR_ID, ...fields }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok && data.status === 'success', data, error: 'WebinarJam ' + r.status + ' ' + JSON.stringify(data.message || data.errors || '') };
  });
}

function airtable(url, method, body) {
  return withRetries(async () => {
    const r = await fetch(url, {
      method,
      headers: { Authorization: 'Bearer ' + process.env.AIRTABLE_TOKEN, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(8000),
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, data, error: 'Airtable ' + r.status };
  });
}

// Sign-ups go to this session or later (user, 2026-11-08: next masterclass is Mon Nov 16, 7 PM ET).
const EARLIEST_SESSION = '2026-11-16 00:00';

// Schedule dates are New York wall-clock strings ("2026-11-04 19:00"), so they compare as text.
function nextSchedule(schedules, now) {
  const p = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(now).forEach((x) => { p[x.type] = x.value; });
  const nowNy = p.year + '-' + p.month + '-' + p.day + ' ' + p.hour + ':' + p.minute;
  return (schedules || [])
    .filter((s) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s.date || '') && s.date > nowNy && s.date >= EARLIEST_SESSION)
    .sort((a, b) => (a.date < b.date ? -1 : 1))[0];
}

// Calling code per country, for numbers typed without a + (Vercel tells us the visitor's country).
const CALLING_CODES = {
  US: '1', CA: '1', GB: '44', AU: '61', NZ: '64', IE: '353', ZA: '27', NG: '234', KE: '254', GH: '233', UG: '256', TZ: '255',
  EG: '20', MA: '212', DZ: '213', TN: '216', ET: '251', ZM: '260', ZW: '263', IN: '91', PK: '92', BD: '880', LK: '94', NP: '977',
  PH: '63', MY: '60', SG: '65', ID: '62', TH: '66', VN: '84', HK: '852', TW: '886', CN: '86', JP: '81', KR: '82',
  AE: '971', SA: '966', QA: '974', KW: '965', BH: '973', OM: '968', JO: '962', LB: '961', IQ: '964', IL: '972', TR: '90',
  DE: '49', FR: '33', ES: '34', IT: '39', PT: '351', NL: '31', BE: '32', CH: '41', AT: '43', SE: '46', NO: '47', DK: '45', FI: '358',
  PL: '48', CZ: '420', SK: '421', HU: '36', RO: '40', BG: '359', GR: '30', HR: '385', RS: '381', SI: '386', UA: '380', RU: '7',
  LT: '370', LV: '371', EE: '372', CY: '357', MT: '356', LU: '352', IS: '354', AL: '355',
  MX: '52', BR: '55', AR: '54', CL: '56', CO: '57', PE: '51', VE: '58', EC: '593', BO: '591', PY: '595', UY: '598',
  DO: '1', PR: '1', JM: '1', TT: '1', BS: '1', CR: '506', PA: '507', GT: '502', HN: '504', SV: '503', NI: '505',
};
// Every other code a number typed with a + can start with.
const OTHER_CODES = '93 98 95 211 218 220 221 222 223 224 225 226 227 228 229 230 231 232 235 236 237 238 239 240 241 242 243 244 245 246 248 249 250 252 257 258 261 262 264 265 266 267 268 269 290 291 297 298 299 350 373 374 375 376 377 378 379 382 383 387 389 423 500 501 508 509 590 592 594 596 597 599 670 672 673 674 675 676 677 678 679 680 681 682 683 685 686 687 688 689 690 691 692 850 853 855 856 870 960 963 967 970 975 976 992 993 994 995 996 998'.split(' ');
const ALL_CODES = new Set([...Object.values(CALLING_CODES), ...OTHER_CODES]);

// Returns WebinarJam's two phone fields, or null when the number can't be a real one.
// "+44 7911..." is read as typed; without a +, the visitor's country decides the code.
function parsePhone(raw, country) {
  const typed = String(raw || '').trim();
  let digits = typed.replace(/\D/g, '');
  let code = '';
  if (typed[0] === '+' || typed.startsWith('00')) {
    digits = digits.replace(/^0+/, '');
    code = [3, 2, 1].map((n) => digits.slice(0, n)).find((c) => ALL_CODES.has(c));
    if (!code) return null;
    digits = digits.slice(code.length);
  } else {
    // A country we can't map must type the +, rather than getting a wrong +1 number.
    code = country ? CALLING_CODES[country] : '1';
    if (!code) return null;
    if (digits.length >= code.length + 10 && digits.startsWith(code)) digits = digits.slice(code.length);
  }
  if (code !== '1') digits = digits.replace(/^0+/, '');
  if (new Set(digits).size < 3) return null;
  const valid = code === '1' ? /^[2-9]\d{9}$/.test(digits) : digits.length >= 6 && digits.length <= 14;
  return valid ? { phone_country_code: '+' + code, phone: digits } : null;
}

// A failure here must not cost the sign-up, so it only logs.
async function saveUtms(email, utms, page) {
  if (!Object.keys(utms).length) return;
  const saved = await airtable(UTM_TABLE, 'POST', {
    records: [{ fields: { Email: email.toLowerCase(), ...utms, Page: page, 'Created At': new Date().toISOString() } }],
  });
  if (saved.ok) return;
  console.error('Masterclass UTMs not saved', email, saved.error);
  // The log may work when this table did not. Recorded so the lead can be fixed to Paid by hand.
  await airtable(LOG_TABLE, 'POST', {
    records: [{ fields: { Email: email, Status: 'Check Source', Problem: 'utms_not_saved', 'Last Error': saved.error + ' ' + JSON.stringify(utms), Page: page, 'Created At': new Date().toISOString() } }],
  });
}

// One attempt at the next session. { ok } or { ok: false, problem, error }.
async function registerLead(lead) {
  const webinar = await wj('/webinar', {});
  if (!webinar.ok) return { ok: false, problem: 'webinarjam_down', error: webinar.error };
  const session = nextSchedule(webinar.data.webinar && webinar.data.webinar.schedules, new Date());
  if (!session) return { ok: false, problem: 'no_upcoming_session', error: 'No future session is scheduled in WebinarJam' };
  const reg = await wj('/register', { ...lead, schedule: String(session.schedule) });
  if (!reg.ok) return { ok: false, problem: 'register_failed', error: reg.error };
  return { ok: true, session: session.date };
}

// Registers everything waiting in the log.
async function retryPending(res) {
  const query = encodeURIComponent("{Status}='Pending'");
  const list = await airtable(LOG_TABLE + '?maxRecords=50&filterByFormula=' + query, 'GET');
  if (!list.ok) {
    console.error('Masterclass log not readable', list.error);
    return res.status(500).json({ ok: false });
  }
  let recovered = 0;
  const records = list.data.records || [];
  for (const rec of records) {
    const f = rec.fields;
    const fields = { first_name: f['First Name'], email: f.Email, phone_country_code: f['Phone Code'], phone: f.Phone };
    if (f['Last Name']) fields.last_name = f['Last Name'];
    if (f.IP) fields.ip_address = f.IP;
    const result = await registerLead(fields);
    const attempts = (f.Attempts || 0) + 1;
    const update = { Attempts: attempts, 'Updated At': new Date().toISOString() };
    if (result.ok) {
      update.Status = 'Recovered';
      recovered++;
    } else {
      update.Problem = result.problem;
      update['Last Error'] = result.error;
      if (attempts >= GIVE_UP_AFTER) update.Status = 'Gave Up';
      console.error('Masterclass lead still not registered', f.Email, result.error);
    }
    await airtable(LOG_TABLE + '/' + rec.id, 'PATCH', { fields: update });
  }
  return res.status(200).json({ ok: true, pending: records.length, recovered });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return retryPending(res);
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const body = req.body || {};
  const firstName = String(body.fname || '').trim().slice(0, 80);
  const lastName = String(body.lname || '').trim().slice(0, 80);
  const email = String(body.email || '').trim().slice(0, 200);
  if (!firstName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: 'missing_details' });
  }
  const phone = parsePhone(body.phone, String(req.headers['x-vercel-ip-country'] || '').toUpperCase());
  if (!phone) return res.status(400).json({ ok: false, error: 'bad_phone' });

  const fields = { first_name: firstName, ...(lastName ? { last_name: lastName } : {}), email, ...phone };
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (ip) fields.ip_address = ip;
  const page = String(body.page || '').slice(0, 60);

  try {
    // UTMs first, so the poller can never see this registrant before their UTMs exist.
    const utms = {};
    UTM_KEYS.forEach((k) => { if (body[k]) utms[k] = String(body[k]).slice(0, 500); });
    await saveUtms(email, utms, page);

    const result = await registerLead(fields);
    if (result.ok) return res.status(200).json({ ok: true, session: result.session });

    console.error('WebinarJam register failed', email, result.problem, result.error);
    const logged = await airtable(LOG_TABLE, 'POST', {
      records: [{ fields: {
        Email: email, Status: 'Pending', Problem: result.problem, 'Last Error': result.error, Attempts: 0,
        'First Name': firstName, 'Last Name': lastName, 'Phone Code': phone.phone_country_code, Phone: phone.phone,
        IP: ip, Page: page, 'Created At': new Date().toISOString(),
      } }],
    });
    if (logged.ok) return res.status(200).json({ ok: true, queued: true });
    console.error('Masterclass log not saved', email, logged.error);
    return res.status(502).json({ ok: false, error: 'register_failed' });
  } catch (err) {
    console.error('WebinarJam register error', email, err);
    return res.status(502).json({ ok: false, error: 'register_failed' });
  }
}
