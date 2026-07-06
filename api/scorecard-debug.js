const SHEET_ID = '1li-TafeNH-7v6B4lDCDF9jB52vtYh_6w3UE1v0V3f4A';

function getTabNameVariants(sunday) {
  const sat = new Date(sunday);
  sat.setDate(sat.getDate() + 6);
  const pad = n => String(n).padStart(2, '0');
  const sm = sunday.getMonth() + 1, sd = sunday.getDate();
  const em = sat.getMonth() + 1,   ed = sat.getDate();
  return [
    `${sm}/${pad(sd)}-${em}/${pad(ed)}`,
    `${sm}/${sd}-${em}/${ed}`,
    `${pad(sm)}/${pad(sd)}-${pad(em)}/${pad(ed)}`,
    `${sm}/${pad(sd)} - ${em}/${pad(ed)}`,
    `${sm}/${sd} - ${em}/${ed}`,
  ];
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const r = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/htmlview`);
    const html = await r.text();
    const re = /name:\s*"((?:[^"\\]|\\.)*)"\s*,\s*pageUrl[^}]*gid:\s*"(\d+)"/g;
    const tabs = [];
    const gidMap = {};
    let m;
    while ((m = re.exec(html)) !== null) {
      const name = m[1].replace(/\\\//g, '/').replace(/\\x3d/gi, '=');
      tabs.push({ name, gid: m[2] });
      gidMap[name] = m[2];
    }

    // Compute current week Sunday
    const today = new Date();
    today.setHours(0,0,0,0);
    const curSunday = new Date(today);
    curSunday.setDate(today.getDate() - today.getDay());

    const variants = getTabNameVariants(curSunday);
    const matches = variants.map(v => ({ variant: v, gid: gidMap[v] || null }));

    // Try fetching the tab that should match
    let fetchResult = null;
    for (const v of variants) {
      const gid = gidMap[v];
      const url = gid
        ? `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`
        : `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(v)}`;
      const fr = await fetch(url);
      const text = await fr.text();
      const preview = text.trim().slice(0, 200);
      fetchResult = { variant: v, gid: gid || null, status: fr.status, preview };
      if (fr.ok && !text.trim().startsWith('<!DOCTYPE') && !text.trim().startsWith('google.visualization')) break;
    }

    res.status(200).json({
      today: today.toISOString().slice(0,10),
      curSunday: curSunday.toISOString().slice(0,10),
      dayOfWeek: today.getDay(),
      tabs,
      variants,
      matches,
      fetchResult,
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
