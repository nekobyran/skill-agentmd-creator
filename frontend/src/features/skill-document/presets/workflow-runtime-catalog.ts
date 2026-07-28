import type { CustomPropertyValue } from "../types";

/**
 * Runtime facts mechanically audited from workflow-task.ps1.  These records are
 * deliberately kept separate from the editable SkillDocument: the Markdown
 * snapshot is the source document, while this catalog describes the executable
 * it references without injecting generated blocks into that document.
 */
export interface WorkflowTaskParameterRuntime {
  [key: string]: CustomPropertyValue;
  name: string;
  aliases: string[];
  powerShellType: string;
  declaredDefaultExpression: string;
  defaultValue: CustomPropertyValue;
  validateSet: string[];
  runtimeAcceptedValues: string[];
  appliesTo: string[];
  requiredFor: string[];
  fallbackSemantics: string;
  outputSemantics: string;
  errorSemantics: string;
}

export interface WorkflowTaskActionRuntime {
  [key: string]: CustomPropertyValue;
  action: string;
  handler: string;
  parameters: string[];
  fallbackSemantics: string;
  outputs: string[];
  errors: string[];
  stateTransitions: string[];
  sideEffects: string[];
}

export const WORKFLOW_TASK_ACTION_NAMES = [
  "start",
  "append",
  "complete",
  "conflict",
  "check",
  "item-done",
  "subtask",
  "summary",
  "status",
  "cleanup",
  "join",
  "message",
  "context",
  "spawn",
  "resume-agent",
  "model-test",
  "audit-check",
  "self-test",
  "help",
];

const ALL_ACTIONS = [...WORKFLOW_TASK_ACTION_NAMES];
const TASK_LOOKUP_ACTIONS = [
  "append", "complete", "conflict", "check", "item-done", "subtask", "summary", "status",
  "join", "message", "context", "spawn", "resume-agent", "model-test", "audit-check",
];
const COLLABORATION_ACTIONS = ["join", "message", "context", "spawn", "resume-agent", "model-test"];
const MODEL_SELECTING_ACTIONS = ["join", "spawn", "resume-agent"];
const PROMPT_AWARE_ACTIONS = [
  "start", "append", "conflict", "item-done", "subtask", "join", "message", "context", "spawn", "resume-agent",
];
const LIMIT_AWARE_ACTIONS = [
  "start", "append", "complete", "conflict", "check", "item-done", "subtask", "summary", "status",
  "cleanup", "join", "message", "context", "spawn", "resume-agent", "audit-check",
];
const MODEL_SELECTORS = [
  "spark", "fast", "quick", "gpt5.3spark", "gpt-5.3-codex-spark",
  "professional", "pro", "expert", "5.5", "gpt5.5", "gpt-5.5",
];

const parameter = (
  name: string,
  aliases: string[],
  powerShellType: string,
  declaredDefaultExpression: string,
  defaultValue: CustomPropertyValue,
  appliesTo: string[],
  overrides: Partial<WorkflowTaskParameterRuntime> = {},
): WorkflowTaskParameterRuntime => ({
  name,
  aliases,
  powerShellType,
  declaredDefaultExpression,
  defaultValue,
  validateSet: [],
  runtimeAcceptedValues: [],
  appliesTo,
  requiredFor: [],
  fallbackSemantics: "未提供时使用 PowerShell 参数绑定默认值。",
  outputSemantics: "参数本身不产生独立输出；由适用 action 消费。",
  errorSemantics: "类型绑定失败时 PowerShell 在进入 action dispatch 前终止。",
  ...overrides,
});

export const WORKFLOW_TASK_PARAMETER_RUNTIME: WorkflowTaskParameterRuntime[] = [
  parameter("Action", [], "[string]", "\"start\"", "start", ALL_ACTIONS, {
    validateSet: [...WORKFLOW_TASK_ACTION_NAMES],
    runtimeAcceptedValues: [...WORKFLOW_TASK_ACTION_NAMES],
    fallbackSemantics: "省略时 dispatch 到 start。",
    outputSemantics: "选择且仅选择一个 action handler。",
    errorSemantics: "ValidateSet 在 dispatch 前拒绝 19 个 action 之外的值。",
  }),
  parameter("TaskId", ["Id"], "[string]", "$null", null, TASK_LOOKUP_ACTIONS, {
    fallbackSemantics: "Resolve-TaskFile 在 active task 恰好为 1 个时自动选择；部分动作改用交互提示，summary/status 空值显示总览。",
    outputSemantics: "用于定位 task-<id>.json；audit-check 在 ParentTaskId 为空时把 TaskId 当父 task。",
    errorSemantics: "0 个 task、多个 task 未显式指定、或目标文件不存在时终止。",
  }),
  parameter("Request", ["RawRequest", "UserRequest"], "[string]", "$null", null, ["start", "append", "conflict", "subtask"], {
    requiredFor: ["start", "append", "conflict", "subtask"],
    fallbackSemantics: "空值时 Read-RequiredValue；只有显式 -Prompt 才交互，否则抛出缺少必填参数。",
    outputSemantics: "按换行、分号、全角分号或竖线拆分，写入编号请求单；conflict/append 会合并。",
    errorSemantics: "非交互模式缺失时终止；空拆分结果会产生空请求单并影响 item-done。",
  }),
  parameter("Plan", ["PlanText"], "[string]", "$null", null, ["start", "append", "conflict", "subtask"], {
    requiredFor: ["start", "append", "conflict", "subtask"],
    fallbackSemantics: "空值时 Read-RequiredValue；只有显式 -Prompt 才交互。",
    outputSemantics: "按请求项分隔规则拆分并写入/追加编号计划单。",
    errorSemantics: "非交互模式缺失时终止。",
  }),
  parameter("TaskName", ["Name"], "[string]", "$null", null, ["complete"], {
    fallbackSemantics: "空值时用完整 rawRequest 生成安全日志名，非法文件名字符替换、空白转下划线并截到 40 字符。",
    outputSemantics: "只影响 log_<safe-name>_<timestamp>_<task-id>.json 文件名。",
    errorSemantics: "无独立业务校验；文件系统写入失败时 complete 终止且 active task 保留。",
  }),
  parameter("ParentTaskId", ["ParentId"], "[string]", "$null", null, ["start", "subtask", "audit-check"], {
    fallbackSemantics: "subtask/audit-check 为空时回退 TaskId；start 为空才启用顶层冲突自动转交。",
    outputSemantics: "写入 task.parentTaskId；subtask 同时捕获 parentContext。",
    errorSemantics: "subtask/audit-check 无法解析父 task 时终止。",
  }),
  parameter("FromTaskId", ["SourceTaskId", "SourceId", "FromId", "AuditTaskId"], "[string]", "$null", null, ["conflict", "join", "audit-check"], {
    requiredFor: ["conflict"],
    fallbackSemantics: "conflict 空值时交互读取；join 空值表示只加入不合并；audit-check 空值时自动发现 final-audit child/log。",
    outputSemantics: "conflict/join 写 handoff 来源；audit-check 限定审查 task。",
    errorSemantics: "conflict 非交互缺失或 join 指定的来源 task 不存在时终止。",
  }),
  parameter("Projects", ["Project", "ChangedProject", "ChangedProjects"], "[string[]]", "$null", null, ["start", "append", "conflict", "subtask"], {
    fallbackSemantics: "可选兼容字段；空值写空数组或保持现有 scope。",
    outputSemantics: "用分号/全角分号/逗号/全角逗号/竖线拆分、去重并合并 scope.projects。",
    errorSemantics: "无独立必填校验。",
  }),
  parameter("Files", ["File", "ChangedFile", "ChangedFiles", "ModifiedFile", "ModifiedFiles"], "[string[]]", "$null", null, ["start", "append", "conflict", "subtask"], {
    requiredFor: ["start", "subtask"],
    fallbackSemantics: "start/subtask 空值时交互读取；append/conflict 空值不扩展 scope。",
    outputSemantics: "拆分、转小写、反斜杠转 /、压缩斜杠、去尾斜杠后写 scope.files，并驱动 path-overlap。",
    errorSemantics: "start/subtask 非交互缺失时终止；虚构/不存在路径不会由脚本验证。",
  }),
  parameter("Feature", ["ScopeFeature"], "[string]", "$null", null, ["start", "append", "conflict", "subtask"], {
    fallbackSemantics: "start 取第一条 Request；subtask 继承父 scope.feature；append/conflict 空值保持目标 feature。",
    outputSemantics: "写入或以分号追加 scope.feature，并参与 contains 型功能重合判断。",
    errorSemantics: "无独立必填校验。",
  }),
  parameter("Platforms", ["Platform"], "[string[]]", "$null", null, ["start", "append", "conflict", "subtask"], {
    fallbackSemantics: "空值写空数组或保持现有 scope。",
    outputSemantics: "拆分、去空并去重写入 scope.platforms；参与平台重合分数。",
    errorSemantics: "脚本不验证平台枚举。",
  }),
  parameter("Validation", ["ValidationResult", "Verification", "Verify", "TestResult"], "[string]", "$null", null, ["complete", "cleanup"], {
    fallbackSemantics: "complete 空值合法并写空字符串；cleanup -Apply 临时覆盖为自动清理证据。",
    outputSemantics: "写 completed log.validation，并解析 workflow_complete 与最优解确认生成 auditDecision。",
    errorSemantics: "脚本 complete 不因空 Validation 阻断；质量门禁要求由外部 skill/workflow policy 承担。",
  }),
  parameter("Risk", ["Risks"], "[string]", "$null", null, ["complete", "cleanup"], {
    fallbackSemantics: "complete 空值合法并写空字符串；cleanup -Apply 临时覆盖为固定安全说明。",
    outputSemantics: "写 completed log.risk。",
    errorSemantics: "脚本 complete 不因空 Risk 阻断；质量门禁要求由外部 policy 承担。",
  }),
  parameter("Item", [], "[int]", "0", 0, ["item-done"], {
    requiredFor: ["item-done"],
    fallbackSemantics: "值 <= 0 时交互读取请求编号；非交互会抛缺少必填参数。",
    outputSemantics: "去重加入 doneItems；全部请求完成时 status=all-items-done，否则 active。",
    errorSemantics: "请求单为空或编号不在 1..requestItems.Count 时终止。",
  }),
  parameter("Note", [], "[string]", "$null", null, ["item-done", "message", "context"], {
    fallbackSemantics: "item-done 允许空且不写 itemNotes；message 空值交互读取；context 可作为 ContextValue 的次级 fallback。",
    outputSemantics: "分别写 itemNotes.note、messages.text 或 sharedContext.value。",
    errorSemantics: "message/context 非交互且所有 fallback 都为空时终止；item-done 不因空 Note 失败。",
  }),
  parameter("NoPrompt", [], "[switch]", "$false", false, PROMPT_AWARE_ACTIONS, {
    fallbackSemantics: "未指定时仍不会自动交互，除非同时显式 -Prompt；-NoPrompt 明确压制 Prompt。",
    outputSemantics: "参与计算 PromptMode = !NoPrompt && Prompt。",
    errorSemantics: "与 -Prompt 同时传入时 NoPrompt 胜出，缺失必填值将抛错。",
  }),
  parameter("Prompt", [], "[switch]", "$false", false, PROMPT_AWARE_ACTIONS, {
    fallbackSemantics: "默认 false；仅在未传 NoPrompt 且 Prompt=true 时启用 Read-Host。",
    outputSemantics: "允许缺失值经 Read-RequiredValue 交互补齐。",
    errorSemantics: "交互输入持续为空时循环，不会接受空值。",
  }),
  parameter("IncludeStale", [], "[switch]", "$false", false, ["start", "check", "subtask", "summary", "status"], {
    fallbackSemantics: "默认隐藏低重合陈旧 task，仅保留新近或高重合候选并另列陈旧提醒。",
    outputSemantics: "true 时候选/总览包含陈旧 task。",
    errorSemantics: "无独立错误。",
  }),
  parameter("StaleOnly", [], "[switch]", "$false", false, ["start", "check", "subtask", "summary", "status"], {
    fallbackSemantics: "默认 false。",
    outputSemantics: "true 时只展示陈旧候选/task；在筛选顺序中优先于 IncludeStale。",
    errorSemantics: "无独立错误。",
  }),
  parameter("Limit", [], "[int]", "10", 10, LIMIT_AWARE_ACTIONS, {
    fallbackSemantics: "默认 10。",
    outputSemantics: "限制 summary/check/stale/cleanup 输出数，也限制多 task 未指定 TaskId 时错误提示中的最近 task 数。",
    errorSemantics: "脚本未声明数值范围；非法负值可能由 Select-Object -First 拒绝。",
  }),
  parameter("StaleMinutes", [], "[int]", "120", 120, ["start", "check", "subtask", "summary", "status", "cleanup"], {
    fallbackSemantics: "默认 120 分钟。",
    outputSemantics: "按 task 文件 LastWriteTime 计算 IsStale；cleanup 只选超过阈值的 all-items-done/joined。",
    errorSemantics: "脚本未声明最小值；负值会使全部 task 被视为陈旧。",
  }),
  parameter("WorkflowRoot", [], "[string]", "$null", null, ALL_ACTIONS, {
    fallbackSemantics: "优先参数，其次 VIBECODING_WORKFLOW_ROOT，再取脚本 command 目录的父目录。",
    outputSemantics: "决定 task/ 与 log/ 根；目录在 dispatch 前创建。",
    errorSemantics: "路径无法创建/解析时在获取 mutex 前后终止。",
  }),
  parameter("AgentName", [], "[string]", "$null", null, COLLABORATION_ACTIONS, {
    fallbackSemantics: "优先参数，其次 CODEX_AGENT_NAME，最后 agent-<MachineName>。",
    outputSemantics: "写 participant/message/sharedContext/spawnedAgent 的 agent/from/updatedBy。",
    errorSemantics: "不是必填参数，不因空值阻断。",
  }),
  parameter("AgentRole", [], "[string]", "$null", null, ["join", "spawn"], {
    fallbackSemantics: "空值取模型 profile role：fast-task-subagent 或 professional-subagent。",
    outputSemantics: "写 participant/spawnedAgent.role 并进入 agent prompt。",
    errorSemantics: "任意非空字符串可用；无独立枚举校验。",
  }),
  parameter("ToAgent", [], "[string]", "$null", null, ["message"], {
    fallbackSemantics: "空值写 recipient=all。",
    outputSemantics: "写 messages.to。",
    errorSemantics: "脚本不验证 recipient 是否已加入 task。",
  }),
  parameter("ContextKey", [], "[string]", "$null", null, ["context"], {
    requiredFor: ["context"],
    fallbackSemantics: "空值时交互读取。",
    outputSemantics: "按精确 key upsert sharedContext，并写 context message。",
    errorSemantics: "非交互缺失时终止。",
  }),
  parameter("ContextValue", [], "[string]", "$null", null, ["context"], {
    requiredFor: ["context"],
    fallbackSemantics: "空值先回退 Note，再交互读取。",
    outputSemantics: "trim 后写 sharedContext.value。",
    errorSemantics: "非交互且 ContextValue/Note 均空时终止。",
  }),
  parameter("Model", [], "[string]", "\"\"", "", MODEL_SELECTING_ACTIONS, {
    runtimeAcceptedValues: [...MODEL_SELECTORS],
    fallbackSemantics: "空值时使用 AgentType；最终默认 spark profile。",
    outputSemantics: "解析为 gpt-5.3-codex-spark 或 gpt-5.5，并写模型说明/生成 Codex 命令。",
    errorSemantics: "非空 selector 不匹配两档 regex aliases 时终止；不存在任意自定义模型通道。",
  }),
  parameter("AgentType", [], "[string]", "\"spark\"", "spark", MODEL_SELECTING_ACTIONS, {
    runtimeAcceptedValues: [...MODEL_SELECTORS],
    fallbackSemantics: "默认 spark；Model 非空时 Model 优先。",
    outputSemantics: "解析 agent profile type/model/role/label/note。",
    errorSemantics: "selector 不匹配两档 regex aliases 时终止。",
  }),
  parameter("SessionId", [], "[string]", "$null", null, ["resume-agent"], {
    fallbackSemantics: "空值不会失败，生成字面占位符 <session-id>。",
    outputSemantics: "进入 codex exec resume 命令并写 resume-agent message。",
    errorSemantics: "脚本不验证 session 是否存在。",
  }),
  parameter("AgentPrompt", [], "[string]", "$null", null, ["spawn", "resume-agent"], {
    fallbackSemantics: "空值只使用脚本生成的基础 join/summary/context 提示。",
    outputSemantics: "trim 后追加到生成的 exec/resume prompt。",
    errorSemantics: "无独立错误。",
  }),
  parameter("Apply", [], "[switch]", "$false", false, ["spawn", "cleanup"], {
    fallbackSemantics: "默认 dry-run/planned。",
    outputSemantics: "spawn=true 时先 probe 再启动后台进程；cleanup=true 时逐个归档安全候选。",
    errorSemantics: "spawn probe 不可用时写 blocked-model-unavailable 后抛错；cleanup 归档失败时终止。",
  }),
  parameter("TimeoutSeconds", [], "[int]", "45", 45, ["spawn", "model-test"], {
    fallbackSemantics: "默认 45；进程等待实际使用 Math.Max(5, TimeoutSeconds)。",
    outputSemantics: "控制 Codex 模型 probe 等待时间并进入超时 reason。",
    errorSemantics: "超时将 probe 标为 unavailable/exitCode=-1；spawn -Apply 随后阻断，model-test 继续测试并汇总。",
  }),
];

const action = (
  actionName: string,
  handler: string,
  parameters: string[],
  fallbackSemantics: string,
  outputs: string[],
  errors: string[],
  stateTransitions: string[],
  sideEffects: string[],
): WorkflowTaskActionRuntime => ({
  action: actionName,
  handler,
  parameters,
  fallbackSemantics,
  outputs,
  errors,
  stateTransitions,
  sideEffects,
});

export const WORKFLOW_TASK_ACTION_RUNTIME: WorkflowTaskActionRuntime[] = [
  action("start", "Start-Task", ["Request", "Plan", "Projects", "Files", "Feature", "Platforms", "ParentTaskId", "Prompt", "NoPrompt", "IncludeStale", "StaleOnly", "Limit", "StaleMinutes", "WorkflowRoot"],
    "Feature 回退第一条 Request；仅顶层 start 扫描非陈旧 file overlap 并自动转交。",
    ["新 taskId/task JSON/path 与冲突候选文本", "确定冲突时输出 auto-handoff 目标且不创建新 task"],
    ["缺 Request/Files/Plan", "workflow storage 写入失败", "mutex/路径失败"],
    ["proposed(ephemeral) -> active", "proposed -> auto-handoff(no task record)"],
    ["可能创建 task JSON", "可能更新冲突目标 request/plan/scope/handoffs"]),
  action("append", "Add-TaskRequest", ["TaskId", "Request", "Plan", "Projects", "Files", "Feature", "Platforms", "Prompt", "NoPrompt", "Limit", "WorkflowRoot"],
    "TaskId 仅在唯一 active task 时可推断；Request/Plan 可交互补齐。",
    ["追加成功标签", "end"],
    ["task 不存在/歧义", "缺 Request/Plan", "JSON/写入失败"],
    ["active|all-items-done|joined -> active"],
    ["合并请求、计划与 scope", "revision +1"]),
  action("complete", "Complete-Task", ["TaskId", "TaskName", "Validation", "Risk", "Limit", "WorkflowRoot"],
    "TaskName 回退 rawRequest；Validation/Risk 允许为空，脚本不自行执行 quality/audit gate。",
    ["completed taskId", "log文件 path", "已删除 task path", "logPath=<path>", "end"],
    ["task 无效/歧义", "log 写入失败", "删除 task 失败"],
    ["active|all-items-done|joined -> completed log"],
    ["先原子写 log，再删除 active task", "若有父 task 则 child status=completed/revision +1"]),
  action("conflict", "Transfer-ConflictRequest", ["TaskId", "FromTaskId", "Request", "Plan", "Projects", "Files", "Feature", "Platforms", "Prompt", "NoPrompt", "Limit", "WorkflowRoot"],
    "FromTaskId/Request/Plan 可交互补齐；scope 参数通过 Add-TaskRequest 的全局绑定合并。",
    ["冲突转交请求已并入", "end"],
    ["目标 task 不存在", "缺来源/请求/计划", "写入失败"],
    ["target -> active"],
    ["目标追加 request/plan/scope", "新增无 type 的 handoff", "revision +1"]),
  action("check", "Check-Task", ["TaskId", "IncludeStale", "StaleOnly", "Limit", "StaleMinutes", "WorkflowRoot"],
    "TaskId 在唯一 active task 时推断。",
    ["排序后的 project/file/feature/platform overlap、score、recommendation", "陈旧提醒"],
    ["task 不存在/歧义/格式无效"],
    ["无持久状态变化"],
    ["只读 task JSON"]),
  action("item-done", "Complete-TaskItem", ["TaskId", "Item", "Note", "Prompt", "NoPrompt", "Limit", "WorkflowRoot"],
    "Item<=0 时交互；Note 可空且此时不写 itemNotes。",
    ["请求项完成 i/n", "all done 输出 end，否则 continue"],
    ["请求单为空", "编号越界", "非交互缺 Item", "写入失败"],
    ["active -> active|all-items-done"],
    ["doneItems 去重", "可选追加 itemNote", "revision +1"]),
  action("subtask", "New-SubTask", ["ParentTaskId", "TaskId", "Request", "Plan", "Projects", "Files", "Feature", "Platforms", "Prompt", "NoPrompt", "IncludeStale", "StaleOnly", "Limit", "StaleMinutes", "WorkflowRoot"],
    "ParentTaskId 为空回退 TaskId；Feature 为空继承父 scope.feature。",
    ["subtaskid", "父task", "task文件", "parentContext 已写入", "child conflict check"],
    ["父 task 不存在/无效", "缺 Request/Files/Plan", "写入失败"],
    ["new child=active", "parent remains current status"],
    ["创建 child task + parentContext", "父 childTasks 追加记录/revision +1"]),
  action("summary", "Show-TaskSummary", ["TaskId", "Limit", "StaleMinutes", "IncludeStale", "StaleOnly", "WorkflowRoot"],
    "TaskId 空显示 active overview；非空显示单 task 详情。",
    ["overview 或 request progress/scope/children/handoffs/participants/context/messages/spawned agents/parentContext"],
    ["指定 task 不存在/无效"],
    ["无持久状态变化"],
    ["只读 task JSON"]),
  action("status", "Show-TaskSummary", ["TaskId", "Limit", "StaleMinutes", "IncludeStale", "StaleOnly", "WorkflowRoot"],
    "summary 的完整 alias，空 TaskId 同样显示 overview。",
    ["与 summary 完全相同"],
    ["与 summary 完全相同"],
    ["无持久状态变化"],
    ["只读 task JSON"]),
  action("cleanup", "Invoke-TaskCleanup", ["StaleMinutes", "Limit", "Apply", "WorkflowRoot"],
    "默认 dry-run；候选严格限 stale 且 status 为 all-items-done/joined。",
    ["candidate count/list", "dry-run 提示或每个 Complete-Task log", "end"],
    ["候选归档/删除失败"],
    ["dry-run: unchanged", "Apply: candidate -> completed log"],
    ["Apply 时临时注入固定 Validation/Risk 后复用 Complete-Task"]),
  action("join", "Join-Task", ["TaskId", "FromTaskId", "AgentName", "AgentRole", "AgentType", "Model", "Prompt", "NoPrompt", "Limit", "WorkflowRoot"],
    "AgentName/Role/Model 均有 profile fallback；FromTaskId 空表示不合并。",
    ["joined target", "agent/role/model", "可选 merged-source", "end"],
    ["目标/来源 task 不存在或无效", "模型 selector 非法", "写入失败"],
    ["target status 不变", "source -> joined(when merge)"],
    ["追加 participant 与 join message", "可合并 source request/plan/scope 并写 join-merge handoff"]),
  action("message", "Write-TaskMessage", ["TaskId", "AgentName", "ToAgent", "Note", "Prompt", "NoPrompt", "Limit", "WorkflowRoot"],
    "AgentName 回退环境/机器名；ToAgent 回退 all；Note 空时交互。",
    ["message-written", "end"],
    ["task 不存在/歧义", "非交互缺 Note", "写入失败"],
    ["task status 不变"],
    ["追加 message", "revision +1"]),
  action("context", "Write-TaskSharedContext", ["TaskId", "AgentName", "ContextKey", "ContextValue", "Note", "Prompt", "NoPrompt", "Limit", "WorkflowRoot"],
    "ContextValue 回退 Note；相同 key 替换而非追加。",
    ["context-written", "key", "end"],
    ["task 不存在/歧义", "缺 key/value", "写入失败"],
    ["task status 不变"],
    ["upsert sharedContext", "追加 context message", "revision +1"]),
  action("spawn", "New-WorkflowAgent", ["TaskId", "AgentName", "AgentRole", "AgentType", "Model", "AgentPrompt", "Apply", "TimeoutSeconds", "Prompt", "NoPrompt", "Limit", "WorkflowRoot"],
    "默认只生成 planned 命令；Apply 才 probe 并启动。",
    ["spawn-agent id", "model note", "apply bool", "command", "end"],
    ["非法模型 selector", "Apply probe unavailable 时记录后抛错", "进程/写入失败"],
    ["planned", "Apply success -> started", "Apply probe fail -> blocked-model-unavailable"],
    ["写 spawnedAgent/message/revision", "Apply 可创建 probe 文件与后台 codex process"]),
  action("resume-agent", "Resume-WorkflowAgent", ["TaskId", "AgentName", "AgentType", "Model", "SessionId", "AgentPrompt", "Prompt", "NoPrompt", "Limit", "WorkflowRoot"],
    "SessionId 空时生成 <session-id> 占位符，不实际启动进程。",
    ["resume-agent-command", "end"],
    ["非法模型 selector", "task/写入失败"],
    ["task status 不变"],
    ["追加 resume-agent message", "revision +1"]),
  action("model-test", "Invoke-AgentModelTests", ["TaskId", "AgentName", "TimeoutSeconds", "Limit", "WorkflowRoot"],
    "始终依次 probe spark/professional；TaskId 可选。",
    ["两档 available/reason/output", "可选 model-test-written", "available=n/2", "end"],
    ["TaskId 指定但不存在", "上下文写入失败"],
    ["probe unavailable 仍完成汇总，不转换为 action failure"],
    ["创建 probe 输出目录", "可选 upsert agent-model-test context + message/revision"]),
  action("audit-check", "Show-AuditCheck", ["ParentTaskId", "TaskId", "FromTaskId", "Limit", "WorkflowRoot"],
    "ParentTaskId 空回退 TaskId；FromTaskId 空时从 final-audit child/log 自动发现。",
    ["audit-check allow/block 全字段", "allow 输出 end"],
    ["父 task 无效", "任一 gate reason 导致 throw audit-check block"],
    ["allow|block 是计算结果，不写父 task status"],
    ["只读 task/log JSON"]),
  action("self-test", "Invoke-SelfTest", ["WorkflowRoot"],
    "在当前 workflow log 根下创建隔离 selftest 目录，并通过子进程调用同一脚本。",
    ["隔离用例命令输出", "通过时 self-test evidence/path"],
    ["任一断言/子命令失败即终止"],
    ["不改变中央 task；隔离 fixture 内发生完整状态迁移"],
    ["创建 selftest task/log/evidence 文件"]),
  action("help", "Show-WorkflowHelp", ["WorkflowRoot"],
    "无 action-specific 输入。",
    ["基础输入、16 条常用命令、冲突/协作/降噪/模型说明", "end"],
    ["仅可能因 dispatch 前 WorkflowRoot 或 mutex 初始化失败"],
    ["无 task 状态变化"],
    ["dispatch 前仍确保 task/log 目录存在"]),
];

export const WORKFLOW_TASK_RUNTIME_CATALOG: Record<string, CustomPropertyValue> = {
  sourceKind: "PowerShell AST/runtime audit",
  actionCount: WORKFLOW_TASK_ACTION_RUNTIME.length,
  parameterCount: WORKFLOW_TASK_PARAMETER_RUNTIME.length,
  actions: WORKFLOW_TASK_ACTION_RUNTIME,
  parameters: WORKFLOW_TASK_PARAMETER_RUNTIME,
};
