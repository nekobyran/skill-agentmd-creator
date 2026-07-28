import type {
  LosslessSkillDocument,
  LosslessNode,
  SourceRange,
} from "../skill-document/lossless-model";
import type { LosslessMutationResult } from "../skill-document/lossless-mutate";

export type FidelityBindingState = "mapped" | "unmapped" | "uneditable";

export interface FidelityBinding {
  semanticId: string;
  category: string;
  label: string;
  expectedKind: string;
  state: FidelityBindingState;
  nodeId?: string;
  range?: SourceRange;
  editable: boolean;
  detail?: string;
}

export interface FidelityCoverageGroup {
  id: string;
  label: string;
  expected: number;
  mapped: number;
  unmapped: number;
  uneditable: number;
}

export interface FidelityReport {
  profileId: string;
  profileName: string;
  sourceMatched: boolean;
  sourceHash?: string;
  expected: number;
  mapped: number;
  unmapped: number;
  uneditable: number;
  editable: number;
  coveragePercent: number;
  bindings: FidelityBinding[];
  groups: FidelityCoverageGroup[];
  diagnostics: string[];
}

export interface IsomorphicSkillProfile {
  id: string;
  name: string;
  description: string;
  inspect(document: LosslessSkillDocument): FidelityReport;
}

export type IsomorphicNodeEditKind =
  | "set-field"
  | "replace-node"
  | "insert-before"
  | "insert-after"
  | "insert-child"
  | "delete-node"
  | "move-up"
  | "move-down"
  | "undo";

export type ApplyNodeEditKind = Exclude<IsomorphicNodeEditKind, "undo">;

export interface NodeEdit {
  range: SourceRange;
  replacement: string;
}

export interface ApplyNodeEditInput {
  document: LosslessSkillDocument;
  nodeId: string;
  expectedRawHash: string;
  kind: ApplyNodeEditKind;
  edits: NodeEdit[];
}

export interface IsomorphicNodeEditResult {
  kind: IsomorphicNodeEditKind;
  nodeId: string;
  previousSource: string;
  source: string;
  changedRange: SourceRange;
  replacementRange: SourceRange;
}

export interface IsomorphicSkillStudioProps {
  source: string;
  name?: string;
  profile?: IsomorphicSkillProfile;
  onSourceChange: (source: string, result?: LosslessMutationResult | IsomorphicNodeEditResult) => void;
  onClose?: () => void;
  onOpenAi?: (node?: LosslessNode) => void;
  className?: string;
}
