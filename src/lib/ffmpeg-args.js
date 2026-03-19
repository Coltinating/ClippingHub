// ffmpeg arg building and segment parsing

function buildTrimArgs(inputPath, outputPath, ssOffset, duration) {
  return [
    '-y',
    '-i', inputPath,
    '-ss', String(ssOffset),
    '-t', String(duration),
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    outputPath,
  ];
}

function parseSegments(text) {
  const lines = text.split('\n');
  const segs = [];
  let t = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#EXTINF:')) {
      const dur = parseFloat(line.match(/#EXTINF:([\d.]+)/)?.[1] || '0');
      const next = lines[i + 1]?.trim();
      if (next && !next.startsWith('#')) {
        segs.push({ url: next, duration: dur, startTime: t });
        t += dur;
      }
    }
  }
  return segs;
}

function findCoveringSegments(segments, startSec, durationSec) {
  const endSec = startSec + durationSec;
  return segments.filter(s => s.startTime + s.duration > startSec && s.startTime < endSec);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildTrimArgs, parseSegments, findCoveringSegments };
}
