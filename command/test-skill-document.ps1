param(
    [string]$LogPath = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$node = "D:\vibecoding\sdk\nodejs\node.exe"
$tsc = Join-Path $root "node_modules\typescript\bin\tsc"
$smoke = Join-Path $root "frontend\src\features\skill-document\skill-document.smoke.ts"
$tempRoot = Join-Path $root ".tmp\skill-document-smoke-$PID"
$safeTempPrefix = [IO.Path]::GetFullPath((Join-Path $root ".tmp")) + [IO.Path]::DirectorySeparatorChar
$resolvedTempRoot = [IO.Path]::GetFullPath($tempRoot)
if (-not $resolvedTempRoot.StartsWith($safeTempPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "临时目录越出工程边界：$resolvedTempRoot"
}
if (-not $LogPath) {
    $LogPath = Join-Path $root "log\skill-document-smoke.log"
}

if (-not (Test-Path $node)) {
    throw "未找到 D 盘 Node SDK：$node"
}
if (-not (Test-Path $tsc)) {
    throw "未找到项目 TypeScript 编译器：$tsc"
}
if (-not (Test-Path $smoke)) {
    throw "未找到 Skill 文档 smoke 源文件：$smoke"
}

function Invoke-NodeProcess {
    param(
        [Parameter(Mandatory)]
        [string[]]$Arguments
    )

    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $node
    $startInfo.WorkingDirectory = $root
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    foreach ($argument in $Arguments) {
        [void]$startInfo.ArgumentList.Add($argument)
    }

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    try {
        [void]$process.Start()
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        return [pscustomobject]@{
            ExitCode = $process.ExitCode
            Output = @(
                @($stdoutTask.GetAwaiter().GetResult() -split "\r?\n")
                @($stderrTask.GetAwaiter().GetResult() -split "\r?\n")
            ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
        }
    } finally {
        $process.Dispose()
    }
}

New-Item -ItemType Directory -Force -Path $tempRoot,(Split-Path $LogPath -Parent) | Out-Null
$originalTemp = $env:TEMP
$originalTmp = $env:TMP
$env:TEMP = $tempRoot
$env:TMP = $tempRoot

try {
    $compile = Invoke-NodeProcess -Arguments @(
        $tsc,
        $smoke,
        "--outDir", $tempRoot,
        "--target", "ES2022",
        "--module", "commonjs",
        "--moduleResolution", "node",
        "--lib", "ES2022,DOM",
        "--strict",
        "--esModuleInterop",
        "--skipLibCheck"
    )
    if ($compile.ExitCode -ne 0) {
        $compile.Output | Write-Output
        throw "skill-document smoke TypeScript 编译失败：$($compile.ExitCode)"
    }

    Set-Content -LiteralPath (Join-Path $tempRoot "package.json") -Value '{"type":"commonjs"}' -Encoding ascii
    $entry = Join-Path $tempRoot "skill-document.smoke.js"
    if (-not (Test-Path $entry)) {
        $emitted = @(
            Get-ChildItem -LiteralPath $tempRoot -Recurse -File -Filter "skill-document.smoke.js" -ErrorAction SilentlyContinue
        )
        if ($emitted.Count -eq 1) {
            $entry = $emitted[0].FullName
        } else {
            throw "未生成唯一 smoke 入口：$tempRoot"
        }
    }

    $runtime = Invoke-NodeProcess -Arguments @($entry)
    $output = @($runtime.Output)
    $output | Set-Content -LiteralPath $LogPath -Encoding utf8
    $output | Write-Output
    if ($runtime.ExitCode -ne 0) {
        throw "skill-document runtime smoke 失败：$($runtime.ExitCode)"
    }
} finally {
    if ($null -eq $originalTemp) {
        Remove-Item Env:TEMP -ErrorAction SilentlyContinue
    } else {
        $env:TEMP = $originalTemp
    }
    if ($null -eq $originalTmp) {
        Remove-Item Env:TMP -ErrorAction SilentlyContinue
    } else {
        $env:TMP = $originalTmp
    }
    if (Test-Path $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force
    }
}
