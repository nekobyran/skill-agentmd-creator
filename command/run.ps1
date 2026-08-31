param(
    [switch]$BuildOnly,
    [switch]$Sidebar,
    [switch]$SkipBuild,
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Debug'
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$sdkRoot = if (Test-Path -LiteralPath "D:\vibecoding\sdk") { "D:\vibecoding\sdk" } else { "H:\vibecoding\sdk" }
$cacheSdkRoot = if (Test-Path -LiteralPath "H:\vibecoding\sdk") { "H:\vibecoding\sdk" } else { $sdkRoot }
$flutterProject = Join-Path $root "project\skillcreator-flutter"
$rustProject = Join-Path $root "project\skillcreator-rust-server"
$flutterRoot = Join-Path $sdkRoot "flutter"
$flutterDart = Join-Path $flutterRoot "bin\cache\dart-sdk\bin\dart.exe"
$flutterToolSnapshot = Join-Path $flutterRoot "bin\cache\flutter_tools.snapshot"
$flutterToolPackages = Join-Path $flutterRoot "packages\flutter_tools\.dart_tool\package_config.json"
$cargoHome = Join-Path $sdkRoot "rust\cargo"
$rustupHome = Join-Path $sdkRoot "rust\rustup"
$rustToolchainBin = Join-Path $rustupHome "toolchains\stable-x86_64-pc-windows-msvc\bin"
$cargo = Join-Path $rustToolchainBin "cargo.exe"
$rustc = Join-Path $rustToolchainBin "rustc.exe"
$rustdoc = Join-Path $rustToolchainBin "rustdoc.exe"
$buildTools = Join-Path $sdkRoot "visual-studio-build-tools-complete"
$vcvars = Join-Path $buildTools "VC\Auxiliary\Build\vcvars64.bat"
$cmake = Join-Path $buildTools "Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
$ninja = Join-Path $buildTools "Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe"
$windowsSdkVersion = "10.0.26100.0"
$windowsSdkRoot = "H:\vibecoding\sdk\windows-sdk-$windowsSdkVersion"
$windowsSdkInclude = Join-Path $windowsSdkRoot "Include"
$windowsSdkLib = Join-Path $windowsSdkRoot "Lib"
$windowsSdkBin = Join-Path $windowsSdkRoot "Bin"
$configurationKey = $Configuration.ToLowerInvariant()
$flutterBuild = Join-Path $cacheSdkRoot "build-cache\skillcreator-flutter-$configurationKey"
$rustBuild = Join-Path $cacheSdkRoot "build-cache\skillcreator-rust-$configurationKey"
$rustProfile = if ($Configuration -eq 'Release') { 'release' } else { 'debug' }
$appBundle = Join-Path $flutterBuild "runner"
$appExe = Join-Path $appBundle "skillcreator_flutter.exe"
$rustExe = Join-Path $rustBuild "$rustProfile\skill_api_server.exe"
$sidecarExe = Join-Path $appBundle "skill_api_server.exe"
$cliRelease = Join-Path $root "release\skillcreator-rust-server\windows\$configurationKey"

$cliApiExe = Join-Path $cliRelease "skill_api_server.exe"
$workspaceTemp = Join-Path $cacheSdkRoot "tmp\skillcreator-run"
$pubCache = Join-Path $cacheSdkRoot "pub-cache"
$runtimeHome = Join-Path $cacheSdkRoot "runtime-home"
$appData = Join-Path $runtimeHome "AppData\Roaming"
$localAppData = Join-Path $runtimeHome "AppData\Local"

function Invoke-Native {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [Parameter(Mandatory)][string[]]$Arguments
    )

    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.WorkingDirectory = (Get-Location).Path
    [void]$startInfo.Environment.Remove('Path')
    [void]$startInfo.Environment.Remove('PATH')
    $childPath = if ($script:nativePath) { $script:nativePath } else { $env:Path }
    $startInfo.Environment['PATH'] = $childPath
    $startInfo.Environment['SystemRoot'] = $env:SystemRoot
    $startInfo.Environment['PATHEXT'] = '.COM;.EXE;.BAT;.CMD'
    $startInfo.Environment['PUB_CACHE'] = $pubCache
    $startInfo.Environment['HOME'] = $runtimeHome
    $startInfo.Environment['USERPROFILE'] = $runtimeHome
    $startInfo.Environment['APPDATA'] = $appData
    $startInfo.Environment['LOCALAPPDATA'] = $localAppData
    $startInfo.Environment['TEMP'] = $env:TEMP
    $startInfo.Environment['TMP'] = $env:TMP
    foreach ($name in @(
        'INCLUDE', 'LIB', 'LIBPATH', 'VCINSTALLDIR', 'VCToolsInstallDir',
        'VSINSTALLDIR', 'WindowsSdkDir', 'WindowsSDKVersion',
        'UniversalCRTSdkDir', 'UCRTVersion'
    )) {
        $value = [Environment]::GetEnvironmentVariable($name)
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            $startInfo.Environment[$name] = $value
        }
    }

    $extension = [IO.Path]::GetExtension($FilePath)
    if ($extension.Equals('.bat', [StringComparison]::OrdinalIgnoreCase) -or
        $extension.Equals('.cmd', [StringComparison]::OrdinalIgnoreCase)) {
        $startInfo.FileName = (Get-Command cmd.exe -ErrorAction Stop).Source
        [void]$startInfo.ArgumentList.Add('/d')
        [void]$startInfo.ArgumentList.Add('/s')
        [void]$startInfo.ArgumentList.Add('/c')
        $parts = @('call', $FilePath)
        foreach ($argument in $Arguments) {
            if ($argument -match '[\s&|<>^()]') {
                $parts += '"' + ($argument -replace '"', '""') + '"'
            } else {
                $parts += $argument
            }
        }
        [void]$startInfo.ArgumentList.Add(($parts -join ' '))
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
        $stdout = $stdoutTask.GetAwaiter().GetResult()
        $stderr = $stderrTask.GetAwaiter().GetResult()
        if ($stdout) { Write-Host $stdout.TrimEnd() }
        if ($stderr) { Write-Host $stderr.TrimEnd() }
        if ($process.ExitCode -ne 0) {
            throw "$FilePath failed with exit code $($process.ExitCode)"
        }
    } finally {
        $process.Dispose()
    }
}

function Invoke-Flutter {
    param([Parameter(Mandatory)][string[]]$Arguments)
    $flutterArguments = @("--packages=$flutterToolPackages", $flutterToolSnapshot) + $Arguments
    Invoke-Native -FilePath $flutterDart -Arguments $flutterArguments
}

function Import-VcVars {
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = (Get-Command cmd.exe -ErrorAction Stop).Source
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    [void]$startInfo.ArgumentList.Add('/d')
    [void]$startInfo.ArgumentList.Add('/s')
    [void]$startInfo.ArgumentList.Add('/c')
    [void]$startInfo.ArgumentList.Add("call $vcvars >nul && set")

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    try {
        [void]$process.Start()
        $stdout = $process.StandardOutput.ReadToEnd()
        $stderr = $process.StandardError.ReadToEnd()
        $process.WaitForExit()
        if ($process.ExitCode -ne 0) {
            throw "无法加载 MSVC 环境：$vcvars`n$stderr"
        }
        $lines = $stdout -split "\r?\n"
    } finally {
        $process.Dispose()
    }

    foreach ($line in $lines) {
        if (-not $line -or $line.StartsWith("=")) {
            continue
        }
        $separator = $line.IndexOf('=')
        if ($separator -le 0) {
            continue
        }
        $name = $line.Substring(0, $separator)
        $value = $line.Substring($separator + 1)
        Set-Item -Path "Env:$name" -Value $value
    }
}

function Stop-ExactExecutable {
    param([Parameter(Mandatory)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return
    }
    $expected = [IO.Path]::GetFullPath($Path)
    Get-Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Path -and [IO.Path]::GetFullPath($_.Path).Equals(
                $expected,
                [StringComparison]::OrdinalIgnoreCase
            )
        } |
        ForEach-Object {
            Stop-Process -Id $_.Id -Force
            Wait-Process -Id $_.Id -Timeout 10 -ErrorAction SilentlyContinue
        }
}

foreach ($required in @(
    $flutterDart, $flutterToolSnapshot, $flutterToolPackages,
    $cargo, $rustc, $rustdoc, $vcvars, $cmake, $ninja,
    (Join-Path $windowsSdkInclude "ucrt\stddef.h"),
    (Join-Path $windowsSdkInclude "um\Windows.h"),
    (Join-Path $windowsSdkLib "ucrt\x64\ucrt.lib"),
    (Join-Path $windowsSdkLib "um\x64\kernel32.lib"),
    (Join-Path $windowsSdkBin "rc.exe")
)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "缺少 D/H 盘构建工具：$required"
    }
}
foreach ($requiredDirectory in @($flutterProject, $rustProject, $windowsSdkRoot)) {
    if (-not (Test-Path -LiteralPath $requiredDirectory -PathType Container)) {
        throw "缺少迁移后的工程或 SDK 目录：$requiredDirectory"
    }
}

New-Item -ItemType Directory -Force -Path $workspaceTemp,$flutterBuild,$rustBuild,$cliRelease,$pubCache,$appData,$localAppData | Out-Null
$env:TEMP = $workspaceTemp
$env:PUB_CACHE = $pubCache
$env:HOME = $runtimeHome
$env:USERPROFILE = $runtimeHome
$env:APPDATA = $appData
$env:LOCALAPPDATA = $localAppData
$env:TMP = $workspaceTemp
$env:CARGO_HOME = $cargoHome
$env:RUSTUP_HOME = $rustupHome
$env:RUSTUP_TOOLCHAIN = "stable-x86_64-pc-windows-msvc"
$env:RUSTC = $rustc
$env:RUSTDOC = $rustdoc
$env:CARGO_TARGET_DIR = $rustBuild
$env:CARGO_INCREMENTAL = "0"
$env:VSLANG = "1033"
$env:PreferredUILang = "en-US"
$env:LANG = "en_US.UTF-8"
$env:LC_ALL = "en_US.UTF-8"
$originalPath = $env:Path
Import-VcVars
if ([string]::IsNullOrWhiteSpace($env:VCToolsInstallDir)) {
    throw "vcvars64 未返回 VCToolsInstallDir：$vcvars"
}
$msvcInclude = Join-Path $env:VCToolsInstallDir "include"
$msvcLib = Join-Path $env:VCToolsInstallDir "lib\x64"
$vcAuxInclude = Join-Path $buildTools "VC\Auxiliary\VS\include"
$env:INCLUDE = @(
    $msvcInclude,
    $vcAuxInclude,
    (Join-Path $windowsSdkInclude "ucrt"),
    (Join-Path $windowsSdkInclude "um"),
    (Join-Path $windowsSdkInclude "shared"),
    (Join-Path $windowsSdkInclude "winrt"),
    (Join-Path $windowsSdkInclude "cppwinrt")
) -join ';'
$env:LIB = @(
    $msvcLib,
    (Join-Path $windowsSdkLib "ucrt\x64"),
    (Join-Path $windowsSdkLib "um\x64")
) -join ';'
$env:LIBPATH = $msvcLib
$env:WindowsSdkDir = "$windowsSdkRoot\"
$env:WindowsSDKVersion = "$windowsSdkVersion\"
$env:UniversalCRTSdkDir = "$windowsSdkRoot\"
$env:UCRTVersion = $windowsSdkVersion
$vcPath = (($env:Path -split ';') | Where-Object {
    $_ -and
    $_ -notlike 'C:\Program Files (x86)\Windows Kits\*' -and
    $_ -notlike '*\WindowsApps*'
}) -join ';'
$basePath = (($originalPath -split ';') | Where-Object {
    $_ -and
    $_ -notlike 'C:\Program Files (x86)\Windows Kits\*' -and
    $_ -notlike '*\WindowsApps*'
}) -join ';'
$windowsPowerShell = 'C:\Windows\System32\WindowsPowerShell\v1.0'
$script:nativePath = "$windowsSdkBin;$rustToolchainBin;$(Split-Path $ninja -Parent);$(Split-Path $cmake -Parent);$cargoHome\bin;$windowsPowerShell;C:\Windows\System32;C:\Program Files\Git\mingw64\bin;$vcPath;$basePath"
$env:Path = $script:nativePath

if ($SkipBuild) {
    foreach ($artifact in @($appExe, $sidecarExe, $cliApiExe)) {
        if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) {
            throw "SkipBuild 缺少已验证产物：$artifact"
        }
    }
    Write-Host "使用现有 Flutter + Rust 产物，跳过构建。"
} else {
    Stop-ExactExecutable -Path $appExe
    Stop-ExactExecutable -Path $sidecarExe
    Stop-ExactExecutable -Path $cliApiExe

    Write-Host "[1/4] Flutter 依赖与静态检查"
    Push-Location $flutterProject
    try {
        Invoke-Flutter @("pub", "get")
        Invoke-Flutter @("analyze")
        Invoke-Flutter @("test")
    } finally {
        Pop-Location
    }

            Write-Host "[2/4] Rust 格式、测试、Clippy 与 API 构建"
    $manifestPath = Join-Path $rustProject "Cargo.toml"
    Invoke-Native $cargo @("fmt", "--manifest-path", $manifestPath, "--", "--check")
    Invoke-Native $cargo @("test", "--manifest-path", $manifestPath)
    Invoke-Native $cargo @("clippy", "--manifest-path", $manifestPath, "--all-targets", "--", "-D", "warnings")
    $cargoArguments = @("build", "--manifest-path", $manifestPath)
    if ($Configuration -eq 'Release') {
        $cargoArguments += '--release'
    }
    Invoke-Native $cargo $cargoArguments


    Write-Host "[3/4] Flutter Windows Ninja 构建"
    Invoke-Native $cmake @(
        "-S", (Join-Path $flutterProject "windows"),
        "-B", $flutterBuild,
        "-G", "Ninja",
                "-DCMAKE_BUILD_TYPE=$Configuration",
        "-DCMAKE_INSTALL_PREFIX=$appBundle",
        "-DCMAKE_MAKE_PROGRAM=$ninja",
        "-DCMAKE_C_COMPILER=cl.exe",
        "-DCMAKE_CXX_COMPILER=cl.exe"
    )
    Invoke-Native $cmake @("--build", $flutterBuild, "--config", $Configuration)
    Invoke-Native $cmake @("--install", $flutterBuild, "--config", $Configuration)

    Write-Host "[4/4] 固化 Rust sidecar 与 CLI 后台"
    Copy-Item -LiteralPath $rustExe -Destination $sidecarExe -Force
    Copy-Item -LiteralPath $rustExe -Destination $cliApiExe -Force
}

if ($BuildOnly) {
    Write-Host "BuildOnly 完成：$appExe"
    Write-Host "Rust sidecar：$sidecarExe"
    Write-Host "CLI backend：$cliApiExe"
    return
}

$appArguments = @()
if ($Sidebar) {
    $appArguments += "--sidebar"
}
$process = Start-Process -FilePath $appExe -ArgumentList $appArguments -WorkingDirectory $appBundle -PassThru
Write-Host "已启动 Flutter SkillCreator，PID=$($process.Id)"
