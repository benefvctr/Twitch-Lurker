# Finds the remote server IP(s) a running game is talking to.
#
#   .\find-game-server.ps1 -ProcessName stalzone
#
# (Process name is the .exe name without the extension — check Task Manager
# Details tab if unsure.)
param(
    [Parameter(Mandatory = $true)]
    [string]$ProcessName
)

$procs = Get-Process -Name $ProcessName -ErrorAction Stop

$conns = Get-NetTCPConnection -OwningProcess $procs.Id -State Established -ErrorAction SilentlyContinue |
    Where-Object {
        $_.RemoteAddress -notmatch '^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::)'
    }

if ($conns) {
    Write-Host "`nEstablished connections for '$ProcessName':`n" -ForegroundColor Cyan
    $conns |
        Sort-Object RemoteAddress -Unique |
        Select-Object RemoteAddress, RemotePort, LocalPort |
        Format-Table -AutoSize
    Write-Host "The address with a game-looking port (often 7000-30000) is your server."
    Write-Host "Next: tracert <that ip>   and   .\compare-ping.ps1 -TargetIp <that ip>`n"
}
else {
    Write-Host "`nNo established TCP connections found for '$ProcessName'." -ForegroundColor Yellow
    Write-Host @"
Many games use UDP, which doesn't show up here. Do this instead:
  1. Press Win+R, run:  resmon
  2. Network tab -> expand 'Network Activity'
  3. Find the game process; the remote Address with steady
     Send/Receive traffic while you're in a match is your server.
"@
}
