// Shared body of the confirmed view. Used by /masterclass-confirmation (?done=1) and
// /masterclass-confirmation-purchase, so an edit here changes both pages.
// Only the headline block above this differs between the two.
(function () {
  // Masterclass schedule: weekly, day of week (0 = Sunday) at HOUR:00 New York time.
  // Keep in step with the constants in /masterclass/index.html.
  var MASTERCLASS_DAY = 3;
  var MASTERCLASS_HOUR = 19;
  var MASTERCLASS_TIME_LABEL = '7PM EST';
  var MASTERCLASS_MINUTES = 90;
  var EVENT_TITLE = 'Live Masterclass: Subscription Based E-commerce with Bronson';
  var EVENT_DETAILS = 'Your link to join is in your confirmation email.';

  var ICON = '<svg class="done-step-icon" width="52" height="58" viewBox="0 0 52 58" fill="none" aria-hidden="true">' +
    '<rect x="3" y="8" width="46" height="47" rx="6" stroke="#16a34a" stroke-width="5"/>' +
    '<rect x="3" y="8" width="46" height="13" fill="#16a34a"/>' +
    '<rect x="12" y="1" width="6" height="12" rx="2" fill="#16a34a"/><rect x="34" y="1" width="6" height="12" rx="2" fill="#16a34a"/>' +
    '<g fill="#16a34a"><rect x="12" y="28" width="7" height="6" rx="1"/><rect x="22.5" y="28" width="7" height="6" rx="1"/><rect x="33" y="28" width="7" height="6" rx="1"/>' +
    '<rect x="12" y="39" width="7" height="6" rx="1"/><rect x="22.5" y="39" width="7" height="6" rx="1"/><rect x="33" y="39" width="7" height="6" rx="1"/></g></svg>';

  var html = `
  <p class="done-lead">Before you close this tab, complete these three steps to make sure you're <b>fully set up for the masterclass</b></p>

  <!-- PLACEHOLDER VIDEO: swap this block for the real player embed -->
  <div class="done-video">
    <div class="done-video-inner">
      <div class="done-play"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>
      <div class="done-video-label">Video Coming Soon</div>
    </div>
  </div>
  <svg class="done-arrow" width="26" height="46" viewBox="0 0 26 46" fill="none" aria-hidden="true"><path d="M13 2v40M3 31l10 11 10-11" stroke="#16a34a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>

  <div class="done-step" style="margin-top:18px;">
    <div class="done-step-pill">STEP 1:</div>
    ${ICON}
    <h2>Add The Date And Time To Your <span>Calendar</span></h2>
    <div class="done-step-card">
      <p>You'll get everything you need in your confirmation email, but put it in your calendar now so life doesn't get in the way.</p>
      <div class="done-when js-done-when"></div>
      <div class="done-cal">
        <button type="button" class="done-btn js-cal-toggle">Add It To My Calendar</button>
        <div class="done-cal-menu js-cal-menu">
          <a class="js-cal-google" target="_blank" rel="noopener">&#128197; Google</a>
          <a class="js-cal-ics">&#127822; Apple</a>
          <a class="js-cal-outlook" target="_blank" rel="noopener">&#128231; Outlook</a>
          <a class="js-cal-ics">&#11015;&#65039; .ICS Download</a>
        </div>
      </div>
    </div>
  </div>

  <div class="done-step">
    <div class="done-step-pill">STEP 2:</div>
    ${ICON}
    <h2>Fill Out This Short Masterclass <span>Intake Form</span></h2>
    <div class="done-step-card">
      <p>Before we go live, I want to know exactly where you're at so I can cover what you actually need. It takes two minutes.</p>
      <div class="done-form" data-tf-live="01M453GA9Q861X9SJ62YMKE8NJ"></div>
    </div>
  </div>

  <div class="done-step">
    <div class="done-step-pill">STEP 3:</div>
    ${ICON}
    <h2>Check Your <span>Inbox</span></h2>
    <div class="done-step-card">
      <p>Find the email from me with your masterclass details. Don't see it in the next few minutes?</p>
      <p>Check promotions or spam, then drag it into your main inbox so you get every reminder.</p>
    </div>
  </div>
`;
  document.querySelectorAll('.js-done-shared').forEach(function (el) { el.innerHTML = html; });

  // Intake form (Typeform). Only load it when the confirmed view is actually showing,
  // so the hidden copy on the offer page doesn't count as a form view.
  var formShowing = Array.prototype.some.call(document.querySelectorAll('.done-form'), function (el) { return !el.closest('[hidden]'); });
  if (formShowing) {
    var tf = document.createElement('script');
    tf.src = 'https://embed.typeform.com/next/embed.js';
    document.body.appendChild(tf);
  }

  /* ---------- Next session (New York time) ---------- */
  function nyParts(date) {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short'
    }).formatToParts(date);
    var out = {};
    parts.forEach(function (p) { out[p.type] = p.value; });
    return out;
  }
  function nyOffset(date) {
    var p = nyParts(date);
    var asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return asUtc - Math.floor(date.getTime() / 1000) * 1000;
  }
  function nextSession(now) {
    var p = nyParts(now);
    var dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
    var days = (MASTERCLASS_DAY - dow + 7) % 7;
    var secsIntoDay = (+p.hour) * 3600 + (+p.minute) * 60 + (+p.second);
    if (days === 0 && secsIntoDay >= MASTERCLASS_HOUR * 3600) days = 7;
    var wallUtc = Date.UTC(+p.year, +p.month - 1, +p.day + days, MASTERCLASS_HOUR, 0, 0);
    var guess = new Date(wallUtc - nyOffset(new Date(wallUtc)));
    return new Date(wallUtc - nyOffset(guess));
  }

  // The masterclass page passes the session they registered for; fall back to the next one.
  var start = null;
  try { start = new Date(window.sessionStorage.getItem('mc_at') || ''); } catch (e) {}
  if (!start || isNaN(start.getTime()) || start.getTime() < Date.now()) start = nextSession(new Date());
  var end = new Date(start.getTime() + MASTERCLASS_MINUTES * 60000);

  var dayLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' }).format(start);
  document.querySelectorAll('.js-done-when').forEach(function (el) { el.textContent = dayLabel + ' @' + MASTERCLASS_TIME_LABEL; });

  /* ---------- Add to calendar ---------- */
  function stamp(d) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
  var google = 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    '&text=' + encodeURIComponent(EVENT_TITLE) +
    '&dates=' + stamp(start) + '/' + stamp(end) +
    '&details=' + encodeURIComponent(EVENT_DETAILS);
  var outlook = 'https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent' +
    '&subject=' + encodeURIComponent(EVENT_TITLE) +
    '&startdt=' + encodeURIComponent(start.toISOString()) +
    '&enddt=' + encodeURIComponent(end.toISOString()) +
    '&body=' + encodeURIComponent(EVENT_DETAILS);
  var ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//The Inner Table//Masterclass//EN', 'BEGIN:VEVENT',
    'UID:masterclass-' + stamp(start) + '@ad-ventur.com', 'DTSTAMP:' + stamp(new Date()),
    'DTSTART:' + stamp(start), 'DTEND:' + stamp(end),
    'SUMMARY:' + EVENT_TITLE, 'DESCRIPTION:' + EVENT_DETAILS,
    'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', 'DESCRIPTION:' + EVENT_TITLE, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  var icsHref = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);

  document.querySelectorAll('.js-cal-google').forEach(function (a) { a.href = google; });
  document.querySelectorAll('.js-cal-outlook').forEach(function (a) { a.href = outlook; });
  document.querySelectorAll('.js-cal-ics').forEach(function (a) { a.href = icsHref; a.setAttribute('download', 'masterclass.ics'); });
  document.querySelectorAll('.js-cal-toggle').forEach(function (btn) {
    btn.addEventListener('click', function () { btn.parentNode.querySelector('.js-cal-menu').classList.toggle('open'); });
  });
})();
