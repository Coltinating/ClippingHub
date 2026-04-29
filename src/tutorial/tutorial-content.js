(function () {
  'use strict';

  /*
    Tutorial content uses action-required advance steps wherever possible.
    The user does the thing; the tutorial detects it and moves on. Only
    pure intro/explainer steps use { type: 'next-button' }.

    Body strings can use {{kb.<id>}} tokens — those are replaced at render
    time with the user's current keybind via KeybindRegistry. Avoid HTML
    entities like &rarr; in titles because they get double-escaped; use
    Unicode characters (→ — § ·) directly instead.

    Targets:
      target            CSS selector in the host renderer
      webviewTarget     { webviewId, selector } — element inside a <webview>;
                        selector may contain "|" to list fallback selectors

    Advance types:
      next-button                    user hits Next
      click   { target }             user clicks the spotlighted element
      event   { event }              CustomEvent fires on document
      webview-nav-to-video           channelBrowser navigates to a video URL
      menu-open { menu }             #menu-<menu> gains 'open' class
      watch   { watcher }            tutorial-actions.watch_<watcher>(cb) returns cleanup
      observe-class { selector,
                     className?,
                     present? }      MutationObserver fires when condition met
  */

  var content = {
    sections: [
      {
        id: 'getting-started',
        title: 'Getting Started',
        blurb: 'Open the Rumble browser and load your first stream.',
        steps: [
          {
            id: 'welcome',
            title: 'Welcome to ClippingHub',
            body: 'ClippingHub is a desktop clipper for live streams and uploads on Rumble.<br><br>This walkthrough lets you keep clicking around the app while it runs — try it.',
            placement: 'center',
            advance: { type: 'next-button' },
          },
          {
            id: 'pick-a-video',
            title: 'Pick the most recent stream',
            body: 'The big panel is an embedded Rumble browser. The highlighted card is the channel\'s most recent stream — click it (or any other video) and ClippingHub will auto-load it into the player. No URL pasting needed.',
            // Spotlight the first video card on the channel page. The pipe (|)
            // lets us list fallback selectors — Rumble has shipped a few
            // markup variants over the years; we try the user-confirmed
            // current path first, then fall back to the generic class.
            webviewTarget: {
              webviewId: 'channelBrowser',
              selector: 'main section > div:nth-child(1) > div:nth-child(2) a.videostream__link | main section a.videostream__link | a.videostream__link',
            },
            placement: 'auto',
            advance: { type: 'webview-nav-to-video' },
          },
          {
            id: 'stream-loaded',
            title: 'Stream loaded',
            body: 'The player should be visible now. When you are ready, hit <b>Next</b> to start clipping.',
            target: '#playerWrap',
            placement: 'auto',
            advance: { type: 'next-button' },
          },
        ],
      },

      {
        id: 'basic-clipping',
        title: 'Basic Clipping',
        blurb: 'Mark IN/OUT, queue a clip, and download it.',
        prereq: 'stream-loaded',
        steps: [
          {
            id: 'player',
            title: 'The player',
            body: 'This is the player. <kbd>{{kb.playPause}}</kbd> plays/pauses, drag the timeline to scrub, and the seek-bar shortcuts in the keyboard map jump you around fast.',
            target: '#playerWrap',
            placement: 'auto',
            advance: { type: 'next-button' },
          },
          {
            id: 'mark-in',
            title: 'Mark IN',
            body: 'Find a moment you want to clip, then press <kbd>{{kb.markIn}}</kbd> or click the <b>IN</b> button. (Try it now — the tutorial will move on once you mark.)',
            target: '#markInBtn',
            placement: 'top',
            advance: { type: 'watch', watcher: 'markIn' },
          },
          {
            id: 'mark-out',
            title: 'Mark OUT',
            body: 'Let it play a beat, then press <kbd>{{kb.markOut}}</kbd> or click the <b>OUT</b> button to finish the clip.',
            target: '#markOutBtn',
            placement: 'top',
            advance: { type: 'watch', watcher: 'markOut' },
          },
          {
            id: 'clips-queue',
            title: 'Clips Queue',
            body: 'Your clip just landed in the <b>Pending</b> list. Each pending clip has a caption box and per-clip overrides for watermark, outro, and preview.',
            target: '#hubSection',
            placement: 'auto',
            advance: { type: 'next-button' },
          },
          {
            id: 'output-folder',
            title: 'Where finished clips go',
            body: 'Once a clip downloads, it moves to <b>Done</b>. The folder icon opens the output directory in Explorer so you can grab the file.',
            target: '#openCompletedFolder',
            placement: 'auto',
            advance: { type: 'next-button' },
          },
        ],
      },

      {
        id: 'watermarks',
        title: 'Watermarks & Preview',
        blurb: 'Stamp a logo or text onto every export.',
        steps: [
          {
            id: 'intro',
            title: 'About watermarks',
            body: 'Watermarks let you brand every clip with text or an image. They live under <b>Settings → Assets</b>. Let us walk there together.',
            placement: 'center',
            advance: { type: 'next-button' },
          },
          {
            id: 'open-file-menu',
            title: 'Open the File menu',
            body: 'Click <b>File</b> in the top menu — the spotlight will jump to <b>Settings</b> as soon as the dropdown opens.',
            target: '.menu-item[data-menu="file"]',
            placement: 'auto',
            advance: { type: 'menu-open', menu: 'file' },
          },
          {
            id: 'click-settings',
            title: 'Click Settings',
            body: 'Click <b>Settings</b> in the dropdown to open the configuration panel.',
            target: '#ddSettings',
            placement: 'right',
            advance: { type: 'observe-class', selector: '.config-modal-overlay', present: true },
          },
          {
            id: 'assets-tab',
            title: 'Switch to the Assets tab',
            body: 'In the settings sidebar, click <b>Assets</b>. That is where universal watermark and outro live.',
            target: '.settings-tab[data-tab="assets"]',
            placement: 'right',
            advance: { type: 'observe-class', selector: '.settings-tab[data-tab="assets"]', className: 'active' },
          },
          {
            id: 'enable-watermark',
            title: 'Enable the universal watermark',
            body: 'Tick <b>Watermark</b> on. This applies your watermark to every exported clip unless a per-clip override says otherwise.',
            target: '#cfgWatermark',
            placement: 'right',
            advance: { type: 'click', target: '#cfgWatermark' },
          },
          {
            id: 'configure-watermark',
            title: 'Configure the watermark',
            body: 'Click <b>Edit Watermark</b> to set the text/image and choose its on-screen position. Skip this step to keep your existing config.',
            target: '#cfgEditWatermark',
            placement: 'right',
            advance: { type: 'next-button' },
          },
          {
            id: 'preview-callout',
            title: 'Per-clip preview',
            body: 'Once you have at least one pending clip, the <b>Preview</b> button on the clip card grabs a frame and stamps the watermark on top — handy for sanity-checking placement before you commit to a download.',
            placement: 'center',
            advance: { type: 'next-button' },
          },
        ],
      },

      {
        id: 'outros',
        title: 'Outros',
        blurb: 'Append a tail clip or image to every export.',
        steps: [
          {
            id: 'intro',
            title: 'About outros',
            body: 'An outro is a short clip or image appended to the end of every export — useful for branding, channel handles, or "follow me" cards.',
            placement: 'center',
            advance: { type: 'next-button' },
          },
          {
            id: 'open-file-menu',
            title: 'Open the File menu',
            body: 'Click <b>File</b> in the top menu to start.',
            target: '.menu-item[data-menu="file"]',
            placement: 'auto',
            advance: { type: 'menu-open', menu: 'file' },
          },
          {
            id: 'click-settings',
            title: 'Click Settings',
            body: 'Click <b>Settings</b> in the dropdown.',
            target: '#ddSettings',
            placement: 'right',
            advance: { type: 'observe-class', selector: '.config-modal-overlay', present: true },
          },
          {
            id: 'assets-tab',
            title: 'Switch to the Assets tab',
            body: 'Click <b>Assets</b> in the sidebar.',
            target: '.settings-tab[data-tab="assets"]',
            placement: 'right',
            advance: { type: 'observe-class', selector: '.settings-tab[data-tab="assets"]', className: 'active' },
          },
          {
            id: 'enable-outro',
            title: 'Enable the universal outro',
            body: 'Tick <b>Outro</b> on. Like the watermark, this applies to every export unless a clip overrides it.',
            target: '#cfgOutroEnabled',
            placement: 'right',
            advance: { type: 'click', target: '#cfgOutroEnabled' },
          },
          {
            id: 'browse-outro',
            title: 'Pick the outro file',
            body: 'Click <b>Browse</b> to choose a video or image. Recommended: a short 2–4s file matching your output resolution.',
            target: '#cfgOutroBrowse',
            placement: 'right',
            advance: { type: 'next-button' },
          },
        ],
      },

      {
        id: 'encoding',
        title: 'FFmpeg & Output',
        blurb: 'Tune codec, quality, and where files land.',
        steps: [
          {
            id: 'intro',
            title: 'About encoding',
            body: 'Encoding settings control codec, quality target, and how fast clips render. The defaults are sane for most users — pop in only if you know what you want.',
            placement: 'center',
            advance: { type: 'next-button' },
          },
          {
            id: 'open-file-menu',
            title: 'Open the File menu',
            body: 'Click <b>File</b> in the top menu.',
            target: '.menu-item[data-menu="file"]',
            placement: 'auto',
            advance: { type: 'menu-open', menu: 'file' },
          },
          {
            id: 'click-settings',
            title: 'Click Settings',
            body: 'Click <b>Settings</b> in the dropdown.',
            target: '#ddSettings',
            placement: 'right',
            advance: { type: 'observe-class', selector: '.config-modal-overlay', present: true },
          },
          {
            id: 'switch-tab-encoding',
            title: 'Switch to the Encoding tab',
            body: 'Click <b>Encoding</b> in the settings sidebar.',
            target: '.settings-tab[data-tab="encoding"]',
            placement: 'right',
            advance: { type: 'observe-class', selector: '.settings-tab[data-tab="encoding"]', className: 'active' },
          },
          {
            id: 'video-codec',
            title: 'Video codec',
            body: '<b>h264</b> = max compatibility (X / YouTube safe). <b>h265</b> = smaller files, narrower playback support. <b>AV1</b> = best quality/size, slowest to encode.',
            target: '#cfgVideoCodec',
            placement: 'right',
            advance: { type: 'next-button' },
          },
          {
            id: 'preset',
            title: 'Preset',
            body: 'Speed/size tradeoff. <b>fast</b> for long batches, <b>medium</b> default, <b>slow</b> for archive-quality renders.',
            target: '#cfgPreset',
            placement: 'right',
            advance: { type: 'next-button' },
          },
          {
            id: 'crf',
            title: 'CRF',
            body: 'Quality target. Lower is better/larger. <b>18</b> visually lossless, <b>23</b> default, <b>28</b> small files. Range 0–51.',
            target: '#cfgCrf',
            placement: 'right',
            advance: { type: 'next-button' },
          },
          {
            id: 'hwaccel',
            title: 'Hardware acceleration',
            body: 'NVIDIA / AMD / Intel GPU encoding speeds up renders 3–10×. Falls back to CPU automatically when unavailable.',
            target: '#cfgHwaccel',
            placement: 'right',
            advance: { type: 'next-button' },
          },
          {
            id: 'audio',
            title: 'Audio',
            body: 'AAC + 192k is the safe default. Bump bitrate up to 320k if you want pristine audio.',
            target: '#cfgAudioCodec',
            placement: 'right',
            advance: { type: 'next-button' },
          },
        ],
      },
    ],
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = content;
  if (typeof window !== 'undefined') window._tutorialContent = content;
})();
