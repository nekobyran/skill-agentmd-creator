[CmdletBinding()]
param(
    [ValidateSet(
        "health",
        "catalog",
        "audit",
        "load",
        "list",
        "read",
        "files",
        "create",
        "update",
                "design-create",
        "design-update",
        "design-source-update",
        "rule-check",
        "rule-find",
        "rule-add",
        "rule-update"
    )]
    [string]$Action = "health",
    [string[]]$Id = @(),
    [string]$SkillId = "",
    [string]$SourcePath = "",
    [string]$Prompt = "",
    [string]$Name = "",
    [string]$Description = "",
    [string]$ReportPath = "",
    [string]$TargetFile = "",
    [string]$RuleId = "",
    [int]$RuleNumber = 0,
    [string]$RuleText = "",
    [switch]$Force,
    [string]$BaseUrl = "http://127.0.0.1:1421/api",
    [switch]$NoStart
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$apiExecutable = Join-Path $projectRoot "release\skillcreator-rust-server\windows\debug\skill_api_server.exe"
$normalizedBaseUrl = $BaseUrl.TrimEnd("/")

function Invoke-Api {
    param(
        [Parameter(Mandatory)]
        [ValidateSet("GET", "POST", "PUT", "DELETE")]
        [string]$Method,
        [Parameter(Mandatory)]
        [string]$Path,
        [object]$Body
    )

    $parameters = @{
        Method = $Method
        Uri = "$normalizedBaseUrl$Path"
        TimeoutSec = 300
    }
    if ($PSBoundParameters.ContainsKey("Body")) {
        $parameters.ContentType = "application/json; charset=utf-8"
        $parameters.Body = $Body | ConvertTo-Json -Depth 100 -Compress
    }
    Invoke-RestMethod @parameters
}

function Test-Api {
    try {
        $null = Invoke-RestMethod -Method Get -Uri "$normalizedBaseUrl/health" -TimeoutSec 1
        return $true
    } catch {
        return $false
    }
}

function Ensure-Api {
    if (Test-Api) {
        return
    }
    if ($NoStart) {
        throw "SkillCreator API 未运行：$normalizedBaseUrl"
    }
    if (-not (Test-Path -LiteralPath $apiExecutable -PathType Leaf)) {
        throw "缺少无窗口 API 后台：$apiExecutable。先构建 skill_api_server 并复制到 CLI release 目录。"
    }

    $process = Start-Process `
        -FilePath $apiExecutable `
        -WorkingDirectory $projectRoot `
        -WindowStyle Hidden `
        -PassThru

    for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
        if (Test-Api) {
            return
        }
        if ($process.HasExited) {
            throw "SkillCreator API 启动失败，退出码：$($process.ExitCode)"
        }
        Start-Sleep -Milliseconds 250
    }
    throw "SkillCreator API 启动超时：$normalizedBaseUrl"
}

function Convert-YamlBlockScalar {
    param(
        [Parameter(Mandatory)][string[]]$Lines,
        [Parameter(Mandatory)][ValidateSet('|', '>')][string]$Style,
        [string]$Modifiers = ""
    )

    $explicitIndent = 0
    if ($Modifiers -match '[1-9]') {
        $explicitIndent = [int]$Matches[0]
    }
    $indent = $explicitIndent
    if ($indent -eq 0) {
        $indents = @($Lines | Where-Object { $_.Trim().Length -gt 0 } | ForEach-Object {
            ([regex]::Match($_, '^[ \t]*')).Value.Length
        })
        if ($indents.Count -gt 0) {
            $indent = ($indents | Measure-Object -Minimum).Minimum
        }
    }
    $normalized = @()
    $moreIndented = @()
    foreach ($line in $Lines) {
        $leading = ([regex]::Match($line, '^[ \t]*')).Value.Length
        $isMoreIndented = $line.Trim().Length -gt 0 -and $leading -gt $indent
        $normalized += if ($indent -gt 0 -and $line.Length -ge $indent) {
            $line.Substring($indent)
        } else {
            $line
        }
        $moreIndented += $isMoreIndented
    }

    if ($Style -eq '|') {
        $value = $normalized -join "`n"
    } else {
        $builder = [Text.StringBuilder]::new()
        for ($index = 0; $index -lt $normalized.Count; $index += 1) {
            [void]$builder.Append($normalized[$index])
            if ($index -lt $normalized.Count - 1) {
                if (
                    -not $normalized[$index] -or
                    -not $normalized[$index + 1] -or
                    $moreIndented[$index] -or $moreIndented[$index + 1]
                ) {
                    [void]$builder.Append("`n")
                } else {
                    [void]$builder.Append(' ')
                }
            }
        }
        $value = $builder.ToString()
    }

    if ($Modifiers.Contains('-')) {
        return $value.TrimEnd("`r", "`n")
    }
    if ($Modifiers.Contains('+')) {
        return $value + "`n"
    }
    return $value.TrimEnd("`r", "`n") + "`n"
}

function Read-FrontmatterValue {
    param(
        [Parameter(Mandatory)]
        [string]$Source,
        [Parameter(Mandatory)]
        [string]$Key
    )

    $text = $Source.TrimStart([char]0xFEFF)
    $lines = @($text -split "\r?\n")
    if ($lines.Count -eq 0 -or $lines[0].Trim() -ne '---') {
        return ""
    }
    $closingIndex = -1
    for ($index = 1; $index -lt $lines.Count; $index += 1) {
        if ($lines[$index] -match '^(?:---|\.\.\.)[ \t]*$') {
            $closingIndex = $index
            break
        }
    }
    if ($closingIndex -lt 0) {
        return ""
    }

    $escapedKey = [Regex]::Escape($Key)
    for ($index = 1; $index -lt $closingIndex; $index += 1) {
        $match = [Regex]::Match($lines[$index], "^$escapedKey\s*:\s*(?<value>.*)$")
        if (-not $match.Success) {
            continue
        }
        $rawValue = $match.Groups['value'].Value.Trim()
        $block = [Regex]::Match($rawValue, '^(?<style>[|>])(?<mods>(?:[+-]?[1-9]?|[1-9]?[+-]?))(?:\s+#.*)?$')
        if ($block.Success) {
            $continuation = @()
            for ($cursor = $index + 1; $cursor -lt $closingIndex; $cursor += 1) {
                $line = $lines[$cursor]
                if ($line.Length -gt 0 -and $line -notmatch '^[ \t]') {
                    break
                }
                $continuation += $line
            }
            return Convert-YamlBlockScalar `
                -Lines $continuation `
                -Style $block.Groups['style'].Value `
                -Modifiers $block.Groups['mods'].Value
        }
        if ($rawValue.Length -ge 2 -and $rawValue.StartsWith('"') -and $rawValue.EndsWith('"')) {
            try {
                return [string]($rawValue | ConvertFrom-Json)
            } catch {
                return $rawValue.Substring(1, $rawValue.Length - 2)
            }
        }
        if ($rawValue.Length -ge 2 -and $rawValue.StartsWith("'") -and $rawValue.EndsWith("'")) {
            return $rawValue.Substring(1, $rawValue.Length - 2).Replace("''", "'")
        }
        return $rawValue
    }
    return ""
}


function New-SourceDraftFromContent {
    param(
        [Parameter(Mandatory)]
        [string]$Source,
        [string]$FallbackName = "",
        [AllowEmptyCollection()][object[]]$Files = @()
    )

    $resolvedName = $Name.Trim()
    if (-not $resolvedName) {
        $resolvedName = Read-FrontmatterValue -Source $Source -Key "name"
    }
    if (-not $resolvedName) {
        $resolvedName = $FallbackName.Trim()
    }
    if (-not $resolvedName) {
        throw "SKILL.md 缺少 name，且没有提供 -Name"
    }
    $resolvedDescription = $Description.Trim()
    if (-not $resolvedDescription) {
        $resolvedDescription = Read-FrontmatterValue -Source $Source -Key "description"
    }
    if (-not $resolvedDescription) {
        $resolvedDescription = "Use when the user asks for the $resolvedName skill."
    }

    @{
        name = $resolvedName
        description = $resolvedDescription
        aliases = @()
        content = ""
        topRules = @()
        rules = @()
        commandTools = @()
        sourceMarkdown = $Source
        files = @($Files)
        deletedFiles = @()
    }
}

function Resolve-SourceBundle {
    if (-not $SourcePath) {
        throw "-SourcePath 是 $Action 的必填参数"
    }

    $resolved = (Resolve-Path -LiteralPath $SourcePath).Path
    $item = Get-Item -LiteralPath $resolved
    $skillDirectory = $null
    if ($item.PSIsContainer) {
        $skillDirectory = $item.FullName
        $entryPath = Join-Path $skillDirectory "SKILL.md"
        if (-not (Test-Path -LiteralPath $entryPath -PathType Leaf)) {
            throw "技能目录缺少入口 SKILL.md：$skillDirectory"
        }
    } else {
        $entryPath = $item.FullName
        if ($item.Name.Equals("SKILL.md", [StringComparison]::OrdinalIgnoreCase)) {
            $skillDirectory = Split-Path $entryPath -Parent
        }
    }

    $source = Get-Content -Raw -LiteralPath $entryPath -Encoding utf8
    $files = @()
    if ($skillDirectory) {
        $entryFullPath = [IO.Path]::GetFullPath($entryPath)
                $strictUtf8 = [Text.UTF8Encoding]::new($false, $true)
        $files = @(
            Get-ChildItem -LiteralPath $skillDirectory -Recurse -File |
                Where-Object {
                    -not $_.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint) -and
                    -not [IO.Path]::GetFullPath($_.FullName).Equals($entryFullPath, [StringComparison]::OrdinalIgnoreCase) -and
                    -not $_.Name.Equals('.skill-creator-source.json', [StringComparison]::OrdinalIgnoreCase)
                } |
                Sort-Object FullName |
                ForEach-Object {
                    $relative = [IO.Path]::GetRelativePath($skillDirectory, $_.FullName).Replace('\', '/')
                    try {
                        $content = $strictUtf8.GetString([IO.File]::ReadAllBytes($_.FullName))
                        [ordered]@{
                            path = $relative
                            content = $content
                        }
                    } catch [Text.DecoderFallbackException] {
                        # Binary assets are preserved in place but are not sent through the UTF-8 editing API.
                    }
                }
        )
    }

    [pscustomobject]@{
        entryPath = $entryPath
        source = $source
        files = $files
        syncDeletedFiles = [bool]$skillDirectory
        fallbackName = if ($skillDirectory) {
            Split-Path $skillDirectory -Leaf
        } else {
            [IO.Path]::GetFileNameWithoutExtension($entryPath)
        }
    }
}

function New-SourceDraft {
    $bundle = Resolve-SourceBundle
    New-SourceDraftFromContent `
        -Source $bundle.source `
        -FallbackName $bundle.fallbackName `
        -Files @($bundle.files)
}

function Get-DeletedBundleFiles {
    param(
        [Parameter(Mandatory)][object]$CurrentSkill,
        [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Files
    )

    $sourcePaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($file in @($Files)) {
        $path = ([string]$file.path).Replace('\', '/')
        if ($path) {
            [void]$sourcePaths.Add($path)
        }
    }
        @($CurrentSkill.files | Where-Object {
        -not [bool]$_.isEntry -and
        -not $sourcePaths.Contains(([string]$_.path).Replace('\', '/'))
    } | ForEach-Object { ([string]$_.path).Replace('\', '/') })
}

function Invoke-NormativeDesign {
    param(
        [Parameter(Mandatory)]
        [ValidateSet("create", "modify")]
        [string]$Mode,
        [string]$CurrentSource = "",
        [AllowEmptyCollection()][object[]]$CurrentFiles = @()
    )

    if (-not $Prompt.Trim()) {
        throw "-Prompt 是 $Action 的必填参数"
    }
    $result = Invoke-Api -Method POST -Path "/design_skill" -Body @{
        mode = $Mode
        prompt = $Prompt.Trim()
        currentSource = $CurrentSource
        currentFiles = @($CurrentFiles)
        history = @()
        normative = $true
        includeChineseSample = $true
    }
    if (-not $result.markdown -or -not $result.sampleMarkdown -or @($result.files).Count -eq 0) {
        throw "SkillCreator 规范设计未返回根索引、分区文件和中文样本"
    }
    $result
}

function Write-AtomicUtf8File {
    param(
        [Parameter(Mandatory)]
        [string]$Path,
        [Parameter(Mandatory)]
        [string]$Content
    )

    $parent = Split-Path $Path -Parent
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    $temporary = Join-Path $parent (".{0}.{1}.tmp" -f (Split-Path $Path -Leaf), [Guid]::NewGuid().ToString("N"))
    try {
        [IO.File]::WriteAllText($temporary, ($Content.TrimEnd() + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
        Move-Item -Force -LiteralPath $temporary -Destination $Path
    } finally {
        if (Test-Path -LiteralPath $temporary) {
            Remove-Item -Force -LiteralPath $temporary
        }
    }
}

function Write-ChineseSample {
    param(
        [Parameter(Mandatory)]
        [string]$CanonicalPath,
        [Parameter(Mandatory)]
        [string]$SampleMarkdown
    )

    $skillDirectory = Split-Path $CanonicalPath -Parent
    $samplePath = Join-Path $skillDirectory "references\SKILL.zh-CN.md"
    Write-AtomicUtf8File -Path $samplePath -Content $SampleMarkdown
    $samplePath
}

function New-DesignResult {
    param(
        [Parameter(Mandatory)]
        [string]$ActionName,
        [Parameter(Mandatory)]
        [object]$Proposal,
        [Parameter(Mandatory)]
        [string]$CanonicalPath,
        [Parameter(Mandatory)]
        [string]$SamplePath
    )

    [ordered]@{
        schemaVersion = 1
        action = $ActionName
        model = $Proposal.model
        assistantMessage = $Proposal.assistantMessage
        canonicalLanguage = "en"
        canonicalPath = $CanonicalPath
                sampleLanguage = "zh-CN"
        samplePath = $SamplePath
        defaultEntry = $CanonicalPath
        files = @($Proposal.files | ForEach-Object { $_.path })
        deletedFiles = @($Proposal.deletedFiles)
    }
}

function Normalize-SkillRelativePath {
    param(
        [Parameter(Mandatory)][string]$Path,
        [switch]$AllowEntry
    )

    $normalized = $Path.Trim().Replace('\', '/')
    if (-not $normalized) {
        throw "技能相对路径不能为空"
    }
    if ($normalized.Length -gt 512 -or [IO.Path]::IsPathRooted($normalized) -or $normalized.Contains(':')) {
        throw "非法技能相对路径：$Path"
    }
    $segments = @($normalized.Split('/') | Where-Object { $_ -ne '' -and $_ -ne '.' })
    if ($segments.Count -eq 0 -or @($segments | Where-Object { $_ -eq '..' -or $_ -ieq '.git' -or $_ -ieq '.svn' }).Count -gt 0) {
        throw "非法技能相对路径：$Path"
    }
    $normalized = $segments -join '/'
    if (-not $AllowEntry -and $normalized.Equals('SKILL.md', [StringComparison]::OrdinalIgnoreCase)) {
        throw "目标文件不能是入口 SKILL.md"
    }
    $normalized
}

function Get-RuleBundle {
    if ($SkillId.Trim()) {
        $encodedId = [Uri]::EscapeDataString($SkillId.Trim())
        $skill = Invoke-Api -Method GET -Path "/skills/$encodedId"
        return [pscustomobject]@{
            kind = 'library'
            skillId = $SkillId.Trim()
            encodedId = $encodedId
            root = [string]$skill.content
            entryPath = [string]$skill.filePath
            fallbackName = [string]$skill.name
            files = @($skill.files | Where-Object { -not [bool]$_.isEntry } | ForEach-Object {
                [ordered]@{ path = ([string]$_.path).Replace('\', '/'); content = [string]$_.content }
            })
        }
    }
    if ($SourcePath.Trim()) {
        $bundle = Resolve-SourceBundle
        return [pscustomobject]@{
            kind = 'external'
            skillId = ''
            encodedId = ''
            root = [string]$bundle.source
            entryPath = [string]$bundle.entryPath
            fallbackName = [string]$bundle.fallbackName
            files = @($bundle.files)
        }
    }
    throw "规则操作必须提供 -SkillId 或 -SourcePath"
}

function Get-BundleFileContent {
    param(
        [Parameter(Mandatory)][object]$Bundle,
        [Parameter(Mandatory)][string]$Path
    )
    $normalized = Normalize-SkillRelativePath -Path $Path -AllowEntry
    if ($normalized.Equals('SKILL.md', [StringComparison]::OrdinalIgnoreCase)) {
        return [string]$Bundle.root
    }
    $match = @($Bundle.files | Where-Object { ([string]$_.path).Equals($normalized, [StringComparison]::OrdinalIgnoreCase) })
    if ($match.Count -eq 0) {
        return $null
    }
    [string]$match[0].content
}

function Set-BundleFileContent {
    param(
        [Parameter(Mandatory)][object]$Bundle,
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Content
    )
    $normalized = Normalize-SkillRelativePath -Path $Path -AllowEntry
    if ($normalized.Equals('SKILL.md', [StringComparison]::OrdinalIgnoreCase)) {
        $Bundle.root = $Content
        return
    }
    $next = @()
    $found = $false
    foreach ($file in @($Bundle.files)) {
        if (([string]$file.path).Equals($normalized, [StringComparison]::OrdinalIgnoreCase)) {
            $next += [ordered]@{ path = $normalized; content = $Content }
            $found = $true
        } else {
            $next += $file
        }
    }
    if (-not $found) {
        $next += [ordered]@{ path = $normalized; content = $Content }
    }
    $Bundle.files = @($next)
}

function Save-RuleBundle {
    param([Parameter(Mandatory)][object]$Bundle)

    if ($Bundle.kind -eq 'library') {
        $draft = New-SourceDraftFromContent `
            -Source ([string]$Bundle.root) `
            -FallbackName ([string]$Bundle.fallbackName) `
            -Files @($Bundle.files)
        return Invoke-Api -Method PUT -Path "/skills/$($Bundle.encodedId)" -Body @{ draft = $draft }
    }

    $skillDirectory = Split-Path ([string]$Bundle.entryPath) -Parent
    Write-AtomicUtf8File -Path ([string]$Bundle.entryPath) -Content ([string]$Bundle.root)
    foreach ($file in @($Bundle.files)) {
        $relative = Normalize-SkillRelativePath -Path ([string]$file.path)
        $target = [IO.Path]::GetFullPath((Join-Path $skillDirectory $relative))
        if (-not $target.StartsWith(([IO.Path]::GetFullPath($skillDirectory) + [IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase)) {
            throw "规则目标文件越出技能目录：$relative"
        }
        Write-AtomicUtf8File -Path $target -Content ([string]$file.content)
    }
    [ordered]@{ filePath = $Bundle.entryPath; writtenFiles = @('SKILL.md') + @($Bundle.files | ForEach-Object { $_.path }) }
}

function Get-CliRulesFromContent {
    param(
        [Parameter(Mandatory)][string]$Content,
        [Parameter(Mandatory)][string]$FilePath
    )
    $lines = @($Content -split "\r?\n")
    $rules = @()
    for ($index = 0; $index -lt $lines.Count; $index += 1) {
        $marker = [regex]::Match($lines[$index], '^\s*<!--\s*skillcreator-rule-id:\s*(?<id>SCR-[A-Fa-f0-9]+)\s*;\s*number:\s*(?<number>\d+)\s*-->\s*$')
        if (-not $marker.Success) {
            continue
        }
        $bodyIndex = $index + 1
        while ($bodyIndex -lt $lines.Count -and [string]::IsNullOrWhiteSpace($lines[$bodyIndex])) {
            $bodyIndex += 1
        }
        if ($bodyIndex -ge $lines.Count) {
            continue
        }
        $item = [regex]::Match($lines[$bodyIndex], '^\s*(?<number>\d+)\.\s+(?<text>.+)$')
        if (-not $item.Success) {
            continue
        }
        $number = [int]$marker.Groups['number'].Value
        if ([int]$item.Groups['number'].Value -ne $number) {
            continue
        }
        $end = $bodyIndex
        $textLines = @($item.Groups['text'].Value.Trim())
        for ($cursor = $bodyIndex + 1; $cursor -lt $lines.Count; $cursor += 1) {
            if ($lines[$cursor] -match '^\s*<!--\s*skillcreator-rule-id:' -or
                $lines[$cursor] -match '^\s*\d+\.\s+' -or
                $lines[$cursor] -match '^##\s+') {
                break
            }
            $end = $cursor
            if (-not [string]::IsNullOrWhiteSpace($lines[$cursor])) {
                $textLines += $lines[$cursor].Trim()
            }
        }
        $rules += [pscustomobject]@{
            id = $marker.Groups['id'].Value
            number = $number
            text = ($textLines -join "`n").Trim()
            path = $FilePath
            markerLine = $index
            bodyLine = $bodyIndex
            endLine = $end
        }
    }
    @($rules)
}

function Get-NumberedRulesFromContent {
    param(
        [Parameter(Mandatory)][string]$Content,
        [Parameter(Mandatory)][string]$FilePath
    )
    $lines = @($Content -split "\r?\n")
    $active = $false
    $section = ''
    $rules = @()
    $cliByNumber = @{}
    foreach ($cliRule in @(Get-CliRulesFromContent -Content $Content -FilePath $FilePath)) {
        $cliByNumber[[int]$cliRule.number] = $cliRule.id
    }
    foreach ($line in $lines) {
        if ($line -match '^##\s+(?<name>.+?)\s*$') {
            $section = $Matches.name.Trim()
            $active = $section -ieq 'Rules' -or $section -ieq 'Top Rules'
            continue
        }
        if (-not $active) {
            continue
        }
        $item = [regex]::Match($line, '^\s*(?<number>\d+)\.\s+(?<text>.+)$')
        if ($item.Success) {
            $number = [int]$item.Groups['number'].Value
            $rules += [pscustomobject]@{
                id = if ($cliByNumber.ContainsKey($number)) { [string]$cliByNumber[$number] } else { '' }
                number = $number
                text = $item.Groups['text'].Value.Trim()
                path = $FilePath
                section = $section
            }
        }
    }
    @($rules)
}

function Get-BundleRules {
    param([Parameter(Mandatory)][object]$Bundle)
    $rules = @()
    $rules += Get-NumberedRulesFromContent -Content ([string]$Bundle.root) -FilePath 'SKILL.md'
    foreach ($file in @($Bundle.files)) {
        if (([string]$file.path) -match '(?i)\.md$') {
                        $rules += Get-NumberedRulesFromContent -Content ([string]$file.content) -FilePath ([string]$file.path)
        }
    }
    @($rules)
}

function ConvertTo-RuleFingerprint {
    param([Parameter(Mandatory)][string]$Text)
    [regex]::Replace($Text.ToLowerInvariant(), '[^\p{L}\p{Nd}]', '')
}

function Get-RuleGramSet {
    param([Parameter(Mandatory)][string]$Text)
    $fingerprint = ConvertTo-RuleFingerprint -Text $Text
    $set = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    if ($fingerprint.Length -le 3) {
        if ($fingerprint) { [void]$set.Add($fingerprint) }
        return $set
    }
    for ($index = 0; $index -le $fingerprint.Length - 3; $index += 1) {
        [void]$set.Add($fingerprint.Substring($index, 3))
    }
    $set
}

function Get-RuleSimilarity {
    param(
        [Parameter(Mandatory)][string]$Left,
        [Parameter(Mandatory)][string]$Right
    )
    $a = Get-RuleGramSet -Text $Left
    $b = Get-RuleGramSet -Text $Right
    if ($a.Count -eq 0 -or $b.Count -eq 0) {
        return 0.0
    }
    $intersection = 0
    foreach ($gram in $a) {
        if ($b.Contains($gram)) { $intersection += 1 }
    }
    $union = $a.Count + $b.Count - $intersection
    if ($union -le 0) { return 1.0 }
    [math]::Round($intersection / $union, 4)
}

function Test-RuleNecessity {
    param([Parameter(Mandatory)][string]$Text)
    $lower = $Text.ToLowerInvariant()
    $reasons = @()
    $defaultBehavior = $false
    $lowProbability = $false
    $unscopedProhibition = $false

    $negative = $lower -match '(do not|don''t|never|must not|avoid|forbid|禁止|不得|不要|避免)'
    if ($negative -and $lower -match '(secret|token|password|credential|api[ -]?key|密钥|令牌|密码|凭据)') {
        $defaultBehavior = $true
        $reasons += 'Generic credential/secret hygiene is default behavior and normally does not need a skill rule.'
    }
    if ($lower -match '(be accurate|follow the user|follow user instructions|do not hallucinate|write clean code|ensure correctness|保持准确|遵循用户要求|不要编造|写干净代码|保证正确)') {
        $defaultBehavior = $true
        $reasons += 'The candidate restates general assistant/software quality behavior instead of skill-specific governance.'
    }
    if ($negative -and $lower -match '(rare|unlikely|one[- ]off|single incident|isolated incident|edge case|极少|小概率|偶发|单次事故|孤立事件)') {
        $lowProbability = $true
        $reasons += 'The candidate is a prohibition aimed at an isolated low-probability event; prefer handling the case in normal reasoning unless it is recurrent or high-impact.'
    }
    $hasCondition = $lower -match '(^|\W)(if|when|unless|only when|before|after)(\W|$)|如果|当.+时|除非|仅当|之前|之后'
    if ($negative -and -not $hasCondition -and $Text.Trim().Length -lt 180) {
        $unscopedProhibition = $true
        $reasons += 'The candidate is a short unscoped prohibition. Prefer a positive scoped rule or omit it if normal behavior already covers it.'
    }

    [pscustomobject]@{
        unnecessary = [bool]($defaultBehavior -or $lowProbability)
        reviewRequired = [bool]($defaultBehavior -or $lowProbability -or $unscopedProhibition)
        defaultBehavior = $defaultBehavior
        lowProbabilityOneOff = $lowProbability
        unscopedProhibition = $unscopedProhibition
        reasons = @($reasons)
    }
}

function Test-RuleRegression {
    param(
        [string]$OldText,
        [string]$NewText
    )
    if (-not $OldText) {
        return [pscustomobject]@{ possibleRegression = $false; reasons = @() }
    }
    $reasons = @()
    $oldFingerprint = ConvertTo-RuleFingerprint -Text $OldText
    $newFingerprint = ConvertTo-RuleFingerprint -Text $NewText
    if ($oldFingerprint.Length -ge 60 -and $newFingerprint.Length -lt [math]::Floor($oldFingerprint.Length * 0.65)) {
        $reasons += 'The replacement is substantially shorter than the existing rule and may drop scope or constraints.'
    }
    $signals = @(
        @{ pattern = '(?i)\bmust\b|必须'; label = 'MUST requirement' },
        @{ pattern = '(?i)\bnever\b|不得|禁止'; label = 'prohibition' },
        @{ pattern = '(?i)\bonly\b|仅'; label = 'exclusivity constraint' },
        @{ pattern = '(?i)\bverify\b|验证'; label = 'verification requirement' },
        @{ pattern = '(?i)\b(if|when|unless)\b|如果|当.+时|除非'; label = 'condition/trigger' },
        @{ pattern = '(?i)\bevidence\b|证据'; label = 'evidence requirement' }
    )
    foreach ($signal in $signals) {
        if ($OldText -match $signal.pattern -and $NewText -notmatch $signal.pattern) {
            $reasons += "The replacement drops an existing $($signal.label)."
        }
    }
    [pscustomobject]@{ possibleRegression = [bool]($reasons.Count -gt 0); reasons = @($reasons) }
}

function Test-RuleCandidate {
    param(
        [Parameter(Mandatory)][object]$Bundle,
        [Parameter(Mandatory)][string]$Candidate,
        [string]$ExcludeRuleId = '',
        [string]$OldText = ''
    )
    $fingerprint = ConvertTo-RuleFingerprint -Text $Candidate
    if (-not $fingerprint) {
        throw "规则内容不能为空"
    }
    $matches = @()
    foreach ($rule in @(Get-BundleRules -Bundle $Bundle)) {
        if ($ExcludeRuleId -and ([string]$rule.id).Equals($ExcludeRuleId, [StringComparison]::OrdinalIgnoreCase)) {
            continue
        }
        $similarity = Get-RuleSimilarity -Left $Candidate -Right ([string]$rule.text)
        if ($similarity -ge 0.68) {
            $matches += [pscustomobject]@{
                path = $rule.path
                number = $rule.number
                id = $rule.id
                similarity = $similarity
                classification = if ($similarity -ge 0.82) { 'duplicate' } else { 'overlap' }
                text = $rule.text
            }
        }
    }
    $necessity = Test-RuleNecessity -Text $Candidate
    $regression = Test-RuleRegression -OldText $OldText -NewText $Candidate
    [pscustomobject]@{
        candidate = $Candidate.Trim()
        duplicateOrOverlap = @($matches)
        necessity = $necessity
        regression = $regression
        blocked = [bool](@($matches).Count -gt 0 -or $necessity.reviewRequired -or $regression.possibleRegression)
    }
}

function Get-NextRuleNumber {
    param([Parameter(Mandatory)][string]$Content)
    $numbers = @(Get-NumberedRulesFromContent -Content $Content -FilePath '<target>' | ForEach-Object { [int]$_.number })
    if ($numbers.Count -eq 0) { return 1 }
    (($numbers | Measure-Object -Maximum).Maximum + 1)
}

function Format-CliRuleBlock {
    param(
        [Parameter(Mandatory)][string]$Id,
        [Parameter(Mandatory)][int]$Number,
        [Parameter(Mandatory)][string]$Text
    )
    $parts = @($Text.Trim() -split "\r?\n")
    $lines = @("<!-- skillcreator-rule-id: $Id; number: $Number -->", "$Number. $($parts[0].Trim())")
    if ($parts.Count -gt 1) {
        foreach ($line in $parts[1..($parts.Count - 1)]) {
            $lines += if ([string]::IsNullOrWhiteSpace($line)) { '   ' } else { "   $($line.Trim())" }
        }
    }
    $lines -join "`n"
}

function Add-CliRuleBlock {
    param(
        [string]$Content,
        [Parameter(Mandatory)][string]$Block,
        [ValidateSet('Rules', 'Top Rules')][string]$Section = 'Rules'
    )
    $text = $Content.TrimEnd()
    $escapedSection = [regex]::Escape($Section)
    if ($text -notmatch "(?im)^##\s+$escapedSection\s*$") {
        return "$text`n`n## $Section`n`n$Block`n"
    }
    $lines = @($text -split "\r?\n")
    $heading = -1
    for ($index = 0; $index -lt $lines.Count; $index += 1) {
        if ($lines[$index] -match "^##\s+$escapedSection\s*$") { $heading = $index; break }
    }
    $insert = $lines.Count
    for ($index = $heading + 1; $index -lt $lines.Count; $index += 1) {
        if ($lines[$index] -match '^##\s+') { $insert = $index; break }
    }
    $before = @($lines[0..($insert - 1)])
    $after = if ($insert -lt $lines.Count) { @($lines[$insert..($lines.Count - 1)]) } else { @() }
    (($before + @('', $Block, '') + $after) -join "`n").TrimEnd() + "`n"
}

function Replace-CliRuleBlock {
    param(
        [Parameter(Mandatory)][string]$Content,
        [Parameter(Mandatory)][object]$Rule,
        [Parameter(Mandatory)][string]$Block
    )
    $lines = @($Content -split "\r?\n")
    $before = if ($Rule.markerLine -gt 0) { @($lines[0..($Rule.markerLine - 1)]) } else { @() }
    $afterStart = [int]$Rule.endLine + 1
    $after = if ($afterStart -lt $lines.Count) { @($lines[$afterStart..($lines.Count - 1)]) } else { @() }
    (($before + @($Block) + $after) -join "`n").TrimEnd() + "`n"
}

function Find-CliRulesInBundle {
    param([Parameter(Mandatory)][object]$Bundle)
    $rules = @()
    $rules += Get-CliRulesFromContent -Content ([string]$Bundle.root) -FilePath 'SKILL.md'
    foreach ($file in @($Bundle.files)) {
        if (([string]$file.path) -match '(?i)\.md$') {
                        $rules += Get-CliRulesFromContent -Content ([string]$file.content) -FilePath ([string]$file.path)
        }
    }
    if ($RuleId.Trim()) {
        $rules = @($rules | Where-Object { ([string]$_.id).Equals($RuleId.Trim(), [StringComparison]::OrdinalIgnoreCase) })
    }
    if ($TargetFile.Trim()) {
        $target = Normalize-SkillRelativePath -Path $TargetFile -AllowEntry
        $rules = @($rules | Where-Object { ([string]$_.path).Equals($target, [StringComparison]::OrdinalIgnoreCase) })
    }
    if ($RuleNumber -gt 0) {
        $rules = @($rules | Where-Object { [int]$_.number -eq $RuleNumber })
    }
    @($rules)
}

function Write-JsonResult {
    param([Parameter(Mandatory)][object]$Value)
    $json = $Value | ConvertTo-Json -Depth 100
    if ($ReportPath) {
        $fullReportPath = [IO.Path]::GetFullPath($ReportPath, $projectRoot)
        $reportParent = Split-Path $fullReportPath -Parent
        New-Item -ItemType Directory -Force -Path $reportParent | Out-Null
        Set-Content -LiteralPath $fullReportPath -Value $json -Encoding utf8
    }
    $json
}

Ensure-Api

switch ($Action) {
    "health" {
        Write-JsonResult (Invoke-Api -Method GET -Path "/health")
    }
    "catalog" {
        Write-JsonResult (Invoke-Api -Method GET -Path "/codex_skills")
    }
    "audit" {
        $catalog = Invoke-Api -Method GET -Path "/codex_skills"
        $chainCounts = [ordered]@{
            structuredLogic = @($catalog.entries | Where-Object editorChain -eq "structured-logic").Count
            structuredSections = @($catalog.entries | Where-Object editorChain -eq "structured-sections").Count
            losslessIsomorphic = @($catalog.entries | Where-Object editorChain -eq "lossless-isomorphic").Count
            sourceRepair = @($catalog.entries | Where-Object editorChain -eq "source-repair").Count
        }
        $result = [ordered]@{
            schemaVersion = 1
            action = "audit"
            scannedAt = $catalog.scannedAt
            roots = @($catalog.roots)
            total = @($catalog.entries).Count
            loadable = @($catalog.entries | Where-Object loadable).Count
            unsupported = @($catalog.entries | Where-Object { -not $_.loadable }).Count
            chains = $chainCounts
            warnings = @($catalog.warnings)
            entries = @($catalog.entries | ForEach-Object {
                [ordered]@{
                    id = $_.id
                    name = $_.name
                    source = $_.source
                    sourcePath = $_.sourcePath
                    editorChain = $_.editorChain
                    loadable = $_.loadable
                    formatGaps = @($_.formatGaps)
                    normalizedRuleCount = $_.normalizedRuleCount
                    legacyRuleCount = $_.legacyRuleCount
                    imported = $_.imported
                    importedId = $_.importedId
                }
            })
        }
        Write-JsonResult $result
    }
    "load" {
        Write-JsonResult (Invoke-Api -Method POST -Path "/codex_skills/import" -Body @{ ids = @($Id) })
    }
    "list" {
        Write-JsonResult (Invoke-Api -Method GET -Path "/skills")
    }
    "read" {
        if (-not $SkillId.Trim()) {
            throw "-SkillId 是 read 的必填参数"
        }
        $encodedId = [Uri]::EscapeDataString($SkillId.Trim())
        Write-JsonResult (Invoke-Api -Method GET -Path "/skills/$encodedId")
    }
    "files" {
        if (-not $SkillId.Trim()) {
            throw "-SkillId 是 files 的必填参数"
        }
        $encodedId = [Uri]::EscapeDataString($SkillId.Trim())
        $skill = Invoke-Api -Method GET -Path "/skills/$encodedId"
        Write-JsonResult ([ordered]@{
            schemaVersion = 2
            action = "files"
            skillId = $SkillId.Trim()
            entryFile = $skill.entryFile
            indexMode = [bool]$skill.indexMode
            files = @($skill.files | ForEach-Object {
                [ordered]@{
                    path = $_.path
                    byteSize = $_.byteSize
                    isEntry = [bool]$_.isEntry
                }
            })
        })
    }
    "create" {
        Write-JsonResult (Invoke-Api -Method POST -Path "/skills" -Body @{ draft = (New-SourceDraft) })
    }
    "update" {
        if (-not $SkillId.Trim()) {
            throw "-SkillId 是 update 的必填参数"
        }
        $encodedId = [Uri]::EscapeDataString($SkillId.Trim())
        $bundle = Resolve-SourceBundle
        $draft = New-SourceDraftFromContent `
            -Source $bundle.source `
            -FallbackName $bundle.fallbackName `
            -Files @($bundle.files)
        if ($bundle.syncDeletedFiles) {
            $current = Invoke-Api -Method GET -Path "/skills/$encodedId"
            $draft.deletedFiles = @(Get-DeletedBundleFiles -CurrentSkill $current -Files @($bundle.files))
        }
        Write-JsonResult (Invoke-Api -Method PUT -Path "/skills/$encodedId" -Body @{ draft = $draft })
    }
        "design-create" {
        $proposal = Invoke-NormativeDesign -Mode create
        $draft = New-SourceDraftFromContent -Source $proposal.markdown -Files @($proposal.files)
        $created = Invoke-Api -Method POST -Path "/skills" -Body @{ draft = $draft }
        $samplePath = Write-ChineseSample `
            -CanonicalPath $created.filePath `
            -SampleMarkdown $proposal.sampleMarkdown
        Write-JsonResult (New-DesignResult `
            -ActionName $Action `
            -Proposal $proposal `
            -CanonicalPath $created.filePath `
            -SamplePath $samplePath)
    }
        "design-update" {
        if (-not $SkillId.Trim()) {
            throw "-SkillId 是 design-update 的必填参数"
        }
        $encodedId = [Uri]::EscapeDataString($SkillId.Trim())
        $current = Invoke-Api -Method GET -Path "/skills/$encodedId"
        $currentFiles = @($current.files | Where-Object {
            -not [bool]$_.isEntry -and
            -not ([string]$_.path).Equals('references/SKILL.zh-CN.md', [StringComparison]::OrdinalIgnoreCase)
        } | ForEach-Object { [ordered]@{ path = $_.path; content = $_.content } })
        $proposal = Invoke-NormativeDesign -Mode modify -CurrentSource $current.content -CurrentFiles $currentFiles
        $draft = New-SourceDraftFromContent -Source $proposal.markdown -Files @($proposal.files)
        $draft.deletedFiles = @($proposal.deletedFiles | Where-Object {
            -not ([string]$_).Equals('references/SKILL.zh-CN.md', [StringComparison]::OrdinalIgnoreCase)
        })
        $updated = Invoke-Api -Method PUT -Path "/skills/$encodedId" -Body @{ draft = $draft }
        $samplePath = Write-ChineseSample `
            -CanonicalPath $updated.filePath `
            -SampleMarkdown $proposal.sampleMarkdown
        Write-JsonResult (New-DesignResult `
            -ActionName $Action `
            -Proposal $proposal `
            -CanonicalPath $updated.filePath `
            -SamplePath $samplePath)
    }
        "design-source-update" {
        $bundle = Resolve-SourceBundle
        $resolvedSource = $bundle.entryPath
        $skillDirectory = Split-Path $resolvedSource -Parent
        $currentFiles = @($bundle.files | Where-Object {
            -not ([string]$_.path).Equals('references/SKILL.zh-CN.md', [StringComparison]::OrdinalIgnoreCase)
        })
        $proposal = Invoke-NormativeDesign -Mode modify -CurrentSource $bundle.source -CurrentFiles $currentFiles

        # Validate every target before committing any change. After validation, failures are repaired forward;
        # this path never restores an old backup over newer source.
        $preparedWrites = @()
        foreach ($file in @($proposal.files)) {
            $relative = Normalize-SkillRelativePath -Path ([string]$file.path)
            $target = [IO.Path]::GetFullPath((Join-Path $skillDirectory $relative))
            $rootPrefix = [IO.Path]::GetFullPath($skillDirectory) + [IO.Path]::DirectorySeparatorChar
            if (-not $target.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
                throw "设计输出文件越出技能目录：$relative"
            }
            $preparedWrites += [pscustomobject]@{ path = $target; content = [string]$file.content }
        }
        $preparedDeletes = @()
        foreach ($deleted in @($proposal.deletedFiles)) {
            $relative = Normalize-SkillRelativePath -Path ([string]$deleted)
            if ($relative.Equals('references/SKILL.zh-CN.md', [StringComparison]::OrdinalIgnoreCase)) {
                continue
            }
            $target = [IO.Path]::GetFullPath((Join-Path $skillDirectory $relative))
            $rootPrefix = [IO.Path]::GetFullPath($skillDirectory) + [IO.Path]::DirectorySeparatorChar
            if (-not $target.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
                throw "设计删除路径越出技能目录：$relative"
            }
            $preparedDeletes += $target
        }

        Write-AtomicUtf8File -Path $resolvedSource -Content $proposal.markdown
        foreach ($write in $preparedWrites) {
            Write-AtomicUtf8File -Path $write.path -Content $write.content
        }
        foreach ($deletePath in $preparedDeletes) {
            if (Test-Path -LiteralPath $deletePath -PathType Leaf) {
                Remove-Item -Force -LiteralPath $deletePath
            }
        }
        $samplePath = Write-ChineseSample `
            -CanonicalPath $resolvedSource `
            -SampleMarkdown $proposal.sampleMarkdown
                Write-JsonResult (New-DesignResult `
            -ActionName $Action `
            -Proposal $proposal `
            -CanonicalPath $resolvedSource `
            -SamplePath $samplePath)
    }
    "rule-check" {
        if (-not $RuleText.Trim()) {
            throw "-RuleText 是 rule-check 的必填参数"
        }
        $bundle = Get-RuleBundle
        $evaluation = Test-RuleCandidate -Bundle $bundle -Candidate $RuleText
        Write-JsonResult ([ordered]@{
            schemaVersion = 3
            action = 'rule-check'
            accepted = -not [bool]$evaluation.blocked
            evaluation = $evaluation
        })
    }
    "rule-find" {
        $bundle = Get-RuleBundle
        $rules = @(Find-CliRulesInBundle -Bundle $bundle)
        Write-JsonResult ([ordered]@{
            schemaVersion = 3
            action = 'rule-find'
            count = $rules.Count
            rules = @($rules | ForEach-Object {
                [ordered]@{
                    id = $_.id
                    number = $_.number
                    path = $_.path
                    text = $_.text
                }
            })
        })
    }
    "rule-add" {
        if (-not $TargetFile.Trim()) {
            throw "-TargetFile 是 rule-add 的必填参数"
        }
        if (-not $RuleText.Trim()) {
            throw "-RuleText 是 rule-add 的必填参数"
        }
        $bundle = Get-RuleBundle
        $target = Normalize-SkillRelativePath -Path $TargetFile -AllowEntry
        if ($target -notmatch '(?i)\.md$') {
            throw "rule-add 只能写入 Markdown 规则分区：$target"
        }
        $evaluation = Test-RuleCandidate -Bundle $bundle -Candidate $RuleText
        if ($evaluation.blocked -and -not $Force) {
            Write-JsonResult ([ordered]@{
                schemaVersion = 3
                action = 'rule-add'
                applied = $false
                rejected = $true
                targetFile = $target
                evaluation = $evaluation
            })
            break
        }
        $content = Get-BundleFileContent -Bundle $bundle -Path $target
        if ($null -eq $content) {
            if ($target.Equals('SKILL.md', [StringComparison]::OrdinalIgnoreCase)) {
                throw "入口 SKILL.md 不存在"
            }
            $title = [IO.Path]::GetFileNameWithoutExtension($target)
            $content = "# $title`n`n## Rules`n"
        }
        $number = Get-NextRuleNumber -Content ([string]$content)
                $generatedRuleId = 'SCR-' + ([Guid]::NewGuid().ToString('N').Substring(0, 12).ToUpperInvariant())
        $block = Format-CliRuleBlock -Id $generatedRuleId -Number $number -Text $RuleText
        $section = if ($target.Equals('SKILL.md', [StringComparison]::OrdinalIgnoreCase)) { 'Top Rules' } else { 'Rules' }
        $nextContent = Add-CliRuleBlock -Content ([string]$content) -Block $block -Section $section
        Set-BundleFileContent -Bundle $bundle -Path $target -Content $nextContent
        $writeResult = Save-RuleBundle -Bundle $bundle
        Write-JsonResult ([ordered]@{
            schemaVersion = 3
            action = 'rule-add'
            applied = $true
            forced = [bool]$Force
                        id = $generatedRuleId
            number = $number
            path = $target
            evaluation = $evaluation
            writeResult = $writeResult
        })
    }
    "rule-update" {
        if (-not $RuleText.Trim()) {
            throw "-RuleText 是 rule-update 的必填参数"
        }
        if (-not $RuleId.Trim() -and $RuleNumber -le 0) {
            throw "rule-update 必须通过 -RuleId，或 -TargetFile + -RuleNumber 定位 CLI 规则"
        }
        $bundle = Get-RuleBundle
        $matches = @(Find-CliRulesInBundle -Bundle $bundle)
        if ($matches.Count -eq 0) {
            throw "未找到匹配的 CLI 规则"
        }
        if ($matches.Count -gt 1) {
            throw "规则定位不唯一；请增加 -TargetFile 或直接使用 -RuleId"
        }
        $rule = $matches[0]
        $evaluation = Test-RuleCandidate `
            -Bundle $bundle `
            -Candidate $RuleText `
            -ExcludeRuleId ([string]$rule.id) `
            -OldText ([string]$rule.text)
        if ($evaluation.blocked -and -not $Force) {
            Write-JsonResult ([ordered]@{
                schemaVersion = 3
                action = 'rule-update'
                applied = $false
                rejected = $true
                id = $rule.id
                number = $rule.number
                path = $rule.path
                evaluation = $evaluation
            })
            break
        }
        $content = Get-BundleFileContent -Bundle $bundle -Path ([string]$rule.path)
        $block = Format-CliRuleBlock -Id ([string]$rule.id) -Number ([int]$rule.number) -Text $RuleText
        $nextContent = Replace-CliRuleBlock -Content ([string]$content) -Rule $rule -Block $block
        Set-BundleFileContent -Bundle $bundle -Path ([string]$rule.path) -Content $nextContent
        $writeResult = Save-RuleBundle -Bundle $bundle
        Write-JsonResult ([ordered]@{
            schemaVersion = 3
            action = 'rule-update'
            applied = $true
            forced = [bool]$Force
            id = $rule.id
            number = $rule.number
            path = $rule.path
            evaluation = $evaluation
            writeResult = $writeResult
        })
    }
}
