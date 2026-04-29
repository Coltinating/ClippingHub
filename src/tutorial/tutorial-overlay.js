(function () {
  'use strict';

  var rootEl = null;
  var backdropEl = null;
  var spotlightEl = null;
  var cardEl = null;
  var tocEl = null;
  var resizeRaf = 0;
  var lastFocus = null;
  var engine = null;
  var content = null;
  var autoAdvanceCleanup = null;
  var trackedTargetEl = null;
  var trackedTargetSelector = null;
  // Webview targets (e.g. a video card inside #channelBrowser) are resolved
  // asynchronously via webview.executeJavaScript, so we cache the last
  // resolved rect and refresh it on each positionAll tick.
  var trackedWebviewTarget = null;
  var cachedWebviewRect = null;
  var webviewRectInflight = false;

  function ensureMounted() {
    if (rootEl) return;
    rootEl = document.getElementById('tutorialRoot');
    if (!rootEl) return;
    backdropEl = document.createElement('div'); backdropEl.className = 'tutorial-backdrop';
    spotlightEl = document.createElement('div'); spotlightEl.className = 'tutorial-spotlight'; spotlightEl.hidden = true;
    cardEl = document.createElement('div'); cardEl.className = 'tutorial-card'; cardEl.setAttribute('role', 'dialog'); cardEl.setAttribute('aria-modal', 'true'); cardEl.hidden = true;
    tocEl = document.createElement('div'); tocEl.className = 'tutorial-toc'; tocEl.setAttribute('role', 'dialog'); tocEl.setAttribute('aria-modal', 'true'); tocEl.hidden = true;
    rootEl.appendChild(backdropEl);
    rootEl.appendChild(spotlightEl);
    rootEl.appendChild(cardEl);
    rootEl.appendChild(tocEl);
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey, true);
    // Reposition periodically so spotlight follows targets that move
    // (e.g. settings modal animates in, dropdown opens).
    setInterval(positionAll, 200);
  }

  function onResize() {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(function () { positionAll(); });
  }

  function onKey(e) {
    if (!isOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); confirmSkip(); return; }
    // Don't hijack arrows/Enter — user is now actively interacting with
    // the underlying app for action-required steps. Step advancement
    // happens via the watcher / observer wiring or the Skip button.
  }

  function isOpen() { return rootEl && rootEl.classList.contains('open'); }

  function confirmSkip() {
    if (window.toast) { try { window.toast('Tutorial skipped — reopen via Help → Tutorial.', 4000); } catch (_) {} }
    engine.skipTutorial();
  }

  function show() {
    ensureMounted();
    if (!rootEl) return;
    rootEl.hidden = false;
    requestAnimationFrame(function () { rootEl.classList.add('open'); });
    lastFocus = document.activeElement;
  }
  function hide() {
    if (!rootEl) return;
    rootEl.classList.remove('open');
    setTimeout(function () { rootEl.hidden = true; }, 220);
    if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) {}
  }

  function getTargetEl(selector) {
    if (!selector) return null;
    try { return document.querySelector(selector); } catch (_) { return null; }
  }

  function getTargetRect(selector) {
    var el = getTargetEl(selector);
    if (!el) return null;
    var r = el.getBoundingClientRect();
    // Hidden / collapsed elements report a zero-area rect — the
    // spotlight at viewport (0,0) is the bug the user complained about.
    // Treat zero-area as "no rect" so the card centers and the spotlight
    // stays hidden until the target is actually visible.
    if (r.width <= 0 || r.height <= 0) return null;
    return r;
  }

  function positionSpotlight(rect) {
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      spotlightEl.hidden = true;
      return;
    }
    var vw = window.innerWidth, vh = window.innerHeight;
    var pad = 6;
    // The 3-5px pulsing ring is rendered as box-shadow OUTSIDE the
    // spotlight element. When the target hugs the viewport edge (e.g.
    // #playerWrap with no adjacent panels), the ring slides off-screen
    // and looks cut off on the affected sides. Inset the spotlight by
    // ringInset so the ring always lands inside the viewport — this
    // overlaps the target by a few px, which is fine.
    var ringInset = 6;
    var top = Math.max(ringInset, rect.top - pad);
    var left = Math.max(ringInset, rect.left - pad);
    var right = Math.min(vw - ringInset, rect.right + pad);
    var bottom = Math.min(vh - ringInset, rect.bottom + pad);
    var w = Math.max(0, right - left);
    var h = Math.max(0, bottom - top);
    if (w <= 0 || h <= 0) { spotlightEl.hidden = true; return; }
    spotlightEl.hidden = false;
    spotlightEl.style.top = top + 'px';
    spotlightEl.style.left = left + 'px';
    spotlightEl.style.width = w + 'px';
    spotlightEl.style.height = h + 'px';
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function positionCard(rect, placement) {
    var vw = window.innerWidth, vh = window.innerHeight;
    var cw = cardEl.offsetWidth || 360;
    var ch = cardEl.offsetHeight || 200;
    var margin = 16, gap = 14;
    var top, left;

    var degenerate = !rect || rect.width <= 0 || rect.height <= 0;
    if (degenerate || placement === 'center') {
      top = Math.max(margin, (vh - ch) / 2);
      left = Math.max(margin, (vw - cw) / 2);
      cardEl.removeAttribute('data-placement');
      cardEl.style.top = top + 'px';
      cardEl.style.left = left + 'px';
      return;
    }
    var p = placement || 'auto';
    if (p === 'auto') {
      if (rect.bottom + gap + ch + margin <= vh) p = 'bottom';
      else if (rect.top - gap - ch >= margin) p = 'top';
      else if (rect.right + gap + cw + margin <= vw) p = 'right';
      else p = 'left';
    }
    if (p === 'top')    { top = rect.top - ch - gap; left = clamp(rect.left + rect.width / 2 - cw / 2, margin, vw - cw - margin); }
    if (p === 'bottom') { top = rect.bottom + gap;   left = clamp(rect.left + rect.width / 2 - cw / 2, margin, vw - cw - margin); }
    if (p === 'left')   { left = rect.left - cw - gap; top = clamp(rect.top + rect.height / 2 - ch / 2, margin, vh - ch - margin); }
    if (p === 'right')  { left = rect.right + gap;     top = clamp(rect.top + rect.height / 2 - ch / 2, margin, vh - ch - margin); }
    // When the target fills the viewport (e.g. #playerWrap at 16/9 width)
    // none of the placements truly fit, and the chosen one can push the card
    // off-screen with negative left/top. Clamp both axes so the card always
    // stays visible — we'd rather overlap the spotlight slightly than hide
    // the close/skip buttons entirely.
    left = clamp(left, margin, vw - cw - margin);
    top = clamp(top, margin, vh - ch - margin);
    cardEl.setAttribute('data-placement', p);
    cardEl.style.top = top + 'px';
    cardEl.style.left = left + 'px';
    var arrowX = rect.left + rect.width / 2 - left - 6;
    var arrowY = rect.top + rect.height / 2 - top - 6;
    cardEl.style.setProperty('--arrow-x', arrowX + 'px');
    cardEl.style.setProperty('--arrow-y', arrowY + 'px');
  }

  function clearAutoAdvance() {
    if (autoAdvanceCleanup) {
      try { autoAdvanceCleanup(); } catch (_) {}
      autoAdvanceCleanup = null;
    }
  }

  // Render-time keybind templating: replace {{kb.id}} with the user's
  // current bind via KeybindRegistry, falling back to the registry default.
  // Keeps content authoring simple while reflecting per-user customization.
  function templateBody(text) {
    if (!text) return '';
    return String(text).replace(/\{\{kb\.([a-zA-Z0-9_]+)\}\}/g, function (_match, id) {
      var live = (window.userConfig && window.userConfig.keybinds) || {};
      var Reg = window.KeybindRegistry;
      var bind = (live[id] != null) ? live[id] : null;
      if (bind == null && Reg && Array.isArray(Reg.REGISTRY)) {
        for (var i = 0; i < Reg.REGISTRY.length; i++) {
          if (Reg.REGISTRY[i].id === id) { bind = Reg.REGISTRY[i].default; break; }
        }
      }
      var fmt = (Reg && Reg.formatBinding) ? Reg.formatBinding(bind) : (bind == null ? '?' : String(bind));
      return '<kbd>' + escapeHtml(fmt) + '</kbd>';
    });
  }

  function isActionRequired(step) {
    if (!step || !step.advance) return false;
    var t = step.advance.type;
    return t === 'click' || t === 'event' || t === 'webview-nav-to-video' ||
           t === 'menu-open' || t === 'watch' || t === 'observe-class';
  }

  function wireAutoAdvance(step) {
    if (!step || !step.advance) return;
    var act = window._tutorialActions || null;

    if (step.advance.type === 'click' && step.advance.target) {
      var t;
      try { t = document.querySelector(step.advance.target); } catch (_) { t = null; }
      if (t) {
        var fn = function () { engine.next(); };
        t.addEventListener('click', fn, { once: true });
        autoAdvanceCleanup = function () { t.removeEventListener('click', fn); };
      }
    } else if (step.advance.type === 'event' && step.advance.event) {
      var ev = step.advance.event;
      var fn2 = function () { engine.next(); };
      document.addEventListener(ev, fn2, { once: true });
      autoAdvanceCleanup = function () { document.removeEventListener(ev, fn2); };
    } else if (step.advance.type === 'webview-nav-to-video' && act && act.watchWebviewForVideo) {
      autoAdvanceCleanup = act.watchWebviewForVideo(function () { engine.next(); });
    } else if (step.advance.type === 'menu-open' && step.advance.menu) {
      var menuEl = document.getElementById('menu-' + step.advance.menu);
      if (menuEl) {
        var mo = new MutationObserver(function () { if (menuEl.classList.contains('open')) { mo.disconnect(); engine.next(); } });
        mo.observe(menuEl, { attributes: true, attributeFilter: ['class'] });
        autoAdvanceCleanup = function () { mo.disconnect(); };
      }
    } else if (step.advance.type === 'watch' && step.advance.watcher && act) {
      var watchFn = act['watch_' + step.advance.watcher];
      if (typeof watchFn === 'function') {
        autoAdvanceCleanup = watchFn(function () { engine.next(); });
      }
    } else if (step.advance.type === 'observe-class' && step.advance.selector && act && act.observeClass) {
      autoAdvanceCleanup = act.observeClass({
        selector: step.advance.selector,
        className: step.advance.className,   // optional; default 'present'
        present: step.advance.present !== false,
      }, function () { engine.next(); });
    }
  }

  function runOnEnter(step) {
    var act = window._tutorialActions || null;
    if (!act || !step || !step.onEnter) return;
    if (step.onEnter === 'paste-current-rumble-url' && act.pasteCurrentRumbleUrl) {
      try { act.pasteCurrentRumbleUrl(); } catch (_) {}
    }
  }

  function runOnNext(step) {
    var act = window._tutorialActions || null;
    if (!act || !step || !step.onNext) return;
    if (step.onNext === 'navigate:nickjfuentes' && act.navigateRumble) {
      try { act.navigateRumble('nickjfuentes'); } catch (_) {}
    }
  }

  function renderStep() {
    var step = engine.getCurrentStep();
    var section = engine.getCurrentSection();
    if (!step || !section) return;
    cardEl.hidden = false; tocEl.hidden = true;
    var stepIdx = engine.getState().stepIndex;
    var actionRequired = isActionRequired(step);
    var rect = step.target ? getTargetRect(step.target) : null;
    // Note element gets toggled live in positionAll(). Always emit the span
    // (with hidden attr when not needed) so we can flip its state without a
    // full re-render — otherwise the message stays stale even after the
    // user opens the panel and the target becomes visible.
    var targetMissingNote = step.target
      ? '<br><br><em class="tutorial-note" data-tutorial-missing-note' +
          (rect ? ' hidden' : '') + '>(this control is not visible right now)</em>'
      : '';

    // Track target so spotlight follows it when modal animates in
    trackedTargetSelector = step.target || null;
    trackedTargetEl = step.target ? getTargetEl(step.target) : null;
    // webviewTarget points at an element inside a <webview> — we have to
    // resolve its rect asynchronously, so reset the cache on step change
    // and let positionAll() drive the refresh.
    trackedWebviewTarget = step.webviewTarget || null;
    cachedWebviewRect = null;
    if (trackedWebviewTarget) refreshWebviewRect();

    var nextLabel = actionRequired ? 'Skip step' : (stepIdx === section.steps.length - 1 ? 'Finish section' : 'Next');
    var nextClass = actionRequired ? 'tutorial-btn' : 'tutorial-btn tutorial-btn-primary';

    cardEl.innerHTML = (
      '<div class="tutorial-card-header">' +
        '<span class="tutorial-card-progress" aria-live="polite">§' +
          (sectionIndex(section.id) + 1) + ' · <strong>' + escapeHtml(section.title) + '</strong> · Step ' + (stepIdx + 1) + ' / ' + section.steps.length +
        '</span>' +
        '<button type="button" class="tutorial-card-toc-btn" aria-label="Open table of contents" data-act="toc">&#9776;</button>' +
        '<button type="button" class="tutorial-card-close" aria-label="Skip tutorial" data-act="skip">&times;</button>' +
      '</div>' +
      '<div class="tutorial-card-body">' +
        '<h3 class="tutorial-card-title" id="tut-title">' + escapeHtml(step.title) + '</h3>' +
        '<p class="tutorial-card-text">' + templateBody(step.body) + targetMissingNote + '</p>' +
      '</div>' +
      '<div class="tutorial-card-footer">' +
        '<button type="button" class="tutorial-btn" data-act="skip-section">Skip section</button>' +
        '<span class="spacer"></span>' +
        (stepIdx > 0 ? '<button type="button" class="tutorial-btn" data-act="back">Back</button>' : '') +
        '<button type="button" class="' + nextClass + '" data-act="next">' + nextLabel + '</button>' +
      '</div>'
    );
    cardEl.setAttribute('aria-labelledby', 'tut-title');
    runOnEnter(step);
    positionSpotlight(step.placement === 'center' ? null : rect);
    positionCard(rect, step.placement || 'auto');
    wireAutoAdvance(step);
    cardEl.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var actName = b.dataset.act;
        if (actName === 'next') { runOnNext(step); engine.next(); }
        else if (actName === 'back') engine.back();
        else if (actName === 'skip-section') engine.skipSection();
        else if (actName === 'skip') confirmSkip();
        else if (actName === 'toc') engine.openTOC();
      });
    });
    var firstBtn = cardEl.querySelector('.tutorial-btn-primary') || cardEl.querySelector('.tutorial-btn');
    if (firstBtn) firstBtn.focus();
  }

  function renderTOC() {
    cardEl.hidden = true; tocEl.hidden = false;
    spotlightEl.hidden = true;
    trackedTargetEl = null;
    trackedTargetSelector = null;
    trackedWebviewTarget = null;
    cachedWebviewRect = null;
    var st = engine.getState();
    tocEl.innerHTML = (
      '<div class="tutorial-toc-header">' +
        '<h2 class="tutorial-toc-title">ClippingHub Tutorial</h2>' +
        '<button type="button" class="tutorial-card-close" aria-label="Close" data-act="exit">&times;</button>' +
      '</div>' +
      '<div class="tutorial-toc-list">' +
        content.sections.map(function (s, i) {
          var state = st.completed[s.id] ? 'completed' : 'not-started';
          var label = state === 'completed' ? 'Completed' : 'Not started';
          return (
            '<button type="button" class="tutorial-toc-item" data-id="' + s.id + '">' +
              '<span class="tutorial-toc-num">' + (i + 1) + '</span>' +
              '<span class="tutorial-toc-meta">' +
                '<p class="tutorial-toc-meta-title">' + escapeHtml(s.title) + '</p>' +
                '<p class="tutorial-toc-meta-blurb">' + escapeHtml(s.blurb) + '</p>' +
              '</span>' +
              '<span class="tutorial-toc-status" data-state="' + state + '">' + label + '</span>' +
            '</button>'
          );
        }).join('') +
      '</div>' +
      '<div class="tutorial-toc-footer">' +
        '<span class="spacer"></span>' +
        '<button type="button" class="tutorial-btn" data-act="exit">Close</button>' +
      '</div>'
    );
    tocEl.querySelectorAll('.tutorial-toc-item').forEach(function (b) {
      b.addEventListener('click', function () { engine.startSection(b.dataset.id); });
    });
    tocEl.querySelectorAll('[data-act="exit"]').forEach(function (b) {
      b.addEventListener('click', function () { engine.exit(); });
    });
    var first = tocEl.querySelector('.tutorial-toc-item');
    if (first) first.focus();
  }

  function renderPrereqWarn() {
    cardEl.hidden = false; tocEl.hidden = true;
    spotlightEl.hidden = true;
    trackedTargetEl = null;
    trackedTargetSelector = null;
    trackedWebviewTarget = null;
    cachedWebviewRect = null;
    var st = engine.getState();
    var sec = engine.getCurrentSection();
    var sectionTitle = sec ? sec.title : 'this section';
    var priorSection = null;
    var priorIdx = -1;
    var sections = content.sections;
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].id === st.sectionId) {
        if (i > 0) { priorSection = sections[i - 1]; priorIdx = i; }
        break;
      }
    }
    var priorTitle = priorSection ? priorSection.title : '';
    var priorNum = priorIdx > 0 ? priorIdx : '';
    cardEl.innerHTML = (
      '<div class="tutorial-card-header">' +
        '<span class="tutorial-card-progress">Prerequisite needed</span>' +
        '<button type="button" class="tutorial-card-close" aria-label="Close" data-act="toc">&times;</button>' +
      '</div>' +
      '<div class="tutorial-card-body">' +
        '<h3 class="tutorial-card-title">' + escapeHtml(sectionTitle) + ' needs setup first</h3>' +
        '<p class="tutorial-card-text">' +
          'This section works best after completing ' +
          (priorSection ? '<b>§' + priorNum + ' — ' + escapeHtml(priorTitle) + '</b>. ' : 'an earlier section. ') +
          'Want to do that one first?' +
        '</p>' +
      '</div>' +
      '<div class="tutorial-card-footer">' +
        (priorSection ? '<button type="button" class="tutorial-btn" data-act="goto-prior">Go to §' + priorNum + '</button>' : '') +
        '<button type="button" class="tutorial-btn" data-act="continue">Continue anyway</button>' +
        '<span class="spacer"></span>' +
        '<button type="button" class="tutorial-btn tutorial-btn-primary" data-act="toc">Back to TOC</button>' +
      '</div>'
    );
    positionCard(null, 'center');
    cardEl.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var actName = b.dataset.act;
        if (actName === 'goto-prior' && priorSection) engine.startSection(priorSection.id);
        else if (actName === 'continue') engine.forceStart(st.sectionId);
        else if (actName === 'toc') engine.openTOC();
      });
    });
  }

  function refreshWebviewRect() {
    if (!trackedWebviewTarget || webviewRectInflight) return;
    var act = window._tutorialActions;
    if (!act || typeof act.getWebviewElementRect !== 'function') return;
    webviewRectInflight = true;
    var t = trackedWebviewTarget;
    act.getWebviewElementRect(t.webviewId, t.selector).then(function (r) {
      webviewRectInflight = false;
      // Discard if the user has moved on to another step in the meantime.
      if (trackedWebviewTarget !== t) return;
      cachedWebviewRect = r || null;
      positionAll();
    }, function () { webviewRectInflight = false; });
  }

  function positionAll() {
    if (!engine || !content || !rootEl || !rootEl.classList.contains('open')) return;
    var st = engine.getState();
    if (st.phase !== 'in-section') return;
    var step = engine.getCurrentStep();
    if (trackedWebviewTarget) {
      // Kick off an async refresh — uses the cached rect for this paint.
      refreshWebviewRect();
      var wvRect = cachedWebviewRect;
      positionSpotlight(step && step.placement === 'center' ? null : wvRect);
      positionCard(wvRect, (step && step.placement) || 'auto');
      return;
    }
    if (trackedTargetSelector) {
      // Re-resolve target each tick so spotlight follows lazy-mounted
      // elements (e.g. settings modal animating into view).
      var rect = getTargetRect(trackedTargetSelector);
      positionSpotlight(step && step.placement === 'center' ? null : rect);
      positionCard(rect, (step && step.placement) || 'auto');
      // Hide the "(not visible)" note the moment the target shows up —
      // otherwise the user keeps reading stale guidance after they've
      // already opened the panel we were waiting on.
      var note = cardEl && cardEl.querySelector('[data-tutorial-missing-note]');
      if (note) note.hidden = !!rect;
    }
  }

  function sectionIndex(id) {
    for (var i = 0; i < content.sections.length; i++) if (content.sections[i].id === id) return i;
    return -1;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function init(eng, ctn) {
    engine = eng; content = ctn;
    ensureMounted();
    engine.on(function (st) {
      clearAutoAdvance();
      if (st.phase === 'idle') hide();
      else if (st.phase === 'toc') { show(); renderTOC(); }
      else if (st.phase === 'in-section') { show(); renderStep(); }
      else if (st.phase === 'prereq-warn') { show(); renderPrereqWarn(); }
    });
  }

  var api = { init: init, refresh: positionAll, _templateBody: templateBody };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window._tutorialOverlay = api;
})();
