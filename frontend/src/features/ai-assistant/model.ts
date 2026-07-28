export type AiStudioMode = "create" | "modify";

export type AiBackendStatus = "connecting" | "connected" | "disconnected";

export type AiRequestStatus = "idle" | "sending" | "applying" | "error";

export type AiMessageRole = "user" | "assistant";

export type AiMessageStatus = "complete" | "sending" | "cancelled" | "error";

export type AiProposalStatus = "pending" | "applying" | "applied" | "discarded" | "error";

export interface AiSkillTarget {
  id: string;
  name: string;
  description?: string;
  filePath?: string;
  content?: string;
}

export interface AiModelStatus {
  connected: boolean;
  model: string;
  reasoningEffort?: string;
  fastMode?: boolean;
  message?: string;
}

export interface AiConversationMessage {
  id: string;
  role: AiMessageRole;
  content: string;
  createdAt: string;
  status: AiMessageStatus;
  proposal?: AiSkillProposal;
}

export interface AiSkillProposal {
  id: string;
  mode: AiStudioMode;
  title: string;
  summary?: string;
  targetSkillId?: string;
  filePath?: string;
  before: string;
  after: string;
  diff?: string;
  warnings?: string[];
  changedFiles?: string[];
  baseRevision?: string;
  baseSourceHash: string;
  status: AiProposalStatus;
  errorMessage?: string;
}

export interface AiDesignRequest {
  mode: AiStudioMode;
  prompt: string;
  targetSkill: AiSkillTarget | null;
  currentSource: string;
  baseSourceHash: string;
  model?: string;
  reasoningEffort?: string;
  conversation: Array<Pick<AiConversationMessage, "role" | "content">>;
}

export interface AiDesignResponseObject {
  message?: string;
  content?: string;
  proposal?: Partial<AiSkillProposal>;
  title?: string;
  summary?: string;
  before?: string;
  after?: string;
  diff?: string;
  warnings?: string[];
  changedFiles?: string[];
  filePath?: string;
  baseRevision?: string;
}

export type AiDesignResponse = string | AiDesignResponseObject | AiSkillProposal;

export interface AiCallContext {
  signal: AbortSignal;
}

export type AiCallDesign = (
  request: AiDesignRequest,
  context: AiCallContext,
) => Promise<AiDesignResponse>;

export type AiApplyProposal = (proposal: AiSkillProposal) => Promise<void> | void;

export interface AiSkillStudioProps {
  selectedSkill: AiSkillTarget | null;
  currentSource: string;
  backendStatus: AiBackendStatus;
  modelStatus: AiModelStatus | null;
  onCallDesign: AiCallDesign;
  onApplyProposal: AiApplyProposal;
  onClose: () => void;
  initialMode?: AiStudioMode;
  className?: string;
}

export interface NormalizedAiDesignResponse {
  message: string;
  proposal?: AiSkillProposal;
}

export interface DiffLine {
  kind: "header" | "context" | "addition" | "deletion";
  text: string;
}
