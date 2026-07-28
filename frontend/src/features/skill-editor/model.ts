import type {
  SkillContract,
  SkillPreset,
  WorkflowBlueprint,
} from "../skill-document/types";

export type AdvancedSkillStudioView = "isomorphic" | "sections" | "contract" | "workflow" | "source";

export type ContractPresetInput = SkillContract | SkillPreset;

export type WorkflowPresetInput = WorkflowBlueprint | SkillPreset;

export interface AdvancedSkillAiContext {
  view: AdvancedSkillStudioView;
  selectedNodeId?: string;
  selectedSectionId?: string;
  selectedWorkflowStepId?: string;
}

export interface AdvancedSkillStudioProps {
  source: string;
  name: string;
  onSourceChange: (source: string) => void;
  onClose: () => void;
  onOpenAi: (context?: AdvancedSkillAiContext) => void;
  contractPreset?: ContractPresetInput;
  workflowPreset?: WorkflowPresetInput;
  initialView?: AdvancedSkillStudioView;
  className?: string;
}
