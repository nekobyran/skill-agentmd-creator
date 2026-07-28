namespace SkillAgentTool.Models;

public sealed record SkillDraft(
    string Name,
    string Description,
    string Trigger,
    string SuggestedCommand
);
