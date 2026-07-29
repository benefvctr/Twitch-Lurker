# lowping — Handoff: what to do when you're back at your PC

Goal: figure out why your Stalzone ping is 60+ from southern Maine, and fix
it for free if possible ($0–6/mo worst case). Total time: ~30 min.

## 1. Get these files onto your PC (2 min)

Open PowerShell and run:

```powershell
git clone -b claude/git-repo-network-latency-d6zgyf https://github.com/benefvctr/Twitch-Lurker lowping
cd lowping
```

(No git? Install from https://git-scm.com, or on GitHub open the branch
`claude/git-repo-network-latency-d6zgyf` → Code → Download ZIP.)

If scripts refuse to run, allow them once:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## 2. Free checks first (5 min)

- Plug into **ethernet** if you're on Wi-Fi.
- Run the bufferbloat test: https://www.waveform.com/tools/bufferbloat
  - Grade C or worse → your router is the problem, not the route. Enable
    QoS / Smart Queue / SQM in the router admin page. A VPS won't fix this.

## 3. Find the Stalzone server IP (5 min, in a match)

```powershell
.\scripts\find-game-server.ps1 -ProcessName <stalzone exe name, no .exe>
```

If it finds nothing (UDP game): `Win+R` → `resmon` → Network tab → find the
Stalzone process → the remote Address with steady send/receive traffic
during a match is the server. Write that IP down.

## 4. Where is it, and is 60 ms bad? (5 min)

- Open `https://ipinfo.io/<the-ip>` in a browser → city + hosting company.
- Run `tracert <the-ip>`. City codes in hop names: bos=Boston,
  ewr/jfk/nyc=NY/NJ, iad/ash/wdc=Ashburn VA, ord/chi=Chicago, dfw=Dallas,
  lax/sjc/sea=West Coast.
- Baseline it: `.\scripts\compare-ping.ps1 -TargetIp <the-ip>`

Expected ping from southern Maine on a clean route:

| Server city   | Normal ping | Your 60 ms means…                       |
|---------------|-------------|------------------------------------------|
| NYC / NJ      | 12–18 ms    | Route is broken — relay wins big (30+ ms) |
| Ashburn, VA   | 18–25 ms    | Route is broken — relay wins big          |
| Chicago       | 30–38 ms    | ~25 ms overhead — relay likely helps      |
| Dallas        | 45–55 ms    | Near normal — relay shaves 5–10 at best   |
| West Coast    | 70–90 ms    | 60 is GOOD. Stop here, it's physics.      |

Also check the tracert for one hop where latency jumps 30+ ms and stays
high — that's the bad peering a relay routes around.

## 5. Only if step 4 says it's fixable: rent the relay

Pick a VPS in the **same city as the game server**:

- **$0**: Oracle Cloud "Always Free" ARM instance (Ashburn or Chicago
  regions). Needs a credit card for ID check but never bills on free tier.
- **~$5/mo, billed hourly**: Vultr / Linode (NJ, Chicago, Dallas). Hourly
  billing means testing for an evening costs pennies.

Create an Ubuntu 24.04 instance, open UDP port 51820 in its
firewall/security-list, SSH in as root, then:

```bash
git clone -b claude/git-repo-network-latency-d6zgyf https://github.com/benefvctr/Twitch-Lurker lowping
bash lowping/server/setup-server.sh <game-ip>/32
```

Tip: run `whois <game-ip>` and use the whole CIDR range it reports instead
of a single /32 — games rotate IPs within their host's block.

The script prints a client config. Save it as `lowping.conf` on your PC,
install WireGuard (https://www.wireguard.com/install/), Import tunnel from
file, Activate. Only game traffic uses the tunnel (that's the AllowedIPs
line) — everything else on the PC is untouched.

## 6. Verify

```powershell
.\scripts\compare-ping.ps1 -TargetIp <game-ip>   # tunnel OFF
.\scripts\compare-ping.ps1 -TargetIp <game-ip>   # tunnel ON
```

Lower average AND lower jitter → keep it. Within ~2 ms or worse → try a VPS
in a different city, or destroy it and you're out pennies.

## Making this its own repo (optional)

Create an empty repo named `lowping` at https://github.com/new, then from
the cloned folder:

```powershell
git remote set-url origin https://github.com/benefvctr/lowping.git
git branch -M main
git push -u origin main
```
