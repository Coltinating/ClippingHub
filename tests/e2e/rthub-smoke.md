# Rthub end-to-end smoke checklist

Run this manually after a deploy. Two app instances against one rthub broker.

## Pre-flight

- [ ] Rthub broker reachable: `curl -fsS https://<rthub-host>/asyncapi.yaml | head -3` returns YAML.
- [ ] `server_config.json` (in `%APPDATA%\ClippingHub\` on Windows) has `"rthubEnabled": true` and `"url": "wss://<rthub-host>/ws"` for both instances.
- [ ] Both instances run as different OS users (or one normal + one in a fresh user profile) so localStorage keys don't collide.

## Sync flow

1. **Launch instance A.** Connect with profile name "Alice", role `clipper`. Enter session ID `smoke-test-1`. Click Go Online.
   - [ ] Status reaches `in-lobby` within ~2s.
   - [ ] DevTools console shows one outbound `peerProfile` and one inbound `stateSnapshot`.

2. **Launch instance B.** Same session ID, name "Bob", role `helper`.
   - [ ] Both instances list both members.
   - [ ] Bob's role shows `helper` on Alice's screen.

3. **Chat from A.**
   - [ ] Message appears on B within 1s.
   - [ ] After both reload, full chat history replays from the broker's DO.

4. **Mark a clip range on B (helper).**
   - [ ] Range appears in A's queue with helper attribution.
   - [ ] A status transitions: `queued` → `claimed` → `done` propagate.

5. **Send a delivery from B → A.**
   - [ ] A receives the delivery.
   - [ ] B sees a non-error result (rthub is best-effort; no ack frame).
   - [ ] Idempotency: a duplicate delivery (same `rangeId + sourceClientId + ts`) does NOT double-fire on A.

## Reconnect flow

6. **Kill instance A's network for 10s, restore.**
   - [ ] A reconnects automatically.
   - [ ] A's `stateSnapshot` shows the chat B sent during the outage.
   - [ ] A re-sends `peerProfile` (B sees presence flicker leave→join with the same name/color).
   - [ ] Any deliveries B sent during the outage arrive on A after reconnect (rthub auto-drains queued deliveries up to 100 FIFO).

7. **Kill instance B entirely.**
   - [ ] A sees B's presence drop within ~30s (heartbeat-driven).
   - [ ] Open instance C with the same session ID and a third profile. C's `stateSnapshot` carries the full chat history persisted in the DO.

## Sync surfaces (deferred until renderer wiring lands)

The CollabUI methods exist (`sendTimeline`, `sendPlayback`, `sendSelection`,
`sendCursor`, `sendClipRange`) and inbound updates are republished on the panel
bus (`rthub:timeline`, etc.), but the renderer currently does not call them
because `window.Player` does not surface seek/play/pause/selection events. Once
those Player events are exposed, add the renderer hooks per plan Task 10
Step 3–5 and re-run this checklist with the additional steps:

- [ ] Click play on A → B plays within ~200ms.
- [ ] Pause A → B pauses.
- [ ] Seek A → B follows; the `>250ms` echo guard prevents seek-loops.
- [ ] Drag scrub bar on A → B sees a ghost cursor (no auto-seek).
- [ ] Select clip on A → B highlights the same clip.

## Rollback verification (before cutover)

8. **Flip `rthubEnabled: false` on both instances. Restart.**
   - [ ] App connects to legacy ws server (`ws://localhost:3535/ws`) via the create/join lobby flow.
   - [ ] Server log line `evt: collab:deprecated` is NOT present (legacy handlers active because `LEGACY_COLLAB` is unset on the server).
   - [ ] Chat, members, ranges, deliveries all work as they did before this branch.

## Sign-off

- Date run:
- Tester:
- Broker URL:
- Rthub broker version (commit/deploy id):
- Notes:
