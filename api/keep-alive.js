// Supabase pauses projects on the free plan after about a week with no
// database activity, which takes /student-portal down. A daily read keeps it awake.
const SB_URL = 'https://gpthswrobafxtmsuouph.supabase.co/rest/v1';
const SB_KEY = 'sb_publishable_OohV5WdfvqHdsgcjKZqFGg_DE7SZmtD';

export default async function handler(req, res) {
  try {
    const r = await fetch(`${SB_URL}/ht_profiles?select=id&limit=1`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(`Supabase responded ${r.status}`);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('keep-alive failed:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
