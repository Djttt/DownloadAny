param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot "..\src-tauri\installer-assets")
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$script:BrandImage = [System.Drawing.Image]::FromFile(
  [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\public\app-icon.png"))
)

$output = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($output) | Out-Null

function New-Canvas([int]$width, [int]$height) {
  $bitmap = [System.Drawing.Bitmap]::new($width, $height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  return @($bitmap, $graphics)
}

function Save-Bmp($bitmap, $graphics, [string]$name) {
  $graphics.Dispose()
  $path = Join-Path $output $name
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $bitmap.Dispose()
}

function Draw-BrandMark($graphics, [float]$x, [float]$y, [float]$size) {
  $graphics.DrawImage($script:BrandImage, $x, $y, $size, $size)
}

function Draw-CloudDownload($graphics, [float]$x, [float]$y, [float]$scale, [System.Drawing.Color]$color) {
  # Derived from Lucide's cloud-download icon (ISC); original SVG is kept in sources/.
  $pen = [System.Drawing.Pen]::new($color, 2.2 * $scale)
  $pen.StartCap = $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $graphics.DrawLine($pen, $x + 12*$scale, $y + 13*$scale, $x + 12*$scale, $y + 21*$scale)
  $graphics.DrawLines($pen, [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new($x + 8*$scale,$y + 17*$scale),
    [System.Drawing.PointF]::new($x + 12*$scale,$y + 21*$scale),
    [System.Drawing.PointF]::new($x + 16*$scale,$y + 17*$scale)
  ))
  $graphics.DrawBezier($pen, $x + 4.4*$scale,$y + 15.3*$scale, $x - 1*$scale,$y + 12*$scale, $x + 1*$scale,$y + 4*$scale, $x + 8*$scale,$y + 4*$scale)
  $graphics.DrawBezier($pen, $x + 8*$scale,$y + 4*$scale, $x + 12*$scale,$y + 1*$scale, $x + 15*$scale,$y + 4*$scale, $x + 15.7*$scale,$y + 8*$scale)
  $graphics.DrawLine($pen, $x + 15.7*$scale,$y + 8*$scale, $x + 17.5*$scale,$y + 8*$scale)
  $graphics.DrawBezier($pen, $x + 17.5*$scale,$y + 8*$scale, $x + 24*$scale,$y + 8*$scale, $x + 24*$scale,$y + 16*$scale, $x + 20*$scale,$y + 16.3*$scale)
  $pen.Dispose()
}

function Draw-Trash($graphics, [float]$x, [float]$y, [float]$scale, [System.Drawing.Color]$color) {
  # Derived from Lucide's trash icon (ISC); original SVG is kept in sources/.
  $pen = [System.Drawing.Pen]::new($color, 2.0 * $scale)
  $pen.StartCap = $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $graphics.DrawLine($pen,$x+3*$scale,$y+6*$scale,$x+21*$scale,$y+6*$scale)
  $graphics.DrawLines($pen,[System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new($x+5*$scale,$y+6*$scale),
    [System.Drawing.PointF]::new($x+5*$scale,$y+20*$scale),
    [System.Drawing.PointF]::new($x+7*$scale,$y+22*$scale),
    [System.Drawing.PointF]::new($x+17*$scale,$y+22*$scale),
    [System.Drawing.PointF]::new($x+19*$scale,$y+20*$scale),
    [System.Drawing.PointF]::new($x+19*$scale,$y+6*$scale)
  ))
  $graphics.DrawLines($pen,[System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new($x+8*$scale,$y+6*$scale),
    [System.Drawing.PointF]::new($x+8*$scale,$y+4*$scale),
    [System.Drawing.PointF]::new($x+10*$scale,$y+2*$scale),
    [System.Drawing.PointF]::new($x+14*$scale,$y+2*$scale),
    [System.Drawing.PointF]::new($x+16*$scale,$y+4*$scale),
    [System.Drawing.PointF]::new($x+16*$scale,$y+6*$scale)
  ))
  $graphics.DrawLine($pen,$x+10*$scale,$y+11*$scale,$x+10*$scale,$y+17*$scale)
  $graphics.DrawLine($pen,$x+14*$scale,$y+11*$scale,$x+14*$scale,$y+17*$scale)
  $pen.Dispose()
}

# Welcome / finish sidebar (NSIS MUI recommended size: 164x314).
$canvas = New-Canvas 164 314; $bitmap = $canvas[0]; $graphics = $canvas[1]
$graphics.Clear([System.Drawing.Color]::FromArgb(245,248,255))
$gradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
  [System.Drawing.Rectangle]::new(0,0,164,314),
  [System.Drawing.Color]::FromArgb(0,82,217),
  [System.Drawing.Color]::FromArgb(0,45,130), 90
)
$graphics.FillRectangle($gradient, 0, 0, 164, 314); $gradient.Dispose()
$soft = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(26,255,255,255))
$graphics.FillEllipse($soft, -48, 205, 190, 190)
$graphics.FillEllipse($soft, 78, -38, 120, 120); $soft.Dispose()
Draw-BrandMark $graphics 30 36 72
Draw-CloudDownload $graphics 69 143 2.0 ([System.Drawing.Color]::White)
$titleFont = [System.Drawing.Font]::new("Segoe UI", 15, [System.Drawing.FontStyle]::Bold)
$captionFont = [System.Drawing.Font]::new("Segoe UI", 8.5, [System.Drawing.FontStyle]::Regular)
$whiteBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
$mutedBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(205,225,245))
$graphics.DrawString("LumeAny", $titleFont, $whiteBrush, 24, 230)
$graphics.DrawString("Download media, simply.", $captionFont, $mutedBrush, 24, 258)
$titleFont.Dispose(); $captionFont.Dispose(); $whiteBrush.Dispose(); $mutedBrush.Dispose()
Save-Bmp $bitmap $graphics "installer-sidebar.bmp"

# Installer header.
$canvas = New-Canvas 150 57; $bitmap = $canvas[0]; $graphics = $canvas[1]
$graphics.Clear([System.Drawing.Color]::White)
$lineBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(0,82,217))
$graphics.FillRectangle($lineBrush, 0, 0, 5, 57); $lineBrush.Dispose()
Draw-BrandMark $graphics 14 9 39
Draw-CloudDownload $graphics 102 13 1.25 ([System.Drawing.Color]::FromArgb(0,82,217))
Save-Bmp $bitmap $graphics "installer-header.bmp"

# Uninstaller header: neutral tone, same brand language.
$canvas = New-Canvas 150 57; $bitmap = $canvas[0]; $graphics = $canvas[1]
$graphics.Clear([System.Drawing.Color]::White)
$lineBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(112,119,132))
$graphics.FillRectangle($lineBrush, 0, 0, 5, 57); $lineBrush.Dispose()
Draw-BrandMark $graphics 14 9 39
Draw-Trash $graphics 105 12 1.3 ([System.Drawing.Color]::FromArgb(112,119,132))
Save-Bmp $bitmap $graphics "uninstaller-header.bmp"

# Keep replaceable copies beside the bitmaps. Re-run `pnpm tauri icon public/app-icon.svg`
# after changing the brand master; or replace these two .ico files directly.
Copy-Item (Join-Path $PSScriptRoot "..\src-tauri\icons\icon.ico") (Join-Path $output "installer.ico") -Force
Copy-Item (Join-Path $PSScriptRoot "..\src-tauri\icons\icon.ico") (Join-Path $output "uninstaller.ico") -Force
$script:BrandImage.Dispose()

Write-Host "Generated installer assets in $output"
