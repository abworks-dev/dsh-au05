param([Parameter(Mandatory=$true)][string]$Source, [Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Source -PathType Container)) { throw 'missing_staged_bundle' }
Compress-Archive -LiteralPath $Source -DestinationPath $Destination -CompressionLevel Optimal -Force
