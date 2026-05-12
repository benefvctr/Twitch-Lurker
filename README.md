# TwitchLurker

TwitchLurker is a Windows desktop app that silently opens Twitch streams in a hidden Firefox instance so your watch-time and channel-points accrual keep ticking even while you're doing something else. It polls a list of channels for live status, opens each live stream in a muted, off-screen Firefox window (moved to your secondary monitor if you have one, otherwise minimized), and manages the whole thing from a small system-tray icon.

## Installation

1. Download `TwitchLurker Setup x.x.x.exe` from the [Releases](../../releases) page.
2. Run the installer. Windows will show a SmartScreen warning because the app is not code-signed -- click **More info** then **Run anyway**. This is normal for self-distributed personal tools.
3. TwitchLurker will launch and appear in your system tray.

## Setup

1. **Install a channel-points auto-claim Firefox extension first.** A good option is [Auto Claim Twitch Channel Points](https://addons.mozilla.org/en-US/firefox/addon/auto-claim-twitch-channel-points/) (or any equivalent). Install it in your regular Firefox profile before setting up TwitchLurker, because the app clones your profile to get your Twitch login and extensions.
2. Open TwitchLurker from the system tray. On first launch, go to the **Connection** tab and click **Refresh Profile** to clone your Firefox profile into the lurker profile.
3. Go to the **Channels** tab and add the Twitch usernames you want to lurk.
4. Click **Start** in the dashboard. TwitchLurker opens a Firefox window in the background and begins monitoring your channels.

## Notes

- **Twitch ToS gray area.** Automated lurking is not explicitly permitted by Twitch's Terms of Service. Use at your own risk, for personal use only.
- **Scale.** Tested comfortably with 4-6 channels. Beyond 8 channels, Firefox memory usage grows noticeably and poll rate may lag.
- **Single-user.** The lurker shares your real Firefox profile (read-only clone), so your Twitch login and extensions carry over automatically. One instance per machine is the intended use.
- **Audio.** Lurker tabs are muted via nircmd at the Windows audio-mixer level, so they do not affect your system volume.
