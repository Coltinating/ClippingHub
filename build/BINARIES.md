# Bundled binaries — what to put where

ClippingHub bundles platform-specific FFmpeg and whisper.cpp binaries so end
users don't have to install anything. The path resolver
([../src/lib/ffmpeg-path.js](../src/lib/ffmpeg-path.js),
[../src/lib/whisper-path.js](../src/lib/whisper-path.js)) looks for binaries in
this order:

1. **Packaged app** — `<resources>/ffmpeg/...` or `<resources>/whisper/...`
   (electron-builder copies these in via `extraResources`)
2. **Dev mode (per-platform)** — `build/ffmpeg/<platform>/ffmpeg[.exe]`,
   `build/whisper/<platform>/cpp/whisper-cli[.exe]`
3. **Dev mode (flat, legacy Windows layout)** — `build/ffmpeg/ffmpeg.exe`
4. **System PATH fallback**

`<platform>` is `win32`, `darwin`, or `linux`.

## FFmpeg

| Platform | Where to drop binaries | Suggested source |
|---|---|---|
| Windows  | `build/ffmpeg/` (legacy, kept for back-compat) **or** `build/ffmpeg/win32/` | [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds/releases) — `ffmpeg-master-latest-win64-gpl.zip` |
| macOS    | `build/ffmpeg/darwin/` | [evermeet.cx/ffmpeg](https://evermeet.cx/ffmpeg/) (universal2) — drop `ffmpeg` and `ffprobe` |
| Linux    | `build/ffmpeg/linux/` | [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds/releases) — `ffmpeg-master-latest-linux64-gpl.tar.xz` |

For each platform, both `ffmpeg` and `ffprobe` (with `.exe` on Windows) are
required. Make sure they're executable on Unix:

```sh
chmod +x build/ffmpeg/darwin/ffmpeg build/ffmpeg/darwin/ffprobe
chmod +x build/ffmpeg/linux/ffmpeg  build/ffmpeg/linux/ffprobe
```

## Whisper.cpp

| Platform | Where to drop binaries | Source |
|---|---|---|
| Windows  | `build/whisper/win32/cpp/` | [whisper.cpp releases](https://github.com/ggml-org/whisper.cpp/releases) — `whisper-bin-x64.zip` (CUDA build for NVIDIA) |
| macOS    | `build/whisper/darwin/cpp/` | Build from source with Metal: `make` in whisper.cpp; binary is named `whisper-cli` |
| Linux    | `build/whisper/linux/cpp/` | Build from source: `make` in whisper.cpp; binary is named `whisper-cli` |

Each `cpp/` dir must also contain the model file `ggml-tiny.en.bin`
(download via the helper script in the whisper.cpp repo: `./models/download-ggml-model.sh tiny.en`).

## Verifying

After dropping in binaries, run:

```sh
node -e "console.log(require('./src/lib/ffmpeg-path.js').getFfmpegPath())"
node -e "console.log(require('./src/lib/whisper-path.js').getWhisperPath())"
```

It should print the resolved binary path, not the bare name `ffmpeg` /
`whisper-cli` (which means the system PATH fallback is being used).

## App icons

`electron-builder.yml` expects icons under `build/icons/`:

- `icon.ico` — Windows
- `icon.icns` — macOS
- `icon.png` (512×512 minimum) — Linux

Use [electron-icon-builder](https://www.npmjs.com/package/electron-icon-builder)
or an online converter to generate `.icns` and `.png` from the existing
`build/icon.ico`.
