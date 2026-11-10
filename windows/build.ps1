# Builds windows\out\MimicTray.exe with the C# compiler that ships with Windows (.NET Framework 4).
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "C# compiler not found at $csc" }
$out = Join-Path $here 'out'
New-Item -ItemType Directory -Force $out | Out-Null
& $csc /nologo /target:winexe /optimize+ "/out:$out\MimicTray.exe" `
    /r:System.Windows.Forms.dll /r:System.Drawing.dll (Join-Path $here 'MimicTray.cs')
if ($LASTEXITCODE -ne 0) { throw "build failed" }
Write-Host "built $out\MimicTray.exe"
