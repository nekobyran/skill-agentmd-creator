import type {
  AiConversationMessage,
  AiDesignResponse,
  AiDesignResponseObject,
  AiSkillProposal,
  AiStudioMode,
  DiffLine,
  NormalizedAiDesignResponse,
} from "./model";

const STORAGE_PREFIX = "skill-creator:ai-studio:v1";
const MAX_STORED_MESSAGES = 80;
const MAX_LCS_CELLS = 180_000;

export function createAiId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function sourceHash(source: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function conversationStorageKey(mode: AiStudioMode, skillId?: string) {
  const target = mode === "modify" ? skillId || "no-skill" : "new-skill";
  return `${STORAGE_PREFIX}:${mode}:${target}`;
}

export function loadConversation(key: string): AiConversationMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitizeStoredMessage)
      .filter((message): message is AiConversationMessage => Boolean(message))
      .slice(-MAX_STORED_MESSAGES);
  } catch {
    return [];
  }
}

export function saveConversation(key: string, messages: AiConversationMessage[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)));
  } catch {
    // Conversation persistence is best-effort; the visible session remains usable.
  }
}

export function normalizeDesignResponse(
  response: AiDesignResponse,
  context: {
    mode: AiStudioMode;
    currentSource: string;
    targetSkillId?: string;
    targetFilePath?: string;
  },
): NormalizedAiDesignResponse {
  if (typeof response === "string") {
    return { message: response.trim() || "AI 未返回内容。" };
  }

  const object = response as AiDesignResponseObject & Partial<AiSkillProposal>;
  const nestedProposal = isRecord(object.proposal) ? object.proposal : undefined;
  const proposalSource = nestedProposal ?? (typeof object.after === "string" ? object : undefined);
  const proposal = proposalSource
    ? normalizeProposal(proposalSource, {
        mode: context.mode,
        currentSource: context.currentSource,
        targetSkillId: context.targetSkillId,
        targetFilePath: context.targetFilePath,
      })
    : undefined;
  const messageCandidate = firstString(object.message, object.content);
  const message = messageCandidate?.trim()
    || proposal?.summary?.trim()
    || (proposal ? "已生成一份待审阅的 Skill 变更提案。" : "AI 未返回内容。");

  return { message, proposal };
}

export function createUnifiedDiff(before: string, after: string, filePath = "SKILL.md") {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  const operations = beforeLines.length * afterLines.length <= MAX_LCS_CELLS
    ? lcsDiff(beforeLines, afterLines)
    : boundedDiff(beforeLines, afterLines);

  return [
    `--- before/${filePath}`,
    `+++ after/${filePath}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
    ...operations.map(({ kind, text }) => `${kind === "addition" ? "+" : kind === "deletion" ? "-" : " "}${text}`),
  ].join("\n");
}

export function parseDiffLines(diff: string): DiffLine[] {
  return diff.split(/\r?\n/).map((text) => {
    if (text.startsWith("@@") || text.startsWith("---") || text.startsWith("+++")) {
      return { kind: "header", text };
    }
    if (text.startsWith("+")) return { kind: "addition", text };
    if (text.startsWith("-")) return { kind: "deletion", text };
    return { kind: "context", text };
  });
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export function safeDomId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function normalizeProposal(
  raw: Partial<AiSkillProposal>,
  context: {
    mode: AiStudioMode;
    currentSource: string;
    targetSkillId?: string;
    targetFilePath?: string;
  },
): AiSkillProposal {
  const mode = raw.mode === "create" || raw.mode === "modify" ? raw.mode : context.mode;
  const before = typeof raw.before === "string" ? raw.before : context.currentSource;
  const after = typeof raw.after === "string" ? raw.after : before;
  const filePath = firstString(raw.filePath, context.targetFilePath) || "SKILL.md";
  return {
    id: firstString(raw.id) || createAiId("proposal"),
    mode,
    title: firstString(raw.title) || (mode === "create" ? "创建 Skill" : "修改 Skill"),
    summary: firstString(raw.summary),
    targetSkillId: firstString(raw.targetSkillId, context.targetSkillId),
    filePath,
    before,
    after,
    diff: firstString(raw.diff) || createUnifiedDiff(before, after, filePath),
    warnings: stringArray(raw.warnings),
    changedFiles: stringArray(raw.changedFiles),
    baseRevision: firstString(raw.baseRevision),
    baseSourceHash: firstString(raw.baseSourceHash) || sourceHash(context.currentSource),
    status: "pending",
  };
}

function sanitizeStoredMessage(value: unknown): AiConversationMessage | null {
  if (!isRecord(value)) return null;
  const role = value.role === "user" || value.role === "assistant" ? value.role : null;
  if (!role || typeof value.content !== "string") return null;
  const status = value.status === "cancelled" || value.status === "error" || value.status === "complete"
    ? value.status
    : value.status === "sending" ? "cancelled" : "complete";
  const proposal = sanitizeStoredProposal(value.proposal);
  return {
    id: typeof value.id === "string" ? value.id : createAiId("message"),
    role,
    content: value.content,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    status,
    proposal,
  };
}

function sanitizeStoredProposal(value: unknown): AiSkillProposal | undefined {
  if (!isRecord(value) || typeof value.before !== "string" || typeof value.after !== "string") {
    return undefined;
  }
  const mode = value.mode === "create" || value.mode === "modify" ? value.mode : "modify";
  const status = value.status === "applied" || value.status === "discarded" || value.status === "error"
    ? value.status
    : "pending";
  const filePath = typeof value.filePath === "string" ? value.filePath : "SKILL.md";
  return {
    id: typeof value.id === "string" ? value.id : createAiId("proposal"),
    mode,
    title: typeof value.title === "string" ? value.title : mode === "create" ? "创建 Skill" : "修改 Skill",
    summary: typeof value.summary === "string" ? value.summary : undefined,
    targetSkillId: typeof value.targetSkillId === "string" ? value.targetSkillId : undefined,
    filePath,
    before: value.before,
    after: value.after,
    diff: typeof value.diff === "string" ? value.diff : createUnifiedDiff(value.before, value.after, filePath),
    warnings: stringArray(value.warnings),
    changedFiles: stringArray(value.changedFiles),
    baseRevision: typeof value.baseRevision === "string" ? value.baseRevision : undefined,
    baseSourceHash: typeof value.baseSourceHash === "string" ? value.baseSourceHash : sourceHash(value.before),
    status,
    errorMessage: typeof value.errorMessage === "string" ? value.errorMessage : undefined,
  };
}

function lcsDiff(before: string[], after: string[]) {
  const matrix = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1));
  for (let left = before.length - 1; left >= 0; left -= 1) {
    for (let right = after.length - 1; right >= 0; right -= 1) {
      matrix[left][right] = before[left] === after[right]
        ? matrix[left + 1][right + 1] + 1
        : Math.max(matrix[left + 1][right], matrix[left][right + 1]);
    }
  }

  const operations: Array<{ kind: "context" | "addition" | "deletion"; text: string }> = [];
  let left = 0;
  let right = 0;
  while (left < before.length && right < after.length) {
    if (before[left] === after[right]) {
      operations.push({ kind: "context", text: before[left] });
      left += 1;
      right += 1;
    } else if (matrix[left + 1][right] >= matrix[left][right + 1]) {
      operations.push({ kind: "deletion", text: before[left] });
      left += 1;
    } else {
      operations.push({ kind: "addition", text: after[right] });
      right += 1;
    }
  }
  while (left < before.length) operations.push({ kind: "deletion", text: before[left++] });
  while (right < after.length) operations.push({ kind: "addition", text: after[right++] });
  return operations;
}

function boundedDiff(before: string[], after: string[]) {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix
    && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix += 1;

  return [
    ...before.slice(0, prefix).map((text) => ({ kind: "context" as const, text })),
    ...before.slice(prefix, before.length - suffix).map((text) => ({ kind: "deletion" as const, text })),
    ...after.slice(prefix, after.length - suffix).map((text) => ({ kind: "addition" as const, text })),
    ...before.slice(before.length - suffix).map((text) => ({ kind: "context" as const, text })),
  ];
}

function splitLines(value: string) {
  if (!value) return [];
  return value.replace(/\r\n/g, "\n").split("\n");
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string");
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
