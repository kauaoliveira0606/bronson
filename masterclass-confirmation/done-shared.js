// Shared body of the confirmed view. Used by /masterclass-confirmation (?done=1) and
// /masterclass-confirmation-purchase, so an edit here changes both pages.
(function () {
  var html = `
  <!-- PLACEHOLDER VIDEO: swap this block for the real player embed -->
  <div class="done-video">
    <div class="done-video-inner">
      <div class="done-play"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></div>
      <div class="done-video-label">Video Coming Soon</div>
    </div>
  </div>

  <p class="done-lead">Before you close this tab, complete these three steps to make sure you're fully set up for the masterclass.</p>

  <div class="done-card js-when-card" hidden>
    <div class="eyebrow">Your Masterclass Is On</div>
    <div class="when js-when"></div>
  </div>

  <!-- PLACEHOLDER STEPS: replace the title and text of each step -->
  <div class="done-steps">
    <div class="done-step">
      <div class="done-step-num">1</div>
      <div>
        <div class="done-step-tag">Step 1</div>
        <h3>Step One Goes Here</h3>
        <p>Placeholder. Details for this step are coming.</p>
      </div>
    </div>
    <div class="done-step">
      <div class="done-step-num">2</div>
      <div>
        <div class="done-step-tag">Step 2</div>
        <h3>Step Two Goes Here</h3>
        <p>Placeholder. Details for this step are coming.</p>
      </div>
    </div>
    <div class="done-step">
      <div class="done-step-num">3</div>
      <div>
        <div class="done-step-tag">Step 3</div>
        <h3>Step Three Goes Here</h3>
        <p>Placeholder. Details for this step are coming.</p>
      </div>
    </div>
  </div>
`;
  document.querySelectorAll('.js-done-shared').forEach(function (el) { el.innerHTML = html; });

  // The masterclass page passes the session label along; show it when we have it.
  var when = null;
  try { when = window.sessionStorage.getItem('mc_when'); } catch (e) {}
  if (when) {
    document.querySelectorAll('.js-when').forEach(function (el) { el.textContent = when; });
    document.querySelectorAll('.js-when-card').forEach(function (el) { el.hidden = false; });
  }
})();
