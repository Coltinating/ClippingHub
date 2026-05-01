# ClippingHub Server

Standalone collab server for the ClippingHub app.

## Quick start - host on your own PC (no Docker)

    cd server
    cp .env.example .env
    npm install
    npm run dev

Server listens on `ws://localhost:3535/ws`. In the app's Collab panel,
paste that URL and click "Go Online".

## Quick start - host on your own PC (Docker)

    cd server
    cp .env.example .env
    docker compose up -d
    docker compose logs -f         # tail logs
    docker compose down            # stop

For LAN peers: tell them to use `ws://<your-LAN-IP>:3535/ws`. Make sure
Windows Defender Firewall allows inbound TCP 3535 (or run
`netsh advfirewall firewall add rule name="ClippingHub Server" dir=in action=allow protocol=TCP localport=3535`
in an admin PowerShell once).

## Deploy to a VPS

    git clone <repo> && cd <repo>/server
    cp .env.example .env && $EDITOR .env
    docker compose up -d

For TLS, terminate at nginx / Caddy and proxy `wss://yourhost/ws` to
`http://127.0.0.1:3535/ws`.

## Data

SQLite at `${DATA_DIR}/clippinghub.db` (default `./data/clippinghub.db`,
mounted to `/data` in the container). Back this up to keep lobby history.
