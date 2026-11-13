Add-Type -AssemblyName System.Drawing

$densities = @{
    'mipmap-mdpi' = 48
    'mipmap-hdpi' = 72
    'mipmap-xhdpi' = 96
    'mipmap-xxhdpi' = 144
    'mipmap-xxxhdpi' = 192
}

foreach ($folder in $densities.Keys) {
    $size = $densities[$folder]
    $dir = Join-Path 'android\app\src\main\res' $folder
    if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    # Background
    $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(194, 101, 42)) # #c2652a
    $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $g.FillEllipse($bgBrush, $rect)

    # Border glow
    $borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(250, 245, 238), [Math]::Max(1.5, $size * 0.04))
    $g.DrawEllipse($borderPen, [float]($size * 0.05), [float]($size * 0.05), [float]($size * 0.9), [float]($size * 0.9))

    # Bridge Arc & Node Symbol
    $iconPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 255, 255), [Math]::Max(2.0, $size * 0.08))
    $iconPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $iconPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

    # Bridge Arc
    $arcRect = New-Object System.Drawing.RectangleF([float]($size * 0.22), [float]($size * 0.26), [float]($size * 0.56), [float]($size * 0.48))
    $g.DrawArc($iconPen, $arcRect, 180, 180)

    # Foundation Pillars
    $pillarY1 = [float]($size * 0.50)
    $pillarY2 = [float]($size * 0.72)
    $g.DrawLine($iconPen, [float]($size * 0.22), $pillarY1, [float]($size * 0.22), $pillarY2)
    $g.DrawLine($iconPen, [float]($size * 0.78), $pillarY1, [float]($size * 0.78), $pillarY2)

    # Center Pulse Node
    $nodeBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 232, 216))
    $nodeSize = [float]($size * 0.16)
    $g.FillEllipse($nodeBrush, [float]($size * 0.50 - $nodeSize / 2), [float]($size * 0.38 - $nodeSize / 2), $nodeSize, $nodeSize)

    # Center Dot
    $dotBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(194, 101, 42))
    $dotSize = [float]($size * 0.08)
    $g.FillEllipse($dotBrush, [float]($size * 0.50 - $dotSize / 2), [float]($size * 0.38 - $dotSize / 2), $dotSize, $dotSize)

    $bmp.Save((Join-Path $dir 'ic_launcher.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Save((Join-Path $dir 'ic_launcher_round.png'), [System.Drawing.Imaging.ImageFormat]::Png)

    $g.Dispose()
    $bmp.Dispose()
}

Write-Host "Launcher icons created successfully!"

