# YT Audio Only

YT Audio Only is a desktop Firefox extension that adds an audio only button to YouTube.

When enabled, it plays the audio stream instead of the full video stream. The video area stays clean by showing the video thumbnail while the audio keeps playing.

This extension is made for desktop Firefox. It is not designed for Android and may not work properly on mobile Firefox.

## Features

- Adds an Audio only button to the YouTube player
- Plays YouTube videos as audio streams
- Keeps the current playback time when switching modes
- Keeps playback speed when possible
- Shows the video thumbnail during audio mode
- Hides video quality options while audio mode is active
- Supports YouTube page navigation
- Uses temporary network rules only while audio mode is active
- The manifest lists no required data collection

## Requirements

- Desktop Firefox 140.0 or newer
- Bun

## Install

You can download the Firefox-signed version from the [GitHub Releases page](https://github.com/mustafachyi/YT-Audio-Only/releases).

To install from source:

```sh
bun install
```

## Build

```sh
bun run build
```

## Lint

```sh
bun run lint
```

## Load in Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click `Load Temporary Add-on`.
3. Select `src/manifest.json`.
4. Open YouTube.
5. Start a video.
6. Click the Audio only button in the player.

## Permissions

The extension uses `declarativeNetRequest`.

This permission is used to manage temporary tab rules while audio mode is active.

The extension only runs on:

```text
youtube.com
www.youtube.com
```

## Privacy

This extension does not use its own server.

It works directly on YouTube pages and requests YouTube audio stream data from YouTube. Normal YouTube account, cookie, and network behavior still applies.

The manifest lists no required data collection.

## Inspiration

Inspired by [we_firefox_ytop_mv3](https://github.com/schdie/we_firefox_ytop_mv3).

## Notes

YouTube can change its player, page layout, or stream response format at any time. If that happens, some parts of the extension may need updates.

## License

This project is licensed under the GNU General Public License v3.0. See the `LICENSE` file for details.
