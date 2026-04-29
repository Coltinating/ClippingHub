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
    backdropEl.addEventListener('click', function () { confirmSkip(); });
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey, true);
  }

  function onResize() {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(function () { positionAll(); });
  }

  function onKey(e) {
    if (!isOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); confirmSkip(); return; }
    if (engine.getState().phase === 'in-section') {
      if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); engine.next(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); engine.back(); }
    }
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

  function getTargetRect(selector) {
    if (!selector) return null;
    var el;
    try { el = document.querySelector(selector); } catch (_) { return null; }
    if (!el) return null;
    return el.getBoundingClientRect();
  }

  function positionSpotlight(rect) {
    if (!rect) { spotlightEl.hidden = true; return; }
    var pad = 6;
    spotlightEl.hidden = false;
    spotlightEl.style.top = (rect.top - pad) + 'px';
    spotlightEl.style.left = (rect.left - pad) + 'px';
    spotlightEl.style.width = (rect.width + pad * 2) + 'px';
    spotlightEl.style.height = (rect.height + pad * 2) + 'px';
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function positionCard(rect, placement) {
    var vw = window.innerWidth, vh = window.innerHeight;
    var cw = cardEl.offsetWidth || 360;
    var ch = cardEl.offsetHeight || 200;
    var margin = 16, gap = 14;
    var top, left;

    if (!rect || placement === 'center') {
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
    }
  }

  function runOnEnter(step) {
    var act = window._tutorialActions || null;
    if (!act || !step.onEnter) return;
    if (step.onEnter === 'paste-current-rumble-url' && act.pasteCurrentRumbleUrl) {
      try { act.pasteCurrentRumbleUrl(); } catch (_) {}
    }
  }

  function runOnNext(step) {
    var act = window._tutorialActions || null;
    if (!act || !step.onNext) return;
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
    var targetMissingNote = '';
    if (step.target) {
      var rectCheck = getTargetRect(step.target);
      if (!rectCheck) targetMissingNote = '<br><br><em>(this control is not visible right now)</em>';
    }
    cardEl.innerHTML = (
      '<div class="tutorial-card-header">' +
        '<span class="tutorial-card-progress" aria-live="polite">&sect;' +
          (sectionIndex(section.id) + 1) + ' &middot; <strong>' + escapeHtml(section.title) + '</strong> &middot; Step ' + (stepIdx + 1) + ' / ' + section.steps.length +
        '</span>' +
        '<button type="button" class="tutorial-card-toc-btn" aria-label="Open table of contents" data-act="toc">&#9776;</button>' +
        '<button type="button" class="tutorial-card-close" aria-label="Skip tutorial" data-act="skip">&times;</button>' +
      '</div>' +
      '<div class="tutorial-card-body">' +
        '<h3 class="tutorial-card-title" id="tut-title">' + escapeHtml(step.title) + '</h3>' +
        '<p class="tutorial-card-text">' + step.body + targetMissingNote + '</p>' +
      '</div>' +
      '<div class="tutorial-card-footer">' +
        '<button type="button" class="tutorial-btn" data-act="skip-section">Skip section</button>' +
        '<span class="spacer"></span>' +
        (stepIdx > 0 ? '<button type="button" class="tutorial-btn" data-act="back">Back</button>' : '') +
        '<button type="button" class="tutorial-btn tutorial-btn-primary" data-act="next">' + (stepIdx === section.steps.length - 1 ? 'Finish section' : 'Next') + '</button>' +
      '</div>'
    );
    cardEl.setAttribute('aria-labelledby', 'tut-title');
    runOnEnter(step);
    var rect = step.target ? getTargetRect(step.target) : null;
    positionSpotlight(step.placement === 'center' ? null : rect);
    positionCard(rect, step.placement || 'auto');
    wireAutoAdvance(step);
    cardEl.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var act = b.dataset.act;
        if (act === 'next') { runOnNext(step); engine.next(); }
        else if (act === 'back') engine.back();
        else if (act === 'skip-section') engine.skipSection();
        else if (act === 'skip') confirmSkip();
        else if (act === 'toc') engine.openTOC();
      });
    });
    var firstBtn = cardEl.querySelector('.tutorial-btn-primary');
    if (firstBtn) firstBtn.focus();
  }

  function renderTOC() {
    cardEl.hidden = true; tocEl.hidden = false;
    spotlightEl.hidden = true;
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
          (priorSection ? '<b>&sect;' + priorNum + ' &mdash; ' + escapeHtml(priorTitle) + '</b>. ' : 'an earlier section. ') +
          'Want to do that one first?' +
        '</p>' +
      '</div>' +
      '<div class="tutorial-card-footer">' +
        (priorSection ? '<button type="button" class="tutorial-btn" data-act="goto-prior">Go to &sect;' + priorNum + '</button>' : '') +
        '<button type="button" class="tutorial-btn" data-act="continue">Continue anyway</button>' +
        '<span class="spacer"></span>' +
        '<button type="button" class="tutorial-btn tutorial-btn-primary" data-act="toc">Back to TOC</button>' +
      '</div>'
    );
    positionCard(null, 'center');
    cardEl.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var act = b.dataset.act;
        if (act === 'goto-prior' && priorSection) engine.startSection(priorSection.id);
        else if (act === 'continue') engine.forceStart(st.sectionId);
        else if (act === 'toc') engine.openTOC();
      });
    });
  }

  function positionAll() {
    var st = engine.getState();
    if (st.phase === 'in-section') {
      var step = engine.getCurrentStep();
      var rect = step && step.target ? getTargetRect(step.target) : null;
      positionSpotlight(step && step.placement === 'center' ? null : rect);
      positionCard(rect, (step && step.placement) || 'auto');
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

  var api = { init: init, refresh: positionAll };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window._tutorialOverlay = api;
})();
