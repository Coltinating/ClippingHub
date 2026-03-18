# ClippingHub

A desktop app for clipping Rumble streams built with Electron. Detects the HLS stream from any Rumble video or live stream, lets you set a start time and duration, then downloads and trims the exact clip using ffmpeg.
### Currently starts with Chrome DevTools enabled for debugging.


<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/30787f5e-8b8a-429e-bd69-0c205d77536f" />



## Features

- Auto-detects m3u8 stream URLs from Rumble pages
- (Broken) Built-in Rumble browser for manual navigation
- Clips VODs and live streams
- timestamp clipping via ffmpeg concat + trim (Rounds up/down the in/out timestamps to avoid corrupted start/end. This is a fallback option if I can't get exact timestamps to work.)
- Live capture mode for ongoing streams

## Requirements

- [Node.js](https://nodejs.org/)
- [ffmpeg](https://ffmpeg.org/download.html) — must be available in your system PATH

## Setup

```bash
npm install
npm start
```

## Usage

1. Paste a Rumble video URL or use **Browse Rumble** to navigate manually
2. The stream loads automatically when the video plays
3. Set your clip start time and duration
4. Hit **Download Clip** — the clip is saved to your Videos/ClipperHub folder

## Tech Stack

- Electron
- HLS.js
- Express (local proxy)
- ffmpeg
