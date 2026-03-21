// ffmpeg arg building and segment parsing

function buildTrimArgs(inputPath, outputPath, ssOffset, duration) {
  return [
    '-y',
    '-i', inputPath,
    '-ss', String(ssOffset),
    '-t', String(duration),
    '-vf', 'setpts=PTS-STARTPTS',
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildTrimArgs, buildConcatArgs, parseSegments, findCoveringSegments };
}
