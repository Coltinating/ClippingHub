# Held at 3.0.0: @asyncapi/modelina 5.x doesn't parse 3.1.0 documents and
# falls back to emitting a single anonymous "Root" model instead of one
# per message + the channel union. Bump to 3.1.0 once Modelina 6.x ships
# stable (currently 6.0.0-next.* only).
asyncapi: 3.0.0
info:
  title: rthub
  version: 0.1.0
  description: |
    Real-time state broker for the video-editor / streamer-clip desktop app.

    **Full integration guide**: <https://rthub.1626.workers.dev/integration-instructions.md>
    A downstream client only needs that URL plus this spec to one-shot the
    integration. The guide walks through codegen, the JS/TS client wrapper,
    the ClippingHub-specific migration recipe, tests, and the
    disconnect/reconnect contract.

    Every connection is parameterised by an opaque `sessionId` path
    parameter. All clients connecting with the same `sessionId` join the
    same room and mirror each other's editor state (timeline position,
    in/out clip range, playback, selection, cursor scrub, chat, presence,
    keyed clip-range collection, peer profiles, and targeted deliveries).
    There is no authentication: knowing the session string is the credential.

    Identity. Clients may pass `?clientId=<urlSafeId>` (1-128 chars matching
    `/^[A-Za-z0-9._~-]{1,128}$/`) to claim a stable identity. The server
    uses it for queued-delivery routing and for surviving reconnects. If
    omitted or invalid, the server mints a fresh UUID per connection.

    Reconnect contract. The broker is implemented as a single Cloudflare
    Durable Object class (`SessionRoom`) keyed by `idFromName(sessionId)`.
    Persisted state slices (timeline, clipRange single-marker, playback,
    selection, chat ring buffer of 1000, keyed clipRanges collection of up
    to 2000) survive a full all-clients-disconnect via DO storage and are
    replayed in every joiner's `stateSnapshot`. Per-recipient delivery
    queues (cap 100, FIFO) survive disconnect and drain immediately after
    the snapshot on the recipient's next connect. Cursor and presence are
    in-memory only and do not survive a full disconnect; cursor is also
    not replayed to late joiners. The WebSocket attachment carrying a
    peer's profile (name, color, role, xHandle, assistUserId) DIES with
    the socket: clients must re-send `peerProfile` after every reconnect
    to re-establish identity. Other peers will see `presenceUpdate{action:
    'leave'}` for the dropped clientId and `presenceUpdate{action:'join'}`
    on reconnect.

    Best-effort delivery. There is no acknowledgement protocol. A client
    that crashes mid-send may leave the broker without the message; a
    client that needs guarantees should add its own ack/retry layer on
    top of the wire.
  license:
    name: MIT
defaultContentType: application/json

servers:
  production:
    host: rthub.example.workers.dev
    pathname: /ws
    protocol: wss
    description: Cloudflare Workers production deployment.
  local:
    host: localhost:5173
    pathname: /ws
    protocol: ws
    description: Local SvelteKit dev server.

channels:
  session:
    address: /ws/{sessionId}
    title: Session room
    description: Bidirectional WebSocket carrying all real-time room messages.
    parameters:
      sessionId:
        $ref: '#/components/parameters/sessionId'
    messages:
      timelineUpdate:   { $ref: '#/components/messages/TimelineUpdate' }
      clipRangeUpdate:  { $ref: '#/components/messages/ClipRangeUpdate' }
      playbackUpdate:   { $ref: '#/components/messages/PlaybackUpdate' }
      chatMessage:      { $ref: '#/components/messages/ChatMessage' }
      selectionUpdate:  { $ref: '#/components/messages/SelectionUpdate' }
      cursorUpdate:     { $ref: '#/components/messages/CursorUpdate' }
      clipRangeUpsert:  { $ref: '#/components/messages/ClipRangeUpsert' }
      clipRangeRemove:  { $ref: '#/components/messages/ClipRangeRemove' }
      delivery:         { $ref: '#/components/messages/Delivery' }
      peerProfile:      { $ref: '#/components/messages/PeerProfile' }
      presenceUpdate:   { $ref: '#/components/messages/PresenceUpdate' }
      stateSnapshot:    { $ref: '#/components/messages/StateSnapshot' }
      errorEvent:       { $ref: '#/components/messages/ErrorEvent' }

operations:
  send:
    action: send
    channel:
      $ref: '#/channels/session'
    summary: Messages a client sends into its session room.
    messages:
      - $ref: '#/channels/session/messages/timelineUpdate'
      - $ref: '#/channels/session/messages/clipRangeUpdate'
      - $ref: '#/channels/session/messages/playbackUpdate'
      - $ref: '#/channels/session/messages/chatMessage'
      - $ref: '#/channels/session/messages/selectionUpdate'
      - $ref: '#/channels/session/messages/cursorUpdate'
      - $ref: '#/channels/session/messages/clipRangeUpsert'
      - $ref: '#/channels/session/messages/clipRangeRemove'
      - $ref: '#/channels/session/messages/delivery'
      - $ref: '#/channels/session/messages/peerProfile'
  receive:
    action: receive
    channel:
      $ref: '#/channels/session'
    summary: Messages a client receives from its session room.
    messages:
      - $ref: '#/channels/session/messages/timelineUpdate'
      - $ref: '#/channels/session/messages/clipRangeUpdate'
      - $ref: '#/channels/session/messages/playbackUpdate'
      - $ref: '#/channels/session/messages/chatMessage'
      - $ref: '#/channels/session/messages/selectionUpdate'
      - $ref: '#/channels/session/messages/cursorUpdate'
      - $ref: '#/channels/session/messages/clipRangeUpsert'
      - $ref: '#/channels/session/messages/clipRangeRemove'
      - $ref: '#/channels/session/messages/delivery'
      - $ref: '#/channels/session/messages/peerProfile'
      - $ref: '#/channels/session/messages/presenceUpdate'
      - $ref: '#/channels/session/messages/stateSnapshot'
      - $ref: '#/channels/session/messages/errorEvent'

components:
  parameters:
    sessionId:
      description: Opaque shared session string. Any UTF-8 string of length 1..256.

  messages:
    TimelineUpdate:
      name: TimelineUpdate
      title: Timeline position update
      summary: Authoritative timeline playhead position, last-write-wins.
      payload:
        $ref: '#/components/schemas/TimelineUpdate'

    ClipRangeUpdate:
      name: ClipRangeUpdate
      title: Clip in/out range update
      summary: In/out points of the active clip, last-write-wins.
      payload:
        $ref: '#/components/schemas/ClipRangeUpdate'

    PlaybackUpdate:
      name: PlaybackUpdate
      title: Playback state update
      summary: Play/pause + position, last-write-wins.
      payload:
        $ref: '#/components/schemas/PlaybackUpdate'

    ChatMessage:
      name: ChatMessage
      title: Chat message
      summary: A chat line. Appended to a bounded ring buffer.
      payload:
        $ref: '#/components/schemas/ChatMessage'

    SelectionUpdate:
      name: SelectionUpdate
      title: Selection update
      summary: IDs of currently-selected timeline clips, last-write-wins.
      payload:
        $ref: '#/components/schemas/SelectionUpdate'

    CursorUpdate:
      name: CursorUpdate
      title: Cursor scrub update
      summary: Lightweight cursor position; not persisted.
      payload:
        $ref: '#/components/schemas/CursorUpdate'

    ClipRangeUpsert:
      name: ClipRangeUpsert
      title: Clip range upsert
      summary: |
        Add or replace a keyed clip range in the room's collection. Used by the
        streamer-clip workflow where each room holds a list of in-flight and
        completed clips, each with its own metadata, status, and ownership.
      payload:
        $ref: '#/components/schemas/ClipRangeUpsert'

    ClipRangeRemove:
      name: ClipRangeRemove
      title: Clip range remove
      summary: Remove a keyed clip range from the room's collection.
      payload:
        $ref: '#/components/schemas/ClipRangeRemove'

    Delivery:
      name: Delivery
      title: Targeted delivery
      summary: |
        Directed message from one peer to one specific other peer, identified
        by `toClientId`. Server forwards only to the named recipient and queues
        if the recipient is offline; queued deliveries drain on the recipient's
        next connect (matching ClippingHub's collab-create-delivery /
        collab-consume-deliveries workflow).
      payload:
        $ref: '#/components/schemas/Delivery'

    PeerProfile:
      name: PeerProfile
      title: Peer identity
      summary: |
        A peer announces its display identity (name, color, role, xHandle,
        assistUserId). Server stores on the WebSocket attachment and reflects
        the values in subsequent presenceUpdate frames and stateSnapshot.
        Idempotent â€” peers can re-send to update their identity at any time.
      payload:
        $ref: '#/components/schemas/PeerProfile'

    PresenceUpdate:
      name: PresenceUpdate
      title: Presence update
      summary: Server-authored notice of clients joining or leaving.
      payload:
        $ref: '#/components/schemas/PresenceUpdate'

    StateSnapshot:
      name: StateSnapshot
      title: State snapshot
      summary: Sent by the server to a newly-joined client.
      payload:
        $ref: '#/components/schemas/StateSnapshot'

    ErrorEvent:
      name: ErrorEvent
      title: Error event
      summary: Per-sender notice that a message was rejected.
      payload:
        $ref: '#/components/schemas/ErrorEvent'

  schemas:
    Envelope:
      type: object
      description: Common fields stamped by the server on every broadcast.
      properties:
        ts:
          type: integer
          description: Server-assigned epoch milliseconds. Ignored on inbound.
          minimum: 0
        sourceClientId:
          type: string
          description: Server-assigned ID of the originating client. Ignored on inbound.

    TimelineUpdate:
      type: object
      additionalProperties: false
      required: [type, positionMs]
      properties:
        type:        { const: timelineUpdate }
        positionMs:  { type: integer, minimum: 0 }
        ts:          { type: integer, minimum: 0 }
        sourceClientId: { type: string }

    ClipRangeUpdate:
      type: object
      additionalProperties: false
      required: [type, inMs, outMs]
      properties:
        type:  { const: clipRangeUpdate }
        inMs:  { type: integer, minimum: 0 }
        outMs: { type: integer, minimum: 0 }
        ts:    { type: integer, minimum: 0 }
        sourceClientId: { type: string }

    PlaybackUpdate:
      type: object
      additionalProperties: false
      required: [type, state, positionMs]
      properties:
        type:       { const: playbackUpdate }
        state:      { type: string, enum: [playing, paused] }
        positionMs: { type: integer, minimum: 0 }
        rate:       { type: number, minimum: 0, default: 1 }
        ts:         { type: integer, minimum: 0 }
        sourceClientId: { type: string }

    ChatMessage:
      type: object
      additionalProperties: false
      required: [type, id, body]
      properties:
        type:   { const: chatMessage }
        id:     { type: string, minLength: 1, maxLength: 64 }
        body:   { type: string, minLength: 1, maxLength: 2000 }
        author: { type: string, maxLength: 80 }
        userId: { type: string, maxLength: 128 }
        ts:     { type: integer, minimum: 0 }
        sourceClientId: { type: string }

    SelectionUpdate:
      type: object
      additionalProperties: false
      required: [type, clipIds]
      properties:
        type:    { const: selectionUpdate }
        clipIds:
          type: array
          items: { type: string, minLength: 1, maxLength: 128 }
          maxItems: 1024
        ts:      { type: integer, minimum: 0 }
        sourceClientId: { type: string }

    CursorUpdate:
      type: object
      additionalProperties: false
      required: [type, positionMs]
      properties:
        type:       { const: cursorUpdate }
        positionMs: { type: integer, minimum: 0 }
        ts:         { type: integer, minimum: 0 }
        sourceClientId: { type: string }

    PresenceUpdate:
      type: object
      additionalProperties: false
      required: [type, clientId, action]
      properties:
        type:         { const: presenceUpdate }
        clientId:     { type: string, maxLength: 128 }
        action:       { type: string, enum: [join, leave, heartbeat] }
        name:         { type: string, maxLength: 80 }
        color:        { type: string, pattern: '^#[0-9a-fA-F]{6}$' }
        role:         { type: string, enum: [clipper, helper, viewer] }
        xHandle:      { type: string, maxLength: 64 }
        assistUserId: { type: string, maxLength: 128 }
        ts:           { type: integer, minimum: 0 }
        sourceClientId: { type: string }

    ClipRangeUpsert:
      type: object
      additionalProperties: false
      required: [type, id]
      properties:
        type:         { const: clipRangeUpsert }
        id:           { type: string, minLength: 1, maxLength: 128 }
        inTime:       { type: integer, minimum: 0 }
        outTime:      { type: integer, minimum: 0 }
        status:       { type: string, enum: [marking, queued, downloading, done, error] }
        pendingOut:   { type: boolean }
        streamKey:    { type: string, maxLength: 128 }
        name:         { type: string, maxLength: 200 }
        caption:      { type: string, maxLength: 2000 }
        postCaption:  { type: string, maxLength: 2000 }
        fileName:     { type: string, maxLength: 256 }
        clipperId:    { type: string, maxLength: 128 }
        clipperName:  { type: string, maxLength: 80 }
        helperId:     { type: string, maxLength: 128 }
        helperName:   { type: string, maxLength: 80 }
        userId:       { type: string, maxLength: 128 }
        userName:     { type: string, maxLength: 80 }
        ts:           { type: integer, minimum: 0 }
        sourceClientId: { type: string }

    ClipRangeRemove:
      type: object
      additionalProperties: false
      required: [type, id]
      properties:
        type: { const: clipRangeRemove }
        id:   { type: string, minLength: 1, maxLength: 128 }
        ts:   { type: integer, minimum: 0 }
        sourceClientId: { type: string }

    Delivery:
      type: object
      additionalProperties: false
      required: [type, toClientId, kind, rangeId]
      properties:
        type:        { const: delivery }
        toClientId:  { type: string, minLength: 1, maxLength: 128 }
        kind:        { type: string, enum: [clip, clipUpdate, clipUnsend] }
        rangeId:     { type: string, minLength: 1, maxLength: 128 }
        payload:
          description: Free-form delivery body. Schema not enforced by the broker.
        ts:          { type: integer, minimum: 0 }
        sourceClientId: { type: string }

    PeerProfile:
      type: object
      additionalProperties: false
      required: [type]
      properties:
        type:         { const: peerProfile }
        name:         { type: string, maxLength: 80 }
        color:        { type: string, pattern: '^#[0-9a-fA-F]{6}$' }
        role:         { type: string, enum: [clipper, helper, viewer] }
        xHandle:      { type: string, maxLength: 64 }
        assistUserId: { type: string, maxLength: 128 }
        ts:           { type: integer, minimum: 0 }
        sourceClientId: { type: string }

    StateSnapshot:
      type: object
      additionalProperties: false
      required: [type, presence, chat, clipRanges]
      properties:
        type:      { const: stateSnapshot }
        timeline:
          oneOf:
            - { $ref: '#/components/schemas/TimelineUpdate' }
            - { type: 'null' }
        clipRange:
          oneOf:
            - { $ref: '#/components/schemas/ClipRangeUpdate' }
            - { type: 'null' }
        playback:
          oneOf:
            - { $ref: '#/components/schemas/PlaybackUpdate' }
            - { type: 'null' }
        selection:
          oneOf:
            - { $ref: '#/components/schemas/SelectionUpdate' }
            - { type: 'null' }
        presence:
          type: array
          items: { $ref: '#/components/schemas/PresenceUpdate' }
        chat:
          type: array
          items: { $ref: '#/components/schemas/ChatMessage' }
        clipRanges:
          type: array
          items: { $ref: '#/components/schemas/ClipRangeUpsert' }
        ts: { type: integer, minimum: 0 }
        sourceClientId: { type: string }

    ErrorEvent:
      type: object
      additionalProperties: false
      required: [type, code, message]
      properties:
        type:    { const: errorEvent }
        code:    { type: string, enum: [INVALID_JSON, SCHEMA_VIOLATION, UNKNOWN_TYPE, INTERNAL] }
        message: { type: string }
        details:
          description: Optional ajv-style error array or free-form detail string.
        ts:      { type: integer, minimum: 0 }
        sourceClientId: { type: string }