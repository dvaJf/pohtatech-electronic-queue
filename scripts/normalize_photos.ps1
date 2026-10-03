Add-Type -AssemblyName System.Drawing

$targetWidth = 600
$targetHeight = 450
$targetRatio = $targetWidth / $targetHeight

$publicDir = "frontend\public\images\branches"
$distDir = "frontend\dist\images\branches"

# Quality encoder
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
$encoderParams = [System.Drawing.Imaging.EncoderParameters]::new(1)
$encoderParams.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new([System.Drawing.Imaging.Encoder]::Quality, [long]92)

$files = Get-ChildItem -Path $publicDir -Filter "*.jpg"
Write-Output "Normalizing $($files.Count) images to exactly ${targetWidth}x${targetHeight}..."

foreach ($file in $files) {
    $srcPath = $file.FullName
    $bytes = [System.IO.File]::ReadAllBytes($srcPath)
    $ms = [System.IO.MemoryStream]::new($bytes)
    $srcBmp = [System.Drawing.Bitmap]::FromStream($ms)

    $sw = $srcBmp.Width
    $sh = $srcBmp.Height
    $srcRatio = $sw / $sh

    if ($srcRatio -gt $targetRatio) {
        # Source is wider than target: crop left and right
        $cropH = $sh
        $cropW = [int]($sh * $targetRatio)
        $cropX = [int](($sw - $cropW) / 2)
        $cropY = 0
    } else {
        # Source is taller than target (vertical): crop top and bottom
        # Position crop around upper-middle (30% from top) to preserve signs and entrance canopies
        $cropW = $sw
        $cropH = [int]($sw / $targetRatio)
        $cropX = 0
        $cropY = [int](($sh - $cropH) * 0.35)
        if ($cropY + $cropH -gt $sh) { $cropY = $sh - $cropH }
        if ($cropY -lt 0) { $cropY = 0 }
    }

    $destBmp = [System.Drawing.Bitmap]::new($targetWidth, $targetHeight, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g = [System.Drawing.Graphics]::FromImage($destBmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

    $srcRect = [System.Drawing.Rectangle]::new($cropX, $cropY, $cropW, $cropH)
    $destRect = [System.Drawing.Rectangle]::new(0, 0, $targetWidth, $targetHeight)

    $g.DrawImage($srcBmp, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()
    $srcBmp.Dispose()
    $ms.Dispose()

    # Save to public and dist
    $destBmp.Save($srcPath, $codec, $encoderParams)
    $distPath = Join-Path $distDir $file.Name
    if (Test-Path $distDir) {
        $destBmp.Save($distPath, $codec, $encoderParams)
    }
    $destBmp.Dispose()
}

Write-Output "All $($files.Count) images successfully normalized to ${targetWidth}x${targetHeight}!"
