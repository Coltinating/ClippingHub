// ffmpeg arg building and segment parsing

function buildTrimArgs(inputPath, outputPath, ssOffset, duration) {
  return [
    '-y',
    '-ss', String(ssOffset),
    '-i', inputPath,
    '-t', String(duration),
    '-vf', 'setpts=PTS-STARTPTS',
    '-af', 'asetpts=PTS-STARTPTS',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    outputPath,
  ];
}

function parseSegments(text) {
  const lines = text.split('\n');
  const segs = [];
  let tMs = 0;
  let mediaSequence = 0;
  let segIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const seqMatch = line.match(/^#EXT-X-MEDIA-SEQUENCE:(\d+)/);
    if (seqMatch) {
      mediaSequence = parseInt(seqMatch[1], 10);
    }
    if (line.startsWith('#EXTINF:')) {
      const dur = parseFloat(line.match(/#EXTINF:([\d.]+)/)?.[1] || '0');
      const next = lines[i + 1]?.trim();
      if (next && !next.startsWith('#')) {
        segs.push({
          url: next,
          duration: dur,
          startTime: tMs / 1000,
          seq: mediaSequence + segIndex,
        });
        tMs += Math.round(dur * 1000);
        segIndex++;
      }
    }
  }
  return { segments: segs, mediaSequence, totalDuration: tMs / 1000 };
}

function findCoveringSegments(segments, startSec, durationSec) {
  const endSec = startSec + durationSec;
  return segments.filter(s => s.startTime + s.duration > startSec && s.startTime < endSec);
}

function buildConcatArgs(listFile, outputPath) {
  return [
    '-y',
    '-f', 'concat', '-safe', '0', '-i', listFile,
    '-c', 'copy',
    '-output_ts_offset', '0',
    '-avoid_negative_ts', 'make_zero',
    outputPath,
  ];
}

function buildImageWatermarkArgs(wm) {
  if (!wm || !wm.imagePath) return null;

  const pos = wm.position || 'center';
  let x, y;

  switch (pos) {
    case 'top-left':     x = '0';       y = '0';       break;
    case 'top-right':    x = 'W-w';     y = '0';       break;
    case 'bottom-left':  x = '0';       y = 'H-h';     break;
    case 'bottom-right': x = 'W-w';     y = 'H-h';     break;
    case 'center':
    default:             x = '(W-w)/2'; y = '(H-h)/2'; break;
  }

  const opacity = wm.opacity ?? 1;

  // Build overlay input filter chain
  let overlayChain = '[1:v]format=rgba';

  // Scale: multiplier (e.g. 0.5 = half), or explicit width/height
  if (wm.scale && wm.scale !== 1) {
    overlayChain += `,scale=iw*${wm.scale}:ih*${wm.scale}`;
  } else if (wm.width && wm.height) {
    overlayChain += `,scale=${wm.width}:${wm.height}`;
  } else if (wm.width) {
    overlayChain += `,scale=${wm.width}:-1`;
  } else if (wm.height) {
    overlayChain += `,scale=-1:${wm.height}`;
  }

  // Apply opacity via alpha channel mixer
  if (opacity < 1) {
    overlayChain += `,colorchannelmixer=aa=${opacity}`;
  }

  overlayChain += '[wm]';

  const filterComplex = `${overlayChain};[0:v]setpts=PTS-STARTPTS[base];[base][wm]overlay=x=${x}:y=${y}`;

  return {
    inputs: ['-i', wm.imagePath],
    filterComplex,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildTrimArgs, buildConcatArgs, parseSegments, findCoveringSegments, buildImageWatermarkArgs };
}
