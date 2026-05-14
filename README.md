# TwitchLurker

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

TwitchLurker silently opens Twitch streams in a hidden Firefox instance so your watch-time and channel-points accrual keep ticking while you're away. It polls a list of channels for live status, opens each live stream in a muted Firefox window (parked on your secondary monitor if you have one, otherwise minimized), and manages the whole thing from a small system-tray icon.

Built as a "leave it running while I'm on vacation" tool.

![surveillance-console UI](https://img.shields.io/badge/aesthetic-surveillance%20console-ffb000?style=flat-square)

## Install

**One-click (recommended):** download [`install.bat`](install.bat) → double-click. The script grabs the latest installer from GitHub Releases and launches it.

**Manual:** download `TwitchLurker Setup x.x.x.exe` from the [Releases](../../releases) page and run it directly.

Either way, Windows SmartScreen will warn that the app is unsigned — click **More info** → **Run anyway**. Normal for self-distributed tools.

## Setup

1. **Install a channel-points auto-claim Firefox extension in your normal Firefox first.** [Auto Claim Twitch Channel Points](https://addons.mozilla.org/en-US/firefox/addon/auto-claim-twitch-channel-points/) works well. TwitchLurker clones your Firefox profile, so your Twitch login *and* extensions transfer automatically — but you have to install the extension *before* the first profile clone.
2. Open TwitchLurker from the tray. Switch to the **CHANNELS** tab and add the Twitch usernames you want to lurk.
3. Switch back to the **STATUS** tab and click **START**. A Firefox window will appear briefly then get parked on your secondary monitor (or minimized if you only have one display).

## How it works

- **Live detection:** poll each watched channel's Twitch page every ~60s, parse the JSON-LD for `isLiveBroadcast`.
- **Stream loading:** Playwright launches Firefox with a clone of your profile, opens a tab per live channel, dismisses the mature-content gate, sets quality to lowest available, ensures the player is unmuted.
- **Audio:** the Firefox process's Windows audio session is muted via [NirCmd](https://www.nirsoft.net/utils/nircmd.html), so video keeps playing (Twitch counts watch-time) but your house stays quiet.
- **Raid handling:** if a stream raids out, the tab is auto-rebound to the new channel if it's on your watchlist, otherwise closed.
- **Health watchdog:** a 30s interval reopens any tabs that crashed.

## Caveats

- **Twitch ToS gray area.** Automated lurking isn't explicitly permitted. Detection risk for a single user on a residential IP with ≤6 channels is low, but use at your own risk and don't scale up.
- **Single-user, single-machine.** The lurker shares your real Firefox profile via clone.
- **Channel-points "bonus chest" claims** are handled by the third-party Firefox extension you install, not by TwitchLurker itself.
- **Sign the lurker out of Mozilla Sync** the first time it launches (open about:preferences#sync inside the lurker Firefox window → Sign Out) — otherwise extension toggles in your normal browser will mirror to the lurker.
- **No automated updates.** Re-download from Releases for new versions.

## Build from source

```powershell
git clone https://github.com/benefvctr/Twitch-Lurker.git
cd Twitch-Lurker
npm install
npx playwright install firefox
npm start            # dev mode
npm test             # unit tests (parser + detector + config)
npm run build        # produce dist/installer/TwitchLurker Setup x.x.x.exe
```

The build step bundles Playwright Firefox via a junction at `<project>/ms-playwright` (created automatically by `scripts/link-playwright.js`).

## Credits

- [NirCmd](https://www.nirsoft.net/utils/nircmd.html) by Nir Sofer — runtime audio-session muting (`bin/nircmd.exe`, redistributed unmodified per Nirsoft's freeware terms).
- [Playwright](https://playwright.dev/) for the Firefox automation layer.
- [JetBrains Mono](https://www.jetbrains.com/lp/mono/) for the surveillance-console UI typography.

## License

MIT. See [LICENSE](LICENSE).
