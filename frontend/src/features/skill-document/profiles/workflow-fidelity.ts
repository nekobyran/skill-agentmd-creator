import type { LosslessNode, LosslessSkillDocument } from "../lossless-model";
import {
  WORKFLOW_TASK_SOURCE,
  WORKFLOW_TASK_SOURCE_FENCED_CODE_BLOCK_COUNT,
  WORKFLOW_TASK_SOURCE_H2_HEADINGS,
  WORKFLOW_TASK_SOURCE_SHA256,
} from "../presets/workflow-task-source";
import {
  WORKFLOW_TASK_ACTION_NAMES,
  WORKFLOW_TASK_PARAMETER_RUNTIME,
} from "../presets/workflow-runtime-catalog";
import type {
  FidelityBinding,
  FidelityCoverageGroup,
  FidelityReport,
  IsomorphicSkillProfile,
} from "../../skill-editor/isomorphic-model";

const SECTION_RULE_COUNTS = [0, 4, 6, 17, 10, 4, 4, 5, 4, 6, 0] as const;
const EXPECTED_INLINE_CODE = 120;

export const WORKFLOW_FIDELITY_PROFILE_ID = "project-workflow-task-isomorphic-v1";

export const WORKFLOW_FIDELITY_PROFILE: IsomorphicSkillProfile = {
  id: WORKFLOW_FIDELITY_PROFILE_ID,
  name: "Project Workflow Task · 完全同构",
  description: "将真实 YAML、11 个章节、60 条规则、6 个命令示例与 19/33 运行时目录绑定到原始 source range。",
  inspect: inspectWorkflowFidelity,
};

export function inspectWorkflowFidelity(document: LosslessSkillDocument): FidelityReport {
  const markdown = document.nodes.filter((node) => node.domain === "markdown");
  const yaml = document.nodes.filter((node) => node.domain === "yaml");
  const headings = markdown.filter((node) => kind(node) === "heading").sort(byRange);
  const h1 = headings.filter((node) => node.attributes.depth === 1);
  const h2 = headings.filter((node) => node.attributes.depth === 2);
  const paragraphs = markdown.filter((node) => kind(node) === "paragraph").sort(byRange);
  const listItems = markdown.filter((node) => kind(node) === "listitem").sort(byRange);
  const codeBlocks = markdown.filter((node) => kind(node) === "code").sort(byRange);
  const inlineCode = markdown.filter((node) => kind(node) === "inlinecode").sort(byRange);
  const links = markdown.filter((node) => kind(node) === "link" || kind(node) === "linkreference").sort(byRange);
  const bindings: FidelityBinding[] = [];
  const diagnostics: string[] = [];

  for (const key of ["name", "description"]) {
    bindings.push(bind(`workflow.frontmatter.${key}`, "frontmatter", `frontmatter.${key}`, "yaml pair", findYamlPair(yaml, key)));
  }
  bindings.push(bind("workflow.heading.h1", "document", "H1 · Project Workflow Task", "heading depth=1", h1[0]));

  WORKFLOW_TASK_SOURCE_H2_HEADINGS.forEach((title, sectionIndex) => {
    const heading = h2[sectionIndex];
    bindings.push(bind(`workflow.section.${sectionIndex + 1}`, "sections", `H2 · ${title}`, "heading depth=2", heading));
    if (heading && headingText(document, heading) !== title) diagnostics.push(`章节 ${sectionIndex + 1} 标题漂移：${headingText(document, heading)}`);
    const start = heading?.range.end ?? -1;
    const end = h2[sectionIndex + 1]?.range.start ?? document.source.length;
    const items = start < 0 ? [] : listItems.filter((node) => node.range.start >= start && node.range.end <= end);
    const expected = SECTION_RULE_COUNTS[sectionIndex];
    for (let itemIndex = 0; itemIndex < expected; itemIndex += 1) {
      const node = items[itemIndex];
      bindings.push(bind(
        `workflow.rule.${sectionIndex + 1}.${itemIndex + 1}`,
        "rules",
        node ? `${title} · ${summary(document, node, 68)}` : `${title} · 规则 ${itemIndex + 1}`,
        "listItem",
        node,
      ));
    }
    if (items.length !== expected) diagnostics.push(`${title} 规则数应为 ${expected}，当前为 ${items.length}`);
  });

  codeBlocks.forEach((node, index) => bindings.push(bind(
    `workflow.command-example.${index + 1}`,
    "commands",
    `PowerShell 示例 ${index + 1} · ${summary(document, node, 56)}`,
    "code",
    node,
  )));
  paragraphs.forEach((node, index) => bindings.push(bind(
    `workflow.paragraph.${index + 1}`,
    "paragraphs",
    `段落 ${index + 1} · ${summary(document, node, 64)}`,
    "paragraph",
    node,
  )));

  const inlineExpected = Math.max(EXPECTED_INLINE_CODE, inlineCode.length);
  for (let index = 0; index < inlineExpected; index += 1) {
    const node = inlineCode[index];
    bindings.push(bind(
      `workflow.inline-code.${index + 1}`,
      "inline-code",
      node ? `行内代码 · ${summary(document, node, 44)}` : `行内代码 ${index + 1}`,
      "inlineCode",
      node,
    ));
  }
  links.forEach((node, index) => bindings.push(bind(
    `workflow.link.${index + 1}`,
    "links",
    `链接 · ${summary(document, node, 52)}`,
    kind(node),
    node,
  )));

  if (h2.length !== WORKFLOW_TASK_SOURCE_H2_HEADINGS.length) diagnostics.push(`H2 应为 11 个，当前为 ${h2.length} 个`);
  if (listItems.length !== 60) diagnostics.push(`listItem 应为 60 个，当前为 ${listItems.length} 个`);
  if (codeBlocks.length !== WORKFLOW_TASK_SOURCE_FENCED_CODE_BLOCK_COUNT) diagnostics.push(`代码示例应为 6 个，当前为 ${codeBlocks.length} 个`);
  if (inlineCode.length !== EXPECTED_INLINE_CODE) diagnostics.push(`inlineCode 应为 ${EXPECTED_INLINE_CODE} 个，当前为 ${inlineCode.length} 个`);
  diagnostics.push(`运行时目录：${WORKFLOW_TASK_ACTION_NAMES.length}/19 actions，${WORKFLOW_TASK_PARAMETER_RUNTIME.length}/33 parameters。`);
  document.diagnostics.forEach((item) => diagnostics.push(`${item.severity.toUpperCase()} ${item.code}: ${item.message}`));

  const sourceMatched = document.source === WORKFLOW_TASK_SOURCE;
  if (!sourceMatched) diagnostics.unshift("源码已偏离内置 Project Workflow Task 基准；仍按当前真实 source range 编辑。");
  const mapped = bindings.filter((item) => item.state === "mapped").length;
  const unmapped = bindings.filter((item) => item.state === "unmapped").length;
  const uneditable = bindings.filter((item) => item.state === "uneditable").length;
  return {
    profileId: WORKFLOW_FIDELITY_PROFILE_ID,
    profileName: WORKFLOW_FIDELITY_PROFILE.name,
    sourceMatched,
    sourceHash: sourceMatched ? WORKFLOW_TASK_SOURCE_SHA256 : document.sourceHash,
    expected: bindings.length,
    mapped,
    unmapped,
    uneditable,
    editable: mapped,
    coveragePercent: bindings.length ? Number(((mapped / bindings.length) * 100).toFixed(2)) : 100,
    bindings,
    groups: groups(bindings),
    diagnostics,
  };
}

function bind(semanticId: string, category: string, label: string, expectedKind: string, node?: LosslessNode): FidelityBinding {
  if (!node) return { semanticId, category, label, expectedKind, state: "unmapped", editable: false };
  const editable = node.editable || Object.values(node.fieldRanges).some((field) => field.editable);
  return {
    semanticId,
    category,
    label,
    expectedKind,
    state: editable ? "mapped" : "uneditable",
    nodeId: node.id,
    range: { ...node.range },
    editable,
  };
}

function findYamlPair(nodes: LosslessNode[], key: string) {
  return nodes
    .filter((node) => (kind(node).includes("pair") || kind(node).includes("property"))
      && (node.attributes.key === key || new RegExp(`^[\\t ]*${key}[\\t ]*:`).test(node.raw)))
    .sort(byRange)[0];
}

function kind(node: LosslessNode) {
  return node.kind.replace(/[\s_.-]+/g, "").toLowerCase();
}

function headingText(document: LosslessSkillDocument, node: LosslessNode) {
  if (typeof node.attributes.text === "string") return node.attributes.text.trim();
  return node.contentRange ? document.source.slice(node.contentRange.start, node.contentRange.end).trim() : node.raw.trim();
}

function summary(document: LosslessSkillDocument, node: LosslessNode, limit: number) {
  const value = typeof node.attributes.value === "string"
    ? node.attributes.value
    : node.contentRange
      ? document.source.slice(node.contentRange.start, node.contentRange.end)
      : node.raw;
  const compact = value.replace(/^[\t ]*(?:[-+*]|\d+[.)])[\t ]+/, "").replace(/\s+/g, " ").trim();
  return compact.length <= limit ? compact : `${compact.slice(0, limit - 1)}…`;
}

function byRange(left: LosslessNode, right: LosslessNode) {
  return left.range.start - right.range.start || right.range.end - left.range.end;
}

function groups(bindings: FidelityBinding[]): FidelityCoverageGroup[] {
  const result = new Map<string, FidelityCoverageGroup>();
  for (const binding of bindings) {
    const group = result.get(binding.category) ?? { id: binding.category, label: binding.category, expected: 0, mapped: 0, unmapped: 0, uneditable: 0 };
    group.expected += 1;
    if (binding.state === "mapped") group.mapped += 1;
    else if (binding.state === "unmapped") group.unmapped += 1;
    else group.uneditable += 1;
    result.set(binding.category, group);
  }
  return [...result.values()];
}

