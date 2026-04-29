(function () {
  'use strict';
  var FLAG_KEY = 'ch.tutorial.seen.v1';
  var PROGRESS_KEY = 'ch.tutorial.progress.v1';

  function root() { return (typeof window !== 'undefined') ? window : globalThis; }

  var content = null;
  var state = { phase: 'idle', sectionId: null, stepIndex: 0, completed: {} };
  var listeners = [];

  function emit() { for (var i = 0; i < listeners.length; i++) listeners[i](state); }
  function on(fn) { listeners.push(fn); }
  function off(fn) { listeners = listeners.filter(function (f) { return f !== fn; }); }

  function loadProgress() {
    try {
      var raw = root().localStorage.getItem(PROGRESS_KEY);
      if (raw) state.completed = JSON.parse(raw) || {};
    } catch (e) {}
  }

  function saveProgress() {
    try { root().localStorage.setItem(PROGRESS_KEY, JSON.stringify(state.completed)); } catch (e) {}
  }

  function init(c) {
    content = c;
    state = { phase: 'idle', sectionId: null, stepIndex: 0, completed: {} };
    listeners = [];
    loadProgress();
    emit();
  }

  function findSection(id) {
    if (!content) return null;
    for (var i = 0; i < content.sections.length; i++) {
      if (content.sections[i].id === id) return content.sections[i];
    }
    return null;
  }

  function getCurrentStep() {
    var sec = findSection(state.sectionId);
    if (!sec) return null;
    return sec.steps[state.stepIndex] || null;
  }

  function getCurrentSection() { return findSection(state.sectionId); }

  function checkPrereq(prereq) {
    if (!prereq) return true;
    if (typeof document === 'undefined') return true;
    if (prereq === 'stream-loaded') {
      var v = document.getElementById('vid');
      return !!(v && v.src);
    }
    if (prereq === 'pending-clip') {
      var l = document.getElementById('pendingClipList');
      return !!(l && l.querySelector('.clip-card'));
    }
    return true;
  }

  function openTOC() { state.phase = 'toc'; state.sectionId = null; emit(); }

  function startSection(id) {
    var sec = findSection(id);
    if (!sec) return;
    if (sec.prereq && !checkPrereq(sec.prereq)) {
      state.phase = 'prereq-warn';
      state.sectionId = id;
      state.pendingPrereq = sec.prereq;
      emit();
      return;
    }
    state.phase = 'in-section';
    state.sectionId = id;
    state.stepIndex = 0;
    emit();
  }

  function forceStart(id) {
    var sec = findSection(id);
    if (!sec) return;
    state.phase = 'in-section';
    state.sectionId = id;
    state.stepIndex = 0;
    emit();
  }

  function next() {
    var sec = findSection(state.sectionId);
    if (!sec) return;
    if (state.stepIndex + 1 < sec.steps.length) {
      state.stepIndex += 1;
      emit();
      return;
    }
    state.completed[sec.id] = true;
    saveProgress();
    openTOC();
  }

  function back() {
    if (state.stepIndex > 0) { state.stepIndex -= 1; emit(); }
  }

  function exit() {
    state.phase = 'idle';
    state.sectionId = null;
    emit();
  }

  function skipSection() {
    state.phase = 'toc';
    state.sectionId = null;
    emit();
  }

  function isFirstRun() {
    try { return root().localStorage.getItem(FLAG_KEY) !== '1'; }
    catch (e) { return false; }
  }

  function markSeen() {
    try { root().localStorage.setItem(FLAG_KEY, '1'); } catch (e) {}
  }

  function clearSeen() {
    try { root().localStorage.removeItem(FLAG_KEY); } catch (e) {}
  }

  function skipTutorial() {
    markSeen();
    exit();
  }

  var api = {
    init: init,
    on: on,
    off: off,
    getState: function () { return state; },
    getCurrentStep: getCurrentStep,
    getCurrentSection: getCurrentSection,
    openTOC: openTOC,
    startSection: startSection,
    forceStart: forceStart,
    next: next,
    back: back,
    exit: exit,
    skipSection: skipSection,
    skipTutorial: skipTutorial,
    isFirstRun: isFirstRun,
    markSeen: markSeen,
    clearSeen: clearSeen,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window._tutorialEngine = api;
})();
