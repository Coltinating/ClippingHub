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
    var pollHandle = null;

    function check() {
      try {
        var url = wv.getURL ? wv.getURL() : wv.src;
        if (isVideoUrl(url)) onVideo(url);
      } catch (_) {}
    }

    function navHandler() { check(); }

    // Primary: Electron <webview> events
    try { wv.addEventListener('did-navigate', navHandler); } catch (_) {}
    try { wv.addEventListener('did-navigate-in-page', navHandler); } catch (_) {}
    // Fallback: poll src in case those events don't fire on this Electron version
    pollHandle = setInterval(check, 500);

    return function () {
      try { wv.removeEventListener('did-navigate', navHandler); } catch (_) {}
      try { wv.removeEventListener('did-navigate-in-page', navHandler); } catch (_) {}
      if (pollHandle) clearInterval(pollHandle);
    };
  }

  window._tutorialActions = {
    navigateRumble: navigateRumble,
    pasteCurrentRumbleUrl: pasteCurrentRumbleUrl,
    watchWebviewForVideo: watchWebviewForVideo,
    isVideoUrl: isVideoUrl,
  };
})();
