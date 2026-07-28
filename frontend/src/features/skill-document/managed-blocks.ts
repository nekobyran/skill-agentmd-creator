import type {
  SkillContract,
  WorkflowBlueprint,
  WorkflowCondition,
  WorkflowStep,
} from "./types";

export const SKILL_CONTRACT_START_MARKER = "<!-- skill-document:skill-contract:start -->";
export const SKILL_CONTRACT_END_MARKER = "<!-- skill-document:skill-contract:end -->";
export const WORKFLOW_BLUEPRINT_START_MARKER = "<!-- skill-document:workflow-blueprint:start -->";
export const WORKFLOW_BLUEPRINT_END_MARKER = "<!-- skill-document:workflow-blueprint:end -->";

const SKILL_CONTRACT_METADATA_PREFIX = "<!-- skill-document:skill-contract:metadata:v1:";
const WORKFLOW_BLUEPRINT_METADATA_PREFIX = "<!-- skill-document:workflow-blueprint:metadata:v1:";
const METADATA_SUFFIX = " -->";
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

interface TextLine {
  content: string;
  start: number;
  end: number;
}

interface ManagedBlockLocation {
  start: number;
  end: number;
  raw: string;
}

interface ManagedBlockDefinition {
  label: string;
  startMarker: string;
  endMarker: string;
  metadataPrefix: string;
}

const CONTRACT_BLOCK: ManagedBlockDefinition = {
  label: "Skill Contract",
  startMarker: SKILL_CONTRACT_START_MARKER,
  endMarker: SKILL_CONTRACT_END_MARKER,
  metadataPrefix: SKILL_CONTRACT_METADATA_PREFIX,
};

const WORKFLOW_BLOCK: ManagedBlockDefinition = {
  label: "Workflow Blueprint",
  startMarker: WORKFLOW_BLUEPRINT_START_MARKER,
  endMarker: WORKFLOW_BLUEPRINT_END_MARKER,
  metadataPrefix: WORKFLOW_BLUEPRINT_METADATA_PREFIX,
};

export class ManagedBlockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManagedBlockError";
  }
}

export function readManagedContract(source: string): SkillContract | null {
  const metadata = readManagedMetadata(source, CONTRACT_BLOCK);
  if (metadata === null) {
    return null;
  }
  assertSkillContract(metadata);
  return metadata;
}

export function writeManagedContract(source: string, contract: SkillContract): string {
  assertSkillContract(contract);
  return writeManagedBlock(source, CONTRACT_BLOCK, renderContractBlock(contract));
}

export function removeManagedContract(source: string): string {
  return removeManagedBlock(source, CONTRACT_BLOCK);
}

export function readManagedWorkflow(source: string): WorkflowBlueprint | null {
  const metadata = readManagedMetadata(source, WORKFLOW_BLOCK);
  if (metadata === null) {
    return null;
  }
  assertWorkflowBlueprint(metadata);
  return metadata;
}

export function writeManagedWorkflow(source: string, workflow: WorkflowBlueprint): string {
  assertWorkflowBlueprint(workflow);
  return writeManagedBlock(source, WORKFLOW_BLOCK, renderWorkflowBlock(workflow));
}

export function removeManagedWorkflow(source: string): string {
  return removeManagedBlock(source, WORKFLOW_BLOCK);
}

function readManagedMetadata(source: string, definition: ManagedBlockDefinition): unknown | null {
  const location = locateManagedBlock(source, definition);
  if (!location) {
    return null;
  }
  const metadataStart = location.raw.indexOf(definition.metadataPrefix);
  if (metadataStart < 0) {
    throw new ManagedBlockError(`${definition.label} block is missing its metadata marker.`);
  }
  if (location.raw.indexOf(definition.metadataPrefix, metadataStart + definition.metadataPrefix.length) >= 0) {
    throw new ManagedBlockError(`${definition.label} block contains duplicate metadata markers.`);
  }
  const payloadStart = metadataStart + definition.metadataPrefix.length;
  const payloadEnd = location.raw.indexOf(METADATA_SUFFIX, payloadStart);
  if (payloadEnd < 0) {
    throw new ManagedBlockError(`${definition.label} metadata marker is not closed.`);
  }
  const payload = location.raw.slice(payloadStart, payloadEnd).trim();
  if (!payload) {
    throw new ManagedBlockError(`${definition.label} metadata payload is empty.`);
  }
  try {
    return JSON.parse(decodeBase64Utf8(payload)) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ManagedBlockError(`${definition.label} metadata cannot be decoded: ${reason}`);
  }
}

function writeManagedBlock(source: string, definition: ManagedBlockDefinition, blockBody: string): string {
  const newline = source.match(/\r\n|\n|\r/)?.[0] ?? "\n";
  const location = locateManagedBlock(source, definition);
  const block = blockBody.replace(/\r\n|\r|\n/g, newline);
  if (location) {
    const preservedLineEnding = location.raw.match(/(?:\r\n|\n|\r)$/)?.[0] ?? "";
    return `${source.slice(0, location.start)}${block}${preservedLineEnding}${source.slice(location.end)}`;
  }
  if (!source) {
    return `${block}${newline}`;
  }
  const withoutTrailingNewlines = source.replace(/(?:\r\n|\r|\n)+$/g, "");
  return `${withoutTrailingNewlines}${newline}${newline}${block}${newline}`;
}

function removeManagedBlock(source: string, definition: ManagedBlockDefinition): string {
  const location = locateManagedBlock(source, definition);
  if (!location) {
    return source;
  }
  const before = source.slice(0, location.start).replace(/[\t ]+$/g, "");
  const after = source.slice(location.end).replace(/^(?:\r\n|\r|\n){0,2}/, "");
  return `${before}${after}`;
}

function locateManagedBlock(source: string, definition: ManagedBlockDefinition): ManagedBlockLocation | null {
  const visibleLines = linesOutsideCodeFences(source);
  const starts = visibleLines.filter((line) => line.content.trim() === definition.startMarker);
  const ends = visibleLines.filter((line) => line.content.trim() === definition.endMarker);
  if (starts.length === 0 && ends.length === 0) {
    return null;
  }
  if (starts.length !== 1 || ends.length !== 1) {
    throw new ManagedBlockError(
      `${definition.label} requires exactly one start marker and one end marker; found ${starts.length}/${ends.length}.`,
    );
  }
  if (ends[0].start <= starts[0].start) {
    throw new ManagedBlockError(`${definition.label} end marker appears before its start marker.`);
  }
  return {
    start: starts[0].start,
    end: ends[0].end,
    raw: source.slice(starts[0].start, ends[0].end),
  };
}

function renderContractBlock(contract: SkillContract): string {
  const lines = [
    SKILL_CONTRACT_START_MARKER,
    `### Skill Contract · ${inline(contract.name)}`,
    "",
    inline(contract.summary),
  ];
  appendList(lines, "Objectives", contract.objectives);
  if (contract.triggers.length > 0) {
    lines.push("", "**Triggers**");
    contract.triggers.forEach((trigger) => {
      const details = [trigger.description, trigger.patterns?.length ? `patterns: ${trigger.patterns.join(", ")}` : ""]
        .filter(Boolean)
        .join("; ");
      lines.push(`- **${inline(trigger.label)}**${details ? ` — ${inline(details)}` : ""}`);
    });
  }
  if (contract.scopeRoutes.length > 0) {
    lines.push("", "**Scope routes**");
    contract.scopeRoutes.forEach((route) => {
      const marker = route.marker ? ` \`${inline(route.marker)}\`` : "";
      const platforms = route.platforms.length ? ` → ${route.platforms.map(inline).join(", ")}` : "";
      lines.push(`- **${inline(route.label)}**${marker}${platforms}${route.default ? " (default)" : ""}`);
    });
  }
  if (contract.rules.length > 0) {
    lines.push("", "**Rules**");
    contract.rules.forEach((rule, index) => {
      lines.push(`${index + 1}. **${inline(rule.title)}** [${rule.strength}/${rule.kind}] — ${inline(rule.statement)}`);
    });
  }
  if (contract.qualityGates.length > 0) {
    lines.push("", "**Quality gates**");
    contract.qualityGates.forEach((gate) => {
      lines.push(`- **${inline(gate.name)}**${gate.required ? " (required)" : ""} — ${inline(gate.checks.join("; "))}`);
    });
  }
  if (contract.resources.length > 0) {
    lines.push("", "**Resources**");
    contract.resources.forEach((resource) => {
      const target = resource.path ?? resource.uri ?? resource.name;
      lines.push(`- ${inline(resource.name)} [${resource.kind}] — \`${inline(target)}\``);
    });
  }
  lines.push(
    "",
    `${SKILL_CONTRACT_METADATA_PREFIX}${encodeBase64Utf8(JSON.stringify(contract))}${METADATA_SUFFIX}`,
    SKILL_CONTRACT_END_MARKER,
  );
  return lines.join("\n");
}

function renderWorkflowBlock(workflow: WorkflowBlueprint): string {
  const lines = [
    WORKFLOW_BLUEPRINT_START_MARKER,
    `### Workflow Blueprint · ${inline(workflow.name)}`,
    "",
    inline(workflow.description),
    "",
    `Entry: ${workflow.entryStepIds.map((id) => `\`${inline(id)}\``).join(", ") || "none"}`,
    `Terminal: ${workflow.terminalStepIds.map((id) => `\`${inline(id)}\``).join(", ") || "none"}`,
  ];
  if (workflow.steps.length > 0) {
    lines.push("", "**Steps**");
    workflow.steps.forEach((step, index) => renderWorkflowStep(lines, step, index));
  }
  if (workflow.qualityGates?.length) {
    lines.push("", "**Workflow gates**");
    workflow.qualityGates.forEach((gate) => {
      lines.push(`- **${inline(gate.name)}**${gate.required ? " (required)" : ""}: ${inline(gate.checks.join("; "))}`);
    });
  }
  lines.push(
    "",
    `${WORKFLOW_BLUEPRINT_METADATA_PREFIX}${encodeBase64Utf8(JSON.stringify(workflow))}${METADATA_SUFFIX}`,
    WORKFLOW_BLUEPRINT_END_MARKER,
  );
  return lines.join("\n");
}

function renderWorkflowStep(lines: string[], step: WorkflowStep, index: number): void {
  const attributes = [step.kind, `action=${step.action}`];
  if (step.platforms.length) attributes.push(`platforms=${step.platforms.join("+")}`);
  if (step.owner) attributes.push(`owner=${step.owner}`);
  if (step.agentType) attributes.push(`agent=${step.agentType}`);
  if (step.model) attributes.push(`model=${step.model}`);
  lines.push(`${index + 1}. **${inline(step.name)}** \`${inline(step.id)}\` — ${inline(attributes.join("; "))}`);
  if (step.description) lines.push(`   - ${inline(step.description)}`);
  if (step.condition) lines.push(`   - Condition: ${inline(renderCondition(step.condition))}`);
  if (step.dependsOn.length) lines.push(`   - Depends on: ${step.dependsOn.map((id) => `\`${inline(id)}\``).join(", ")}`);
  if (step.inputs.length) lines.push(`   - Inputs: ${step.inputs.map((input) => inline(input.name)).join(", ")}`);
  if (step.outputs.length) lines.push(`   - Outputs: ${step.outputs.map((output) => inline(output.name)).join(", ")}`);
  if (step.command) lines.push(`   - Command: \`${inline(step.command.command)}\``);
  if (step.tool) lines.push(`   - Tool: \`${inline([step.tool.namespace, step.tool.name, step.tool.operation].filter(Boolean).join("."))}\``);
  if (step.evidence?.length) lines.push(`   - Evidence: ${step.evidence.map((item) => inline(item.description)).join("; ")}`);
  if (step.risk && step.risk.level !== "none") lines.push(`   - Risk: ${step.risk.level}${step.risk.description ? ` — ${inline(step.risk.description)}` : ""}`);
  if (step.approval?.required) lines.push(`   - Approval: required${step.approval.reason ? ` — ${inline(step.approval.reason)}` : ""}`);
  const destructive = typeof step.destructive === "boolean" ? step.destructive : step.destructive?.destructive;
  if (destructive) lines.push("   - Destructive: yes");
}

function appendList(lines: string[], heading: string, values: string[]): void {
  if (values.length === 0) {
    return;
  }
  lines.push("", `**${heading}**`);
  values.forEach((value) => lines.push(`- ${inline(value)}`));
}

function renderCondition(condition: WorkflowCondition | string): string {
  if (typeof condition === "string") {
    return condition;
  }
  if (condition.expression) {
    return condition.expression;
  }
  return JSON.stringify(condition);
}

function inline(value: string): string {
  return value
    .replace(/\r\n|\r|\n/g, " ")
    .replace(/\|/g, "\\|")
    .replace(/<!--/g, "&lt;!--")
    .replace(/-->/g, "--&gt;")
    .trim();
}

function assertSkillContract(value: unknown): asserts value is SkillContract {
  const root = requireRecord(value, "Skill Contract");
  requireFiniteNumber(root.schemaVersion, "Skill Contract.schemaVersion");
  requireString(root.id, "Skill Contract.id");
  requireString(root.name, "Skill Contract.name");
  requireString(root.summary, "Skill Contract.summary");
  requireStringArray(root.objectives, "Skill Contract.objectives");
  requireArray(root.triggers, "Skill Contract.triggers", assertContractTrigger);
  requireArray(root.scopeRoutes, "Skill Contract.scopeRoutes", assertContractScopeRoute);
  requireArray(root.rules, "Skill Contract.rules", assertContractRule);
  optionalArray(root.inputs, "Skill Contract.inputs", assertCustomProperty);
  optionalArray(root.outputs, "Skill Contract.outputs", assertCustomProperty);
  requireArray(root.resources, "Skill Contract.resources", assertResource);
  requireStringArray(root.requiredSkills, "Skill Contract.requiredSkills");
  requireArray(root.qualityGates, "Skill Contract.qualityGates", assertContractQualityGate);
  optionalStringArray(root.completionReportFields, "Skill Contract.completionReportFields");
  optionalArray(root.properties, "Skill Contract.properties", assertCustomProperty);
  optionalExtensions(root.extensions, "Skill Contract.extensions");
}

function assertWorkflowBlueprint(value: unknown): asserts value is WorkflowBlueprint {
  const root = requireRecord(value, "Workflow Blueprint");
  requireFiniteNumber(root.schemaVersion, "Workflow Blueprint.schemaVersion");
  requireString(root.id, "Workflow Blueprint.id");
  requireString(root.name, "Workflow Blueprint.name");
  requireString(root.description, "Workflow Blueprint.description");
  requireStringArray(root.entryStepIds, "Workflow Blueprint.entryStepIds");
  requireStringArray(root.terminalStepIds, "Workflow Blueprint.terminalStepIds");
  optionalStringArray(root.states, "Workflow Blueprint.states");
  optionalArray(root.parameters, "Workflow Blueprint.parameters", assertWorkflowValue);
  requireArray(root.steps, "Workflow Blueprint.steps", assertWorkflowStep);
  optionalArray(root.transitions, "Workflow Blueprint.transitions", assertWorkflowTransition);
  optionalArray(root.resources, "Workflow Blueprint.resources", assertResource);
  optionalArray(root.qualityGates, "Workflow Blueprint.qualityGates", assertContractQualityGate);
  optionalArray(root.properties, "Workflow Blueprint.properties", assertCustomProperty);
  optionalExtensions(root.extensions, "Workflow Blueprint.extensions");
}

const CONTRACT_RULE_STRENGTHS = new Set([
  "required", "prohibited", "default", "preferred", "allowed", "conditional",
]);
const CONTRACT_RULE_KINDS = new Set([
  "trigger", "scope-route", "component-selection", "restriction", "data-path", "motion",
  "platform-boundary", "verification", "evidence", "completion-report", "collaboration",
  "conflict", "audit", "lifecycle", "custom",
]);
const RESOURCE_KINDS = new Set([
  "file", "directory", "url", "command", "tool", "asset", "template", "reference", "other",
]);
const WORKFLOW_STEP_KINDS = new Set([
  "intake", "action", "decision", "implementation", "verification", "handoff",
  "collaboration", "audit", "cleanup", "completion", "custom",
]);
const WORKFLOW_CONDITION_LANGUAGES = new Set([
  "plain", "javascript", "powershell", "regex", "jsonpath", "custom",
]);
const WORKFLOW_VALUE_TYPES = new Set([
  "string", "number", "boolean", "array", "object", "path", "markdown", "json", "unknown",
]);
const EVIDENCE_TYPES = new Set([
  "command", "test", "build", "source", "screenshot", "log", "artifact", "path", "review", "other",
]);

function assertContractTrigger(value: unknown, path: string): void {
  const item = requireRecord(value, path);
  requireString(item.id, `${path}.id`);
  requireString(item.label, `${path}.label`);
  optionalString(item.description, `${path}.description`);
  optionalStringArray(item.patterns, `${path}.patterns`);
  optionalStringArray(item.platforms, `${path}.platforms`);
  optionalStringArray(item.conditions, `${path}.conditions`);
  optionalStringArray(item.routesTo, `${path}.routesTo`);
  optionalExtensions(item.extensions, `${path}.extensions`);
}

function assertContractScopeRoute(value: unknown, path: string): void {
  const item = requireRecord(value, path);
  requireString(item.id, `${path}.id`);
  optionalString(item.marker, `${path}.marker`);
  requireString(item.label, `${path}.label`);
  optionalString(item.description, `${path}.description`);
  requireStringArray(item.platforms, `${path}.platforms`);
  optionalBoolean(item.default, `${path}.default`);
  optionalBoolean(item.sharedImplementation, `${path}.sharedImplementation`);
  optionalStringArray(item.conditions, `${path}.conditions`);
  optionalStringArray(item.verificationTargets, `${path}.verificationTargets`);
  optionalStringArray(item.relatedSkills, `${path}.relatedSkills`);
  optionalExtensions(item.extensions, `${path}.extensions`);
}

function assertContractRule(value: unknown, path: string): void {
  const item = requireRecord(value, path);
  requireString(item.id, `${path}.id`);
  requireString(item.title, `${path}.title`);
  requireString(item.statement, `${path}.statement`);
  requireEnum(item.kind, `${path}.kind`, CONTRACT_RULE_KINDS);
  requireEnum(item.strength, `${path}.strength`, CONTRACT_RULE_STRENGTHS);
  optionalEnum(item.severity, `${path}.severity`, new Set(["info", "warning", "error", "blocking"]));
  optionalStringArray(item.targets, `${path}.targets`);
  optionalStringArray(item.platforms, `${path}.platforms`);
  optionalStringArray(item.triggers, `${path}.triggers`);
  optionalStringArray(item.conditions, `${path}.conditions`);
  optionalStringArray(item.exceptions, `${path}.exceptions`);
  optionalString(item.rationale, `${path}.rationale`);
  optionalStringArray(item.examples, `${path}.examples`);
  optionalStringArray(item.pathPatterns, `${path}.pathPatterns`);
  optionalStringArray(item.requiredEvidence, `${path}.requiredEvidence`);
  optionalStringArray(item.verificationRules, `${path}.verificationRules`);
  optionalString(item.remediation, `${path}.remediation`);
  optionalStringArray(item.relatedSkills, `${path}.relatedSkills`);
  optionalBoolean(item.enabled, `${path}.enabled`);
  optionalFiniteNumber(item.order, `${path}.order`);
  optionalArray(item.properties, `${path}.properties`, assertCustomProperty);
  optionalExtensions(item.extensions, `${path}.extensions`);
}

function assertContractQualityGate(value: unknown, path: string): void {
  const item = requireRecord(value, path);
  requireString(item.id, `${path}.id`);
  requireString(item.name, `${path}.name`);
  optionalString(item.description, `${path}.description`);
  requireBoolean(item.required, `${path}.required`);
  optionalString(item.condition, `${path}.condition`);
  requireStringArray(item.checks, `${path}.checks`);
  optionalStringArray(item.evidence, `${path}.evidence`);
  optionalString(item.failureMessage, `${path}.failureMessage`);
  optionalExtensions(item.extensions, `${path}.extensions`);
}

function assertResource(value: unknown, path: string): void {
  const item = requireRecord(value, path);
  requireString(item.id, `${path}.id`);
  requireString(item.name, `${path}.name`);
  requireEnum(item.kind, `${path}.kind`, RESOURCE_KINDS);
  optionalString(item.description, `${path}.description`);
  optionalString(item.path, `${path}.path`);
  optionalString(item.uri, `${path}.uri`);
  optionalString(item.mediaType, `${path}.mediaType`);
  optionalString(item.role, `${path}.role`);
  optionalBoolean(item.required, `${path}.required`);
  optionalStringArray(item.platforms, `${path}.platforms`);
  optionalString(item.checksum, `${path}.checksum`);
  optionalString(item.content, `${path}.content`);
  optionalArray(item.properties, `${path}.properties`, assertCustomProperty);
  optionalExtensions(item.extensions, `${path}.extensions`);
}

function assertCustomProperty(value: unknown, path: string): void {
  const item = requireRecord(value, path);
  requireString(item.id, `${path}.id`);
  requireString(item.key, `${path}.key`);
  optionalString(item.label, `${path}.label`);
  optionalString(item.description, `${path}.description`);
  optionalString(item.group, `${path}.group`);
  assertCustomPropertyValue(item.value, `${path}.value`);
  optionalEnum(item.valueType, `${path}.valueType`, new Set([
    "string", "number", "boolean", "null", "array", "object", "markdown", "path", "command",
  ]));
  optionalBoolean(item.editable, `${path}.editable`);
  optionalFiniteNumber(item.order, `${path}.order`);
  if (item.validation !== undefined) assertCustomPropertyValidation(item.validation, `${path}.validation`);
  optionalExtensions(item.extensions, `${path}.extensions`);
}

function assertCustomPropertyValidation(value: unknown, path: string): void {
  const item = requireRecord(value, path);
  optionalBoolean(item.required, `${path}.required`);
  optionalFiniteNumber(item.min, `${path}.min`);
  optionalFiniteNumber(item.max, `${path}.max`);
  optionalFiniteNumber(item.minLength, `${path}.minLength`);
  optionalFiniteNumber(item.maxLength, `${path}.maxLength`);
  optionalString(item.pattern, `${path}.pattern`);
  if (item.enum !== undefined) requireArray(item.enum, `${path}.enum`, assertCustomPropertyValue);
  optionalString(item.message, `${path}.message`);
  optionalExtensions(item.extensions, `${path}.extensions`);
}

function assertWorkflowValue(value: unknown, path: string): void {
  const item = requireRecord(value, path);
  requireString(item.id, `${path}.id`);
  requireString(item.name, `${path}.name`);
  optionalString(item.description, `${path}.description`);
  optionalEnum(item.type, `${path}.type`, WORKFLOW_VALUE_TYPES);
  optionalBoolean(item.required, `${path}.required`);
  optionalBoolean(item.multiple, `${path}.multiple`);
  if (item.defaultValue !== undefined) assertCustomPropertyValue(item.defaultValue, `${path}.defaultValue`);
  optionalString(item.source, `${path}.source`);
  optionalString(item.destination, `${path}.destination`);
  if (item.validation !== undefined) assertCustomPropertyValidation(item.validation, `${path}.validation`);
  optionalExtensions(item.extensions, `${path}.extensions`);
}

function assertWorkflowStep(value: unknown, path: string): void {
  const item = requireRecord(value, path);
  requireString(item.id, `${path}.id`);
  requireString(item.name, `${path}.name`);
  optionalString(item.description, `${path}.description`);
  requireString(item.action, `${path}.action`);
  requireEnum(item.kind, `${path}.kind`, WORKFLOW_STEP_KINDS);
  if (item.condition !== undefined) assertWorkflowConditionOrString(item.condition, `${path}.condition`);
  requireArray(item.inputs, `${path}.inputs`, assertWorkflowValue);
  requireArray(item.outputs, `${path}.outputs`, assertWorkflowValue);
  if (item.command !== undefined) assertWorkflowCommand(item.command, `${path}.command`);
  if (item.tool !== undefined) assertWorkflowTool(item.tool, `${path}.tool`);
  requireStringArray(item.platforms, `${path}.platforms`);
  optionalString(item.owner, `${path}.owner`);
  optionalString(item.agentType, `${path}.agentType`);
  optionalString(item.model, `${path}.model`);
  requireStringArray(item.dependsOn, `${path}.dependsOn`);
  if (typeof item.parallel !== "boolean") assertWorkflowParallelPolicy(item.parallel, `${path}.parallel`);
  if (item.timeout !== undefined && typeof item.timeout !== "number") {
    assertWorkflowTimeoutPolicy(item.timeout, `${path}.timeout`);
  } else {
    optionalFiniteNumber(item.timeout, `${path}.timeout`);
  }
  if (item.retry !== undefined) assertWorkflowRetryPolicy(item.retry, `${path}.retry`);
  if (item.success !== undefined) assertWorkflowOutcome(item.success, `${path}.success`);
  if (item.failure !== undefined) assertWorkflowOutcome(item.failure, `${path}.failure`);
  optionalArray(item.evidence, `${path}.evidence`, assertEvidenceRequirement);
  if (item.risk !== undefined) assertWorkflowRisk(item.risk, `${path}.risk`);
  if (item.approval !== undefined) assertWorkflowApproval(item.approval, `${path}.approval`);
  if (item.destructive !== undefined && typeof item.destructive !== "boolean") {
    assertWorkflowDestructivePolicy(item.destructive, `${path}.destructive`);
  }
  optionalBoolean(item.enabled, `${path}.enabled`);
  optionalFiniteNumber(item.order, `${path}.order`);
  optionalArray(item.properties, `${path}.properties`, assertCustomProperty);
  optionalExtensions(item.extensions, `${path}.extensions`);
}

function assertWorkflowConditionOrString(value: unknown, path: string): void {
  if (typeof value === "string") return;
  assertWorkflowCondition(value, path);
}

function assertWorkflowCondition(value: unknown, path: string): void {
  const item = requireRecord(value, path);
  optionalString(item.expression, `${path}.expression`);
  optionalEnum(item.language, `${path}.language`, WORKFLOW_CONDITION_LANGUAGES);
  optionalString(item.description, `${path}.description`);
  optionalArray(item.all, `${path}.all`, assertWorkflowCondition);
  optionalArray(item.any, `${path}.any`, assertWorkflowCondition);
  if (item.not !== undefined) assertWorkflowCondition(item.not, `${path}.not`);
  optionalExtensions(item.extensions, `${path}.extensions`);
}

function assertWorkflowCommand(value: unknown, path: string): void {
  const item = requireRecord(value, path);
  optionalString(item.executable, `${path}.executable`);
  optionalString(item.shell, `${path}.shell`);
  requireString(item.command, `${path}.command`);
  optionalStringArray(item.arguments, `${path}.arguments`);
  optionalString(item.workingDirectory, `${path}.workingDirectory`);
  if (item.environment !== undefined) {
    const environment = requireRecord(item.environment, `${path}.environment`);
    Object.entries(environment).forEach(([key, entry]) => requireString(entry, `${path}.environment.${key}`));
  }
  optionalString(item.dryRunCommand, `${path}.dryRunCommand`);
  optionalExtensions(item.extensions, `${path}.extensions`);
}

function assertWorkflowTool(value: unknown, path: string): void {
  const item = requireRecord(value, path);
  requireString(item.name, `${path}.name`);
  optionalString(item.namespace, `${path}.namespace`);
  optionalString(item.operation, `${path}.operation`);
  if (item.arguments !== undefined) {
    const argumentsValue = requireRecord(item.arguments, `${path}.arguments`);
    Object.entries(argumentsValue).forEach(([key, entry]) => assertCustomPropertyValue(entry, `${path}.arguments.${key}`));
  }
  optionalBoolean(item.readOnly, `${path}.readOnly`);
  optionalExtensions(item.extensions, `${path}.extensions`);
}

function assertWorkflowParallelPolicy(value: unknown, path: string): void {
  const item = requireRecord(value, path);
  requireBoolean(item.enabled, `${path}.enabled`);
  optionalString(item.group, `${path}.group`);
  optionalFiniteNumber(item.maxConcurrency, `${path}.maxConcurrency`);
  optionalBoolean(item.waitForAll, `${path}.waitForAll`);
  optionalBoolean(item.failFast, `${path}.failFast`);
  optionalExtensions(item.extensions, `${path}.extensions`);
}

function assertWorkflowTimeoutPolicy(value: unknown, path: string): void {
  const item = requireRecord(value, path);
  requireFiniteNumber(item.seconds, `${path}.seconds`);
  optionalEnum(item.onTimeout, `${path}.onTimeout`, new Set(["fail", "retry", "continue", "escalate"]));
  optionalString(item.message, `${path}.message`);
  optionalExtensions(item.extensions, `${path}.extensions`);
}

function assertWorkflowRetryPolicy(value: unknown, path: string): void {
  const item = requireRecord(value, path);
  requireFiniteNumber(item.maxAttempts, `${path}.maxAttempts`);
  optionalFiniteNumber(item.delaySeconds, `${path}.delaySeconds`);
  optionalFiniteNumber(item.backoffMultiplier, `${path}.backoffMultiplier`);
  optionalFiniteNumber(item.maxDelaySeconds, `${path}.maxDelaySeconds`);
  optionalStringArray(item.retryOn, `${path}.retryOn`);
  optionalExtensions(item.extensions, `${path}.extensions`);
}

function assertWorkflowOutcome(value: unknown, path: string): void {
  const item = requireRecord(value, path);
  optionalString(item.status, `${path}.status`);
  optionalString(item.message, `${path}.message`);
  optionalStringArray(item.next, `${path}.next`);
  if (item.outputs !== undefined) {
    const outputs = requireRecord(item.outputs, `${path}.outputs`);
    Object.entries(outputs).forEach(([key, entry]) => assertCustomPropertyValue(entry, `${path}.outputs.${key}`));
  }
  optionalStringArray(item.actions, `${path}.actions`);
  optionalExtensions(item.extensions, `${path}.extensions`);
}

function assertEvidenceRequirement(value: unknown, path: string): void {
  const item = requireRecord(value, path);
  requireString(item.id, `${path}.id`);
  requireEnum(item.type, `${path}.type`, EVIDENCE_TYPES);
  requireString(item.description, `${path}.description`);
  optionalBoolean(item.required, `${path}.required`);
  optionalString(item.path, `${path}.path`);
  optionalString(item.command, `${path}.command`);
  optionalString(item.acceptance, `${path}.acceptance`);
  optionalExtensions(item.extensions, `${path}.extensions`);
}

function assertWorkflowRisk(value: unknown, path: string): void {
  const item = requireRecord(value, path);
  requireEnum(item.level, `${path}.level`, new Set(["none", "low", "medium", "high", "critical"]));
  optionalString(item.description, `${path}.description`);
  optionalStringArray(item.mitigations, `${path}.mitigations`);
  optionalString(item.residualRisk, `${path}.residualRisk`);
  optionalExtensions(item.extensions, `${path}.extensions`);
}

function assertWorkflowApproval(value: unknown, path: string): void {
  const item = requireRecord(value, path);
  requireBoolean(item.required, `${path}.required`);
  optionalString(item.approver, `${path}.approver`);
  optionalString(item.reason, `${path}.reason`);
  optionalString(item.prompt, `${path}.prompt`);
  optionalEnum(item.before, `${path}.before`, new Set(["plan", "execute", "apply", "complete"]));
  optionalExtensions(item.extensions, `${path}.extensions`);
}

function assertWorkflowDestructivePolicy(value: unknown, path: string): void {
  const item = requireRecord(value, path);
  requireBoolean(item.destructive, `${path}.destructive`);
  optionalBoolean(item.reversible, `${path}.reversible`);
  optionalBoolean(item.backupRequired, `${path}.backupRequired`);
  optionalBoolean(item.exactTargetRequired, `${path}.exactTargetRequired`);
  optionalBoolean(item.confirmationRequired, `${path}.confirmationRequired`);
  optionalString(item.rollback, `${path}.rollback`);
  optionalExtensions(item.extensions, `${path}.extensions`);
}

function assertWorkflowTransition(value: unknown, path: string): void {
  const item = requireRecord(value, path);
  requireString(item.id, `${path}.id`);
  requireString(item.from, `${path}.from`);
  requireString(item.to, `${path}.to`);
  if (item.condition !== undefined) assertWorkflowConditionOrString(item.condition, `${path}.condition`);
  optionalString(item.action, `${path}.action`);
  optionalFiniteNumber(item.priority, `${path}.priority`);
  optionalExtensions(item.extensions, `${path}.extensions`);
}

function assertCustomPropertyValue(value: unknown, path: string): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    requireFiniteNumber(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertCustomPropertyValue(entry, `${path}[${index}]`));
    return;
  }
  const object = requireRecord(value, path);
  Object.entries(object).forEach(([key, entry]) => assertCustomPropertyValue(entry, `${path}.${key}`));
}

function optionalExtensions(value: unknown, path: string): void {
  if (value === undefined) return;
  const extensions = requireRecord(value, path);
  Object.entries(extensions).forEach(([key, entry]) => assertCustomPropertyValue(entry, `${path}.${key}`));
}

function requireArray(
  value: unknown,
  path: string,
  assertion: (entry: unknown, entryPath: string) => void,
): asserts value is unknown[] {
  if (!Array.isArray(value)) failSchema(path, "an array");
  value.forEach((entry, index) => assertion(entry, `${path}[${index}]`));
}

function optionalArray(
  value: unknown,
  path: string,
  assertion: (entry: unknown, entryPath: string) => void,
): void {
  if (value !== undefined) requireArray(value, path, assertion);
}

function requireStringArray(value: unknown, path: string): asserts value is string[] {
  requireArray(value, path, requireString);
}

function optionalStringArray(value: unknown, path: string): void {
  if (value !== undefined) requireStringArray(value, path);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) failSchema(path, "an object");
  return value;
}

function requireString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string") failSchema(path, "a string");
}

function optionalString(value: unknown, path: string): void {
  if (value !== undefined) requireString(value, path);
}

function requireBoolean(value: unknown, path: string): asserts value is boolean {
  if (typeof value !== "boolean") failSchema(path, "a boolean");
}

function optionalBoolean(value: unknown, path: string): void {
  if (value !== undefined) requireBoolean(value, path);
}

function requireFiniteNumber(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) failSchema(path, "a finite number");
}

function optionalFiniteNumber(value: unknown, path: string): void {
  if (value !== undefined) requireFiniteNumber(value, path);
}

function requireEnum(value: unknown, path: string, allowed: Set<string>): asserts value is string {
  requireString(value, path);
  if (!allowed.has(value)) failSchema(path, `one of: ${[...allowed].join(", ")}`);
}

function optionalEnum(value: unknown, path: string, allowed: Set<string>): void {
  if (value !== undefined) requireEnum(value, path, allowed);
}

function failSchema(path: string, expected: string): never {
  throw new ManagedBlockError(`${path} must be ${expected}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function linesOutsideCodeFences(source: string): TextLine[] {
  const lines = splitLines(source);
  const visible: TextLine[] = [];
  let fence: { character: "`" | "~"; length: number } | undefined;
  for (const line of lines) {
    if (fence) {
      if (isFenceClose(line.content, fence)) {
        fence = undefined;
      }
      continue;
    }
    const match = line.content.match(FENCE_OPEN);
    if (match) {
      const marker = match[1];
      fence = { character: marker[0] as "`" | "~", length: marker.length };
      continue;
    }
    visible.push(line);
  }
  return visible;
}

function isFenceClose(content: string, fence: { character: "`" | "~"; length: number }): boolean {
  return new RegExp(`^ {0,3}${fence.character}{${fence.length},}[\\t ]*$`).test(content);
}

function splitLines(source: string): TextLine[] {
  const lines: TextLine[] = [];
  let offset = 0;
  while (offset < source.length) {
    let cursor = offset;
    while (cursor < source.length && source[cursor] !== "\r" && source[cursor] !== "\n") cursor += 1;
    let eolLength = 0;
    if (cursor < source.length) eolLength = source[cursor] === "\r" && source[cursor + 1] === "\n" ? 2 : 1;
    const end = cursor + eolLength;
    lines.push({ content: source.slice(offset, cursor), start: offset, end });
    offset = end;
  }
  return lines;
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    output += alphabet[first >> 2];
    output += alphabet[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    output += second === undefined ? "=" : alphabet[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    output += third === undefined ? "=" : alphabet[third & 0x3f];
  }
  return output;
}

function decodeBase64Utf8(value: string): string {
  const clean = value.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 !== 0) {
    throw new Error("invalid base64 payload");
  }
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes: number[] = [];
  for (let index = 0; index < clean.length; index += 4) {
    const first = alphabet.indexOf(clean[index]);
    const second = alphabet.indexOf(clean[index + 1]);
    const third = clean[index + 2] === "=" ? 0 : alphabet.indexOf(clean[index + 2]);
    const fourth = clean[index + 3] === "=" ? 0 : alphabet.indexOf(clean[index + 3]);
    if (first < 0 || second < 0 || third < 0 || fourth < 0) throw new Error("invalid base64 character");
    bytes.push((first << 2) | (second >> 4));
    if (clean[index + 2] !== "=") bytes.push(((second & 0x0f) << 4) | (third >> 2));
    if (clean[index + 3] !== "=") bytes.push(((third & 0x03) << 6) | fourth);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
}
