// /student-portal proof submissions start as pending and are approved here
// once they have waited an hour, unless an admin approved or rejected them first.
// Runs every 5 minutes from vercel.json.
const SB_URL = 'https://gpthswrobafxtmsuouph.supabase.co/rest/v1';
const SB_KEY = 'sb_publishable_OohV5WdfvqHdsgcjKZqFGg_DE7SZmtD';
const headers = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' };
const WAIT_MS = 60 * 60 * 1000;
// Same list as `repeatable: true` in student-portal/index.html: these pay once a day, the rest once ever.
const REPEATABLE = new Set(['Attend a Coaching Call']);

async function sb(path, opts = {}) {
  const r = await fetch(`${SB_URL}/${path}`, { ...opts, headers: { ...headers, ...(opts.headers || {}) }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Supabase ${r.status} on ${path.split('?')[0]}: ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

const etDate = d => new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

export default async function handler(req, res) {
  const cutoff = new Date(Date.now() - WAIT_MS).toISOString();
  const results = [];
  try {
    const due = await sb(`ht_submissions?status=eq.pending&created_at=lte.${encodeURIComponent(cutoff)}&order=created_at.asc&select=*`);
    for (const s of due) {
      const email = encodeURIComponent(s.email || '');
      const [prof] = s.email ? await sb(`ht_profiles?email=eq.${email}&select=*`) : [];
      if (!prof) { results.push({ id: s.id, skipped: 'no profile' }); continue; }

      const approved = await sb(`ht_submissions?email=eq.${email}&status=eq.approved&category=eq.${encodeURIComponent(s.category)}&select=created_at`);
      const dupe = approved.some(r => !REPEATABLE.has(s.category) || etDate(r.created_at) === etDate(s.created_at));
      const status = dupe ? 'rejected' : 'approved';

      // Only the caller whose update flips it out of pending awards points,
      // so an admin click and this job can never both pay the same submission.
      const claimed = await sb(`ht_submissions?id=eq.${s.id}&status=eq.pending`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ status, reviewed_at: new Date().toISOString() }),
      });
      if (!claimed.length) { results.push({ id: s.id, skipped: 'already reviewed' }); continue; }
      if (!dupe) {
        await sb(`ht_profiles?email=eq.${email}`, { method: 'PATCH', body: JSON.stringify({ points: (prof.points || 0) + (s.points_value || 0) }) });
      }
      results.push({ id: s.id, status });
    }
    return res.status(200).json({ ok: true, results });
  } catch (e) {
    console.error('ht-auto-approve failed:', e.message);
    return res.status(500).json({ ok: false, error: e.message, results });
  }
}
