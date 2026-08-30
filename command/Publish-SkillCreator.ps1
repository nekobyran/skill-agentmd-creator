param(
    [string]$Version = "1.0.0",
    [string]$Repository = "nekobyran/skill-agentmd-creator",
    [switch]$SkipBuild,
    [switch]$Publish,
    [switch]$Apply,
    [switch]$KeepBuildCache
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$flutterProject = Join-Path $projectRoot "project\skillcreator-flutter"
$rustProject = Join-Path $projectRoot "project\skillcreator-rust-server"
$runScript = Join-Path $projectRoot "command\run.ps1"
$releaseNotesPath = Join-Path $projectRoot "RELEASE_NOTES.md"
$tag = "v$Version"
$releaseRoot = Join-Path $projectRoot "release\skillcreator-flutter\windows\release"

$stageRoot = Join-Path $releaseRoot "SkillCreator-$tag-Windows-x64"
$zipTarget = Join-Path $releaseRoot "SkillCreator-$tag-Windows-x64-Portable.zip"
$hashPath = Join-Path $releaseRoot "SkillCreator-$tag-SHA256.txt"
$manifestPath = Join-Path $releaseRoot "SkillCreator-$tag-manifest.json"

function Resolve-SdkRoot {
    if ($env:VIBECODING_SDK_ROOT) {
        return [IO.Path]::GetFullPath($env:VIBECODING_SDK_ROOT)
    }
    foreach ($candidate in @("D:\vibecoding\sdk", "H:\vibecoding\sdk")) {
        if (Test-Path -LiteralPath $candidate -PathType Container) {
            return $candidate
        }
    }
    throw "未找到 D: 或 H: 上的 vibecoding SDK；可通过 VIBECODING_SDK_ROOT 指定。"
}

function Get-CargoVersion {
    param([Parameter(Mandatory)][string]$ManifestPath)
    $text = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8
    $match = [regex]::Match($text, '(?ms)^\[package\]\s*.*?^version\s*=\s*"(?<version>[^"]+)"')
    if (-not $match.Success) {
        throw "无法读取 Cargo package.version：$ManifestPath"
    }
    $match.Groups['version'].Value
}

function Get-FlutterVersion {
    param([Parameter(Mandatory)][string]$PubspecPath)
    $text = Get-Content -LiteralPath $PubspecPath -Raw -Encoding UTF8
    $match = [regex]::Match($text, '(?m)^version:\s*(?<version>[^\s+]+)(?:\+[^\s]+)?\s*$')
    if (-not $match.Success) {
        throw "无法读取 Flutter pubspec version：$PubspecPath"
    }
    $match.Groups['version'].Value
}

function Assert-VersionConsistency {
    $flutterVersion = Get-FlutterVersion -PubspecPath (Join-Path $flutterProject "pubspec.yaml")
    $rustVersion = Get-CargoVersion -ManifestPath (Join-Path $rustProject "Cargo.toml")
    if ($flutterVersion -ne $Version -or $rustVersion -ne $Version) {
        throw "版本号不一致，期望 $Version：pubspec.yaml=$flutterVersion Cargo.toml=$rustVersion"
    }
}

function Assert-PublicRepository {
    $visibility = & gh repo view $Repository --json visibility --jq '.visibility'
    if ($LASTEXITCODE -ne 0) {
        throw "无法读取 GitHub 仓库 $Repository。"
    }
    if ([string]$visibility -ne 'PUBLIC') {
        throw "拒绝发布：GitHub 仓库 $Repository 的 visibility 不是 PUBLIC。"
    }
}

function Assert-ProjectGitRoot {
    $actualRoot = (& git -C $projectRoot rev-parse --show-toplevel).Trim()
    if ($LASTEXITCODE -ne 0) {
        throw "项目尚未初始化独立 Git 仓库：$projectRoot"
    }
    if (-not [IO.Path]::GetFullPath($actualRoot).Equals($projectRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "拒绝发布：Git 根目录不是当前项目。actual=$actualRoot expected=$projectRoot"
    }
}

Assert-VersionConsistency
$sdkRoot = Resolve-SdkRoot
$cacheSdkRoot = if (Test-Path -LiteralPath "H:\vibecoding\sdk") { "H:\vibecoding\sdk" } else { $sdkRoot }
$bundleSource = Join-Path $cacheSdkRoot "build-cache\skillcreator-flutter-release\runner"
$rustBuild = Join-Path $cacheSdkRoot "build-cache\skillcreator-rust-release"

New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null

if (-not $SkipBuild) {
    Write-Host "[1/5] Release 全量构建与测试"
    & $runScript -BuildOnly -Configuration Release
} else {
    Write-Host "[1/5] 使用现有 Release 构建产物"
}

Write-Host "[2/5] 验证 Flutter portable bundle"
foreach ($required in @(
    (Join-Path $bundleSource "skillcreator_flutter.exe"),
    (Join-Path $bundleSource "skill_api_server.exe"),
    (Join-Path $bundleSource "flutter_windows.dll"),
    (Join-Path $bundleSource "data")
)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "发布 bundle 缺少文件：$required"
    }
}

Write-Host "[3/5] 固化 portable ZIP"
if (Test-Path -LiteralPath $stageRoot) {
    Remove-Item -LiteralPath $stageRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $stageRoot | Out-Null
Copy-Item -Path (Join-Path $bundleSource '*') -Destination $stageRoot -Recurse -Force
if (Test-Path -LiteralPath $zipTarget) {
    Remove-Item -LiteralPath $zipTarget -Force
}
Compress-Archive -Path (Join-Path $stageRoot '*') -DestinationPath $zipTarget -CompressionLevel Optimal

Write-Host "[4/5] 生成 SHA-256 与 manifest"
$zipHash = Get-FileHash -LiteralPath $zipTarget -Algorithm SHA256
$hashLine = "$($zipHash.Hash.ToLowerInvariant())  $([IO.Path]::GetFileName($zipTarget))"
[IO.File]::WriteAllText($hashPath, "$hashLine`n", [Text.UTF8Encoding]::new($false))
$bundleFiles = Get-ChildItem -LiteralPath $stageRoot -Recurse -File | ForEach-Object {
    $relative = [IO.Path]::GetRelativePath($stageRoot, $_.FullName).Replace('\', '/')
    $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
    [ordered]@{
        path = $relative
        bytes = $_.Length
        sha256 = $hash.Hash.ToLowerInvariant()
    }
}
$manifest = [ordered]@{
    product = 'SkillCreator'
    framework = 'Flutter'
    backend = 'Rust sidecar'
    version = $Version
    tag = $tag
    platform = 'windows-x64'
    generatedAtUtc = [DateTime]::UtcNow.ToString('o')
    portableArchive = [ordered]@{
        name = [IO.Path]::GetFileName($zipTarget)
        bytes = (Get-Item -LiteralPath $zipTarget).Length
        sha256 = $zipHash.Hash.ToLowerInvariant()
    }
    bundleFiles = @($bundleFiles)
}
[IO.File]::WriteAllText(
    $manifestPath,
    ($manifest | ConvertTo-Json -Depth 8),
    [Text.UTF8Encoding]::new($false)
)

Write-Host "[5/5] 发布准备检查"
$publishAssets = @($zipTarget, $hashPath, $manifestPath)
foreach ($asset in $publishAssets) {
    $item = Get-Item -LiteralPath $asset
    Write-Host ("asset={0} bytes={1}" -f $item.FullName, $item.Length)
}

if ($Publish) {
    if (-not $Apply) {
        Write-Host "dry-run: 将发布 $tag 到公开仓库 $Repository"
        Write-Host "重新运行时加入 -Publish -Apply 才会创建 GitHub Release。"
    } else {
        Assert-ProjectGitRoot
        Assert-PublicRepository
        & git -C $projectRoot diff --quiet
        if ($LASTEXITCODE -ne 0) { throw '工作区存在未提交改动，拒绝发布。' }
        & git -C $projectRoot diff --cached --quiet
        if ($LASTEXITCODE -ne 0) { throw '暂存区存在未提交改动，拒绝发布。' }

        $head = [string](& git -C $projectRoot rev-parse HEAD)
        $tagHead = [string](& git -C $projectRoot rev-list -n 1 $tag 2>$null)
        if ($LASTEXITCODE -ne 0 -or $tagHead.Trim() -ne $head.Trim()) {
            throw "标签 $tag 不存在或未指向当前 HEAD。"
        }
        & gh release view $tag --repo $Repository *> $null
        if ($LASTEXITCODE -eq 0) {
            throw "GitHub Release $tag 已存在，拒绝覆盖。"
        }
        & gh release create $tag --repo $Repository --title "SkillCreator $tag" --notes-file $releaseNotesPath --verify-tag $zipTarget $hashPath $manifestPath
        if ($LASTEXITCODE -ne 0) {
            throw "GitHub Release $tag 创建失败。"
        }
    }
}

if (-not $KeepBuildCache -and -not $SkipBuild) {
    foreach ($cache in @(
                (Join-Path $cacheSdkRoot "build-cache\skillcreator-flutter-release"),
        $rustBuild
    )) {
        if (Test-Path -LiteralPath $cache) {
            $resolved = [IO.Path]::GetFullPath($cache)
                        $safePrefix = [IO.Path]::GetFullPath((Join-Path $cacheSdkRoot 'build-cache')) + [IO.Path]::DirectorySeparatorChar

            if (-not $resolved.StartsWith($safePrefix, [StringComparison]::OrdinalIgnoreCase)) {
                throw "拒绝清理非 SDK build-cache：$resolved"
            }
            Remove-Item -LiteralPath $resolved -Recurse -Force
            Write-Host "已清理本次 Release 构建缓存：$resolved"
        }
    }
}
