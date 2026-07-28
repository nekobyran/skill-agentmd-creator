import type {
  LosslessNode,
  LosslessSkillDocument,
} from "../lossless-model";
import {
  FLUTTER_DESIGN_SOURCE,
  FLUTTER_DESIGN_SOURCE_CONSTRAINT_COUNT,
  FLUTTER_DESIGN_SOURCE_SHA256,
} from "../presets/flutter-design-source";
import type {
  FidelityBinding,
  FidelityCoverageGroup,
  FidelityReport,
  IsomorphicSkillProfile,
} from "../../skill-editor/isomorphic-model";

const SECTION_EXPECTATIONS = [
  { title: "Triggers And Scope", rules: 6 },
  { title: "Material Component Selection", rules: 9 },
  { title: "Flutter UI Restrictions", rules: 11 },
  { title: "Data, Cache, And Local Persistence", rules: 8 },
  { title: "Motion And UIX Shared Entry", rules: 7 },
  { title: "Platform And Native Boundaries", rules: 7 },
  { title: "Verification And Evidence", rules: 9 },
] as const;

const FRONTMATTER_KEYS = ["name", "description"] as const;
const EXPECTED_H1 = "Flutter App Design";
const EXPECTED_PREAMBLE_PARAGRAPHS = 2;
const EXPECTED_INLINE_CODE = 40;

export const FLUTTER_FIDELITY_PROFILE_ID = "flutter-app-design-isomorphic-v1";

export const FLUTTER_FIDELITY_PROFILE: IsomorphicSkillProfile = {
  id: FLUTTER_FIDELITY_PROFILE_ID,
  name: "Flutter App Design · 完全同构",
  description: "将真实 YAML、标题、前言、57 条规则与所有行内节点绑定到原始 source range。",
  inspect: inspectFlutterFidelity,
};

export function inspectFlutterFidelity(document: LosslessSkillDocument): FidelityReport {
  const bindings: FidelityBinding[] = [];
  const diagnostics: string[] = [];
  const nodes = document.nodes;
  const markdownNodes = nodes.filter((node) => node.domain === "markdown");
  const yamlNodes = nodes.filter((node) => node.domain === "yaml");
  const headings = markdownNodes.filter(isHeading).sort(bySourceRange);
  const h1Nodes = headings.filter((node) => headingDepth(node) === 1);
  const h2Nodes = headings.filter((node) => headingDepth(node) === 2);
  const paragraphs = markdownNodes.filter((node) => normalizedKind(node) === "paragraph").sort(bySourceRange);
  const listItems = markdownNodes.filter((node) => normalizedKind(node) === "listitem").sort(bySourceRange);
  const inlineCodeNodes = markdownNodes.filter((node) => normalizedKind(node) === "inlinecode").sort(bySourceRange);
  const linkNodes = markdownNodes
    .filter((node) => normalizedKind(node) === "link" || normalizedKind(node) === "linkreference")
    .sort(bySourceRange);

  FRONTMATTER_KEYS.forEach((key) => {
    const node = findYamlProperty(yamlNodes, key);
    bindings.push(bindNode({
      semanticId: `flutter.frontmatter.${key}`,
      category: "frontmatter",
      label: `frontmatter.${key}`,
      expectedKind: "yaml property",
      node,
      detail: node ? undefined : `缺少顶层 YAML 属性 ${key}`,
    }));
  });

  const h1 = h1Nodes[0];
  bindings.push(bindNode({
    semanticId: "flutter.heading.h1",
    category: "document",
    label: `H1 · ${EXPECTED_H1}`,
    expectedKind: "heading depth=1",
    node: h1,
    detail: h1 && headingText(document, h1) !== EXPECTED_H1
      ? `当前标题为“${headingText(document, h1)}”`
      : undefined,
  }));

  const firstH2Start = h2Nodes[0]?.range.start ?? document.source.length;
  const preambleParagraphs = paragraphs.filter((node) =>
    node.range.start > (h1?.range.end ?? document.bodyRange.start)
    && node.range.end <= firstH2Start);
  for (let index = 0; index < EXPECTED_PREAMBLE_PARAGRAPHS; index += 1) {
    const node = preambleParagraphs[index];
    bindings.push(bindNode({
      semanticId: `flutter.preamble.${index + 1}`,
      category: "preamble",
      label: index === 0 ? "Flutter UI 与平台适配权威说明" : "Core rule",
      expectedKind: "paragraph",
      node,
      detail: node ? undefined : `缺少第 ${index + 1} 个前言段落`,
    }));
  }

  let globalRuleIndex = 0;
  SECTION_EXPECTATIONS.forEach((expectation, sectionIndex) => {
    const heading = h2Nodes[sectionIndex];
    const headingLabel = `H2 · ${expectation.title}`;
    bindings.push(bindNode({
      semanticId: `flutter.section.${sectionIndex + 1}`,
      category: "sections",
      label: headingLabel,
      expectedKind: "heading depth=2",
      node: heading,
      detail: heading && headingText(document, heading) !== expectation.title
        ? `标题漂移：当前为“${headingText(document, heading)}”`
        : undefined,
    }));

    const sectionStart = heading?.range.end ?? -1;
    const sectionEnd = h2Nodes[sectionIndex + 1]?.range.start ?? document.source.length;
    const sectionRules = sectionStart >= 0
      ? listItems.filter((node) => node.range.start >= sectionStart && node.range.end <= sectionEnd)
      : [];

    for (let ruleIndex = 0; ruleIndex < expectation.rules; ruleIndex += 1) {
      const ruleNumber = globalRuleIndex + 1;
      const node = sectionRules[ruleIndex];
      bindings.push(bindNode({
        semanticId: `flutter.rule.${ruleNumber}`,
        category: "rules",
        label: node
          ? `规则 ${String(ruleNumber).padStart(2, "0")} · ${nodeSummary(document, node, 72)}`
          : `规则 ${String(ruleNumber).padStart(2, "0")} · ${expectation.title}`,
        expectedKind: "listItem",
        node,
        detail: node ? undefined : `${expectation.title} 缺少第 ${ruleIndex + 1} 条规则`,
      }));
      globalRuleIndex += 1;
    }

    if (sectionRules.length !== expectation.rules) {
      diagnostics.push(
        `${expectation.title} 规则数应为 ${expectation.rules}，当前为 ${sectionRules.length}`,
      );
    }
  });

  const inlineExpected = Math.max(EXPECTED_INLINE_CODE, inlineCodeNodes.length);
  for (let index = 0; index < inlineExpected; index += 1) {
    const node = inlineCodeNodes[index];
    bindings.push(bindNode({
      semanticId: `flutter.inline-code.${index + 1}`,
      category: "inline-code",
      label: node ? `行内代码 · ${nodeSummary(document, node, 48)}` : `行内代码 ${index + 1}`,
      expectedKind: "inlineCode",
      node,
      detail: node ? undefined : `缺少基准行内代码节点 ${index + 1}`,
    }));
  }

  linkNodes.forEach((node, index) => {
    bindings.push(bindNode({
      semanticId: `flutter.link.${index + 1}`,
      category: "links",
      label: `链接 · ${nodeSummary(document, node, 56)}`,
      expectedKind: normalizedKind(node),
      node,
    }));
  });

  if (h2Nodes.length !== SECTION_EXPECTATIONS.length) {
    diagnostics.push(`H2 应为 ${SECTION_EXPECTATIONS.length} 个，当前为 ${h2Nodes.length} 个`);
  }
  if (listItems.length !== FLUTTER_DESIGN_SOURCE_CONSTRAINT_COUNT) {
    diagnostics.push(
      `规则 listItem 应为 ${FLUTTER_DESIGN_SOURCE_CONSTRAINT_COUNT} 个，当前为 ${listItems.length} 个`,
    );
  }
  if (inlineCodeNodes.length !== EXPECTED_INLINE_CODE) {
    diagnostics.push(`inlineCode 应为 ${EXPECTED_INLINE_CODE} 个，当前为 ${inlineCodeNodes.length} 个`);
  }

  const sourceMatched = document.source === FLUTTER_DESIGN_SOURCE;
  if (!sourceMatched) {
    diagnostics.unshift("源码已偏离内置 Flutter App Design 基准；节点仍按真实 source range 检查。");
  }
  document.diagnostics.forEach((diagnostic) => {
    diagnostics.push(`${diagnostic.severity.toUpperCase()} ${diagnostic.code}: ${diagnostic.message}`);
  });

  const groups = buildGroups(bindings);
  const mapped = bindings.filter((binding) => binding.state === "mapped").length;
  const unmapped = bindings.filter((binding) => binding.state === "unmapped").length;
  const uneditable = bindings.filter((binding) => binding.state === "uneditable").length;
  const expected = bindings.length;

  return {
    profileId: FLUTTER_FIDELITY_PROFILE_ID,
    profileName: FLUTTER_FIDELITY_PROFILE.name,
    sourceMatched,
    sourceHash: sourceMatched ? FLUTTER_DESIGN_SOURCE_SHA256 : document.sourceHash,
    expected,
    mapped,
    unmapped,
    uneditable,
    editable: mapped,
    coveragePercent: expected ? Number(((mapped / expected) * 100).toFixed(2)) : 100,
    bindings,
    groups,
    diagnostics,
  };
}

interface BindNodeInput {
  semanticId: string;
  category: string;
  label: string;
  expectedKind: string;
  node?: LosslessNode;
  detail?: string;
}

function bindNode(input: BindNodeInput): FidelityBinding {
  if (!input.node) {
    return {
      semanticId: input.semanticId,
      category: input.category,
      label: input.label,
      expectedKind: input.expectedKind,
      state: "unmapped",
      editable: false,
      detail: input.detail,
    };
  }

  const editable = isAddressablyEditable(input.node);
  return {
    semanticId: input.semanticId,
    category: input.category,
    label: input.label,
    expectedKind: input.expectedKind,
    state: editable ? "mapped" : "uneditable",
    nodeId: input.node.id,
    range: { ...input.node.range },
    editable,
    detail: input.detail,
  };
}

function isAddressablyEditable(node: LosslessNode): boolean {
  return node.editable || Object.values(node.fieldRanges).some((range) => range.editable);
}

function findYamlProperty(nodes: LosslessNode[], key: string): LosslessNode | undefined {
  const candidates = nodes.filter((node) => {
    const kind = normalizedKind(node);
    if (!(kind.includes("pair") || kind.includes("property"))) return false;
    const attributeKey = [node.attributes.key, node.attributes.name, node.attributes.keyValue]
      .find((value): value is string => typeof value === "string");
    if (attributeKey === key) return true;
    return new RegExp(`^[\\t ]*${escapeRegExp(key)}[\\t ]*:`).test(node.raw);
  });
  return candidates.sort((left, right) => {
    const leftScore = isAddressablyEditable(left) ? 0 : 1;
    const rightScore = isAddressablyEditable(right) ? 0 : 1;
    return leftScore - rightScore || bySourceRange(left, right);
  })[0];
}

function isHeading(node: LosslessNode): boolean {
  return normalizedKind(node) === "heading" || /^ {0,3}#{1,6}[\t ]+/.test(node.raw);
}

function headingDepth(node: LosslessNode): number | undefined {
  const depth = node.attributes.depth;
  if (typeof depth === "number" && Number.isInteger(depth)) return depth;
  return node.raw.match(/^ {0,3}(#{1,6})[\t ]+/)?.[1].length;
}

function headingText(document: LosslessSkillDocument, node: LosslessNode): string {
  const text = node.attributes.text;
  if (typeof text === "string") return text.trim();
  if (node.contentRange) return document.source.slice(node.contentRange.start, node.contentRange.end).trim();
  return node.raw.replace(/^ {0,3}#{1,6}[\t ]+/, "").replace(/[\t ]+#+[\t ]*(?:\r\n|\r|\n)?$/, "").trim();
}

function normalizedKind(node: LosslessNode): string {
  return node.kind.replace(/[\s_.-]+/g, "").toLowerCase();
}

function nodeSummary(document: LosslessSkillDocument, node: LosslessNode, limit: number): string {
  const value = typeof node.attributes.value === "string"
    ? node.attributes.value
    : node.contentRange
      ? document.source.slice(node.contentRange.start, node.contentRange.end)
      : node.raw;
  const normalized = value
    .replace(/^(?:[\t ]*[-+*][\t ]+|[\t ]*\d+[.)][\t ]+)/, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, Math.max(1, limit - 1))}…`;
}

function bySourceRange(left: LosslessNode, right: LosslessNode): number {
  return left.range.start - right.range.start || right.range.end - left.range.end;
}

function buildGroups(bindings: FidelityBinding[]): FidelityCoverageGroup[] {
  const groups = new Map<string, FidelityCoverageGroup>();
  bindings.forEach((binding) => {
    const current = groups.get(binding.category) ?? {
      id: binding.category,
      label: categoryLabel(binding.category),
      expected: 0,
      mapped: 0,
      unmapped: 0,
      uneditable: 0,
    };
    current.expected += 1;
    if (binding.state === "mapped") current.mapped += 1;
    else if (binding.state === "unmapped") current.unmapped += 1;
    else current.uneditable += 1;
    groups.set(binding.category, current);
  });
  return [...groups.values()];
}

function categoryLabel(category: string): string {
  return ({
    frontmatter: "YAML Frontmatter",
    document: "文档标题",
    preamble: "前言段落",
    sections: "二级章节",
    rules: "57 条规则",
    "inline-code": "行内代码",
    links: "链接节点",
  } as Record<string, string>)[category] ?? category;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
