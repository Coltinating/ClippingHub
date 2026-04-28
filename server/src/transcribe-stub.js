// PLACEHOLDER: emits fake chunks every 1s so the wire path can be verified.
// Replace `tick` with a real whisper invocation later (whisper.cpp, faster-whisper,
// or a spawned ffmpeg | whisper pipe — see app's main.js:743-1100 for reference).
const FILLER = ['…', '(silence)', '...mock chunk for '];

export function startStub({ channelId, videoUrl, onChunk, onError }) {
  let n = 0;
  const id = setInterval(() => {
    try {
      n++;
      onChunk({
        tStart: (n - 1) * 1.0,
        tEnd: n * 1.0,
        text: `${FILLER[n % FILLER.length]}${channelId} #${n}`
      });
    } catch (e) { onError?.(e); }
  }, 1000);
  return () => clearInterval(id);
}
