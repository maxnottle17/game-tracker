# Draws the Game Tracker icon (a gold podium on a dark tile) and puts a shortcut on the desktop.
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$png = Join-Path $root 'ui\icon.png'
$ico = Join-Path $root 'ui\icon.ico'

$bmp = New-Object System.Drawing.Bitmap 256, 256
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::Transparent)

function RoundRect($x, $y, $w, $h, $r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

$tile = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 24, 29, 39))
$g.FillPath($tile, (RoundRect 8 8 240 240 48))
$gold = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 245, 185, 66))
$silver = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 207, 214, 226))
$bronze = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 216, 154, 106))
$g.FillPath($silver, (RoundRect 44 118 50 90 10))
$g.FillPath($gold, (RoundRect 103 64 50 144 10))
$g.FillPath($bronze, (RoundRect 162 148 50 60 10))
$g.Dispose()
$bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

# An .ico file can simply wrap a 256px PNG.
$bytes = [System.IO.File]::ReadAllBytes($png)
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $ms
$bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]1)
$bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([byte]0)
$bw.Write([uint16]1); $bw.Write([uint16]32)
$bw.Write([uint32]$bytes.Length); $bw.Write([uint32]22)
$bw.Write($bytes)
[System.IO.File]::WriteAllBytes($ico, $ms.ToArray())

$desktop = [Environment]::GetFolderPath('Desktop')
$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut((Join-Path $desktop 'Game Tracker.lnk'))
$lnk.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$lnk.Arguments = '"' + (Join-Path $root 'Game Tracker.vbs') + '"'
$lnk.WorkingDirectory = $root
$lnk.IconLocation = "$ico,0"
$lnk.Description = 'Hours played and achievements leaderboard'
$lnk.Save()
"Shortcut: $(Join-Path $desktop 'Game Tracker.lnk')"
Get-ChildItem $desktop -Filter '*.lnk' | Select-Object -ExpandProperty Name
