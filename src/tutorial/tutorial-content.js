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

    {{platform.<key>}} tokens expand per-OS using window._tutorialPlatformAdvice
    (defined at the bottom of this file). Use these for "what's fastest on
    your machine" recommendations so a Windows user never sees Linux/macOS
    options and vice-versa.

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
            // The featured/most-recent stream on a Rumble channel page is the
            // FIRST a.videostream__link in document order — a big card above
            // the row of smaller thumbnails. document.querySelector returns
            // the first match, so the simplest selector wins; the | fallbacks
            // only kick in if Rumble ships markup that loses the class.
            webviewTarget: {
              webviewId: 'channelBrowser',
              selector: 'main section a.videostream__link | a.videostream__link | a[href*=".html"][class*="video"]',
            },
            placement: 'auto',
            advance: { type: 'webview-nav-to-video' },
          },
          {
            id: 'stream-loaded',
            title: 'Stream loaded',
            body: 'The player should be visible now. When you are ready, press <b>Finish Section</b> to move on to the next tutorial section. You are able to skip the tutorial by closing the panel in the top right.',
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
            body: '<b>h264</b> = max compatibility (X / YouTube safe). <b>h265</b> = smaller files, narrower playback support. <b>nvenc</b>/<b>videotoolbox</b>/<b>vaapi</b>/<b>qsv</b> variants offload to your GPU when paired with the matching Hardware setting on the next tab.',
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
            title: 'CRF / CQ',
            body: 'Quality target. Lower is better/larger. <b>18</b> visually lossless, <b>23</b> default, <b>28</b> small files. Range 0–51. (NVENC reads this as CQ, same scale.)',
            target: '#cfgCrf',
            placement: 'right',
            advance: { type: 'next-button' },
          },
          {
            id: 'audio-codec',
            title: 'Audio codec',
            body: '<b>AAC</b> is the safe default — every player supports it. <b>Opus</b> sounds better at the same bitrate but isn\'t universally supported. <b>Copy</b> skips re-encoding the source audio entirely (fastest, but pass-through only).',
            target: '#cfgAudioCodec',
            placement: 'right',
            advance: { type: 'next-button' },
          },
          {
            id: 'audio-bitrate',
            title: 'Audio bitrate',
            body: '<b>192k</b> is the safe default. Bump to <b>256k</b> or <b>320k</b> for pristine audio in music-heavy clips. Lower than 128k starts losing audible quality.',
            target: '#cfgAudioBitrate',
            placement: 'right',
            advance: { type: 'next-button' },
          },
          {
            id: 'switch-tab-hardware',
            title: 'Switch to the Hardware tab',
            body: 'Encoding settings are split across two tabs. The GPU acceleration controls live on <b>Hardware</b> — click it now.',
            target: '.settings-tab[data-tab="performance"]',
            placement: 'right',
            advance: { type: 'observe-class', selector: '.settings-tab[data-tab="performance"]', className: 'active' },
          },
          {
            id: 'hwaccel',
            title: 'Hardware acceleration',
            body: 'GPU decoding speeds up renders 3–10× when paired with a matching codec. Falls back to CPU automatically when unavailable. Only options compatible with your OS are shown — pick the one that matches your GPU vendor.',
            target: '#cfgHwaccel',
            placement: 'right',
            advance: { type: 'next-button' },
          },
          {
            id: 'hwaccel-format',
            title: 'Output format',
            body: 'Pixel format the GPU keeps frames in during decode. Leave on <b>Default</b> unless you hit a "format mismatch" error — then match it to the HW Accel choice above (cuda/d3d11/videotoolbox_vld/vaapi/qsv).',
            target: '#cfgHwaccelFormat',
            placement: 'right',
            advance: { type: 'next-button' },
          },
          {
            id: 'hwaccel-device',
            title: 'Device ID',
            body: 'Which GPU to use when you have more than one. Leave blank for default. Set <b>0</b> for the primary GPU, <b>1</b> for the secondary, etc.',
            target: '#cfgHwaccelDevice',
            placement: 'right',
            advance: { type: 'next-button' },
          },
          {
            id: 'nvenc-preset',
            title: 'NVENC preset',
            body: 'Only used when the codec is <b>h264_nvenc</b> or <b>hevc_nvenc</b>. <b>p1</b> = fastest / lowest quality, <b>p7</b> = slowest / highest quality. <b>p4</b> is a sane default.',
            target: '#cfgNvencPreset',
            placement: 'right',
            advance: { type: 'next-button' },
          },
          {
            id: 'fastest-recommendation',
            title: 'Fastest on your machine',
            body: '{{platform.fastestSetup}}',
            placement: 'center',
            advance: { type: 'next-button' },
          },
        ],
      },
    ],
  };

  // Per-OS guidance for {{platform.X}} tokens. Keys are the token names;
  // each maps to an object of platform → text. The overlay's templateBody
  // picks window.clipper.platform (falling back to process.platform/win32).
  // Keep these short — they render inside a tutorial card body.
  var platformAdvice = {
    fastestSetup: {
      win32:
        'Windows users get the biggest speedup from a matching <b>codec</b> + <b>HW Accel</b> pair:<br>' +
        '• <b>NVIDIA GPU:</b> <code>h264_nvenc</code> + <code>cuda</code><br>' +
        '• <b>AMD GPU:</b> <code>libx264</code> + <code>d3d11va</code> (AMD has no native NVENC equivalent here)<br>' +
        '• <b>Intel iGPU:</b> <code>h264_qsv</code> + <code>qsv</code><br>' +
        'If you don\'t know your GPU, leave the defaults — ClippingHub falls back to CPU automatically.',
      darwin:
        'On macOS, the fastest path is always Apple\'s built-in encoder:<br>' +
        '• Codec: <code>h264_videotoolbox</code> (or <code>hevc_videotoolbox</code> for smaller files)<br>' +
        '• HW Accel: <code>videotoolbox</code><br>' +
        'No driver setup needed — works on every Mac from 2018 onward.',
      linux:
        'Linux choices depend on your GPU vendor:<br>' +
        '• <b>NVIDIA:</b> <code>h264_nvenc</code> + <code>cuda</code> (requires the proprietary driver)<br>' +
        '• <b>Intel/AMD:</b> <code>h264_vaapi</code> + <code>vaapi</code> (works with the open-source drivers)<br>' +
        '• <b>Intel only:</b> <code>h264_qsv</code> + <code>qsv</code> is also an option<br>' +
        'CPU fallback is always available with <code>libx264</code>.',
      'default':
        'Pick the codec ending in <code>_nvenc</code> / <code>_videotoolbox</code> / <code>_vaapi</code> / <code>_qsv</code> that matches your GPU, and set HW Accel to the matching value above. Leave defaults if unsure — ClippingHub falls back to CPU automatically.',
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = content;
    module.exports.platformAdvice = platformAdvice;
  }
  if (typeof window !== 'undefined') {
    window._tutorialContent = content;
    window._tutorialPlatformAdvice = platformAdvice;
  }
})();
