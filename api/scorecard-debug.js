const SHEET_ID = '1li-TafeNH-7v6B4lDCDF9jB52vtYh_6w3UE1v0V3f4A';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const r = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/htmlview`);
    const html = await r.text();
    const re = /name:\s*"((?:[^"\\]|\\.)*)"\s*,\s*pageUrl[^}]*gid:\s*"(\d+)"/g;
    const tabs = [];
    let m;
    while ((m = re.exec(html)) !== null) {
      const name = m[1].replace(/\\\//g, '/').replace(/\\x3d/gi, '=');
      tabs.push({ name, gid: m[2] });
    }
    res.status(200).json({ tabs });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
