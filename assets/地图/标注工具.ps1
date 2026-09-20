param(
  [Parameter(Mandatory=$true)][string]$MapDir,
  [switch]$Grid
)

Add-Type -AssemblyName System.Drawing

$bg   = Join-Path $MapDir (Get-ChildItem $MapDir -Filter '*-完整背景图.jpg' | Select-Object -First 1 -ExpandProperty Name)
$html = Join-Path $MapDir (Get-ChildItem $MapDir -Filter '*-地图页源码.html' | Select-Object -First 1 -ExpandProperty Name)
$out  = $bg -replace '-完整背景图\.jpg$', '-标注版.jpg'

$src = Get-Content -LiteralPath $html -Encoding UTF8 -Raw

# 解析容器尺寸（span 坐标系）
$divW = 753; $divH = 988
if ($src -match '<div style="width:\s*(\d+)px;\s*height:\s*(\d+)px') { $divW = [int]$Matches[1]; $divH = [int]$Matches[2] }
elseif ($src -match '<table[^>]*width="?(\d+)"?[^>]*height="?(\d+)"?') { $divW = [int]$Matches[1]; $divH = [int]$Matches[2] }

# 解析切片网格（行列数）
$cells = [regex]::Matches($src, '<TD background="pic/[^"]+/[^"]+_(\d+)\.(?:jpg|gif)">')
$maxN = ($cells | ForEach-Object { [int]$_.Groups[1].Value } | Measure-Object -Maximum).Maximum

# 通用地点标签正则：class 顺序任意、引号成对、style 中含 left/top
$labelRegex = '(?s)<span[^>]*class=["'']?pos["'']?[^>]*?style=(["''])[^"'']*?left:\s*(\d+)px;\s*top:\s*(\d+)px[^"'']*?\1[^>]*?title=(["''])([^"'']+)\4[^>]*>(.*?)</span>'
$labels = @()
foreach ($m in [regex]::Matches($src, $labelRegex)) {
  $labels += [pscustomobject]@{
    X = [int]$m.Groups[2].Value; Y = [int]$m.Groups[3].Value
    Title = $m.Groups[5].Value; Text = ($m.Groups[6].Value -replace '<[^>]+>','').Trim()
  }
}

$img = [System.Drawing.Image]::FromFile($bg)
$bmp = New-Object System.Drawing.Bitmap($img.Width, $img.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.DrawImage($img, 0, 0, $img.Width, $img.Height)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

$sx = $img.Width / $divW; $sy = $img.Height / $divH

# 可选：切片网格线
if ($Grid) {
  $gridCols = 10; $gridRows = 10
  if ($maxN -eq 25) { $gridCols = 5; $gridRows = 5 }
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(70, 255, 255, 0), 1)
  $pen.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dash
  for ($c = 1; $c -lt $gridCols; $c++) { $x = [int]($img.Width * $c / $gridCols); $g.DrawLine($pen, $x, 0, $x, $img.Height) }
  for ($r = 1; $r -lt $gridRows; $r++) { $y = [int]($img.Height * $r / $gridRows); $g.DrawLine($pen, 0, $y, $img.Width, $y) }
}

# 画地点标签（仿原版：半透明底 + 亮边框 + 黄字）
$font = New-Object System.Drawing.Font('微软雅黑', 9, [System.Drawing.FontStyle]::Bold)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(150, 0, 0, 0))
$textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 235, 130))
$penBox = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(200, 255, 220, 90), 1)

foreach ($l in $labels) {
  $txt = $l.Text
  if ([string]::IsNullOrWhiteSpace($txt)) { $txt = $l.Title }
  $sz = $g.MeasureString($txt, $font)
  $w = [int]($sz.Width + 8); $h = [int]($sz.Height + 4)
  $x = [int]($l.X * $sx); $y = [int]($l.Y * $sy)
  $rect = New-Object System.Drawing.Rectangle($x, $y, $w, $h)
  $rectF = New-Object System.Drawing.RectangleF([float]$x, [float]$y, [float]$w, [float]$h)
  $g.FillRectangle($bgBrush, $rect)
  $g.DrawRectangle($penBox, $rect)
  $g.DrawString($txt, $font, $textBrush, $rectF, $sf)
}

$g.Dispose(); $img.Dispose()
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]95)
$bmp.Save($out, $codec, $ep)
$bmp.Dispose()
Write-Output ("已生成: " + $out + " （标签 " + $labels.Count + " 个）")
