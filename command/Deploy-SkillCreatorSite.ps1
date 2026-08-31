[CmdletBinding()]
param(
    [ValidateSet('Check', 'Build', 'DryRun', 'Deploy')]
    [string]$Action = 'Check'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$configPath = Join-Path $projectRoot 'project\skillcreator-site-static\wrangler.jsonc'
$buildScript = Join-Path $PSScriptRoot 'Build-SkillCreatorSite.mjs'
$verifyScript = Join-Path $PSScriptRoot 'Verify-SkillCreatorSite.mjs'
$outputRoot = Join-Path $projectRoot 'release\skillcreator-site-static\web\release'
$deployStatusPath = Join-Path $projectRoot 'release\skillcreator-site-static\web\deploy-status.json'
$domain = 'skillcreator.nkbr.cc'
$wranglerVersion = '4.114.0'

function Resolve-SdkRoot {
    if ($env:VIBECODING_SDK_ROOT) {
        return [IO.Path]::GetFullPath($env:VIBECODING_SDK_ROOT)
    }
    foreach ($candidate in @('D:\vibecoding\sdk', 'H:\vibecoding\sdk')) {
        if (Test-Path -LiteralPath $candidate -PathType Container) {
            return $candidate
        }
    }
    throw '未找到 D: 或 H: 上的 vibecoding SDK。'
}

function Resolve-NodeTool {
    param(
        [Parameter(Mandatory)][string]$SdkRoot,
        [Parameter(Mandatory)][string]$Name
    )
    $sdkCandidate = Join-Path $SdkRoot "nodejs\$Name"
    if (Test-Path -LiteralPath $sdkCandidate -PathType Leaf) {
        return $sdkCandidate
    }
    return (Get-Command $Name -ErrorAction Stop).Source
}

function Invoke-Captured {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$WorkingDirectory
    )

    Push-Location $WorkingDirectory
    try {
        $lines = @(& $FilePath @Arguments 2>&1 | ForEach-Object { [string]$_ })
        $exitCode = $LASTEXITCODE
        foreach ($line in $lines) {
            Write-Output $line
        }
        if ($exitCode -ne 0) {
            throw "$FilePath exited with code $exitCode."
        }
        return @($lines)
    } finally {
        Pop-Location
    }
}

function Assert-Configuration {
    foreach ($path in @($configPath, $buildScript, $verifyScript)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "缺少静态发布输入：$path"
        }
    }

    $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8
    if (
        $config -notmatch '"pattern"\s*:\s*"skillcreator\.nkbr\.cc"' -or
        $config -notmatch '"custom_domain"\s*:\s*true' -or
        $config -notmatch '"directory"\s*:\s*"\.\.\/\.\.\/release\/skillcreator-site-static\/web\/release"'
    ) {
        throw "Cloudflare 配置未绑定 $domain 的静态产物目录。"
    }
}

function Ensure-Wrangler {
    param(
        [Parameter(Mandatory)][string]$SdkRoot,
        [Parameter(Mandatory)][string]$Npm
    )

    $wranglerRoot = Join-Path $SdkRoot 'cache\temp\skillcreator-release-site\wrangler'
    $wranglerCli = Join-Path $wranglerRoot 'node_modules\wrangler\bin\wrangler.js'
    if (Test-Path -LiteralPath $wranglerCli -PathType Leaf) {
        return $wranglerCli
    }

    New-Item -ItemType Directory -Path $wranglerRoot -Force | Out-Null
    $env:npm_config_cache = Join-Path $SdkRoot 'npm-cache'
    Invoke-Captured -FilePath $Npm -Arguments @(
        'install',
        '--prefix', $wranglerRoot,
        '--no-save',
        '--no-package-lock',
        "wrangler@$wranglerVersion"
    ) -WorkingDirectory $projectRoot | Out-Null

    if (-not (Test-Path -LiteralPath $wranglerCli -PathType Leaf)) {
        throw "Wrangler 安装完成但入口不存在：$wranglerCli"
    }
    return $wranglerCli
}

function Invoke-SourceVerification {
    param([Parameter(Mandatory)][string]$Node)
    Invoke-Captured -FilePath $Node -Arguments @($verifyScript) -WorkingDirectory $projectRoot | Out-Null
}

function Invoke-SiteBuildAndVerification {
    param([Parameter(Mandatory)][string]$Node)
    Invoke-Captured -FilePath $Node -Arguments @($buildScript) -WorkingDirectory $projectRoot | Out-Null
    Invoke-Captured -FilePath $Node -Arguments @(
        $verifyScript,
        '--root=release/skillcreator-site-static/web/release',
        '--require-release'
    ) -WorkingDirectory $projectRoot | Out-Null
}

Assert-Configuration
$sdkRoot = Resolve-SdkRoot
$node = Resolve-NodeTool -SdkRoot $sdkRoot -Name 'node.exe'
$npm = Resolve-NodeTool -SdkRoot $sdkRoot -Name 'npm.cmd'

Invoke-SourceVerification -Node $node
if ($Action -eq 'Check') {
    Write-Output 'verification=source-pass'
    return
}

Invoke-SiteBuildAndVerification -Node $node
Write-Output "release_output=$outputRoot"
if ($Action -eq 'Build') {
    return
}

$wranglerCli = Ensure-Wrangler -SdkRoot $sdkRoot -Npm $npm
if ($Action -eq 'DryRun') {
    Invoke-Captured -FilePath $node -Arguments @(
        $wranglerCli,
        'deploy',
        '--config', $configPath,
        '--dry-run'
    ) -WorkingDirectory $projectRoot | Out-Null
    Write-Output 'cloudflare_dry_run=pass'
    return
}

Invoke-Captured -FilePath $node -Arguments @(
    $wranglerCli,
    'whoami'
) -WorkingDirectory $projectRoot | Out-Null
$deployOutput = @(Invoke-Captured -FilePath $node -Arguments @(
    $wranglerCli,
    'deploy',
    '--config', $configPath
) -WorkingDirectory $projectRoot)

$versionId = ''
foreach ($line in $deployOutput) {
    $match = [regex]::Match($line, 'Current Version ID:\s*(?<id>[0-9a-f-]{36})', 'IgnoreCase')
    if ($match.Success) {
        $versionId = $match.Groups['id'].Value
        break
    }
}

$status = [ordered]@{
    status = 'deployed'
    domain = $domain
    url = "https://$domain"
    worker = 'skillcreator-release-site'
    versionId = $versionId
    deployedAt = [DateTime]::UtcNow.ToString('o')
}
New-Item -ItemType Directory -Path (Split-Path $deployStatusPath -Parent) -Force | Out-Null
[IO.File]::WriteAllText(
    $deployStatusPath,
    (($status | ConvertTo-Json -Depth 4) + [Environment]::NewLine),
    [Text.UTF8Encoding]::new($false)
)
Write-Output "site=https://$domain"
Write-Output "cloudflare_version=$versionId"
