using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using SkillAgentTool.Models;

namespace SkillAgentTool.Services;

internal sealed class SkillFileService
{
    public sealed record CreateResult(string FilePath, string WriterHint, bool UsedNative);
    public const string Extension = ".agentmd";
    public const string EntryFileName = "agent-entry.json";

    public static string WorkspaceRoot { get; } = Path.Combine(AppContext.BaseDirectory, "agentmd");
    public static string AiEntryFilePath { get; } = Path.Combine(WorkspaceRoot, EntryFileName);

    public static IReadOnlyList<SkillItem> ListSkills()
    {
        EnsureWorkspace();
        var files = Directory.GetFiles(WorkspaceRoot, $"*{Extension}", SearchOption.TopDirectoryOnly);
        return files
            .Select(p => new SkillItem(Path.GetFileNameWithoutExtension(p), p, File.GetLastWriteTime(p)))
            .OrderByDescending(f => f.LastWriteTime)
            .ToList();
    }

    public static CreateResult CreateSkill(SkillDraft draft)
    {
        EnsureWorkspace();
        var safeName = MakeSafeFileName(draft.Name);
        var normalizedName = string.IsNullOrWhiteSpace(safeName) ? $"skill-{DateTime.UtcNow:yyyyMMdd_HHmmss}" : safeName;
        var finalName = ResolveUniqueName(normalizedName);
        var filePath = Path.Combine(WorkspaceRoot, $"{finalName}{Extension}");

        var markdown = BuildMarkdown(draft, filePath);

        var usedNative = NativeSkillBridge.TryWrite(filePath, markdown, out var nativeError);
        if (!usedNative)
        {
            File.WriteAllText(filePath, markdown, new UTF8Encoding(false));
            nativeError = "Fallback to managed write path";
        }

        WriteAiEntry();
        return new CreateResult(filePath, nativeError, usedNative);
    }

    public static string GetAiEntryJson()
    {
        EnsureWorkspace();
        WriteAiEntry();
        return File.ReadAllText(AiEntryFilePath, new UTF8Encoding(false));
    }

    public static void EnsureAiEntryFile()
    {
        EnsureWorkspace();
        WriteAiEntry();
    }

    private static void EnsureWorkspace()
    {
        if (!Directory.Exists(WorkspaceRoot))
        {
            Directory.CreateDirectory(WorkspaceRoot);
        }
    }

    private static string ResolveUniqueName(string baseName)
    {
        var candidate = baseName;
        var index = 1;

        while (File.Exists(Path.Combine(WorkspaceRoot, $"{candidate}{Extension}")))
        {
            candidate = $"{baseName}-{index++}";
        }

        return candidate;
    }

    private static string BuildMarkdown(SkillDraft draft, string filePath)
    {
        return
$@"---
name: ""{EscapeYaml(draft.Name)}""
description: ""{EscapeYaml(draft.Description)}""
entry_trigger: ""{EscapeYaml(draft.Trigger)}""
suggested_command: ""{EscapeYaml(draft.SuggestedCommand)}""
---

# {draft.Name}

## 场景
用于通过 Skill/agentmd 创建工具直接落盘的新 skill 模板条目，入口位于 AI 配置文件中。

## 约定
- 文件路径：`{Path.GetFileName(filePath)}`
- 创建时间：`{DateTime.UtcNow:yyyy-MM-dd HH:mm:ss} UTC`
- 触发词：`{draft.Trigger}`
- 建议指令：`{draft.SuggestedCommand}`

## 使用示例
```powershell
agent-skill run {draft.SuggestedCommand}
```
";
    }

    private static string MakeSafeFileName(string text)
    {
        var filtered = Regex.Replace(text, @"[\\/:*?""<>|]", "_");
        filtered = filtered.Replace(" ", "_");
        return filtered.Trim('_', '.');
    }

    private static string EscapeYaml(string value) => (value ?? string.Empty).Replace("\"", "\\\"");

    private static void WriteAiEntry()
    {
        var payload = new AiEntryManifest(
            Tool: "skill-agentmd-creator",
            Version: "1.0",
            Description: "用于创建 skill/agentmd 文件的 WinUI3 工具，右下角【添加】按钮会写入以下目录。",
            EntryRoot: WorkspaceRoot,
            SupportedExtensions: [Extension],
            CliHint:
@"{
  ""name"": ""CreateSkill"",
  ""args"": {
    ""name"": ""string"",
    ""description"": ""string"",
    ""trigger"": ""string"",
    ""suggested_command"": ""string""
  }
}"
        );

        var json = JsonSerializer.Serialize(payload, new JsonSerializerOptions
        {
            WriteIndented = true
        });
        File.WriteAllText(AiEntryFilePath, json, new UTF8Encoding(false));
    }

    private readonly record struct AiEntryManifest(
        string Tool,
        string Version,
        string Description,
        string EntryRoot,
        string[] SupportedExtensions,
        string CliHint
    );
}
