// Timeline-Zoom — interactive zoomable timeline mounted below the main player.
// Reads playhead from window.Player.els.vid, span from vid.duration / vid.seekable,
// marks from window.ClipState. Seeks via window.Player.timeline.seekTo(t).
// Pure math is delegated to window.TimelineZoomMath.
(function () {
  'use strict';

  const M = window.TimelineZoomMath;
  const MIN_SPAN = 2;
  const ZOOM_STEP = 1.15;
  const PLAYHEAD_HIT_RADIUS = 9;
  const EDGE_AUTOPAN_FRAC = 0.06;
  const EDGE_AUTOPAN_PX_PER_FRAME = 6;
  const DRAG_THRESHOLD_SCRUB = 2;
  const DRAG_THRESHOLD_PAN = 4;

  function pad2(n) { return String(n).padStart(2, '0'); }
  function fmtHMS(s) {
    if (!Number.isFinite(s)) s = 0;
    s = Math.floor(Math.max(0, s));
    return pad2(Math.floor(s / 3600)) + ':' + pad2(Math.floor((s % 3600) / 60)) + ':' + pad2(s % 60);
  }
  function fmtDur(s) {
    if (!s || !Number.isFinite(s) || s < 0) return '0:00';
    s = Math.floor(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0 ? h + ':' + pad2(m) + ':' + pad2(sec) : m + ':' + pad2(sec);
  }
  function fmtSpan(s) {
    if (s >= 3600) return (s / 3600).toFixed(s >= 7200 ? 0 : 1) + 'h';
    if (s >= 60)   return (s / 60).toFixed(s >= 600 ? 0 : 1) + 'm';
    return s.toFixed(s >= 10 ? 0 : 1) + 's';
  }

  function getTimelineRange() {
    const P = window.Player;
    const vid = P && P.els ? P.els.vid : null;
    if (!vid) return null;
    if (P.state.isLive) {
      const sk = vid.seekable;
      if (!sk || sk.length === 0) return null;
      return { absStart: sk.start(0), absEnd: sk.end(sk.length - 1) };
    }
    if (Number.isFinite(vid.duration) && vid.duration > 0) {
      return { absStart: 0, absEnd: vid.duration };
    }
    return null;
  }

  function mount(rootEl) {
    rootEl.classList.add('tlzoom-root');
    rootEl.innerHTML = `
      <div class="tlzoom-stats">
        <span class="tlzoom-stat"><span class="tlzoom-stat-label">Playhead</span><span class="tlzoom-stat-value" data-lbl="playhead">00:00:00</span></span>
        <span class="tlzoom-sep"></span>
        <span class="tlzoom-stat"><span class="tlzoom-stat-label">View</span><span class="tlzoom-stat-value" data-lbl="view">&mdash;</span></span>
        <span class="tlzoom-sep"></span>
        <span class="tlzoom-stat"><span class="tlzoom-stat-label">Span</span><span class="tlzoom-stat-value" data-lbl="span">&mdash;</span></span>
        <span class="tlzoom-sep"></span>
        <span class="tlzoom-stat"><span class="tlzoom-stat-label">Clips</span><span class="tlzoom-stat-value" data-lbl="clips">0</span></span>
        <span class="tlzoom-spacer"></span>
        <span class="tlzoom-stat in"><span class="tlzoom-stat-label">IN</span><span class="tlzoom-stat-value" data-lbl="in">&mdash;</span></span>
        <span class="tlzoom-sep"></span>
        <span class="tlzoom-stat out"><span class="tlzoom-stat-label">OUT</span><span class="tlzoom-stat-value" data-lbl="out">&mdash;</span></span>
        <span class="tlzoom-sep"></span>
        <span class="tlzoom-stat"><span class="tlzoom-stat-label">DUR</span><span class="tlzoom-stat-value" data-lbl="dur">&mdash;</span></span>
        <span class="tlzoom-sep"></span>
        <span class="tlzoom-buffering-badge" data-el="bufBadge">Buffering</span>
        <button type="button" class="tlzoom-reset-btn" data-act="reset" title="Reset zoom to full range">Reset view</button>
      </div>
      <div class="tlzoom-section-cap"><span><b>Anchor</b> &middot; where you are in the stream</span><span class="hint">read-only</span></div>
      <div class="tlzoom-minimap-wrap">
        <div class="tlzoom-minimap" data-el="minimap">
          <div class="tlzoom-minimap-viewport" data-el="mmViewport"></div>
          <div class="tlzoom-minimap-playhead" data-el="mmPlayhead"></div>
        </div>
      </div>
      <div class="tlzoom-minimap-labels" data-el="mmLabels"></div>
      <div class="tlzoom-section-cap" style="margin-top:12px;"><span><b>Navigator</b> &middot; zoom &middot; scrub &middot; seek</span><span class="hint">drag bg / drag playhead / wheel</span></div>
      <div class="tlzoom-scrubber-wrap">
        <div class="tlzoom-scrubber" data-el="scrubber">
          <div class="tlzoom-playhead" data-el="playhead"></div>
        </div>
        <div class="tlzoom-tooltip" data-el="tooltip">00:00:00</div>
      </div>
    `;

    const q = (sel) => rootEl.querySelector(sel);
    const els = {
      root: rootEl,
      lblPlayhead: q('[data-lbl="playhead"]'),
      lblView:     q('[data-lbl="view"]'),
      lblSpan:     q('[data-lbl="span"]'),
      lblIn:       q('[data-lbl="in"]'),
      lblOut:      q('[data-lbl="out"]'),
      lblDur:      q('[data-lbl="dur"]'),
      lblClips:    q('[data-lbl="clips"]'),
      minimap:     q('[data-el="minimap"]'),
      mmViewport:  q('[data-el="mmViewport"]'),
      mmPlayhead:  q('[data-el="mmPlayhead"]'),
      mmLabels:    q('[data-el="mmLabels"]'),
      scrubber:    q('[data-el="scrubber"]'),
      playhead:    q('[data-el="playhead"]'),
      tooltip:     q('[data-el="tooltip"]'),
      bufBadge:    q('[data-el="bufBadge"]'),
      btnReset:    q('[data-act="reset"]'),
    };

    // Verify all els resolved — log loudly so we don't silently fail mid-render.
    for (const k in els) {
      if (els[k] == null) console.warn('[timeline-zoom] els.' + k + ' is null — DOM mount likely broken');
    }

    const state = { view: null /* {start, end} in absolute timeline coords */ };
    let renderQueued = false;

    function getClipState() {
      if (!window.ClipState) return { pendingInTime: null, clips: [] };
      return {
        pendingInTime: window.ClipState.getPendingInTime(),
        clips: window.ClipState.getPendingClips() || [],
      };
    }
    // Stats summary: latest clip wins for IN/OUT/DUR, pending IN takes precedence.
    function getStatsMarks(cs) {
      if (cs.pendingInTime != null) return { inMark: cs.pendingInTime, outMark: null };
      const last = cs.clips[cs.clips.length - 1];
      if (last) return { inMark: last.inTime, outMark: last.outTime };
      return { inMark: null, outMark: null };
    }

    function render() {
      try { return _render(); } catch (e) { console.error('[timeline-zoom] render error:', e); }
    }
    function _render() {
      const range = getTimelineRange();
      if (!range) { els.root.hidden = true; return; }
      els.root.hidden = false;

      // Lazy-init view to full range; rescope into bounds if range moved.
      if (!state.view) {
        state.view = { start: range.absStart, end: range.absEnd };
      } else {
        if (state.view.start < range.absStart) {
          const delta = range.absStart - state.view.start;
          state.view = { start: state.view.start + delta, end: state.view.end + delta };
        }
        if (state.view.end > range.absEnd) {
          const sp = state.view.end - state.view.start;
          state.view = { start: Math.max(range.absStart, range.absEnd - sp), end: range.absEnd };
        }
      }

      const view = state.view;
      const span = view.end - view.start;
      const total = range.absEnd - range.absStart;
      const playhead = window.Player.els.vid.currentTime;
      const cs = getClipState();
      const marks = getStatsMarks(cs);

      els.lblPlayhead.textContent = fmtHMS(playhead - range.absStart);
      els.lblView.textContent = fmtHMS(view.start - range.absStart) + ' → ' + fmtHMS(view.end - range.absStart);
      els.lblSpan.textContent = fmtSpan(span);
      els.lblClips.textContent = String(cs.clips.length + (cs.pendingInTime != null ? 1 : 0));
      els.lblIn.textContent  = marks.inMark  != null ? fmtHMS(marks.inMark  - range.absStart) : '—';
      els.lblOut.textContent = marks.outMark != null ? fmtHMS(marks.outMark - range.absStart) : '—';
      els.lblDur.textContent = (marks.inMark != null && marks.outMark != null && marks.outMark > marks.inMark)
        ? fmtDur(marks.outMark - marks.inMark) : '—';

      const sw = els.scrubber.clientWidth;

      Array.from(els.scrubber.querySelectorAll('.tlzoom-tick, .tlzoom-tick-label')).forEach(n => n.remove());
      const step = M.pickTickStep(span);
      const firstTick = Math.ceil(view.start / step) * step;
      for (let t = firstTick; t <= view.end; t += step) {
        const f = M.timeToFrac(view, t);
        if (f < 0 || f > 1) continue;
        const x = f * sw;
        const tick = document.createElement('div');
        tick.className = 'tlzoom-tick major';
        tick.style.left = x + 'px';
        els.scrubber.appendChild(tick);
        const lbl = document.createElement('div');
        lbl.className = 'tlzoom-tick-label';
        lbl.style.left = x + 'px';
        lbl.textContent = span >= 60 ? fmtHMS(t - range.absStart) : fmtHMS(t - range.absStart).slice(3);
        els.scrubber.appendChild(lbl);
      }

      const phF = M.timeToFrac(view, playhead);
      if (phF >= 0 && phF <= 1) {
        els.playhead.style.display = '';
        els.playhead.style.left = (phF * 100) + '%';
      } else {
        els.playhead.style.display = 'none';
      }

      // ─── Multi-state clip rendering: pending/downloading/done bands plus
      //     collab ranges. Each state gets a distinct visual class. Pending IN
      //     (no OUT yet) still shown as a single vertical line below.
      Array.from(els.scrubber.querySelectorAll('.tlzoom-clip, .tlzoom-pending-in')).forEach(n => n.remove());
      Array.from(els.minimap.querySelectorAll('.tlzoom-mm-clip, .tlzoom-mm-pending-in')).forEach(n => n.remove());

      const allClips = (window.ClipState && window.ClipState.getAllTimelineClips)
        ? window.ClipState.getAllTimelineClips()
        : cs.clips.map(c => Object.assign({}, c, { _state: 'pending' }));

      const collabRanges = (window.CollabUI && window.CollabUI.getClipRanges)
        ? window.CollabUI.getClipRanges() : [];

      function appendClipBand(clip, stateClass, userColor) {
        if (clip.inTime == null || clip.outTime == null || clip.outTime <= clip.inTime) return;
        const aF = M.timeToFrac(view, clip.inTime);
        const bF = M.timeToFrac(view, clip.outTime);
        if (bF >= 0 && aF <= 1) {
          const a = Math.max(aF, 0);
          const b = Math.min(bF, 1);
          if (b > a) {
            const band = document.createElement('div');
            band.className = 'tlzoom-clip ' + stateClass;
            band.style.left = (a * 100) + '%';
            band.style.width = ((b - a) * 100) + '%';
            if (clip.id) band.dataset.clipId = clip.id;
            if (clip.collabRangeId || stateClass === 'state-collab') {
              band.dataset.collabId = clip.id || clip.collabRangeId || '';
            }
            if (userColor) {
              band.style.borderLeftColor = userColor;
              band.style.borderRightColor = userColor;
            }
            const tag = document.createElement('div');
            tag.className = 'tlzoom-clip-tag';
            tag.textContent = clip.name || ('Clip ' + ((clip.id || '').slice(-4) || '?'));
            band.appendChild(tag);
            els.scrubber.appendChild(band);
          }
        }
        const mmA = ((clip.inTime  - range.absStart) / total) * 100;
        const mmB = ((clip.outTime - range.absStart) / total) * 100;
        if (mmB > mmA) {
          const mmBand = document.createElement('div');
          mmBand.className = 'tlzoom-mm-clip ' + stateClass;
          mmBand.style.left = mmA + '%';
          mmBand.style.width = (mmB - mmA) + '%';
          if (userColor) mmBand.style.background = userColor;
          els.minimap.appendChild(mmBand);
        }
      }

      allClips.forEach((clip) => appendClipBand(clip, 'state-' + (clip._state || 'pending')));

      // Collab ranges from other users — dedupe against our own clips by id.
      const ownIds = new Set(allClips.map(c => c.id).filter(Boolean));
      collabRanges.forEach((cr) => {
        if (ownIds.has(cr.id)) return;
        if (cr.pendingOut) return; // single-line range; not a band
        const userColor = (window.CollabUI && window.CollabUI.getUserColor)
          ? window.CollabUI.getUserColor(cr.userId, cr.userName) : '#7b61ff';
        appendClipBand(cr, 'state-collab', userColor);
      });

      // Pending IN (user marked IN but not yet OUT).
      if (cs.pendingInTime != null) {
        const pf = M.timeToFrac(view, cs.pendingInTime);
        if (pf >= 0 && pf <= 1) {
          const line = document.createElement('div');
          line.className = 'tlzoom-pending-in';
          line.style.left = (pf * 100) + '%';
          els.scrubber.appendChild(line);
        }
        const mmLine = document.createElement('div');
        mmLine.className = 'tlzoom-mm-pending-in';
        mmLine.style.left = (((cs.pendingInTime - range.absStart) / total) * 100) + '%';
        els.minimap.appendChild(mmLine);
      }

      const mmStartPct = ((view.start - range.absStart) / total) * 100;
      const mmEndPct   = ((view.end   - range.absStart) / total) * 100;
      els.mmViewport.style.left  = mmStartPct + '%';
      els.mmViewport.style.width = (mmEndPct - mmStartPct) + '%';
      els.mmPlayhead.style.left = (((playhead - range.absStart) / total) * 100) + '%';

      els.mmLabels.innerHTML = '';
      for (let i = 0; i <= 4; i++) {
        const t = (total / 4) * i;
        const lbl = document.createElement('span');
        lbl.style.left = (i * 25) + '%';
        lbl.textContent = fmtHMS(t);
        els.mmLabels.appendChild(lbl);
      }
    }

    function scheduleRender() {
      if (renderQueued) return;
      renderQueued = true;
      requestAnimationFrame(() => { renderQueued = false; render(); });
    }

    function resetView() {
      state.view = null;
      render();
    }

    if (window.Player && window.Player.on) {
      window.Player.on('timeupdate', scheduleRender);
      window.Player.on('streamready', () => { state.view = null; scheduleRender(); });
    }
    window.addEventListener('marks-changed', scheduleRender);
    window.addEventListener('resize', scheduleRender);
    els.btnReset.addEventListener('click', resetView);

    // ─── Buffering signal: turn the playhead red while video can't keep up.
    // We track a counter (not a boolean) because seeking + waiting can stack
    // and we only want to clear the buffering state once ALL signals settle.
    let bufferingDepth = 0;
    function setBuffering(on) {
      bufferingDepth = Math.max(0, bufferingDepth + (on ? 1 : -1));
      const isBuf = bufferingDepth > 0;
      els.scrubber.classList.toggle('buffering', isBuf);
      els.minimap.classList.toggle('buffering', isBuf);
      els.bufBadge.classList.toggle('on', isBuf);
    }
    function bindBufferingEvents() {
      const vid = window.Player && window.Player.els ? window.Player.els.vid : null;
      if (!vid) { setTimeout(bindBufferingEvents, 100); return; }
      // Suspended/loading frames → up; playable → down.
      vid.addEventListener('waiting',  () => setBuffering(true));
      vid.addEventListener('seeking',  () => setBuffering(true));
      vid.addEventListener('stalled',  () => setBuffering(true));
      vid.addEventListener('canplay',  () => setBuffering(false));
      vid.addEventListener('playing',  () => setBuffering(false));
      vid.addEventListener('seeked',   () => setBuffering(false));
      // Reconcile: if vid.readyState is HAVE_FUTURE_DATA(3)+ we're playable.
      // This catches the case where canplay/playing fired before we wired up.
      if (vid.readyState >= 3) bufferingDepth = 0;
    }
    bindBufferingEvents();

    // ─── Mouse interactions ─────────────────────────────────────────
    let drag = null;
    let autoPanRAF = null;

    function isNearPlayhead(localX, rect) {
      const playhead = window.Player.els.vid.currentTime;
      if (!state.view) return false;
      const phF = M.timeToFrac(state.view, playhead);
      if (phF < 0 || phF > 1) return false;
      const phX = phF * rect.width;
      return Math.abs(localX - phX) <= PLAYHEAD_HIT_RADIUS;
    }

    function maintainEdgeAutoPan(getLocalX, getWidth) {
      if (autoPanRAF) cancelAnimationFrame(autoPanRAF);
      function tick() {
        autoPanRAF = null;
        if (!drag || drag.mode !== 'scrub') return;
        const x = getLocalX();
        const w = getWidth();
        const range = getTimelineRange();
        if (!range || !state.view || w <= 0) return;
        const total = range.absEnd - range.absStart;
        const span = state.view.end - state.view.start;
        const shift = M.edgeAutoPanShift({ localX: x, width: w, span, edgeFrac: EDGE_AUTOPAN_FRAC, pxPerFrame: EDGE_AUTOPAN_PX_PER_FRAME });
        if (shift === 0) return;
        const beforeStart = state.view.start;
        const localView = { start: state.view.start - range.absStart, end: state.view.end - range.absStart };
        const shifted = M.shiftView(localView, shift, total);
        state.view = { start: shifted.start + range.absStart, end: shifted.end + range.absStart };
        if (state.view.start === beforeStart) return;
        const t = M.fracToTime(state.view, x / w);
        window.Player.timeline.seekTo(t);
        scheduleRender();
        autoPanRAF = requestAnimationFrame(tick);
      }
      autoPanRAF = requestAnimationFrame(tick);
    }

    els.scrubber.addEventListener('mousedown', (e) => {
      console.log('[timeline-zoom] mousedown', { button: e.button, hasView: !!state.view, x: e.clientX });
      if (e.button !== 0) return;
      if (!state.view) {
        console.warn('[timeline-zoom] mousedown ignored — state.view is null');
        return;
      }
      const rect = els.scrubber.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      drag = {
        startClientX: e.clientX,
        startLocalX: localX,
        startTime: M.fracToTime(state.view, localX / rect.width),
        viewStartAtDown: state.view.start,
        rect,
        hitPlayhead: isNearPlayhead(localX, rect),
        mode: null,
      };
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!drag) {
        if (e.target === els.scrubber || els.scrubber.contains(e.target)) {
          const rect = els.scrubber.getBoundingClientRect();
          const localX = e.clientX - rect.left;
          els.scrubber.style.cursor = isNearPlayhead(localX, rect) ? 'ew-resize' : '';
        }
        return;
      }
      const dx = e.clientX - drag.startClientX;
      if (drag.mode == null) {
        const threshold = drag.hitPlayhead ? DRAG_THRESHOLD_SCRUB : DRAG_THRESHOLD_PAN;
        if (Math.abs(dx) < threshold) return;
        drag.mode = drag.hitPlayhead ? 'scrub' : 'pan';
        els.scrubber.classList.add(drag.mode === 'pan' ? 'panning' : 'scrubbing');
        els.mmViewport.style.transition = 'none';
        els.tooltip.classList.remove('visible');
      }
      const localX = e.clientX - drag.rect.left;
      if (drag.mode === 'scrub') {
        const t = M.fracToTime(state.view, localX / drag.rect.width);
        window.Player.timeline.seekTo(t);
        maintainEdgeAutoPan(
          () => e.clientX - els.scrubber.getBoundingClientRect().left,
          () => els.scrubber.clientWidth
        );
      } else if (drag.mode === 'pan') {
        const sp = state.view.end - state.view.start;
        const newStart = drag.startTime - (localX / drag.rect.width) * sp;
        const range = getTimelineRange();
        if (!range) return;
        const total = range.absEnd - range.absStart;
        const localView = M.clampView(
          { start: newStart - range.absStart, end: newStart - range.absStart + sp },
          total
        );
        state.view = { start: localView.start + range.absStart, end: localView.end + range.absStart };
        scheduleRender();
      }
    });

    window.addEventListener('mouseup', () => {
      if (!drag) return;
      if (drag.mode == null) {
        window.Player.timeline.seekTo(drag.startTime);
        render();
      }
      els.scrubber.classList.remove('panning', 'scrubbing');
      els.mmViewport.style.transition = '';
      if (autoPanRAF) { cancelAnimationFrame(autoPanRAF); autoPanRAF = null; }
      drag = null;
    });

    els.scrubber.addEventListener('wheel', (e) => {
      console.log('[timeline-zoom] wheel', { deltaY: e.deltaY, deltaX: e.deltaX, hasView: !!state.view });
      if (!state.view) return;
      e.preventDefault();
      const rect = els.scrubber.getBoundingClientRect();
      const cursorFrac = (e.clientX - rect.left) / rect.width;
      const range = getTimelineRange();
      if (!range) return;
      const total = range.absEnd - range.absStart;

      const isPan = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (isPan) {
        const delta = e.shiftKey ? e.deltaY : e.deltaX;
        const sp = state.view.end - state.view.start;
        const localView = M.shiftView(
          { start: state.view.start - range.absStart, end: state.view.end - range.absStart },
          (delta / 100) * sp * 0.25,
          total
        );
        state.view = { start: localView.start + range.absStart, end: localView.end + range.absStart };
        scheduleRender();
        return;
      }

      const factor = e.deltaY > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      const localView = M.zoomAround(
        { start: state.view.start - range.absStart, end: state.view.end - range.absStart },
        cursorFrac, factor, total, MIN_SPAN
      );
      state.view = { start: localView.start + range.absStart, end: localView.end + range.absStart };
      scheduleRender();
    }, { passive: false });

    els.scrubber.addEventListener('mousemove', (e) => {
      if (drag || !state.view) return;
      const rect = els.scrubber.getBoundingClientRect();
      const f = (e.clientX - rect.left) / rect.width;
      const range = getTimelineRange();
      if (!range) return;
      const t = M.fracToTime(state.view, f);
      els.tooltip.textContent = fmtHMS(t - range.absStart);
      els.tooltip.style.left = (e.clientX - rect.left) + 'px';
      els.tooltip.style.top = '0px';
      els.tooltip.classList.add('visible');
    });
    els.scrubber.addEventListener('mouseleave', () => {
      if (drag) return;
      els.tooltip.classList.remove('visible');
      els.scrubber.style.cursor = '';
    });

    rootEl._tlzoom = { state, els, render, scheduleRender, resetView, getTimelineRange };

    render();
    return rootEl._tlzoom;
  }

  window.TimelineZoom = { mount };
})();
