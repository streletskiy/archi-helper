$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$cache = Join-Path $root '.cache/max-distribution'
New-Item $cache -ItemType Directory -Force | Out-Null
function Get-VerifiedFile($Name, $Url, $Hash) {
    $file = Join-Path $cache $Name
    if (!(Test-Path $file) -or (Get-FileHash $file).Hash -ne $Hash) {
        Invoke-WebRequest -UseBasicParsing $Url -OutFile "$file.download"
        if ((Get-FileHash "$file.download").Hash -ne $Hash) { throw "Invalid checksum for $Name" }
        Move-Item -LiteralPath "$file.download" -Destination $file -Force
    }
    return $file
}
$setup = Get-VerifiedFile 'upstream.exe' 'https://github.com/cl0nazepamm/3dsmax-mcp/releases/download/v2.0.1/3dsmax-mcp-2.0.1-Setup.exe' '53b5af9ac0094384d88616a101b13886e87620e64745d1b6242b07c0372919e0'
$archive = Get-VerifiedFile 'unpacker.zip' 'https://raw.githubusercontent.com/jrathlev/InnoUnpacker-Windows-GUI/578d3af5ec8aae028c21eb2d23532edf83f49df5/innounp-2/bin/innounp-267.zip' 'ac1d98bba6588072ade06163781938df274f444bec7318069668608d1e5faae8'
Expand-Archive -LiteralPath $archive -DestinationPath "$cache/unpacker" -Force
$unpacker = (Get-ChildItem "$cache/unpacker" -Filter innounp.exe -Recurse | Select-Object -First 1).FullName
# Extract the upstream distribution without executing its installer or configuring other MCP clients.
& $unpacker -x -y "-d$cache/payload" $setup | Out-Null
if ($LASTEXITCODE -ne 0) { throw "3dsmax-mcp extraction failed ($LASTEXITCODE)" }
$dest = Join-Path $root 'runtime/max-mcp'
New-Item $dest -ItemType Directory -Force | Out-Null
Copy-Item -LiteralPath "$cache/payload/{app}/runtime" -Destination $dest -Recurse -Force
Copy-Item -LiteralPath "$cache/payload/{commonappdata}/Autodesk/ApplicationPlugins/3dsmax-mcp" -Destination $dest -Recurse -Force
Copy-Item -LiteralPath "$cache/payload/{app}/LICENSE.txt" -Destination "$dest/LICENSE.txt" -Force
& "$dest/runtime/python.exe" -B -c "from maxmcp.server import mcp; print('3dsmax-mcp ready')"
if ($LASTEXITCODE -ne 0) { throw '3dsmax-mcp runtime could not start' }
