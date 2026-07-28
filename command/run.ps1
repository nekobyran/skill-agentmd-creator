param(
    [switch]$BuildOnly,
    [switch]$Sidebar,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$sdkRoot = "D:\vibecoding\sdk"
$nodeRoot = Join-Path $sdkRoot "nodejs"
$rustRoot = Join-Path $sdkRoot "rust"
$cargoHome = Join-Path $rustRoot "cargo"
$rustupHome = Join-Path $rustRoot "rustup"
$npmCache = Join-Path $sdkRoot "npm-cache"
$npm = Join-Path $nodeRoot "npm.cmd"
$node = Join-Path $nodeRoot "node.exe"
$cargo = Join-Path $cargoHome "bin\cargo.exe"
$workspaceTemp = Join-Path $root ".tmp"
$cargoManifest = Join-Path $root "src-tauri\Cargo.toml"
$appExe = Join-Path $root "src-tauri\target\debug\skill-agentmd-creator.exe"
$apiExe = Join-Path $root "src-tauri\target\debug\skill_api_server.exe"
$vitePort = 1420
$apiPort = 1421

if (-not (Test-Path $npm)) {
    throw "未找到 D 盘 Node SDK：$npm"
}
if (-not (Test-Path $node)) {
    throw "未找到 D 盘 Node 运行时：$node"
}
if (-not (Test-Path $cargo)) {
    throw "未找到 D 盘 Rust SDK：$cargo"
}

New-Item -ItemType Directory -Force -Path $workspaceTemp,$npmCache | Out-Null
$env:TEMP = $workspaceTemp
$env:TMP = $workspaceTemp
$env:CARGO_HOME = $cargoHome
$env:RUSTUP_HOME = $rustupHome
$env:npm_config_cache = $npmCache
$env:Path = "$nodeRoot;$($cargoHome)\bin;$env:Path"


function Invoke-Native {
    param(
        [string]$FilePath,
        [string[]]$Arguments
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath failed with exit code $LASTEXITCODE"
    }
}

function Test-Port {
    param([int]$Port)
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(300)) {
            return $false
        }
        $client.EndConnect($async)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

function Wait-Port {
    param([int]$Port)
    for ($i = 0; $i -lt 40; $i++) {
        if (Test-Port $Port) {
            return
        }
        Start-Sleep -Milliseconds 500
    }
    throw "Vite dev server 未在 127.0.0.1:$Port 启动"
}

function Wait-HttpEndpoint {
    param(
        [string]$Uri,
        [string]$Label
    )
    for ($i = 0; $i -lt 40; $i++) {
        try {
            $response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 1
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
                return
            }
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    throw "$Label 未在 $Uri 启动"
}

function Stop-WorkspaceListener {
    param(
        [int]$Port,
        [string]$ExpectedExecutable,
        [string]$CommandNeedle = ""
    )

    $connection = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($null -eq $connection) {
        return
    }

    $process = Get-Process -Id $connection.OwningProcess -ErrorAction Stop
    $actualPath = [IO.Path]::GetFullPath($process.Path)
    $expectedPath = [IO.Path]::GetFullPath($ExpectedExecutable)
    if (-not $actualPath.Equals($expectedPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw "端口 $Port 被其他程序占用：PID=$($process.Id), Path=$actualPath"
    }

    if ($CommandNeedle) {
        $commandLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$($process.Id)").CommandLine
        if ([string]::IsNullOrWhiteSpace($commandLine) -or
            $commandLine.IndexOf($CommandNeedle, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
            throw "端口 $Port 的进程不属于当前工程：PID=$($process.Id)"
        }
    }

    Stop-Process -Id $process.Id -Force
    for ($i = 0; $i -lt 20; $i++) {
        if (-not (Test-Port $Port)) {
            return
        }
        Start-Sleep -Milliseconds 150
    }
    throw "当前工程旧进程未能释放端口 $Port"
}

Push-Location $root
try {
    if ($SkipBuild) {
        $distIndex = Join-Path $root "dist\index.html"
        foreach ($requiredArtifact in @($distIndex, $appExe, $apiExe)) {
            if (-not (Test-Path $requiredArtifact)) {
                throw "SkipBuild 缺少已验证产物：$requiredArtifact"
            }
        }
        Write-Host "[1/4-3/4] 使用现有已验证产物，跳过重复构建"
    } else {
        Write-Host "[1/4] 安装前端依赖..."
        if (-not (Test-Path (Join-Path $root "node_modules"))) {
            Invoke-Native $npm @("install")
        } else {
            Write-Host "node_modules 已存在，跳过 npm install"
        }

        Write-Host "[2/4] 构建 React/Tailwind 前端..."
        Invoke-Native $npm @("run", "build")

        Write-Host "[3/4] 构建 Tauri Rust 桌面壳..."
        Invoke-Native $cargo @("build", "--manifest-path", $cargoManifest)
    }

    if ($BuildOnly) {
        Write-Host "BuildOnly 完成：$appExe"
        return
    }

    if (-not (Test-Path $appExe)) {
        throw "未生成 Tauri 可执行文件：$appExe"
    }

    Write-Host "[4/4] 启动 Rust API + Vite + Tauri 窗口..."
    if (-not (Test-Path $apiExe)) {
        throw "未生成 API 后台可执行文件：$apiExe"
    }

    Stop-WorkspaceListener -Port $apiPort -ExpectedExecutable $apiExe
    $apiOut = Join-Path $env:TEMP "skill-agentmd-creator-api.out.log"
    $apiErr = Join-Path $env:TEMP "skill-agentmd-creator-api.err.log"
    $apiProcess = Start-Process -FilePath $apiExe -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $apiOut -RedirectStandardError $apiErr -PassThru
    Wait-HttpEndpoint -Uri "http://127.0.0.1:$apiPort/api/health" -Label "Rust API backend"
    Write-Host "Rust API backend PID=$($apiProcess.Id)"

    Stop-WorkspaceListener -Port $vitePort -ExpectedExecutable $node -CommandNeedle $root
    $viteOut = Join-Path $env:TEMP "skill-agentmd-creator-vite.out.log"
    $viteErr = Join-Path $env:TEMP "skill-agentmd-creator-vite.err.log"
    $viteProcess = Start-Process -FilePath $npm -ArgumentList @("run", "dev") -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $viteOut -RedirectStandardError $viteErr -PassThru
    Wait-Port $vitePort
    Write-Host "Vite dev server PID=$($viteProcess.Id)"

    $appArgs = @()
    if ($Sidebar) {
        $appArgs += "--sidebar"
    }
    $process = Start-Process -FilePath $appExe -ArgumentList $appArgs -WorkingDirectory $root -PassThru
    Write-Host "已启动 Skill Agentmd Creator，PID=$($process.Id)"
} finally {
    Pop-Location
}
