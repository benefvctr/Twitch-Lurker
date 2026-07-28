# lowping

A do-it-yourself game route optimizer — the same idea as ExitLag/WTFast, built
from a $0–6/month VPS and WireGuard, with split tunneling so **only your game
traffic** goes through the relay. Everything else on your PC uses your normal
connection.

## How ExitLag actually works (and why you can DIY it)

Your ping is `distance + routing`. Distance is physics (~1 ms of round-trip
per 100 km of fiber) and nothing can fix it. Routing is your ISP's choice of
path to the game server, and it's often bad: your packets may detour through a
congested exchange or a distant city before heading to the server.

ExitLag doesn't have magic — it routes your game traffic through its own
servers that have better peering. You can do the same thing by renting a VPS
in a datacenter close to the game servers and tunneling your game traffic
through it:

```
before:  you ──(ISP's messy route)──────────────► game server
after:   you ──(clean route)──► VPS ──(datacenter route)──► game server
```

**Honest expectations:** this shaves 10–30 ms when your ISP's route is bad.
If your route is already direct, it does nothing (or adds 1–3 ms). Diagnose
first — step 1 tells you whether it's worth doing at all.

## Step 0 — free wins first

Before renting anything, check these; they fix most "yellow ping":

1. **Ethernet, not Wi-Fi.** Wi-Fi adds 5–20 ms of jitter even when it looks fine.
2. **Closest server region.** Make sure the game isn't putting you on a far region.
3. **Bufferbloat.** Run the test at waveform.com/tools/bufferbloat. If your
   grade is C or worse, ping spikes whenever anything downloads/streams —
   enable SQM/Smart Queue/QoS on your router. This is the #1 cause of ping
   that's fine at 3 AM and terrible in the evening.

## Step 1 — find the game server and check the route

1. With the game running, find the server's IP:

   ```powershell
   .\scripts\find-game-server.ps1 -ProcessName <GameExeNameWithoutExe>
   ```

   Many games use UDP, which this can't always see. Fallback: open **Resource
   Monitor** (`resmon`) → Network tab → find the game process → the remote
   address with steady send/receive traffic is your server.

2. Trace the route:

   ```powershell
   tracert <game-server-ip>
   ```

   (Or use [WinMTR](https://sourceforge.net/projects/winmtr/) for a live view.)

3. Read the result:
   - **Latency climbs gradually with distance** → your route is fine; a relay
     won't help much. Your 60 ms is mostly geography.
   - **One hop where latency jumps 30+ ms and stays high**, or the route
     visibly detours through the wrong city/country → a relay will likely help.

Record your baseline: `.\scripts\compare-ping.ps1 -TargetIp <ip>`

## Step 2 — rent a VPS near the game servers

Pick a datacenter city close to the game server (the tracert hostnames often
reveal the city). Any tiny instance works — WireGuard needs almost nothing.

| Provider | Cost | Notes |
|---|---|---|
| Oracle Cloud Free Tier | $0 | Always-free ARM VPS; the truly free option |
| Hetzner | ~€4.5/mo | Great for EU servers |
| Vultr / DigitalOcean / Linode | ~$5–6/mo | Many locations, good for NA |
| OVH | ~$4/mo | EU + NA |

Choose Ubuntu 22.04/24.04. Before committing, ping the provider's
"looking glass" / test IP for that datacenter from your PC — you want a low,
stable ping to the VPS itself.

## Step 3 — set up the relay (one command on the VPS)

SSH into the VPS as root and run:

```bash
curl -fsSL https://raw.githubusercontent.com/<you>/lowping/main/server/setup-server.sh -o setup-server.sh
bash setup-server.sh 203.0.113.10/32
```

Replace `203.0.113.10/32` with your game server IP(s) — comma-separated, and
you can use whole ranges like `198.51.100.0/24` since games often rotate IPs
within the provider's block (look up the IP's range with `whois <ip>`).

The script installs WireGuard, configures NAT forwarding, and **prints a
client config file** at the end.

## Step 4 — connect your gaming PC

1. Install [WireGuard for Windows](https://www.wireguard.com/install/).
2. Save the printed config as `lowping.conf`, then *Import tunnel from file*.
3. Activate the tunnel.

Because `AllowedIPs` in the config lists only the game server addresses, this
is a **split tunnel**: only game traffic uses the relay. Browsing, Discord,
downloads — all unaffected.

## Step 5 — verify it actually helped

```powershell
# tunnel OFF
.\scripts\compare-ping.ps1 -TargetIp <game-server-ip>
# tunnel ON
.\scripts\compare-ping.ps1 -TargetIp <game-server-ip>
```

Compare average and jitter, then confirm in-game. If the tunnel is worse,
try a VPS in a different city — placement is everything.

## Caveats

- **You can't beat distance.** If the server is 2,500 km away, ~50 ms is the
  physical floor no matter what ExitLag or anyone else claims.
- **Anti-cheat / ToS.** Most games are fine with this (it's what ExitLag does),
  but a few flag datacenter IPs. Check your game's ToS.
- **Game IPs change.** If the game stops routing through the tunnel after a
  patch or region switch, re-run step 1 and widen `AllowedIPs`.
