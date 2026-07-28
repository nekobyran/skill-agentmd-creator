import {
  SKILL_CONTRACT_END_MARKER,
  SKILL_CONTRACT_START_MARKER,
  WORKFLOW_BLUEPRINT_END_MARKER,
  WORKFLOW_BLUEPRINT_START_MARKER,
} from "../skill-document/managed-blocks";
import type {
  SkillContract,
  SkillPreset,
  WorkflowBlueprint,
  WorkflowStep,
} from "../skill-document/types";
import type { ContractPresetInput, WorkflowPresetInput } from "./model";

export interface EditableSectionBody {
  editableBody: string;
  managedSuffix: string;
  managedTailHidden: boolean;
}

export function createEmptyContract(name: string): SkillContract {
  const normalizedName = name.trim() || "Untitled Skill";
  return {
    schemaVersion: 1,
    id: uniqueEntityId([], slugify(normalizedName) || "skill-contract"),
    name: normalizedName,
    summary: "",
    objectives: [],
    triggers: [],
    scopeRoutes: [],
    rules: [],
    resources: [],
    requiredSkills: [],
    qualityGates: [],
    properties: [],
    extensions: {},
  };
}

export function createEmptyWorkflow(name: string): WorkflowBlueprint {
  const normalizedName = name.trim() || "Untitled Skill";
  return {
    schemaVersion: 1,
    id: uniqueEntityId([], `${slugify(normalizedName) || "skill"}-workflow`),
    name: `${normalizedName} Workflow`,
    description: "",
    entryStepIds: [],
    terminalStepIds: [],
    states: [],
    parameters: [],
    steps: [],
    transitions: [],
    resources: [],
    qualityGates: [],
    properties: [],
    extensions: {},
  };
}

export function createEmptyWorkflowStep(workflow: WorkflowBlueprint): WorkflowStep {
  const id = uniqueEntityId(workflow.steps.map((step) => step.id), "step");
  return {
    id,
    name: "新步骤",
    description: "",
    action: "",
    kind: "action",
    inputs: [],
    outputs: [],
    platforms: [],
    dependsOn: [],
    parallel: false,
    enabled: true,
    order: workflow.steps.length,
    properties: [],
    extensions: {},
  };
}

export function withWorkflowStepOrder(steps: WorkflowStep[]) {
  return steps.map((step, order) => ({ ...step, order }));
}

export function listToText(values: string[] | undefined) {
  return values?.join("\n") ?? "";
}

export function textToList(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item, index, values) => Boolean(item) && values.indexOf(item) === index);
}

export function formatStructuredValue(value: unknown) {
  if (value === undefined) return "";
  return JSON.stringify(value, null, 2);
}

export function parseStructuredValue(value: string, allowPlainString = false): unknown {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (allowPlainString && !/^[{["\d\-tfn]/.test(trimmed)) return trimmed;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch (error) {
    if (allowPlainString) return trimmed;
    throw error;
  }
}

export function splitEditableSectionBody(body: string): EditableSectionBody {
  const starts = [SKILL_CONTRACT_START_MARKER, WORKFLOW_BLUEPRINT_START_MARKER]
    .map((marker) => body.indexOf(marker))
    .filter((index) => index >= 0);
  if (!starts.length) {
    return { editableBody: body, managedSuffix: "", managedTailHidden: false };
  }

  const firstManagedIndex = Math.min(...starts);
  const suffix = body.slice(firstManagedIndex);
  const residue = removeMarkerBlock(
    removeMarkerBlock(suffix, SKILL_CONTRACT_START_MARKER, SKILL_CONTRACT_END_MARKER),
    WORKFLOW_BLUEPRINT_START_MARKER,
    WORKFLOW_BLUEPRINT_END_MARKER,
  );
  if (residue.trim()) {
    return { editableBody: body, managedSuffix: "", managedTailHidden: false };
  }
  return {
    editableBody: body.slice(0, firstManagedIndex),
    managedSuffix: suffix,
    managedTailHidden: true,
  };
}

export function contractFromPreset(input: ContractPresetInput): SkillContract {
  if (isSkillPreset(input)) return cloneValue(input.contract);
  return cloneValue(input);
}

export function workflowFromPreset(input: WorkflowPresetInput): WorkflowBlueprint {
  if (isSkillPreset(input)) return cloneValue(input.workflow);
  return cloneValue(input);
}

export function presetName(input: ContractPresetInput | WorkflowPresetInput) {
  return isSkillPreset(input) ? input.name : input.name;
}

export function uniqueEntityId(existing: string[], preferred: string) {
  const base = slugify(preferred) || "item";
  if (!existing.includes(base)) return base;
  let suffix = 2;
  while (existing.includes(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function isSkillPreset(value: ContractPresetInput | WorkflowPresetInput): value is SkillPreset {
  return isRecord(value) && isRecord(value.contract) && isRecord(value.workflow) && isRecord(value.document);
}

function removeMarkerBlock(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  if (start < 0) return source;
  const endStart = source.indexOf(endMarker, start + startMarker.length);
  if (endStart < 0) return source;
  return `${source.slice(0, start)}${source.slice(endStart + endMarker.length)}`;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
