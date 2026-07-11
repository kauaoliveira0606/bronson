// Cron: runs every 3 days via vercel.json
// Pulls upcoming live_calls from aistorebuilder Supabase, maps to 4 slots,
// writes to bronson coaching_settings so the Coaching Calls tab is always current.

const ASBUILDER_URL  = 'https://aucakdtwvdhedqttxbyo.supabase.co';
const ASBUILDER_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1Y2FrZHR3dmRoZWRxdHR4YnlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc1NTgzNTQsImV4cCI6MjA4MzEzNDM1NH0.QGsc4_bjEEEVkxt6m3AB623mNktFHsU3rItvmhinB_g';
const ASBUILDER_EMAIL = process.env.ASBUILDER_EMAIL;
const ASBUILDER_PASS  = process.env.ASBUILDER_PASS;

const BRONSON_URL = 'https://gpthswrobafxtmsuouph.supabase.co/rest/v1';
const BRONSON_KEY = 'sb_publishable_OohV5WdfvqHdsgcjKZqFGg_DE7SZmtD';

// Maps call title keyword → which slot index it fills
// Slot 0: wix-monthly (Kiryl)
// Slot 1: wix-yearly call 1 (Julia first)
// Slot 2: wix-yearly call 2 (Julia second)
// Slot 3: constant-contact (Alex)
const COACH_MAP = {
  kiryl: 0,
  julia: [1, 2],
  alex:  3,
};

const SLOT_LABELS = [
  'Wix Monthly Call',
  'Wix Yearly Call',
  'Wix Yearly Bonus Call',
  'Constant Contact Call',
];

function fmtTime(isoStr) {
  const d = new Date(isoStr);
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const day  = days[d.getUTCDay()];
  let h = d.getUTCHours() - 4; // EST = UTC-4 (adjust for EDT; close enough)
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h > 12) h -= 12;
  if (h <= 0) h += 12;
  const m = d.getUTCMinutes();
  const mStr = m > 0 ? `:${String(m).padStart(2,'0')}` : '';
  return `${day} ${h}${mStr} ${ampm} EST`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Allow manual trigger via GET or scheduled POST from Vercel cron
  try {
    // 1. Auth with aistorebuilder Supabase
    const authRes = await fetch(`${ASBUILDER_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'apikey': ASBUILDER_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ASBUILDER_EMAIL, password: ASBUILDER_PASS }),
    });
    const auth = await authRes.json();
    if (!auth.access_token) {
      return res.status(500).json({ error: 'Auth failed', detail: auth });
    }

    // 2. Fetch next 14 days of live calls
    const now  = new Date().toISOString();
    const soon = new Date(Date.now() + 14 * 86400000).toISOString();
    const callsRes = await fetch(
      `${ASBUILDER_URL}/rest/v1/live_calls?scheduled_at=gte.${now}&scheduled_at=lte.${soon}&order=scheduled_at.asc&limit=50`,
      { headers: { 'apikey': ASBUILDER_KEY, 'Authorization': `Bearer ${auth.access_token}` } }
    );
    const calls = await callsRes.json();
    if (!Array.isArray(calls)) {
      return res.status(500).json({ error: 'Bad calls response', detail: calls });
    }

    // 3. Map to 4 slots — pick next upcoming per coach
    const slots = [null, null, null, null];
    const juliaCount = { n: 0 };

    for (const call of calls) {
      const name = call.title.toLowerCase();
      if (name.includes('kiryl') && slots[0] === null) {
        slots[0] = { label: SLOT_LABELS[0], time: fmtTime(call.scheduled_at), link: call.meeting_link };
      } else if (name.includes('julia')) {
        if (juliaCount.n === 0 && slots[1] === null) {
          slots[1] = { label: SLOT_LABELS[1], time: fmtTime(call.scheduled_at), link: call.meeting_link };
          juliaCount.n++;
        } else if (juliaCount.n === 1 && slots[2] === null) {
          slots[2] = { label: SLOT_LABELS[2], time: fmtTime(call.scheduled_at), link: call.meeting_link };
          juliaCount.n++;
        }
      } else if (name.includes('alex') && slots[3] === null) {
        slots[3] = { label: SLOT_LABELS[3], time: fmtTime(call.scheduled_at), link: call.meeting_link };
      }
      if (slots.every(s => s !== null)) break;
    }

    // Fill any missing slots with empty placeholders
    const finalCalls = slots.map((s, i) => s || { label: SLOT_LABELS[i], time: '', link: '' });

    // 4. Write to bronson coaching_settings (upsert: PATCH row 1, INSERT if missing)
    const details = JSON.stringify({ calls: finalCalls, synced_at: new Date().toISOString() });
    const bronsonHeaders = {
      'apikey': BRONSON_KEY,
      'Authorization': `Bearer ${BRONSON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    };

    let saveRes = await fetch(`${BRONSON_URL}/coaching_settings?id=eq.1`, {
      method: 'PATCH',
      headers: bronsonHeaders,
      body: JSON.stringify({ details }),
    });

    // If no row exists yet, insert it
    if (saveRes.status === 404 || saveRes.status === 406) {
      saveRes = await fetch(`${BRONSON_URL}/coaching_settings`, {
        method: 'POST',
        headers: bronsonHeaders,
        body: JSON.stringify({ zoom_link: '', details }),
      });
    }

    if (!saveRes.ok && saveRes.status !== 201) {
      const err = await saveRes.text();
      return res.status(500).json({ error: 'Save failed', status: saveRes.status, detail: err });
    }

    return res.status(200).json({ ok: true, calls: finalCalls });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
