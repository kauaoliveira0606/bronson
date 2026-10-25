// Serves the masterclass as a real .ics file so "Add to Apple Calendar" works on iPhone.
// iOS Safari ignores data: URI downloads but opens a text/calendar response as an
// "Add to Calendar" sheet. The confirmation page passes the session start/end it computed;
// only the times come from the URL, the event text is fixed here.
const EVENT_TITLE = 'Live Masterclass: Subscription Based E-commerce with Bronson';
const JOIN_URL = 'https://event.webinarjam.com/8wgzn9/go/live/13q192tyipsxs4';
const EVENT_DETAILS = 'Join the masterclass here: ' + JOIN_URL;
const DEFAULT_MINUTES = 90;

function stamp(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export default function handler(req, res) {
  const start = new Date(String(req.query.start || ''));
  if (isNaN(start.getTime())) return res.status(400).send('Missing or invalid start');
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
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).send(ics);
}
