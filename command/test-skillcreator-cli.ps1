[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$cli = Join-Path $PSScriptRoot "Invoke-SkillCreator.ps1"
$fixtureRoot = Join-Path $projectRoot (".tmp\skillcreator-cli-contract-test-{0}" -f [Guid]::NewGuid().ToString("N"))

New-Item -ItemType Directory -Force -Path $fixtureRoot | Out-Null
$listenerProbe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listenerProbe.Start()
$port = ([Net.IPEndPoint]$listenerProbe.LocalEndpoint).Port
$listenerProbe.Stop()
$baseUrl = "http://127.0.0.1:$port/api"

$canonical = @'
---
name: mock-skill
description: Use when a caller needs a normalized mock skill.
---

## Top Rules

1. Load only the partition required by the current task.

## Partition Index

- Rules and validation: `references/rules.md`
'@

$sample = @'
---
name: mock-skill
description: 当调用方需要规范化模拟技能时使用。
---

## 顶部规则

1. 仅加载当前任务所需的分区。

## 分区索引

- 规则与验证：`references/rules.md`
'@

$canonicalRules = @'
# Rules

## Rules

1. If input is present, MUST validate it before execution.
2. After execution, VERIFY the recorded result.

## Workflow
Validate, execute, then verify.

## Validation
Confirm the recorded result.
'@

$job = Start-Job -ScriptBlock {
    param($Port, $FixtureRoot, $Canonical, $Sample, $CanonicalRules)

    $listener = [Net.HttpListener]::new()
    $listener.Prefixes.Add("http://127.0.0.1:$Port/")
    $listener.Start()
    $designIndex = 0
    try {
        while ($listener.IsListening) {
            $shutdown = $false
            $context = $listener.GetContext()
            $request = $context.Request
            $path = $request.Url.AbsolutePath
            $body = ""
            if ($request.HasEntityBody) {
                $reader = [IO.StreamReader]::new($request.InputStream, $request.ContentEncoding)
                $body = $reader.ReadToEnd()
                $reader.Dispose()
            }

            $status = 200
            $payload = switch ("$($request.HttpMethod) $path") {
                "GET /api/health" {
                    @{ ok = $true; service = "mock-skillcreator"; dataDir = $FixtureRoot }
                    break
                }
                "GET /api/shutdown" {
                    $shutdown = $true
                    @{ ok = $true }
                    break
                }
                "POST /api/design_skill" {
                    $designIndex += 1
                    [IO.File]::WriteAllText(
                        (Join-Path $FixtureRoot "design-request-$designIndex.json"),
                        $body,
                        [Text.UTF8Encoding]::new($false)
                    )
                                        @{
                        assistantMessage = "规范设计完成"
                        markdown = $Canonical
                        files = @(
                            @{ path = "references/rules.md"; content = $CanonicalRules },
                            @{ path = "assets/check.ps1"; content = "Write-Output 'ok'`n" }
                        )
                        deletedFiles = @()
                        sampleMarkdown = $Sample
                        model = "mock-codex"
                    }
                    break
                }
                "POST /api/skills" {
                    $requestBody = $body | ConvertFrom-Json
                    [IO.File]::WriteAllText(
                        (Join-Path $FixtureRoot "create-request.json"),
                        $body,
                        [Text.UTF8Encoding]::new($false)
                    )
                    $requestSkillName = if ($requestBody.draft.name) { [string]$requestBody.draft.name } else { "mock-skill" }
                    $skillDirectory = Join-Path $FixtureRoot ("library\{0}" -f $requestSkillName)
                    New-Item -ItemType Directory -Force -Path $skillDirectory | Out-Null
                    $skillPath = Join-Path $skillDirectory "SKILL.md"
                    [IO.File]::WriteAllText(
                        $skillPath,
                        $requestBody.draft.sourceMarkdown,
                        [Text.UTF8Encoding]::new($false)
                    )
                    foreach ($file in @($requestBody.draft.files)) {
                        $target = Join-Path $skillDirectory ([string]$file.path)
                        New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
                        [IO.File]::WriteAllText($target, [string]$file.content, [Text.UTF8Encoding]::new($false))
                    }
                    @{
                        filePath = $skillPath
                        entryPath = (Join-Path $FixtureRoot "library\AGENTS.md")
                        content = $requestBody.draft.sourceMarkdown
                        writtenFiles = @("SKILL.md") + @($requestBody.draft.files | ForEach-Object { $_.path })
                    }
                    break
                }
                                "GET /api/skills/mock-library" {
                    $skillDirectory = Join-Path $FixtureRoot "library\mock-library"
                    $ruleDirectory = Join-Path $skillDirectory "rules"
                    New-Item -ItemType Directory -Force -Path $ruleDirectory | Out-Null
                    $skillPath = Join-Path $skillDirectory "SKILL.md"
                    $rulePath = Join-Path $ruleDirectory "core.md"
                    $initialSource = "---`nname: mock-library`ndescription: Use when a library fixture is needed.`n---`n`n## Top Rules`n`n1. Load only the required partition.`n`n## Partition Index`n`n- Rules: ``rules/core.md```n"
                    $initialRules = "# Core`n`n## Rules`n`n1. MUST validate library input before execution.`n"
                    if (-not (Test-Path -LiteralPath $skillPath -PathType Leaf)) {
                        [IO.File]::WriteAllText($skillPath, $initialSource, [Text.UTF8Encoding]::new($false))
                    }
                    if (-not (Test-Path -LiteralPath $rulePath -PathType Leaf)) {
                        [IO.File]::WriteAllText($rulePath, $initialRules, [Text.UTF8Encoding]::new($false))
                    }
                                        $currentSource = [IO.File]::ReadAllText($skillPath, [Text.Encoding]::UTF8)
                    $fileEntries = @(Get-ChildItem -LiteralPath $skillDirectory -Recurse -File | Sort-Object FullName | ForEach-Object {
                        $relative = [IO.Path]::GetRelativePath($skillDirectory, $_.FullName).Replace('\', '/')
                        $content = [IO.File]::ReadAllText($_.FullName, [Text.Encoding]::UTF8)
                        @{
                            path = $relative
                            content = $content
                            byteSize = $content.Length
                            isEntry = $relative.Equals('SKILL.md', [StringComparison]::OrdinalIgnoreCase)
                        }
                    })
                    @{
                        id = "mock-library"
                        name = "mock-library"
                        description = "Use when a library fixture is needed."
                        filePath = $skillPath
                        content = $currentSource
                        entryFile = "SKILL.md"
                        indexMode = @($fileEntries | Where-Object { -not $_.isEntry }).Count -gt 0
                        files = $fileEntries
                    }
                    break
                }
                "PUT /api/skills/mock-library" {
                    $requestBody = $body | ConvertFrom-Json
                    [IO.File]::WriteAllText(
                        (Join-Path $FixtureRoot "update-request.json"),
                        $body,
                        [Text.UTF8Encoding]::new($false)
                    )
                    $skillDirectory = Join-Path $FixtureRoot "library\mock-library"
                    New-Item -ItemType Directory -Force -Path $skillDirectory | Out-Null
                    $skillPath = Join-Path $skillDirectory "SKILL.md"
                    [IO.File]::WriteAllText($skillPath, $requestBody.draft.sourceMarkdown, [Text.UTF8Encoding]::new($false))
                    foreach ($file in @($requestBody.draft.files)) {
                        $target = Join-Path $skillDirectory ([string]$file.path)
                        New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
                        [IO.File]::WriteAllText($target, [string]$file.content, [Text.UTF8Encoding]::new($false))
                    }
                    foreach ($deleted in @($requestBody.draft.deletedFiles)) {
                        $target = Join-Path $skillDirectory ([string]$deleted)
                        if (Test-Path -LiteralPath $target -PathType Leaf) {
                            Remove-Item -Force -LiteralPath $target
                        }
                    }
                    @{
                        filePath = $skillPath
                        entryPath = (Join-Path $FixtureRoot "library\AGENTS.md")
                        content = $requestBody.draft.sourceMarkdown
                        writtenFiles = @("SKILL.md") + @($requestBody.draft.files | ForEach-Object { $_.path })
                    }
                    break
                }
                default {
                    $status = 404
                    @{ error = "unexpected request: $($request.HttpMethod) $path" }
                }
            }

            $json = $payload | ConvertTo-Json -Depth 20 -Compress
            $bytes = [Text.Encoding]::UTF8.GetBytes($json)
            $context.Response.StatusCode = $status
            $context.Response.ContentType = "application/json; charset=utf-8"
            $context.Response.ContentLength64 = $bytes.Length
            $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
            $context.Response.Close()
            if ($shutdown) {
                break
            }
        }
    } finally {
        $listener.Stop()
        $listener.Close()
    }
} -ArgumentList $port, $fixtureRoot, $canonical, $sample, $canonicalRules

try {
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
        try {
            $null = Invoke-RestMethod -Method Get -Uri "$baseUrl/health" -TimeoutSec 1
            $ready = $true
            break
        } catch {
            Start-Sleep -Milliseconds 100
        }
    }
    if (-not $ready) {
        throw "mock SkillCreator API did not start"
    }

    $create = & $cli `
        -Action design-create `
        -Prompt "请创建一个规范化模拟技能" `
        -BaseUrl $baseUrl `
        -NoStart | ConvertFrom-Json

    $externalDirectory = Join-Path $fixtureRoot "external-skill"
    New-Item -ItemType Directory -Force -Path $externalDirectory | Out-Null
    $externalSkill = Join-Path $externalDirectory "SKILL.md"
    [IO.File]::WriteAllText(
        $externalSkill,
        "---`nname: old-skill`ndescription: Use when an old fixture is needed.`n---`n`n# Old`n",
        [Text.UTF8Encoding]::new($false)
    )
    $sourceUpdate = & $cli `
        -Action design-source-update `
        -SourcePath $externalSkill `
        -Prompt "Normalize this existing skill." `
        -BaseUrl $baseUrl `
        -NoStart | ConvertFrom-Json

    $libraryUpdate = & $cli `
        -Action design-update `
        -SkillId "mock-library" `
        -Prompt "Normalize this library skill." `
        -BaseUrl $baseUrl `
        -NoStart | ConvertFrom-Json

    $bundleRoot = Join-Path $fixtureRoot "bundle-source"
    $bundleRuleDirectory = Join-Path $bundleRoot "rules"
    New-Item -ItemType Directory -Force -Path $bundleRuleDirectory | Out-Null
    [IO.File]::WriteAllText(
        (Join-Path $bundleRoot "SKILL.md"),
                "---`nname: bundle-skill`ndescription: Use when testing a multi-file bundle.`n---`n`n## Top Rules`n`n1. Load only the required partition.`n`n## Partition Index`n`n- Rules: ``rules/core.md```n",
        [Text.UTF8Encoding]::new($false)
    )
    [IO.File]::WriteAllText(
        (Join-Path $bundleRuleDirectory "core.md"),
        "# Core`n`n## Rules`n- [scope=cli] ALL(bundle requested) => MUST load only this block`n",
        [Text.UTF8Encoding]::new($false)
    )
    $bundleCreate = & $cli `
        -Action create `
        -SourcePath $bundleRoot `
        -BaseUrl $baseUrl `
        -NoStart | ConvertFrom-Json
        $fileIndex = & $cli `
        -Action files `
        -SkillId "mock-library" `
        -BaseUrl $baseUrl `
        -NoStart | ConvertFrom-Json

    $ruleText = "When SkillCreator changes a CLI-managed rule, it MUST preserve the stable rule identifier and VERIFY the fixed number remains unchanged."
    $ruleCheck = & $cli `
        -Action rule-check `
        -SkillId "mock-library" `
        -RuleText $ruleText `
        -BaseUrl $baseUrl `
        -NoStart | ConvertFrom-Json
    if (-not $ruleCheck.accepted) {
        throw "unique scoped rule should pass rule-check"
    }
    $ruleAdd = & $cli `
        -Action rule-add `
        -SkillId "mock-library" `
        -TargetFile "rules/core.md" `
        -RuleText $ruleText `
        -BaseUrl $baseUrl `
        -NoStart | ConvertFrom-Json
    if (-not $ruleAdd.applied -or -not $ruleAdd.id -or $ruleAdd.number -ne 2) {
        throw "rule-add did not allocate stable id and next fixed number"
    }
    $ruleFind = & $cli `
        -Action rule-find `
        -SkillId "mock-library" `
        -RuleId $ruleAdd.id `
        -BaseUrl $baseUrl `
        -NoStart | ConvertFrom-Json
    if ($ruleFind.count -ne 1 -or $ruleFind.rules[0].number -ne $ruleAdd.number -or $ruleFind.rules[0].path -ne "rules/core.md") {
        throw "rule-find did not resolve the CLI rule by stable id"
    }
    $duplicateAdd = & $cli `
        -Action rule-add `
        -SkillId "mock-library" `
        -TargetFile "rules/core.md" `
        -RuleText $ruleText `
        -BaseUrl $baseUrl `
        -NoStart | ConvertFrom-Json
    if (-not $duplicateAdd.rejected -or @($duplicateAdd.evaluation.duplicateOrOverlap).Count -eq 0) {
        throw "duplicate rule was not rejected"
    }
    $fluffCheck = & $cli `
        -Action rule-check `
        -SkillId "mock-library" `
                -RuleText "Do not hallucinate." `
        -BaseUrl $baseUrl `
        -NoStart | ConvertFrom-Json
    if ($fluffCheck.accepted -or -not $fluffCheck.evaluation.necessity.defaultBehavior) {
        throw "generic default secret-hygiene rule was not rejected as unnecessary"
    }
    $regressionUpdate = & $cli `
        -Action rule-update `
        -SkillId "mock-library" `
        -RuleId $ruleAdd.id `
        -RuleText "Update it." `
        -BaseUrl $baseUrl `
        -NoStart | ConvertFrom-Json
    if (-not $regressionUpdate.rejected -or -not $regressionUpdate.evaluation.regression.possibleRegression) {
        throw "rule-update did not reject a weakening replacement"
    }
    $updatedRuleText = "When SkillCreator changes a CLI-managed rule, it MUST preserve the stable rule identifier, preserve its fixed number, and VERIFY both after the update."
    $ruleUpdate = & $cli `
        -Action rule-update `
        -SkillId "mock-library" `
        -RuleId $ruleAdd.id `
        -RuleText $updatedRuleText `
        -BaseUrl $baseUrl `
        -NoStart | ConvertFrom-Json
    if (-not $ruleUpdate.applied -or $ruleUpdate.id -ne $ruleAdd.id -or $ruleUpdate.number -ne $ruleAdd.number) {
        throw "rule-update did not preserve stable id and fixed number"
    }

    $createRequest = Get-Content -Raw -LiteralPath (Join-Path $fixtureRoot "create-request.json") -Encoding utf8 | ConvertFrom-Json
    if (@($createRequest.draft.files).Count -ne 1 -or $createRequest.draft.files[0].path -ne "rules/core.md") {
        throw "multi-file create did not send rules/core.md as draft.files"
    }
    if (@($bundleCreate.writtenFiles) -notcontains "rules/core.md") {
        throw "multi-file create response did not report rules/core.md"
    }
        if (-not $fileIndex.indexMode -or @($fileIndex.files).Count -lt 2) {
        throw "files action did not expose the multi-file index contract"
    }

    $blockScalarRoot = Join-Path $fixtureRoot "block-scalar-source"
    New-Item -ItemType Directory -Force -Path $blockScalarRoot | Out-Null
    $blockScalarSource = @(
        "---",
        "name: block-scalar-skill",
        "description: |-",
        "  First line",
        "  second line",
        "custom: keep",
        "---",
        "",
        "# Block scalar"
    ) -join "`n"
    [IO.File]::WriteAllText(
        (Join-Path $blockScalarRoot "SKILL.md"),
        $blockScalarSource,
        [Text.UTF8Encoding]::new($false)
    )
    $null = & $cli -Action create -SourcePath $blockScalarRoot -BaseUrl $baseUrl -NoStart | ConvertFrom-Json
    $blockRequest = Get-Content -Raw -LiteralPath (Join-Path $fixtureRoot "create-request.json") -Encoding utf8 | ConvertFrom-Json
    if ($blockRequest.draft.description -ne "First line`nsecond line") {
        throw "block scalar description was not decoded losslessly: $($blockRequest.draft.description)"
    }
    if ($blockRequest.draft.sourceMarkdown -notmatch 'description: \|-' -or $blockRequest.draft.sourceMarkdown -notmatch 'custom: keep') {
        throw "block scalar sourceMarkdown was not preserved"
    }

    $indentedDelimiterSource = @(
        "---",
        "name: indented-delimiter-skill",
        "description: |-",
        "  First",
        "  ---",
        "  Last",
        "custom: keep",
        "---",
        "",
        "# Indented delimiter"
    ) -join "`n"
    [IO.File]::WriteAllText((Join-Path $blockScalarRoot "SKILL.md"), $indentedDelimiterSource, [Text.UTF8Encoding]::new($false))
    $null = & $cli -Action create -SourcePath $blockScalarRoot -BaseUrl $baseUrl -NoStart | ConvertFrom-Json
    $delimiterRequest = Get-Content -Raw -LiteralPath (Join-Path $fixtureRoot "create-request.json") -Encoding utf8 | ConvertFrom-Json
    if ($delimiterRequest.draft.description -ne "First`n---`nLast") {
        throw "indented YAML delimiter incorrectly closed frontmatter: $($delimiterRequest.draft.description)"
    }

    $foldedSource = @(
        "---",
        "name: folded-skill",
        "description: >-",
        "  first",
        "  second",
        "    code",
        "  third",
        "---",
        "",
        "# Folded"
    ) -join "`n"
    [IO.File]::WriteAllText((Join-Path $blockScalarRoot "SKILL.md"), $foldedSource, [Text.UTF8Encoding]::new($false))
    $null = & $cli -Action create -SourcePath $blockScalarRoot -BaseUrl $baseUrl -NoStart | ConvertFrom-Json
    $foldedRequest = Get-Content -Raw -LiteralPath (Join-Path $fixtureRoot "create-request.json") -Encoding utf8 | ConvertFrom-Json
    if ($foldedRequest.draft.description -ne "first second`n  code`nthird") {
        throw "folded YAML scalar lost more-indented semantics: $($foldedRequest.draft.description)"
    }

    $requests = Get-ChildItem -LiteralPath $fixtureRoot -Filter "design-request-*.json"
    if ($requests.Count -ne 3) {
        throw "expected three normative design requests, got $($requests.Count)"
    }
    foreach ($requestFile in $requests) {
        $requestBody = Get-Content -Raw -LiteralPath $requestFile.FullName -Encoding utf8 | ConvertFrom-Json
        if (-not $requestBody.normative -or -not $requestBody.includeChineseSample) {
            throw "design request did not enable normative bilingual output"
        }
    }

    foreach ($result in @($create, $sourceUpdate, $libraryUpdate)) {
        if ($result.canonicalLanguage -ne "en" -or $result.sampleLanguage -ne "zh-CN") {
            throw "language contract mismatch"
        }
        if ($result.defaultEntry -ne $result.canonicalPath) {
            throw "default entry must point to the English canonical SKILL.md"
        }
        if (-not (Test-Path -LiteralPath $result.canonicalPath -PathType Leaf)) {
            throw "canonical file missing: $($result.canonicalPath)"
        }
        if (-not (Test-Path -LiteralPath $result.samplePath -PathType Leaf)) {
            throw "Chinese sample missing: $($result.samplePath)"
        }
        $canonicalContent = Get-Content -Raw -LiteralPath $result.canonicalPath -Encoding utf8
        $sampleContent = Get-Content -Raw -LiteralPath $result.samplePath -Encoding utf8
                if ($canonicalContent -notmatch "## Top Rules" -or $canonicalContent -notmatch "## Partition Index") {
            throw "canonical skill is missing compact root routing sections: $($result.canonicalPath)"
        }
        if (@($result.files).Count -eq 0) {
            throw "normative design result did not report partition files"
        }
        if ($sampleContent -notmatch "[\u3400-\u9fff]") {
            throw "browse-only sample is not Chinese"
        }
    }

    $updateRoot = Join-Path $fixtureRoot "bundle-update-source"
    New-Item -ItemType Directory -Force -Path $updateRoot | Out-Null
        [IO.File]::WriteAllText((Join-Path $updateRoot "SKILL.md"), "---`nname: mock-library`ndescription: Use when updating a multi-file fixture.`n---`n`n## Top Rules`n`n1. Load only the required partition.`n`n## Partition Index`n`n- No indexed partitions yet.`n", [Text.UTF8Encoding]::new($false))
    $null = & $cli -Action update -SkillId "mock-library" -SourcePath $updateRoot -BaseUrl $baseUrl -NoStart | ConvertFrom-Json
    $updateRequest = Get-Content -Raw -LiteralPath (Join-Path $fixtureRoot "update-request.json") -Encoding utf8 | ConvertFrom-Json
    if (@($updateRequest.draft.files).Count -ne 0) {
        throw "directory update should not send removed child Markdown as draft.files"
    }
    if (@($updateRequest.draft.deletedFiles) -notcontains "rules/core.md") {
        throw "directory update did not synchronize removed rules/core.md through deletedFiles"
    }

    [ordered]@{
        ok = $true
        designRequests = $requests.Count
        createCanonical = $create.canonicalPath
        createSample = $create.samplePath
        sourceUpdateCanonical = $sourceUpdate.canonicalPath
        sourceUpdateSample = $sourceUpdate.samplePath
        libraryUpdateCanonical = $libraryUpdate.canonicalPath
        libraryUpdateSample = $libraryUpdate.samplePath
    } | ConvertTo-Json -Depth 4
} finally {
    try {
        $null = Invoke-RestMethod -Method Get -Uri "$baseUrl/shutdown" -TimeoutSec 2
    } catch {
    }
    $null = Wait-Job -Job $job -Timeout 5
    if ($job.State -notin @("Completed", "Failed", "Stopped")) {
        Stop-Job -Job $job -ErrorAction SilentlyContinue
    }
    Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
    $resolvedFixture = [IO.Path]::GetFullPath($fixtureRoot)
    $resolvedTempRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot ".tmp"))
    if ($resolvedFixture.StartsWith($resolvedTempRoot + [IO.Path]::DirectorySeparatorChar)) {
        Remove-Item -Recurse -Force -LiteralPath $resolvedFixture -ErrorAction SilentlyContinue
    }
}
