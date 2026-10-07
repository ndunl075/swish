# Swish installer for Windows.
#
# Browsers don't let outside programs install extensions silently, so this
# does everything around the one click only you can make: it copies Swish to
# a permanent folder, puts that folder's path on your clipboard, and opens
# your browser's extensions page.

$ErrorActionPreference = 'Stop'

$source = Join-Path $PSScriptRoot 'extension'
$dest = Join-Path $env:LOCALAPPDATA 'Swish'

if (-not (Test-Path (Join-Path $source 'manifest.json'))) {
    Write-Host "Can't find the extension files next to this installer." -ForegroundColor Red
    Write-Host 'Unzip the whole download first, then run Install Swish.cmd from the unzipped folder.'
    exit 1
}

$updating = Test-Path (Join-Path $dest 'manifest.json')
if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
Copy-Item -Recurse $source $dest
Set-Clipboard -Value $dest

$version = (Get-Content (Join-Path $dest 'manifest.json') -Raw | ConvertFrom-Json).version

$browsers = @(
    @{ Name = 'Microsoft Edge'; Page = 'edge://extensions'
       Paths = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") },
    @{ Name = 'Google Chrome'; Page = 'chrome://extensions'
       Paths = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") },
    @{ Name = 'Brave'; Page = 'brave://extensions'
       Paths = @("$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe", "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe") }
)
$found = foreach ($b in $browsers) {
    $exe = $b.Paths | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if ($exe) { @{ Name = $b.Name; Page = $b.Page; Exe = $exe } }
}

Write-Host ''
Write-Host "  Swish $version" -ForegroundColor DarkYellow
Write-Host "  Installed to $dest"
Write-Host ''

if ($updating) {
    Write-Host '  Updated. Open your extensions page and click the reload icon on Swish.' -ForegroundColor Green
} else {
    Write-Host '  One last step in your browser:' -ForegroundColor Green
    Write-Host '    1. Turn on Developer mode.'
    Write-Host '    2. Click "Load unpacked".'
    Write-Host '    3. Paste the folder path (already copied to your clipboard) and choose Select Folder.'
    Write-Host ''
    Write-Host "  Keep $dest where it is; the browser loads Swish from there."
}
Write-Host ''

$browser = $null
if (@($found).Count -eq 1) {
    $browser = @($found)[0]
} elseif (@($found).Count -gt 1) {
    for ($i = 0; $i -lt @($found).Count; $i++) { Write-Host "  [$($i + 1)] $(@($found)[$i].Name)" }
    $pick = Read-Host '  Which browser should Swish go in? (number)'
    if ($pick -match '^\d+$' -and [int]$pick -ge 1 -and [int]$pick -le @($found).Count) {
        $browser = @($found)[[int]$pick - 1]
    }
}

if ($browser) {
    Start-Process -FilePath $browser.Exe -ArgumentList $browser.Page
    Write-Host "  Opened $($browser.Page) in $($browser.Name)."
} else {
    Write-Host '  Open your browser''s extensions page (for example edge://extensions or chrome://extensions).'
}
Write-Host ''
