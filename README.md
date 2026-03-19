# ClippingHub

Desktop app for clipping Rumble streams and VODs. Paste a URL, set your in/out points, and export clips with optional watermarks and outros. Built on Electron + ffmpeg.

## What it does

- Loads any Rumble video or live stream and auto-detects the HLS stream
- Set start/end timestamps and clip segments from VODs or live streams
- Live clipping mode with catch-up playback so you don't fall behind
- Add image watermarks to clips (configurable position, size, opacity)
- Append a custom outro video to the end of clips
- Customizable keybinds for jumping around the timeline (Shift/Alt/Ctrl + Arrow keys)
- Optional GPU acceleration for faster encoding (NVIDIA CUDA)
- Config system that saves your preferences between sessions

## Requirements

You need two things installed before running ClippingHub:

### Node.js

Download and install from [https://nodejs.org](https://nodejs.org/) — grab the LTS version. During install, keep the default options and make sure "Add to PATH" is checked. To verify it installed, open a terminal and run:

```
node --version
```

You should see something like `v20.x.x` or higher.

### ffmpeg

ffmpeg handles the actual video encoding. Download a build from [https://ffmpeg.org/download.html](https://ffmpeg.org/download.html) — on Windows, [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) has prebuilt binaries. Grab the "essentials" zip, extract it somewhere (like `C:\ffmpeg`), and add the `bin` folder to your system PATH:

1. Search "Environment Variables" in Windows
2. Under System Variables, find `Path` and click Edit
3. Click New and add the path to the `bin` folder (e.g. `C:\ffmpeg\bin`)
4. Click OK and restart your terminal

Verify with:

```
ffmpeg -version
```

## Setup

Clone the repo and install dependencies:

```
git clone https://github.com/Coltinating/ClippingHub.git
cd ClippingHub
npm install
```

Then start the app:

```
npm start
```

Alternatively, on Windows you can just double-click `INSTALL.bat` instead of typing `npm install`, and `START.bat` instead of `npm start`.

## How to use it

1. The app opens with a built-in Rumble browser — browse channels, find streams, or paste any URL into the bar
2. You can set a default channel in the config menu so it loads automatically on startup
3. Once a video or live stream is playing, the HLS stream is detected and the player loads
4. Use the timeline controls to set your clip start and end points
5. Hit **Download** to export the clip to your Videos/ClippingHub folder

### Watermarks

Click the watermark icon on a pending clip to add an image overlay. You can set the position (corner or center), scale, and opacity. If you want every clip to have the same watermark, set a universal watermark in the config menu — it gets applied automatically.

### Outros

Click **Add Outro** on a pending clip to append a video to the end. You can set a universal outro in the config menu so it gets added to every clip by default.

### Config menu

The gear icon in the Pending Clips header opens the settings panel. From there you can:

- Toggle which buttons show up on pending clips (Jump to In, Jump to End, Watermark, Outro)
- Set a default channel to load on startup
- Configure universal watermark and outro settings
- Set up custom keybinds
- Enable GPU acceleration and pick your CUDA device
- Tweak ffmpeg encoding settings
- Save/load your config to share between machines

Config saves to `%APPDATA%/ClippingHub/user_config.json`.

### Keybinds

Arrow keys scrub the timeline by default. Hold Shift, Alt, or Ctrl for different jump sizes — all configurable in the settings. Useful for live clipping when you need to quickly find the right moment.

### Catch-up mode

After making a clip during a live stream, you'll be behind real-time. Catch-up mode bumps the playback speed (1.1x to 2.5x, adjustable) so you can get back to the live edge without missing anything.

## Tech stack

- Electron
- HLS.js
- Express (local proxy)
- ffmpeg
- Playwright (browser automation)
