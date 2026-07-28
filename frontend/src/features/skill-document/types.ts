export type CustomPropertyPrimitive = string | number | boolean | null;

export type CustomPropertyValue =
  | CustomPropertyPrimitive
  | CustomPropertyValue[]
  | { [key: string]: CustomPropertyValue };

export type ExtensionMap = Record<string, CustomPropertyValue>;

export interface SourceSpan {
  path?: string;
  startLine?: number;
  endLine?: number;
  startOffset?: number;
  endOffset?: number;
}

export interface CustomPropertyValidation {
  required?: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  enum?: CustomPropertyValue[];
  message?: string;
  extensions?: ExtensionMap;
}

export interface CustomProperty {
  id: string;
  key: string;
  label?: string;
  description?: string;
  group?: string;
  value: CustomPropertyValue;
  valueType?: "string" | "number" | "boolean" | "null" | "array" | "object" | "markdown" | "path" | "command";
  editable?: boolean;
  order?: number;
  validation?: CustomPropertyValidation;
  extensions?: ExtensionMap;
}

export type ResourceKind =
  | "file"
  | "directory"
  | "url"
  | "command"
  | "tool"
  | "asset"
  | "template"
  | "reference"
  | "other";

export interface Resource {
  id: string;
  name: string;
  kind: ResourceKind;
  description?: string;
  path?: string;
  uri?: string;
  mediaType?: string;
  role?: string;
  required?: boolean;
  platforms?: string[];
  checksum?: string;
  content?: string;
  properties?: CustomProperty[];
  extensions?: ExtensionMap;
}

export type FrontmatterLineKind = "property" | "continuation" | "comment" | "blank" | "raw";

export interface FrontmatterLine {
  kind: FrontmatterLineKind;
  raw: string;
  content: string;
  eol: string;
  key?: string;
  value?: CustomPropertyValue;
  rawValue?: string;
}

export interface FrontmatterDocument {
  present: boolean;
  openingRaw: string;
  closingRaw: string;
  lines: FrontmatterLine[];
  data: Record<string, CustomPropertyValue>;
  order: string[];
  newline: string;
  sourceSpan?: SourceSpan;
  extensions?: ExtensionMap;
}

export interface Section {
  id: string;
  title: string;
  headingRaw: string;
  body: string;
  order: number;
  sourceSpan?: SourceSpan;
  properties?: CustomProperty[];
  extensions?: ExtensionMap;
}

export type ContractRuleStrength = "required" | "prohibited" | "default" | "preferred" | "allowed" | "conditional";

export type ContractRuleKind =
  | "trigger"
  | "scope-route"
  | "component-selection"
  | "restriction"
  | "data-path"
  | "motion"
  | "platform-boundary"
  | "verification"
  | "evidence"
  | "completion-report"
  | "collaboration"
  | "conflict"
  | "audit"
  | "lifecycle"
  | "custom";

export interface ContractTrigger {
  id: string;
  label: string;
  description?: string;
  patterns?: string[];
  platforms?: string[];
  conditions?: string[];
  routesTo?: string[];
  extensions?: ExtensionMap;
}

export interface ContractScopeRoute {
  id: string;
  marker?: string;
  label: string;
  description?: string;
  platforms: string[];
  default?: boolean;
  sharedImplementation?: boolean;
  conditions?: string[];
  verificationTargets?: string[];
  relatedSkills?: string[];
  extensions?: ExtensionMap;
}

export interface ContractRule {
  id: string;
  title: string;
  statement: string;
  kind: ContractRuleKind;
  strength: ContractRuleStrength;
  severity?: "info" | "warning" | "error" | "blocking";
  targets?: string[];
  platforms?: string[];
  triggers?: string[];
  conditions?: string[];
  exceptions?: string[];
  rationale?: string;
  examples?: string[];
  pathPatterns?: string[];
  requiredEvidence?: string[];
  verificationRules?: string[];
  remediation?: string;
  relatedSkills?: string[];
  enabled?: boolean;
  order?: number;
  sourceSpan?: SourceSpan;
  properties?: CustomProperty[];
  extensions?: ExtensionMap;
}

export interface ContractQualityGate {
  id: string;
  name: string;
  description?: string;
  required: boolean;
  condition?: string;
  checks: string[];
  evidence?: string[];
  failureMessage?: string;
  extensions?: ExtensionMap;
}

export interface SkillContract {
  schemaVersion: number;
  id: string;
  name: string;
  summary: string;
  objectives: string[];
  triggers: ContractTrigger[];
  scopeRoutes: ContractScopeRoute[];
  rules: ContractRule[];
  inputs?: CustomProperty[];
  outputs?: CustomProperty[];
  resources: Resource[];
  requiredSkills: string[];
  qualityGates: ContractQualityGate[];
  completionReportFields?: string[];
  properties?: CustomProperty[];
  extensions?: ExtensionMap;
}

export type WorkflowStepKind =
  | "intake"
  | "action"
  | "decision"
  | "implementation"
  | "verification"
  | "handoff"
  | "collaboration"
  | "audit"
  | "cleanup"
  | "completion"
  | "custom";

export interface WorkflowCondition {
  expression?: string;
  language?: "plain" | "javascript" | "powershell" | "regex" | "jsonpath" | "custom";
  description?: string;
  all?: WorkflowCondition[];
  any?: WorkflowCondition[];
  not?: WorkflowCondition;
  extensions?: ExtensionMap;
}

export interface WorkflowValue {
  id: string;
  name: string;
  description?: string;
  type?: "string" | "number" | "boolean" | "array" | "object" | "path" | "markdown" | "json" | "unknown";
  required?: boolean;
  multiple?: boolean;
  defaultValue?: CustomPropertyValue;
  source?: string;
  destination?: string;
  validation?: CustomPropertyValidation;
  extensions?: ExtensionMap;
}

export interface WorkflowCommand {
  executable?: string;
  shell?: string;
  command: string;
  arguments?: string[];
  workingDirectory?: string;
  environment?: Record<string, string>;
  dryRunCommand?: string;
  extensions?: ExtensionMap;
}

export interface WorkflowTool {
  name: string;
  namespace?: string;
  operation?: string;
  arguments?: Record<string, CustomPropertyValue>;
  readOnly?: boolean;
  extensions?: ExtensionMap;
}

export interface WorkflowParallelPolicy {
  enabled: boolean;
  group?: string;
  maxConcurrency?: number;
  waitForAll?: boolean;
  failFast?: boolean;
  extensions?: ExtensionMap;
}

export interface WorkflowTimeoutPolicy {
  seconds: number;
  onTimeout?: "fail" | "retry" | "continue" | "escalate";
  message?: string;
  extensions?: ExtensionMap;
}

export interface WorkflowRetryPolicy {
  maxAttempts: number;
  delaySeconds?: number;
  backoffMultiplier?: number;
  maxDelaySeconds?: number;
  retryOn?: string[];
  extensions?: ExtensionMap;
}

export interface WorkflowOutcome {
  status?: string;
  message?: string;
  next?: string[];
  outputs?: Record<string, CustomPropertyValue>;
  actions?: string[];
  extensions?: ExtensionMap;
}

export interface EvidenceRequirement {
  id: string;
  type: "command" | "test" | "build" | "source" | "screenshot" | "log" | "artifact" | "path" | "review" | "other";
  description: string;
  required?: boolean;
  path?: string;
  command?: string;
  acceptance?: string;
  extensions?: ExtensionMap;
}

export interface WorkflowRisk {
  level: "none" | "low" | "medium" | "high" | "critical";
  description?: string;
  mitigations?: string[];
  residualRisk?: string;
  extensions?: ExtensionMap;
}

export interface WorkflowApproval {
  required: boolean;
  approver?: string;
  reason?: string;
  prompt?: string;
  before?: "plan" | "execute" | "apply" | "complete";
  extensions?: ExtensionMap;
}

export interface WorkflowDestructivePolicy {
  destructive: boolean;
  reversible?: boolean;
  backupRequired?: boolean;
  exactTargetRequired?: boolean;
  confirmationRequired?: boolean;
  rollback?: string;
  extensions?: ExtensionMap;
}

export interface WorkflowStep {
  id: string;
  name: string;
  description?: string;
  action: string;
  kind: WorkflowStepKind;
  condition?: WorkflowCondition | string;
  inputs: WorkflowValue[];
  outputs: WorkflowValue[];
  command?: WorkflowCommand;
  tool?: WorkflowTool;
  platforms: string[];
  owner?: string;
  agentType?: string;
  model?: string;
  dependsOn: string[];
  parallel: boolean | WorkflowParallelPolicy;
  timeout?: number | WorkflowTimeoutPolicy;
  retry?: WorkflowRetryPolicy;
  success?: WorkflowOutcome;
  failure?: WorkflowOutcome;
  evidence?: EvidenceRequirement[];
  risk?: WorkflowRisk;
  approval?: WorkflowApproval;
  destructive?: boolean | WorkflowDestructivePolicy;
  enabled?: boolean;
  order?: number;
  properties?: CustomProperty[];
  extensions?: ExtensionMap;
}

export interface WorkflowTransition {
  id: string;
  from: string;
  to: string;
  condition?: WorkflowCondition | string;
  action?: string;
  priority?: number;
  extensions?: ExtensionMap;
}

export interface WorkflowBlueprint {
  schemaVersion: number;
  id: string;
  name: string;
  description: string;
  entryStepIds: string[];
  terminalStepIds: string[];
  states?: string[];
  parameters?: WorkflowValue[];
  steps: WorkflowStep[];
  transitions?: WorkflowTransition[];
  resources?: Resource[];
  qualityGates?: ContractQualityGate[];
  properties?: CustomProperty[];
  extensions?: ExtensionMap;
}

export interface SkillDocument {
  schemaVersion: number;
  id: string;
  bom: string;
  newline: string;
  hasTrailingNewline: boolean;
  frontmatter: FrontmatterDocument;
  preamble: string;
  sections: Section[];
  sourcePath?: string;
  properties?: CustomProperty[];
  extensions?: ExtensionMap;
}

export interface SkillPreset {
  id: string;
  name: string;
  description: string;
  document: SkillDocument;
  contract: SkillContract;
  workflow: WorkflowBlueprint;
  resources: Resource[];
  properties?: CustomProperty[];
  extensions?: ExtensionMap;
}

