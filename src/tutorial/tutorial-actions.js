(function () {
  'use strict';

  function navigateRumble(channel) {
    var wv = document.getElementById('channelBrowser');
    if (!wv) return;
    var url = 'https://rumble.com/c/' + channel;
    if (wv.loadURL) try { wv.loadURL(url); } catch (_) { wv.src = url; }
    else wv.src = url;
  }

  function pasteCurrentRumbleUrl() {
    var wv = document.getElementById('channelBrowser');
    var input = document.getElementById('urlIn');
    if (!wv || !input) return;
    try {
      var url = wv.getURL ? wv.getURL() : wv.src;
      if (url) {
        input.value = url;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } catch (e) {}
  }

  function isVideoUrl(url) {
    return /^https?:\/\/rumble\.com\/v[a-z0-9]+/i.test(url || '');
  }

  function watchWebviewForVideo(onVideo) {
    var wv = document.getElementById('channelBrowser');
    if (!wv) return function () {};
    var fired = false;
    var pollHandle = null;
    var vidObserver = null;

    function fire(url) {
      if (fired) return;
      fired = true;
      cleanup();
      onVideo(url);
    }

    // renderer.js intercepts will-navigate and calls webview.stop() before
    // navigation completes, so wv.getURL() / did-navigate never reflect the
    // video URL. We hook will-navigate directly (where e.url is the target)
    // and also watch #vid.src as a robust fallback for any code path that
    // loads a stream into the player.
    function urlHandler(e) {
      var url = (e && e.url) || null;
      if (!url && wv.getURL) { try { url = wv.getURL(); } catch (_) {} }
      if (isVideoUrl(url)) fire(url);
    }

    function vidCheck() {
      var v = document.getElementById('vid');
      if (v && v.src) fire(v.src);
    }

    try { wv.addEventListener('will-navigate', urlHandler); } catch (_) {}
    try { wv.addEventListener('did-start-navigation', urlHandler); } catch (_) {}
    try { wv.addEventListener('did-navigate', urlHandler); } catch (_) {}
    try { wv.addEventListener('did-navigate-in-page', urlHandler); } catch (_) {}

    var v = document.getElementById('vid');
    if (v) {
      vidObserver = new MutationObserver(vidCheck);
      vidObserver.observe(v, { attributes: true, attributeFilter: ['src'] });
      vidCheck();
    }

    pollHandle = setInterval(function () {
      try {
        var url = wv.getURL ? wv.getURL() : wv.src;
        if (isVideoUrl(url)) fire(url);
      } catch (_) {}
      vidCheck();
    }, 500);

    function cleanup() {
      try { wv.removeEventListener('will-navigate', urlHandler); } catch (_) {}
      try { wv.removeEventListener('did-start-navigation', urlHandler); } catch (_) {}
      try { wv.removeEventListener('did-navigate', urlHandler); } catch (_) {}
      try { wv.removeEventListener('did-navigate-in-page', urlHandler); } catch (_) {}
      if (vidObserver) { try { vidObserver.disconnect(); } catch (_) {} vidObserver = null; }
      if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
    }
    return cleanup;
  }

  // Resolve the bounding rect of an element living inside a <webview>.
  // Async because executeJavaScript returns a Promise. Translates the inner
  // rect into outer-page coords by adding the webview's own rect offset, so
  // the tutorial spotlight (which lives in the host renderer) can highlight
  // a video card the user is supposed to click on Rumble.
  function getWebviewElementRect(webviewId, selector) {
    var wv = document.getElementById(webviewId);
    if (!wv || typeof wv.executeJavaScript !== 'function') return Promise.resolve(null);
    var wvRect = wv.getBoundingClientRect();
    if (!wvRect || wvRect.width <= 0 || wvRect.height <= 0) return Promise.resolve(null);
    var script =
      '(function(){' +
        'var sel=' + JSON.stringify(selector) + ';' +
        'var parts=sel.split("|");' +
        'var el=null;' +
        'for(var i=0;i<parts.length;i++){' +
          'try{ el=document.querySelector(parts[i].trim()); }catch(_){ el=null; }' +
          'if(el) break;' +
        '}' +
        'if(!el) return null;' +
        'var r=el.getBoundingClientRect();' +
        'if(r.width<=0||r.height<=0) return null;' +
        'return {top:r.top,left:r.left,width:r.width,height:r.height};' +
      '})()';
    var p;
    try { p = wv.executeJavaScript(script, false); }
    catch (_) { return Promise.resolve(null); }
    if (!p || typeof p.then !== 'function') return Promise.resolve(null);
    return p.then(function (r) {
      if (!r) return null;
      return {
        top: wvRect.top + r.top,
        left: wvRect.left + r.left,
        width: r.width,
        height: r.height,
        right: wvRect.left + r.left + r.width,
        bottom: wvRect.top + r.top + r.height,
      };
    }).catch(function () { return null; });
  }

  // Lightweight key-binding matcher mirroring renderer.js semantics.
  // Handles modifier prefixes ("shift+,", "ctrl+ArrowLeft") and bare keys.
  function keyMatches(e, bind) {
    if (!bind) return false;
    var parts = String(bind).toLowerCase().split('+');
    var key = parts[parts.length - 1];
    var hasCtrl = parts.indexOf('ctrl') >= 0;
    var hasShift = parts.indexOf('shift') >= 0;
    var hasAlt = parts.indexOf('alt') >= 0;
    if (!!e.ctrlKey !== hasCtrl) return false;
    if (!!e.shiftKey !== hasShift) return false;
    if (!!e.altKey !== hasAlt) return false;
    var eKey = (e.key || '').toLowerCase();
    return eKey === key;
  }

  function liveBind(id) {
    var live = (window.userConfig && window.userConfig.keybinds) || {};
    if (live[id] != null) return live[id];
    var Reg = window.KeybindRegistry;
    if (Reg && Array.isArray(Reg.REGISTRY)) {
      for (var i = 0; i < Reg.REGISTRY.length; i++) {
        if (Reg.REGISTRY[i].id === id) return Reg.REGISTRY[i].default;
      }
    }
    return null;
  }

  // Watch for "mark IN" — fires on either #markInBtn click OR the user's
  // current markIn keybind being pressed. Covers both ways the app accepts
  // mark IN without depending on Stream A renderer.js dispatching events.
  function makeKeyOrClickWatcher(keybindId, buttonId) {
    return function (onAdvance) {
      var btn = buttonId ? document.getElementById(buttonId) : null;
      var fired = false;
      function fire() {
        if (fired) return;
        fired = true;
        cleanup();
        onAdvance();
      }
      function btnHandler() { fire(); }
      function keyHandler(e) {
        // Skip while focus is in inputs/textareas — those keystrokes are typing
        var t = e.target;
        var tag = t && t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
        var bind = liveBind(keybindId);
        if (keyMatches(e, bind)) fire();
      }
      function cleanup() {
        if (btn) btn.removeEventListener('click', btnHandler);
        document.removeEventListener('keydown', keyHandler, true);
      }
      if (btn) btn.addEventListener('click', btnHandler);
      document.addEventListener('keydown', keyHandler, true);
      return cleanup;
    };
  }

  // Generic class/presence observer.
  // - { selector, present: true }   → fires when first matching element appears
  // - { selector, className: 'active' } → fires when matching element gains class
  function observeClass(opts, onAdvance) {
    if (!opts || !opts.selector) return function () {};
    var fired = false;

    function checkPresent() {
      var el = document.querySelector(opts.selector);
      if (opts.className) {
        if (el && el.classList && el.classList.contains(opts.className)) fire();
      } else if (opts.present !== false) {
        if (el) fire();
      } else {
        if (!el) fire();
      }
    }

    function fire() {
      if (fired) return;
      fired = true;
      cleanup();
      onAdvance();
    }

    var mo = new MutationObserver(checkPresent);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    // Run once now in case condition is already true
    checkPresent();

    function cleanup() { try { mo.disconnect(); } catch (_) {} }
    return cleanup;
  }

  window._tutorialActions = {
    navigateRumble: navigateRumble,
    pasteCurrentRumbleUrl: pasteCurrentRumbleUrl,
    watchWebviewForVideo: watchWebviewForVideo,
    getWebviewElementRect: getWebviewElementRect,
    isVideoUrl: isVideoUrl,
    observeClass: observeClass,
    watch_markIn: makeKeyOrClickWatcher('markIn', 'markInBtn'),
    watch_markOut: makeKeyOrClickWatcher('markOut', 'markOutBtn'),
    watch_playPause: makeKeyOrClickWatcher('playPause', null),
  };
})();
