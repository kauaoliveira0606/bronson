// Serves the masterclass as a real .ics file so "Add to Apple Calendar" works on iPhone.
// iOS Safari ignores data: URI downloads but opens a text/calendar response as an
// "Add to Calendar" sheet. The confirmation page passes the session start/end it computed;
// with no start the link always gives the NEXT session, so /api/masterclass-ics can be
// shared in emails and texts. Only the times come from the URL, the event text is fixed here.

// Schedule: weekly, day of week (0 = Sunday) at HOUR:00 New York time. MASTERCLASS_DATE
// (New York date) pins the next session to that day until it starts.
// Keep in step with /masterclass/index.html and /masterclass-confirmation/done-shared.js.
const MASTERCLASS_DATE = '2026-11-11';
const MASTERCLASS_DAY = 3;
const MASTERCLASS_HOUR = 19;

const EVENT_TITLE = 'Live Masterclass: Subscription Based E-commerce with Bronson';
const JOIN_URL = 'https://event.webinarjam.com/8wgzn9/go/live/13q192tyipsxs4';
const EVENT_DETAILS = 'Join the masterclass here: ' + JOIN_URL;
const DEFAULT_MINUTES = 90;

function nyParts(date) {
  const out = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short',
  }).formatToParts(date).forEach((p) => { out[p.type] = p.value; });
  return out;
}
function nyOffset(date) {
  const p = nyParts(date);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}
// A New York wall-clock time (as UTC fields) turned into a real instant.
function fromNyWall(wallUtc) {
  const guess = new Date(wallUtc - nyOffset(new Date(wallUtc)));
  return new Date(wallUtc - nyOffset(guess));
}
// The session stays "next" through the whole day it runs (New York time), so people
// who are late still get today's session; it rolls to the following week at midnight.
function nextSession(now) {
  if (MASTERCLASS_DATE) {
    const d = MASTERCLASS_DATE.split('-');
    const dayAfter = fromNyWall(Date.UTC(+d[0], +d[1] - 1, +d[2] + 1, 0, 0, 0));
    if (now < dayAfter) return fromNyWall(Date.UTC(+d[0], +d[1] - 1, +d[2], MASTERCLASS_HOUR, 0, 0));
  }
  const p = nyParts(now);
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  const days = (MASTERCLASS_DAY - dow + 7) % 7;
  return fromNyWall(Date.UTC(+p.year, +p.month - 1, +p.day + days, MASTERCLASS_HOUR, 0, 0));
}

function stamp(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export default function handler(req, res) {
  let start = new Date(String(req.query.start || ''));
  if (isNaN(start.getTime())) start = nextSession(new Date());
  let end = new Date(String(req.query.end || ''));
  if (isNaN(end.getTime()) || end <= start || end - start > 6 * 3600000) {
    end = new Date(start.getTime() + DEFAULT_MINUTES * 60000);
  }

  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//The Inner Table//Masterclass//EN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:masterclass-' + stamp(start) + '@ad-ventur.com', 'DTSTAMP:' + stamp(new Date()),
    'DTSTART:' + stamp(start), 'DTEND:' + stamp(end),
    'SUMMARY:' + EVENT_TITLE, 'DESCRIPTION:' + EVENT_DETAILS, 'LOCATION:' + JOIN_URL, 'URL:' + JOIN_URL,
    'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', 'DESCRIPTION:' + EVENT_TITLE, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="masterclass.ics"');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(ics);
}
