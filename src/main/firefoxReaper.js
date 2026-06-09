const { execFile } = require('child_process');

// Marker that uniquely identifies our cloned lurker profile on the Firefox
// command line. We only ever kill processes whose root matches this — never
// the user's real Firefox.
const LURKER_MARKER = '*twitch-lurker*firefox-profile*';

/**
 * Kill the entire lurker Firefox process tree and verify it is gone.
 *
 * Why this is non-trivial (and why the old top-level-only kill never worked):
 * Firefox spawns child processes (content / gpu / rdd / socket). Those children
 * do NOT carry the profile path on their command line, so we cannot find them by
 * the marker once the parent is dead. We must:
 *   1. Discover the whole tree by walking ParentProcessId WHILE the parents are
 *      still alive (links go stale the moment a parent exits on Windows).
 *   2. Kill children-first so a parent can't be reported as the lock holder
 *      after its children are already gone.
 *   3. Re-kill from the captured PID set and verify by PID existence — not by
 *      the command-line marker, which orphaned children no longer match.
 *
 * All of this runs inside a single PowerShell process so the captured PID set
 * survives across retry iterations. A locked profile (parent.lock / *.sqlite)
 * is the documented root cause of the 180s launchPersistentContext timeout, so
 * this must fully succeed before the next launch.
 *
 * @param {object}  [opts]
 * @param {number}  [opts.timeoutSec=5]   Internal kill/verify deadline.
 * @returns {Promise<{ clean: boolean, remaining: number, killed: number }>}
 */
function reapLurkerFirefox({ timeoutSec = 5 } = {}) {
  return new Promise((resolve) => {
    const ps = `
$ErrorActionPreference = 'SilentlyContinue';

function Get-LurkerTree {
  # Roots = lurker firefox processes identified by the profile marker.
  # The Name = 'firefox.exe' filter is CRITICAL: without it, this very PowerShell
  # process matches (its own command line contains the marker text) and the reaper
  # would kill itself before finishing. Helper shells are never firefox.exe; the
  # marker-less content/gpu children are found via the ParentProcessId walk below.
  $roots = Get-CimInstance Win32_Process -Filter "Name = 'firefox.exe'" | Where-Object { $_.CommandLine -like '${LURKER_MARKER}' };
  $seen = New-Object System.Collections.Generic.List[int];
  $visited = New-Object System.Collections.Generic.HashSet[int];
  $queue = New-Object System.Collections.Queue;
  foreach ($r in $roots) { [void]$queue.Enqueue([int]$r.ProcessId); }
  # BFS over ParentProcessId. Order is shallow->deep, so reversing it later
  # gives us a children-first kill order.
  while ($queue.Count -gt 0) {
    $procId = [int]$queue.Dequeue();
    if (-not $visited.Add($procId)) { continue; }
    $seen.Add($procId);
    foreach ($k in (Get-CimInstance Win32_Process -Filter "ParentProcessId = $procId")) {
      [void]$queue.Enqueue([int]$k.ProcessId);
    }
  }
  return ,$seen
}

$tree = Get-LurkerTree;
if ($tree.Count -eq 0) { Write-Output 'KILLED:0'; Write-Output 'REMAIN:0'; exit }

# Accumulate every PID we ever see so we keep re-killing orphans whose parent
# (the root) has already exited and can no longer be walked to.
$all = New-Object System.Collections.Generic.HashSet[int];
foreach ($procId in $tree) { [void]$all.Add($procId); }
$killedCount = $all.Count;

$deadline = (Get-Date).AddSeconds(${timeoutSec});
$alive = 0;
do {
  # Children-first: reverse the shallow->deep discovery order.
  $order = New-Object System.Collections.Generic.List[int];
  $order.AddRange([int[]]$all);
  $order.Reverse();
  foreach ($procId in $order) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue; }

  Start-Sleep -Milliseconds 100;

  # Re-discover any children spawned mid-kill and fold them into the set.
  foreach ($procId in (Get-LurkerTree)) { [void]$all.Add($procId); }

  $alive = 0;
  foreach ($procId in $all) {
    if (Get-Process -Id $procId -ErrorAction SilentlyContinue) { $alive++; }
  }
} while ($alive -gt 0 -and (Get-Date) -lt $deadline)

Write-Output "KILLED:$killedCount";
Write-Output "REMAIN:$alive";
`;

    // Node-side timeout is generous relative to the PowerShell-internal deadline
    // so the script returns its own structured result rather than being killed.
    execFile(
      'powershell',
      ['-NoProfile', '-Command', ps],
      { timeout: (timeoutSec + 5) * 1000 },
      (_err, stdout) => {
        const text = (stdout ?? '').toString();
        const killed = parseInt((/KILLED:(\d+)/.exec(text) || [])[1], 10) || 0;
        // If the script was killed or produced no REMAIN line, treat as unknown
        // (not clean) so callers don't assume success.
        const remainMatch = /REMAIN:(\d+)/.exec(text);
        const remaining = remainMatch ? parseInt(remainMatch[1], 10) : -1;
        resolve({ clean: remaining === 0, remaining, killed });
      }
    );
  });
}

module.exports = { reapLurkerFirefox, LURKER_MARKER };
