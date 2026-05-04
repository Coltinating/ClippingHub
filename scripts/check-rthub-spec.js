// @ts-check
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { createHash } = require('node:crypto');

const SPEC_URL = 'https://rthub.1626.workers.dev/asyncapi.yaml';
const LOCK = '.rthub-spec.lock';

(async () => {
  const text = await (await fetch(SPEC_URL)).text();
  // Canonicalise: strip trailing whitespace per line, normalise EOLs.
  const canonical = text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
  const hash = createHash('sha256').update(canonical).digest('hex').slice(0, 16);
  const pinned = existsSync(LOCK) ? readFileSync(LOCK, 'utf8').trim() : '';
  if (!pinned) {
    writeFileSync(LOCK, hash + '\n');
    console.log('Initialised ' + LOCK + ' with ' + hash);
    return;
  }
  if (hash !== pinned) {
    console.error('rthub spec drift detected.');
    console.error('  pinned: ' + pinned);
    console.error('  live:   ' + hash);
    console.error('To accept (after auditing rthub-protocol.js mappers): write ' + hash + ' to ' + LOCK);
    process.exit(1);
  }
  console.log('rthub spec OK (' + hash + ')');
})();
