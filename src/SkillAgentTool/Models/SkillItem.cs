namespace SkillAgentTool.Models;

public sealed record SkillItem(
    string Name,
    string Path,
    DateTime LastWriteTime
);
