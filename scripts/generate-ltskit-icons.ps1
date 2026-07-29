Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$build = Join-Path $root 'build'
$pngPath = Join-Path $build 'icon.png'
$icoPath = Join-Path $build 'icon.ico'

function New-LTSKitBitmap([int] $size) {
  $bitmap = New-Object System.Drawing.Bitmap $size, $size
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

  $bounds = New-Object System.Drawing.Rectangle 0, 0, $size, $size
  $radius = [int]($size * 0.289)
  $shape = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = $radius * 2
  $shape.AddArc(0, 0, $diameter, $diameter, 180, 90)
  $shape.AddArc($size - $diameter, 0, $diameter, $diameter, 270, 90)
  $shape.AddArc($size - $diameter, $size - $diameter, $diameter, $diameter, 0, 90)
  $shape.AddArc(0, $size - $diameter, $diameter, $diameter, 90, 90)
  $shape.CloseFigure()

  $graphics.SetClip($shape)
  $outer = [System.Drawing.Color]::FromArgb(255, 15, 118, 110)
  $middle = [System.Drawing.Color]::FromArgb(255, 37, 99, 235)
  $highlight = [System.Drawing.Color]::FromArgb(255, 96, 165, 250)
  $graphics.Clear($outer)
  $centerX = [int]($size * 0.30)
  $centerY = [int]($size * 0.25)
  $maxRadius = [int]($size * 1.15)
  for ($radiusStep = $maxRadius; $radiusStep -gt 0; $radiusStep -= [Math]::Max(1, [int]($size / 400))) {
    $ratio = $radiusStep / $maxRadius
    if ($ratio -gt 0.55) {
      $mix = ($ratio - 0.55) / 0.45
      $red = [int]($middle.R + (($highlight.R - $middle.R) * $mix))
      $green = [int]($middle.G + (($highlight.G - $middle.G) * $mix))
      $blue = [int]($middle.B + (($highlight.B - $middle.B) * $mix))
    } else {
      $mix = $ratio / 0.55
      $red = [int]($outer.R + (($middle.R - $outer.R) * $mix))
      $green = [int]($outer.G + (($middle.G - $outer.G) * $mix))
      $blue = [int]($outer.B + (($middle.B - $outer.B) * $mix))
    }
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, $red, $green, $blue))
    $graphics.FillEllipse($brush, $centerX - $radiusStep, $centerY - $radiusStep, $radiusStep * 2, $radiusStep * 2)
    $brush.Dispose()
  }

  $scale = $size / 1024.0
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White, (57 * $scale))
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $graphics.DrawEllipse($pen, (217 * $scale), (217 * $scale), (590 * $scale), (590 * $scale))
  $graphics.DrawLine($pen, (223 * $scale), (574 * $scale), (801 * $scale), (574 * $scale))
  $arc = New-Object System.Drawing.Drawing2D.GraphicsPath
  $arc.AddBezier((346 * $scale), (574 * $scale), (380 * $scale), (461 * $scale), (454 * $scale), (398 * $scale), (512 * $scale), (398 * $scale))
  $arc.AddBezier((512 * $scale), (398 * $scale), (570 * $scale), (398 * $scale), (644 * $scale), (461 * $scale), (678 * $scale), (574 * $scale))
  $graphics.DrawPath($pen, $arc)
  $graphics.DrawLine($pen, (352 * $scale), (687 * $scale), (672 * $scale), (687 * $scale))
  $dotBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $dotRadius = 40 * $scale
  $graphics.FillEllipse($dotBrush, (512 * $scale) - $dotRadius, (307 * $scale) - $dotRadius, $dotRadius * 2, $dotRadius * 2)

  $dotBrush.Dispose()
  $arc.Dispose()
  $pen.Dispose()
  $graphics.Dispose()
  $shape.Dispose()
  return $bitmap
}

function Get-PngBytes([System.Drawing.Bitmap] $bitmap) {
  $stream = New-Object System.IO.MemoryStream
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $stream.ToArray()
  $stream.Dispose()
  # Keep the PNG payload together instead of streaming individual bytes through PowerShell's pipeline.
  return ,$bytes
}

$main = New-LTSKitBitmap 1024
$main.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$main.Dispose()

$sizes = @(16, 32, 48, 64, 128, 256)
$entries = @()
foreach ($size in $sizes) {
  $bitmap = New-LTSKitBitmap $size
  $entries += ,(Get-PngBytes $bitmap)
  $bitmap.Dispose()
}

$stream = New-Object System.IO.FileStream($icoPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
$writer = New-Object System.IO.BinaryWriter($stream)
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]$sizes.Count)
$offset = 6 + (16 * $sizes.Count)
for ($index = 0; $index -lt $sizes.Count; $index++) {
  $size = $sizes[$index]
  $bytes = $entries[$index]
  $writer.Write([Byte]($(if ($size -eq 256) { 0 } else { $size })))
  $writer.Write([Byte]($(if ($size -eq 256) { 0 } else { $size })))
  $writer.Write([Byte]0)
  $writer.Write([Byte]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]32)
  $writer.Write([UInt32]$bytes.Length)
  $writer.Write([UInt32]$offset)
  $offset += $bytes.Length
}
foreach ($bytes in $entries) { $writer.Write($bytes) }
$writer.Dispose()
$stream.Dispose()

Write-Output 'Generated build/icon.png and build/icon.ico.'
