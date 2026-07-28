param(
    [string]$Version = "1.0.0",
    [string]$Repository = "nekobyran/skill-agentmd-creator",
    [string]$BuildRoot = "",
    [switch]$SkipBuild,
    [switch]$Publish,
    [switch]$Apply,
    [switch]$KeepBuildCache
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$packagePath = Join-Path $projectRoot "package.json"
$tauriConfigPath = Join-Path $projectRoot "src-tauri\tauri.conf.json"
$cargoManifestPath = Join-Path $projectRoot "src-tauri\Cargo.toml"
$releaseNotesPath = Join-Path $projectRoot "RELEASE_NOTES.md"
$releaseRoot = Join-Path $projectRoot "release\skillcreator_windows\release"
$workspaceTemp = Join-Path $projectRoot ".tmp\release"
$tag = "v$Version"
$setupTarget = Join-Path $releaseRoot "SkillCreator-$tag-Windows-x64-Setup.exe"
$portableTarget = Join-Path $releaseRoot "SkillCreator-$tag-Windows-x64-Portable.exe"
$hashPath = Join-Path $releaseRoot "SkillCreator-$tag-SHA256.txt"
$manifestPath = Join-Path $releaseRoot "SkillCreator-$tag-manifest.json"

function Invoke-Native {
    param(
        [Parameter(Mandatory)]
        [string]$FilePath,
        [Parameter(Mandatory)]
        [string[]]$Arguments
    )

    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.WorkingDirectory = $projectRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true

    if ([IO.Path]::GetExtension($FilePath).Equals('.cmd', [StringComparison]::OrdinalIgnoreCase)) {
        $startInfo.FileName = (Get-Command cmd.exe -ErrorAction Stop).Source
        [void]$startInfo.ArgumentList.Add('/d')
        [void]$startInfo.ArgumentList.Add('/s')
        [void]$startInfo.ArgumentList.Add('/c')
        $command = @(
            '"' + ($FilePath -replace '"', '""') + '"'
            $Arguments | ForEach-Object {
                if ($_ -match '[\s&|<>^()]') {
                    '"' + ($_ -replace '"', '""') + '"'
                } else {
                    $_
                }
            }
        ) -join ' '
        [void]$startInfo.ArgumentList.Add($command)
    } else {
        $startInfo.FileName = $FilePath
        foreach ($argument in $Arguments) {
            [void]$startInfo.ArgumentList.Add($argument)
        }
    }

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    try {
        [void]$process.Start()
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        $output = @(
            @($stdoutTask.GetAwaiter().GetResult() -split "\r?\n")
            @($stderrTask.GetAwaiter().GetResult() -split "\r?\n")
        ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
        $output | Write-Output
        if ($process.ExitCode -ne 0) {
            throw "$FilePath failed with exit code $($process.ExitCode)"
        }
    } finally {
        $process.Dispose()
    }
}

function Resolve-SdkRoot {
    if ($env:VIBECODING_SDK_ROOT) {
        return [IO.Path]::GetFullPath($env:VIBECODING_SDK_ROOT)
    }

    foreach ($candidate in @("D:\vibecoding\sdk", "H:\vibecoding\sdk")) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    throw "未找到 D: 或 H: 上的 vibecoding SDK；可通过 VIBECODING_SDK_ROOT 指定。"
}

function Resolve-BuildRoot {
    if ($BuildRoot) {
        return [IO.Path]::GetFullPath($BuildRoot)
    }

    $hDrive = Get-PSDrive -Name H -PSProvider FileSystem -ErrorAction SilentlyContinue
    if ($hDrive -and $hDrive.Free -gt 100GB) {
        return "H:\vibecoding\sdk\build-cache\skillcreator-v$Version"
    }

    return "D:\vibecoding\sdk\build-cache\skillcreator-v$Version"
}

function Resolve-RustToolchainBin {
    param([Parameter(Mandatory)][string]$RustupHome)

    $toolchainsRoot = Join-Path $RustupHome "toolchains"
    $candidates = Get-ChildItem -LiteralPath $toolchainsRoot -Directory -ErrorAction SilentlyContinue |
        Sort-Object @{ Expression = { $_.Name -like "stable-*" }; Descending = $true },Name
    foreach ($candidate in $candidates) {
        $bin = Join-Path $candidate.FullName "bin"
        if (
            (Test-Path -LiteralPath (Join-Path $bin "cargo-fmt.exe")) -and
            (Test-Path -LiteralPath (Join-Path $bin "cargo-clippy.exe"))
        ) {
            return $bin
        }
    }

    throw "未找到包含 rustfmt/clippy 的 Rust toolchain：$toolchainsRoot"
}

function Assert-VersionConsistency {
    $package = Get-Content -LiteralPath $packagePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $tauri = Get-Content -LiteralPath $tauriConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $cargoText = Get-Content -LiteralPath $cargoManifestPath -Raw -Encoding UTF8
    $cargoMatch = [regex]::Match(
        $cargoText,
        '(?ms)^\[package\]\s*.*?^version\s*=\s*"(?<version>[^"]+)"'
    )

    if (-not $cargoMatch.Success) {
        throw "无法从 $cargoManifestPath 读取 package.version。"
    }

    $versions = [ordered]@{
        "package.json" = [string]$package.version
        "tauri.conf.json" = [string]$tauri.version
        "Cargo.toml" = $cargoMatch.Groups["version"].Value
    }
    $mismatch = $versions.GetEnumerator() | Where-Object { $_.Value -ne $Version }
    if ($mismatch) {
        $details = ($versions.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ", "
        throw "版本号不一致，期望 $Version：$details"
    }
}

function Assert-PublicRepository {
    $visibility = & gh repo view $Repository --json visibility --jq ".visibility"
    if ($LASTEXITCODE -ne 0) {
        throw "无法读取 GitHub 仓库 $Repository。"
    }
    if ([string]$visibility -ne "PUBLIC") {
        throw "拒绝发布：GitHub 仓库 $Repository 的 visibility 不是 PUBLIC。"
    }
}

function Assert-ProjectGitRoot {
    $actualRoot = (& git -C $projectRoot rev-parse --show-toplevel).Trim()
    if ($LASTEXITCODE -ne 0) {
        throw "项目尚未初始化独立 Git 仓库：$projectRoot"
    }
    if (-not [IO.Path]::GetFullPath($actualRoot).Equals(
        $projectRoot,
        [StringComparison]::OrdinalIgnoreCase
    )) {
        throw "拒绝发布：Git 根目录不是当前项目。actual=$actualRoot expected=$projectRoot"
    }
}

Assert-VersionConsistency

$sdkRoot = Resolve-SdkRoot
$nodeRoot = Join-Path $sdkRoot "nodejs"
$cargoHome = Join-Path $sdkRoot "rust\cargo"
$rustupHome = Join-Path $sdkRoot "rust\rustup"
$node = Join-Path $nodeRoot "node.exe"
$tscCli = Join-Path $projectRoot "node_modules\typescript\bin\tsc"
$viteCli = Join-Path $projectRoot "node_modules\vite\bin\vite.js"
$tauriCli = Join-Path $projectRoot "node_modules\@tauri-apps\cli\tauri.js"
$cargo = Join-Path $cargoHome "bin\cargo.exe"
$rustToolchainBin = Resolve-RustToolchainBin -RustupHome $rustupHome
$resolvedBuildRoot = Resolve-BuildRoot

foreach ($requiredTool in @($node, $tscCli, $viteCli, $tauriCli, $cargo)) {
    if (-not (Test-Path -LiteralPath $requiredTool)) {
        throw "缺少发布工具：$requiredTool"
    }
}

New-Item -ItemType Directory -Force -Path $workspaceTemp,$releaseRoot | Out-Null
if (-not $SkipBuild) {
    New-Item -ItemType Directory -Force -Path $resolvedBuildRoot | Out-Null
}
$env:TEMP = $workspaceTemp
$env:TMP = $workspaceTemp
$env:CARGO_HOME = $cargoHome
$env:RUSTUP_HOME = $rustupHome
$env:CARGO_TARGET_DIR = $resolvedBuildRoot
$env:npm_config_cache = Join-Path $sdkRoot "npm-cache"
$env:Path = "$projectRoot\node_modules\.bin;$nodeRoot;$rustToolchainBin;$cargoHome\bin;$env:Path"

Push-Location $projectRoot
try {
    if (-not $SkipBuild) {
        Write-Host "[1/6] 前端类型检查与生产构建"
        Invoke-Native -FilePath $node -Arguments @($tscCli)
        Invoke-Native -FilePath $node -Arguments @($viteCli, "build")

        Write-Host "[2/6] Skill 文档运行时 smoke"
        & (Join-Path $projectRoot "command\test-skill-document.ps1")
        $env:TEMP = $workspaceTemp
        $env:TMP = $workspaceTemp

        Write-Host "[3/6] Rust 格式、Clippy 与测试"
        Invoke-Native $cargo @(
            "fmt",
            "--manifest-path", $cargoManifestPath,
            "--", "--check"
        )
        Invoke-Native $cargo @(
            "clippy",
            "--manifest-path", $cargoManifestPath,
            "--all-targets",
            "--all-features",
            "--", "-D", "warnings"
        )
        Invoke-Native $cargo @(
            "test",
            "--manifest-path", $cargoManifestPath
        )

        Write-Host "[4/6] Tauri Windows x64 NSIS release 构建"
        Invoke-Native -FilePath $node -Arguments @(
            $tauriCli,
            "build",
            "--bundles", "nsis",
            "--ci",
            "--config", '{"build":{"beforeBuildCommand":""}}'
        )

        $bundleRoot = Join-Path $resolvedBuildRoot "release\bundle\nsis"
        $installer = Get-ChildItem -LiteralPath $bundleRoot -Filter "*setup.exe" -File |
            Sort-Object LastWriteTimeUtc -Descending |
            Select-Object -First 1
        $portable = Join-Path $resolvedBuildRoot "release\skill-agentmd-creator.exe"
        if (-not $installer) {
            throw "未找到 NSIS 安装包：$bundleRoot"
        }
        if (-not (Test-Path -LiteralPath $portable)) {
            throw "未找到 release 主程序：$portable"
        }

        Write-Host "[5/6] 固化发布资产与 SHA-256"
        Copy-Item -LiteralPath $installer.FullName -Destination $setupTarget -Force
        Copy-Item -LiteralPath $portable -Destination $portableTarget -Force
    } else {
        Write-Host "[1/6-5/6] 使用 release 目录中的已验证资产"
        foreach ($existingAsset in @($setupTarget, $portableTarget)) {
            if (-not (Test-Path -LiteralPath $existingAsset)) {
                throw "SkipBuild 缺少发布资产：$existingAsset"
            }
        }
    }

    $assetPaths = @($setupTarget, $portableTarget)
    $hashLines = foreach ($assetPath in $assetPaths) {
        $hash = Get-FileHash -LiteralPath $assetPath -Algorithm SHA256
        "$($hash.Hash.ToLowerInvariant())  $([IO.Path]::GetFileName($assetPath))"
    }
    [IO.File]::WriteAllLines($hashPath, $hashLines, [Text.UTF8Encoding]::new($false))

    $manifest = [ordered]@{
        product = "SkillCreator"
        version = $Version
        tag = $tag
        platform = "windows-x64"
        generatedAtUtc = [DateTime]::UtcNow.ToString("o")
        files = @(
            $assetPaths | ForEach-Object {
                $item = Get-Item -LiteralPath $_
                $hash = Get-FileHash -LiteralPath $_ -Algorithm SHA256
                [ordered]@{
                    name = $item.Name
                    bytes = $item.Length
                    sha256 = $hash.Hash.ToLowerInvariant()
                }
            }
        )
    }
    [IO.File]::WriteAllText(
        $manifestPath,
        ($manifest | ConvertTo-Json -Depth 6),
        [Text.UTF8Encoding]::new($false)
    )

    Write-Host "[6/6] 发布准备检查"
    $publishAssets = @($setupTarget, $portableTarget, $hashPath, $manifestPath)
    $publishAssets | ForEach-Object {
        $item = Get-Item -LiteralPath $_
        Write-Host ("asset={0} bytes={1}" -f $item.FullName,$item.Length)
    }

    if ($Publish) {
        if (-not $Apply) {
            Write-Host "dry-run: 将发布 $tag 到公开仓库 $Repository"
            Write-Host "重新运行时加入 -Publish -Apply 才会创建 GitHub Release。"
            return
        }

        Assert-ProjectGitRoot
        Assert-PublicRepository
        Invoke-Native "git" @("-C", $projectRoot, "diff", "--quiet")
        Invoke-Native "git" @("-C", $projectRoot, "diff", "--cached", "--quiet")

        $head = [string](& git -C $projectRoot rev-parse HEAD)
        $tagHead = [string](& git -C $projectRoot rev-list -n 1 $tag 2>$null)
        if ($LASTEXITCODE -ne 0 -or $tagHead.Trim() -ne $head.Trim()) {
            throw "标签 $tag 不存在或未指向当前 HEAD。"
        }

        & gh release view $tag --repo $Repository *> $null
        if ($LASTEXITCODE -eq 0) {
            throw "GitHub Release $tag 已存在，拒绝覆盖。"
        }

        Invoke-Native "gh" @(
            "release", "create", $tag,
            "--repo", $Repository,
            "--title", "SkillCreator $tag",
            "--notes-file", $releaseNotesPath,
            "--verify-tag",
            $setupTarget,
            $portableTarget,
            $hashPath,
            $manifestPath
        )
    }
} finally {
    Pop-Location
    if (-not $KeepBuildCache -and (Test-Path -LiteralPath $resolvedBuildRoot)) {
        $resolved = [IO.Path]::GetFullPath($resolvedBuildRoot)
        $allowedRoots = @(
            "D:\vibecoding\sdk\build-cache\",
            "H:\vibecoding\sdk\build-cache\"
        )
        $isAllowed = $allowedRoots | Where-Object {
            $resolved.StartsWith($_, [StringComparison]::OrdinalIgnoreCase)
        }
        if (-not $isAllowed -or [IO.Path]::GetFileName($resolved) -notlike "skillcreator-*") {
            throw "拒绝清理未通过安全校验的构建目录：$resolved"
        }
        Remove-Item -LiteralPath $resolved -Recurse -Force
        Write-Host "已清理本次构建缓存：$resolved"
    }
}
