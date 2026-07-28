# Measures latency to a target: average, min/max, jitter, packet loss.
# Run once with the tunnel OFF and once with it ON, then compare.
#
#   .\compare-ping.ps1 -TargetIp 203.0.113.10
#   .\compare-ping.ps1 -TargetIp 203.0.113.10 -Count 100
param(
    [Parameter(Mandatory = $true)]
    [string]$TargetIp,

    [int]$Count = 50
)

Write-Host "`nPinging $TargetIp $Count times..." -ForegroundColor Cyan

$replies = Test-Connection -ComputerName $TargetIp -Count $Count -ErrorAction SilentlyContinue

# Windows PowerShell 5.1 exposes ResponseTime; PowerShell 7+ exposes Latency.
$latencies = @(
    $replies | ForEach-Object {
        if ($_.PSObject.Properties['Latency']) { $_.Latency }
        elseif ($_.PSObject.Properties['ResponseTime']) { $_.ResponseTime }
    }
) | Where-Object { $_ -ne $null }

if ($latencies.Count -eq 0) {
    Write-Host "No replies. The server may block ICMP ping - test in-game instead," -ForegroundColor Yellow
    Write-Host "or ping the last responding hop from tracert." -ForegroundColor Yellow
    exit 1
}

$avg  = ($latencies | Measure-Object -Average).Average
$min  = ($latencies | Measure-Object -Minimum).Minimum
$max  = ($latencies | Measure-Object -Maximum).Maximum
$sd   = [math]::Sqrt(($latencies | ForEach-Object { [math]::Pow($_ - $avg, 2) } | Measure-Object -Average).Average)
$loss = [math]::Round((1 - $latencies.Count / $Count) * 100, 1)

Write-Host ""
Write-Host ("  Average : {0:N1} ms" -f $avg)
Write-Host ("  Min/Max : {0} / {1} ms" -f $min, $max)
Write-Host ("  Jitter  : {0:N1} ms (std dev)" -f $sd)
Write-Host ("  Loss    : {0}% ({1}/{2} replies)" -f $loss, $latencies.Count, $Count)
Write-Host ""
Write-Host "Run this with the WireGuard tunnel off, then on. Lower average AND"
Write-Host "lower jitter = the relay is helping. Within ~2 ms = not worth it."
