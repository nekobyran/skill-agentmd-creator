import { gfmFromMarkdown } from "mdast-util-gfm";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import {
  isAlias,
  isMap,
  isPair,
  isScalar,
  isSeq,
  parseDocument,
} from "yaml";

import type {
  FieldRange,
  FrontmatterBoundary,
  LosslessCoverage,
  LosslessDiagnostic,
  LosslessNode,
  LosslessNodeDomain,
  LosslessSkillDocument,
  NewlineProfile,
  SourceRange,
} from "./lossless-model";

interface MdastPointLike {
  offset?: number;
}

interface MdastPositionLike {
  start: MdastPointLike;
  end: MdastPointLike;
}

interface MdastNodeLike {
  type: string;
  position?: MdastPositionLike;
  children?: MdastNodeLike[];
  [key: string]: unknown;
}

interface LineSlice {
  start: number;
  contentEnd: number;
  end: number;
  eol: "\r\n" | "\n" | "\r" | "";
}

interface MutableParseState {
  source: string;
  nodes: LosslessNode[];
  nodeIndex: Record<string, LosslessNode>;
  diagnostics: LosslessDiagnostic[];
  usedIds: Set<string>;
  diagnosticSequence: number;
}

interface NodeInput {
  id: string;
  parentId: string | null;
  domain: LosslessNodeDomain;
  kind: string;
  path?: Array<string | number>;
  range: SourceRange;
  contentRange?: SourceRange;
  fieldRanges?: Record<string, FieldRange>;
  editable?: boolean;
  coverageRole: LosslessNode["coverageRole"];
  attributes?: Record<string, unknown>;
}

const EMPTY_RANGE: SourceRange = { start: 0, end: 0 };

/** A deterministic, synchronous hash suitable for stale source-slice guards. */
export function hashLosslessSource(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    hash ^= codeUnit & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= codeUnit >>> 8;
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function clampRange(range: SourceRange, sourceLength: number): SourceRange {
  const start = Math.max(0, Math.min(sourceLength, Math.trunc(range.start)));
  const end = Math.max(start, Math.min(sourceLength, Math.trunc(range.end)));
  return { start, end };
}

function makeFieldRange(source: string, range: SourceRange, editable = true): FieldRange {
  const normalized = clampRange(range, source.length);
  return {
    ...normalized,
    raw: source.slice(normalized.start, normalized.end),
    editable,
  };
}

function uniqueId(state: MutableParseState, requested: string): string {
  if (!state.usedIds.has(requested)) {
    state.usedIds.add(requested);
    return requested;
  }

  let suffix = 2;
  while (state.usedIds.has(`${requested}#${suffix}`)) suffix += 1;
  const id = `${requested}#${suffix}`;
  state.usedIds.add(id);
  return id;
}

function addNode(state: MutableParseState, input: NodeInput): LosslessNode {
  const range = clampRange(input.range, state.source.length);
  const id = uniqueId(state, input.id);
  const raw = state.source.slice(range.start, range.end);
  const node: LosslessNode = {
    id,
    parentId: input.parentId,
    children: [],
    domain: input.domain,
    kind: input.kind,
    path: input.path ?? [],
    range,
    contentRange: input.contentRange
      ? clampRange(input.contentRange, state.source.length)
      : undefined,
    fieldRanges: input.fieldRanges ?? {},
    raw,
    rawHash: hashLosslessSource(raw),
    editable: input.editable ?? true,
    coverageRole: input.coverageRole,
    attributes: input.attributes ?? {},
  };
  state.nodes.push(node);
  state.nodeIndex[id] = node;
  if (input.parentId) state.nodeIndex[input.parentId]?.children.push(id);
  return node;
}

function addDiagnostic(
  state: MutableParseState,
  diagnostic: Omit<LosslessDiagnostic, "id">,
): void {
  state.diagnosticSequence += 1;
  state.diagnostics.push({
    id: `${diagnostic.source}:${diagnostic.code}:${state.diagnosticSequence}`,
    ...diagnostic,
    range: diagnostic.range
      ? clampRange(diagnostic.range, state.source.length)
      : undefined,
  });
}

function readLine(source: string, start: number): LineSlice {
  let cursor = start;
  while (cursor < source.length && source[cursor] !== "\r" && source[cursor] !== "\n") {
    cursor += 1;
  }
  const contentEnd = cursor;
  let eol: LineSlice["eol"] = "";
  if (source[cursor] === "\r" && source[cursor + 1] === "\n") {
    cursor += 2;
    eol = "\r\n";
  } else if (source[cursor] === "\r") {
    cursor += 1;
    eol = "\r";
  } else if (source[cursor] === "\n") {
    cursor += 1;
    eol = "\n";
  }
  return { start, contentEnd, end: cursor, eol };
}

function newlineProfile(source: string): NewlineProfile {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  let first: NewlineProfile["first"] = "";
  const expression = /\r\n|\r|\n/g;
  for (let match = expression.exec(source); match; match = expression.exec(source)) {
    const newline = match[0] as "\r\n" | "\n" | "\r";
    if (!first) first = newline;
    if (newline === "\r\n") crlf += 1;
    else if (newline === "\n") lf += 1;
    else cr += 1;
  }

  const counts: Array<[NewlineProfile["dominant"], number]> = [
    ["\r\n", crlf],
    ["\n", lf],
    ["\r", cr],
  ];
  counts.sort((left, right) => right[1] - left[1]);
  const dominant = counts[0][1] > 0 ? counts[0][0] : "";
  const styles = Number(crlf > 0) + Number(lf > 0) + Number(cr > 0);
  return { first, dominant, crlf, lf, cr, mixed: styles > 1 };
}

function findFrontmatter(source: string, bomLength: number): FrontmatterBoundary {
  const absent: FrontmatterBoundary = {
    present: false,
    terminated: true,
    marker: null,
    closingMarker: null,
    range: null,
    openingRange: null,
    contentRange: null,
    closingRange: null,
    bodyRange: { start: bomLength, end: source.length },
    rootId: null,
    value: null,
  };
  if (bomLength >= source.length) return absent;

  const opening = readLine(source, bomLength);
  if (!/^---[\t ]*$/.test(source.slice(opening.start, opening.contentEnd))) return absent;

  let cursor = opening.end;
  while (cursor < source.length) {
    const line = readLine(source, cursor);
    const text = source.slice(line.start, line.contentEnd);
    const closing = /^(---|\.\.\.)[\t ]*$/.exec(text);
    if (closing) {
      return {
        present: true,
        terminated: true,
        marker: "---",
        closingMarker: closing[1] as "---" | "...",
        range: { start: opening.start, end: line.end },
        openingRange: { start: opening.start, end: opening.end },
        contentRange: { start: opening.end, end: line.start },
        closingRange: { start: line.start, end: line.end },
        bodyRange: { start: line.end, end: source.length },
        rootId: null,
        value: null,
      };
    }
    if (line.end <= cursor) break;
    cursor = line.end;
  }

  return {
    present: true,
    terminated: false,
    marker: "---",
    closingMarker: null,
    range: { start: opening.start, end: source.length },
    openingRange: { start: opening.start, end: opening.end },
    contentRange: { start: opening.end, end: source.length },
    closingRange: null,
    bodyRange: { start: source.length, end: source.length },
    rootId: null,
    value: null,
  };
}

function tokenSourceRange(token: unknown): SourceRange | null {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  const seen = new Set<object>();

  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    const record = value as Record<string, unknown>;
    if (typeof record.offset === "number" && typeof record.source === "string") {
      start = Math.min(start, record.offset);
      end = Math.max(end, record.offset + record.source.length);
    }
    Object.values(record).forEach(visit);
  };

  visit(token);
  return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null;
}

function yamlRelativeRange(value: unknown, contentLength: number): SourceRange {
  if (isPair(value)) {
    const tokenRange = tokenSourceRange(value.srcToken);
    if (tokenRange) return clampRange(tokenRange, contentLength);
    const childRanges = [value.key, value.value]
      .map((child) => yamlRelativeRange(child, contentLength))
      .filter((range) => range.end > range.start);
    if (childRanges.length > 0) {
      return {
        start: Math.min(...childRanges.map((range) => range.start)),
        end: Math.max(...childRanges.map((range) => range.end)),
      };
    }
    return EMPTY_RANGE;
  }

  if (isAlias(value) || isMap(value) || isScalar(value) || isSeq(value)) {
    const range = value.range;
    if (range) return clampRange({ start: range[0], end: range[2] }, contentLength);
    const tokenRange = tokenSourceRange(value.srcToken);
    if (tokenRange) return clampRange(tokenRange, contentLength);
  }
  return EMPTY_RANGE;
}

function yamlValueRange(value: unknown, contentLength: number): SourceRange | null {
  if (isAlias(value) || isMap(value) || isScalar(value) || isSeq(value)) {
    if (value.range) {
      return clampRange({ start: value.range[0], end: value.range[1] }, contentLength);
    }
  }
  return null;
}

function absoluteRange(relative: SourceRange, base: number): SourceRange {
  return { start: base + relative.start, end: base + relative.end };
}

function yamlKind(value: unknown): string {
  if (isPair(value)) return "pair";
  if (isMap(value)) return value.flow ? "flowMap" : "map";
  if (isSeq(value)) return value.flow ? "flowSequence" : "sequence";
  if (isAlias(value)) return "alias";
  if (isScalar(value)) return "scalar";
  return "unknown";
}

function yamlKeyLabel(value: unknown, fallback: number): string | number {
  if (isScalar(value)) {
    const scalar = value.value;
    if (typeof scalar === "string" || typeof scalar === "number") return scalar;
    if (typeof scalar === "boolean" || scalar === null) return String(scalar);
  }
  if (isAlias(value)) return `*${value.source}`;
  return fallback;
}

function yamlAttributes(value: unknown): Record<string, unknown> {
  if (isPair(value)) return { key: yamlKeyLabel(value.key, 0) };
  if (isScalar(value)) {
    return {
      value: value.value,
      source: value.source,
      style: value.type ?? "PLAIN",
      anchor: value.anchor ?? null,
      tag: value.tag ?? null,
      comment: value.comment ?? null,
      commentBefore: value.commentBefore ?? null,
    };
  }
  if (isAlias(value)) return { source: value.source };
  if (isMap(value) || isSeq(value)) {
    return {
      flow: Boolean(value.flow),
      anchor: value.anchor ?? null,
      tag: value.tag ?? null,
      comment: value.comment ?? null,
      commentBefore: value.commentBefore ?? null,
      itemCount: value.items.length,
    };
  }
  return {};
}

function pathId(path: Array<string | number>): string {
  if (path.length === 0) return "root";
  return path
    .map((part) => encodeURIComponent(String(part)).replaceAll("%", "~"))
    .join("/");
}

function addYamlTree(
  state: MutableParseState,
  value: unknown,
  parentId: string,
  path: Array<string | number>,
  contentRange: SourceRange,
  role = "node",
): LosslessNode {
  const contentLength = contentRange.end - contentRange.start;
  const relativeRange = yamlRelativeRange(value, contentLength);
  const range = absoluteRange(relativeRange, contentRange.start);
  const kind = yamlKind(value);
  const fieldRanges: Record<string, FieldRange> = {};

  if (isPair(value)) {
    const keyRange = yamlValueRange(value.key, contentLength);
    const valueRange = yamlValueRange(value.value, contentLength);
    if (keyRange) fieldRanges.key = makeFieldRange(state.source, absoluteRange(keyRange, contentRange.start));
    if (valueRange) fieldRanges.value = makeFieldRange(state.source, absoluteRange(valueRange, contentRange.start));
  } else {
    const scalarRange = yamlValueRange(value, contentLength);
    if (scalarRange && (isScalar(value) || isAlias(value))) {
      fieldRanges.value = makeFieldRange(
        state.source,
        absoluteRange(scalarRange, contentRange.start),
      );
    }
  }

  const node = addNode(state, {
    id: `yaml:${pathId(path)}:${role}:${kind}`,
    parentId,
    domain: "yaml",
    kind,
    path,
    range,
    contentRange: fieldRanges.value
      ? { start: fieldRanges.value.start, end: fieldRanges.value.end }
      : undefined,
    fieldRanges,
    coverageRole: isScalar(value) || isAlias(value) || (!isPair(value) && !isMap(value) && !isSeq(value))
      ? "leaf"
      : "container",
    attributes: yamlAttributes(value),
  });

  if (isPair(value)) {
    addYamlTree(state, value.key, node.id, [...path, "$key"], contentRange, "key");
    if (value.value !== null && value.value !== undefined) {
      addYamlTree(state, value.value, node.id, [...path, "$value"], contentRange, "value");
    }
  } else if (isMap(value)) {
    value.items.forEach((pair, index) => {
      const key = isPair(pair) ? yamlKeyLabel(pair.key, index) : index;
      addYamlTree(state, pair, node.id, [...path, key], contentRange, `pair-${index}`);
    });
  } else if (isSeq(value)) {
    value.items.forEach((item, index) => {
      if (item !== null && item !== undefined) {
        addYamlTree(state, item, node.id, [...path, index], contentRange, `item-${index}`);
      }
    });
  }
  return node;
}

function mdastRange(node: MdastNodeLike, bodyStart: number, sourceLength: number): SourceRange {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (typeof start !== "number" || typeof end !== "number") {
    return { start: bodyStart, end: bodyStart };
  }
  return clampRange({ start: bodyStart + start, end: bodyStart + end }, sourceLength);
}

function childRange(
  children: MdastNodeLike[] | undefined,
  bodyStart: number,
  sourceLength: number,
): SourceRange | null {
  if (!children || children.length === 0) return null;
  const ranges = children
    .map((child) => mdastRange(child, bodyStart, sourceLength))
    .filter((range) => range.end >= range.start);
  if (ranges.length === 0) return null;
  return {
    start: Math.min(...ranges.map((range) => range.start)),
    end: Math.max(...ranges.map((range) => range.end)),
  };
}

function mdastText(node: MdastNodeLike): string {
  if (typeof node.value === "string") return node.value;
  if (node.type === "image" && typeof node.alt === "string") return node.alt;
  return (node.children ?? []).map(mdastText).join("");
}

function findCheckboxRange(raw: string, absoluteStart: number): SourceRange | null {
  const match = /^(?:[\t ]*)(?:[-+*]|\d+[.)])[\t ]+(\[[ xX]\])/.exec(raw);
  if (!match || match.index === undefined) return null;
  const relativeStart = match[0].lastIndexOf(match[1]);
  return {
    start: absoluteStart + relativeStart,
    end: absoluteStart + relativeStart + match[1].length,
  };
}

function findInlineCodeValueRange(raw: string, absoluteStart: number): SourceRange | null {
  const opening = /^(`+)/.exec(raw);
  if (!opening) return null;
  const marker = opening[1];
  const closingStart = raw.lastIndexOf(marker);
  if (closingStart < marker.length) return null;
  return {
    start: absoluteStart + marker.length,
    end: absoluteStart + closingStart,
  };
}

function lineEndingLengthBefore(value: string, offset: number): number {
  if (offset >= 2 && value.slice(offset - 2, offset) === "\r\n") return 2;
  if (offset >= 1 && (value[offset - 1] === "\n" || value[offset - 1] === "\r")) return 1;
  return 0;
}

function codeFieldRanges(source: string, range: SourceRange): Record<string, FieldRange> {
  const raw = source.slice(range.start, range.end);
  const fields: Record<string, FieldRange> = {};
  const opening = /^(?:[\t ]{0,3})(`{3,}|~{3,})([^\r\n]*)/.exec(raw);
  if (!opening) {
    fields.value = makeFieldRange(source, range);
    return fields;
  }

  const marker = opening[1];
  const rest = opening[2];
  const restOffset = opening[0].length - rest.length;
  const leading = /^\s*/.exec(rest)?.[0].length ?? 0;
  const trailing = /\s*$/.exec(rest)?.[0].length ?? 0;
  const infoStart = restOffset + leading;
  const infoEnd = restOffset + Math.max(leading, rest.length - trailing);
  fields.info = makeFieldRange(source, {
    start: range.start + infoStart,
    end: range.start + infoEnd,
  });

  const openingLine = readLine(raw, 0);
  const contentStart = openingLine.end;
  let cursor = contentStart;
  let closingStart = raw.length;
  while (cursor < raw.length) {
    const line = readLine(raw, cursor);
    const lineText = raw.slice(line.start, line.contentEnd);
    const closing = /^(?:[\t ]{0,3})(`{3,}|~{3,})[\t ]*$/.exec(lineText);
    if (closing && closing[1][0] === marker[0] && closing[1].length >= marker.length) {
      closingStart = line.start;
      break;
    }
    if (line.end <= cursor) break;
    cursor = line.end;
  }
  const separatorLength = closingStart < raw.length
    ? lineEndingLengthBefore(raw, closingStart)
    : 0;
  fields.value = makeFieldRange(source, {
    start: range.start + contentStart,
    end: range.start + Math.max(contentStart, closingStart - separatorLength),
  });
  return fields;
}

function findInlineLinkUrlRange(raw: string, absoluteStart: number): SourceRange | null {
  if (raw.startsWith("<") && raw.endsWith(">")) {
    return { start: absoluteStart + 1, end: absoluteStart + raw.length - 1 };
  }

  let bracketDepth = 0;
  let escaped = false;
  let closeBracket = -1;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "[") bracketDepth += 1;
    if (character === "]") {
      bracketDepth -= 1;
      if (bracketDepth === 0) {
        closeBracket = index;
        break;
      }
    }
  }
  if (closeBracket < 0) return raw.length > 0
    ? { start: absoluteStart, end: absoluteStart + raw.length }
    : null;

  let cursor = closeBracket + 1;
  while (/\s/.test(raw[cursor] ?? "")) cursor += 1;
  if (raw[cursor] !== "(") return null;
  cursor += 1;
  while (/\s/.test(raw[cursor] ?? "")) cursor += 1;
  if (raw[cursor] === "<") {
    const start = cursor + 1;
    cursor = start;
    escaped = false;
    while (cursor < raw.length) {
      if (!escaped && raw[cursor] === ">") {
        return { start: absoluteStart + start, end: absoluteStart + cursor };
      }
      if (!escaped && raw[cursor] === "\\") escaped = true;
      else escaped = false;
      cursor += 1;
    }
    return null;
  }

  const start = cursor;
  let parentheses = 0;
  escaped = false;
  while (cursor < raw.length) {
    const character = raw[cursor];
    if (escaped) {
      escaped = false;
      cursor += 1;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      cursor += 1;
      continue;
    }
    if (character === "(") parentheses += 1;
    else if (character === ")") {
      if (parentheses === 0) break;
      parentheses -= 1;
    } else if (/\s/.test(character) && parentheses === 0) break;
    cursor += 1;
  }
  return { start: absoluteStart + start, end: absoluteStart + cursor };
}

function primitiveAttributes(node: MdastNodeLike): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  const keys = [
    "value",
    "depth",
    "ordered",
    "start",
    "spread",
    "checked",
    "lang",
    "meta",
    "url",
    "title",
    "alt",
    "identifier",
    "label",
    "referenceType",
    "align",
  ];
  keys.forEach((key) => {
    const value = node[key];
    if (
      value === null
      || typeof value === "string"
      || typeof value === "number"
      || typeof value === "boolean"
      || (Array.isArray(value) && value.every((item) => item === null || typeof item === "string"))
    ) {
      attributes[key] = value;
    }
  });
  return attributes;
}

function markdownFields(
  state: MutableParseState,
  node: MdastNodeLike,
  range: SourceRange,
  bodyStart: number,
): { fields: Record<string, FieldRange>; attributes: Record<string, unknown>; contentRange?: SourceRange } {
  const fields: Record<string, FieldRange> = {};
  const attributes = primitiveAttributes(node);
  const raw = state.source.slice(range.start, range.end);
  let contentRange: SourceRange | undefined;

  if (node.type === "text" || node.type === "html") {
    fields.value = makeFieldRange(state.source, range);
    contentRange = range;
  } else if (node.type === "heading") {
    const textRange = childRange(node.children, bodyStart, state.source.length);
    if (textRange) {
      fields.text = makeFieldRange(state.source, textRange);
      contentRange = textRange;
    } else {
      const marker = /^(?:[\t ]{0,3})#{1,6}(?:[\t ]+|$)/.exec(raw);
      const offset = marker?.[0].length ?? raw.length;
      fields.text = makeFieldRange(state.source, {
        start: range.start + offset,
        end: range.start + offset,
      });
      contentRange = { start: fields.text.start, end: fields.text.end };
    }
    attributes.text = mdastText(node);
  } else if (node.type === "listItem") {
    const checkboxRange = findCheckboxRange(raw, range.start);
    if (checkboxRange) fields.checkbox = makeFieldRange(state.source, checkboxRange);
    const firstParagraph = node.children?.find((child) => child.type === "paragraph");
    const textRange = firstParagraph
      ? childRange(firstParagraph.children, bodyStart, state.source.length) ?? mdastRange(firstParagraph, bodyStart, state.source.length)
      : childRange(node.children, bodyStart, state.source.length);
    if (textRange) {
      fields.text = makeFieldRange(state.source, textRange);
      contentRange = textRange;
    }
    attributes.text = mdastText(node);
  } else if (node.type === "code") {
    Object.assign(fields, codeFieldRanges(state.source, range));
    const info = [node.lang, node.meta].filter((value) => typeof value === "string" && value.length > 0).join(" ");
    attributes.info = info;
    if (fields.value) contentRange = { start: fields.value.start, end: fields.value.end };
  } else if (node.type === "inlineCode") {
    const valueRange = findInlineCodeValueRange(raw, range.start);
    if (valueRange) fields.value = makeFieldRange(state.source, valueRange);
    contentRange = valueRange ?? range;
  } else if (node.type === "link") {
    const labelRange = childRange(node.children, bodyStart, state.source.length);
    if (labelRange) fields.label = makeFieldRange(state.source, labelRange);
    const urlRange = findInlineLinkUrlRange(raw, range.start);
    if (urlRange) fields.url = makeFieldRange(state.source, urlRange);
    attributes.label = mdastText(node);
    contentRange = labelRange ?? urlRange ?? range;
  } else if (node.type === "image") {
    const urlRange = findInlineLinkUrlRange(raw, range.start);
    if (urlRange) fields.url = makeFieldRange(state.source, urlRange);
    const labelMatch = /^!\[([\s\S]*?)\]/.exec(raw);
    if (labelMatch) {
      const start = range.start + 2;
      fields.label = makeFieldRange(state.source, { start, end: start + labelMatch[1].length });
    }
    contentRange = fields.label ?? fields.url ?? range;
  } else if (typeof node.value === "string") {
    fields.value = makeFieldRange(state.source, range);
    contentRange = range;
  }

  return { fields, attributes, contentRange };
}

function addMarkdownTree(
  state: MutableParseState,
  node: MdastNodeLike,
  parentId: string,
  treePath: number[],
  bodyStart: number,
): LosslessNode {
  const range = mdastRange(node, bodyStart, state.source.length);
  if (!node.position) {
    addDiagnostic(state, {
      severity: "warning",
      source: "markdown",
      code: "missing-position",
      message: `Markdown node ${node.type} did not include a source position.`,
      range,
      fatal: false,
    });
  }
  const details = markdownFields(state, node, range, bodyStart);
  const hasChildren = Boolean(node.children && node.children.length > 0);
  const result = addNode(state, {
    id: `markdown:${treePath.join(".") || "root"}:${node.type}`,
    parentId,
    domain: "markdown",
    kind: node.type,
    path: treePath,
    range,
    contentRange: details.contentRange,
    fieldRanges: details.fields,
    coverageRole: hasChildren ? "container" : "leaf",
    attributes: details.attributes,
  });
  node.children?.forEach((child, index) => {
    addMarkdownTree(state, child, result.id, [...treePath, index], bodyStart);
  });
  return result;
}

function triviaKind(raw: string): string {
  if (raw === "\uFEFF") return "bom";
  if (/^[\t \r\n]*$/.test(raw)) return "whitespace";
  if (/^(?:---|\.\.\.)[\t ]*(?:\r\n|\r|\n)?$/.test(raw)) return "frontmatterDelimiter";
  return "syntax";
}

function addCoverageTrivia(state: MutableParseState, rootId: string): LosslessCoverage {
  const candidates = state.nodes
    .filter((node) => node.coverageRole === "leaf" && node.range.end > node.range.start)
    .sort((left, right) => left.range.start - right.range.start || right.range.end - left.range.end);
  const nodeIds: string[] = [];
  let cursor = 0;
  let semanticLength = 0;
  let triviaLength = 0;
  let overlapCount = 0;
  let gapCount = 0;
  let semanticNodeCount = 0;
  let triviaNodeCount = 0;

  const addTrivia = (start: number, end: number): void => {
    if (end <= start) return;
    gapCount += 1;
    triviaLength += end - start;
    const raw = state.source.slice(start, end);
    const trivia = addNode(state, {
      id: `trivia:${start}-${end}`,
      parentId: rootId,
      domain: "trivia",
      kind: triviaKind(raw),
      path: ["trivia", gapCount - 1],
      range: { start, end },
      fieldRanges: { raw: makeFieldRange(state.source, { start, end }) },
      coverageRole: "trivia",
      attributes: { whitespace: /^[\t \r\n]*$/.test(raw) },
    });
    nodeIds.push(trivia.id);
    triviaNodeCount += 1;
  };

  candidates.forEach((node) => {
    if (node.range.start < cursor) {
      overlapCount += 1;
      if (node.range.end <= cursor) return;
      // A partial overlap should not make the coverage segment list overlap.
      addTrivia(cursor, node.range.end);
      cursor = node.range.end;
      return;
    }
    addTrivia(cursor, node.range.start);
    nodeIds.push(node.id);
    semanticLength += node.range.end - node.range.start;
    semanticNodeCount += 1;
    cursor = node.range.end;
  });
  addTrivia(cursor, state.source.length);
  cursor = state.source.length;

  const coveredLength = semanticLength + triviaLength;
  const complete = coveredLength === state.source.length;
  return {
    sourceLength: state.source.length,
    coveredLength,
    semanticLength,
    triviaLength,
    percent: state.source.length === 0 ? 100 : (coveredLength / state.source.length) * 100,
    complete,
    overlapCount,
    gapCount,
    semanticNodeCount,
    triviaNodeCount,
    editableNodeCount: nodeIds.filter((id) => state.nodeIndex[id]?.editable).length,
    uneditableNodeCount: nodeIds.filter((id) => !state.nodeIndex[id]?.editable).length,
    nodeIds,
  };
}

/** Parse a SKILL.md source string without normalizing or discarding source text. */
export function parseLosslessSkillDocument(source: string): LosslessSkillDocument {
  const state: MutableParseState = {
    source,
    nodes: [],
    nodeIndex: {},
    diagnostics: [],
    usedIds: new Set<string>(),
    diagnosticSequence: 0,
  };
  const bom: "\uFEFF" | "" = source.startsWith("\uFEFF") ? "\uFEFF" : "";
  const profile = newlineProfile(source);
  const frontmatter = findFrontmatter(source, bom.length);

  const root = addNode(state, {
    id: "document:root",
    parentId: null,
    domain: "document",
    kind: "skillDocument",
    range: { start: 0, end: source.length },
    contentRange: { start: bom.length, end: source.length },
    fieldRanges: { source: makeFieldRange(source, { start: 0, end: source.length }) },
    coverageRole: "container",
    attributes: {},
  });

  if (bom) {
    addNode(state, {
      id: "trivia:bom",
      parentId: root.id,
      domain: "trivia",
      kind: "bom",
      path: ["bom"],
      range: { start: 0, end: bom.length },
      fieldRanges: { raw: makeFieldRange(source, { start: 0, end: bom.length }) },
      coverageRole: "leaf",
      attributes: {},
    });
  }

  let frontmatterRoot: LosslessNode | null = null;
  if (frontmatter.present && frontmatter.range && frontmatter.openingRange && frontmatter.contentRange) {
    const fields: Record<string, FieldRange> = {
      opening: makeFieldRange(source, frontmatter.openingRange),
      content: makeFieldRange(source, frontmatter.contentRange),
    };
    if (frontmatter.closingRange) fields.closing = makeFieldRange(source, frontmatter.closingRange);
    frontmatterRoot = addNode(state, {
      id: "yaml:frontmatter",
      parentId: root.id,
      domain: "yaml",
      kind: "frontmatter",
      path: ["frontmatter"],
      range: frontmatter.range,
      contentRange: frontmatter.contentRange,
      fieldRanges: fields,
      coverageRole: "container",
      attributes: {
        terminated: frontmatter.terminated,
        openingMarker: frontmatter.marker,
        closingMarker: frontmatter.closingMarker,
      },
    });
    frontmatter.rootId = frontmatterRoot.id;

    addNode(state, {
      id: "trivia:frontmatter-opening",
      parentId: frontmatterRoot.id,
      domain: "trivia",
      kind: "frontmatterOpeningDelimiter",
      path: ["frontmatter", "opening"],
      range: frontmatter.openingRange,
      fieldRanges: { raw: makeFieldRange(source, frontmatter.openingRange) },
      coverageRole: "leaf",
      attributes: { marker: frontmatter.marker },
    });
    if (frontmatter.closingRange) {
      addNode(state, {
        id: "trivia:frontmatter-closing",
        parentId: frontmatterRoot.id,
        domain: "trivia",
        kind: "frontmatterClosingDelimiter",
        path: ["frontmatter", "closing"],
        range: frontmatter.closingRange,
        fieldRanges: { raw: makeFieldRange(source, frontmatter.closingRange) },
        coverageRole: "leaf",
        attributes: { marker: frontmatter.closingMarker },
      });
    }

    if (!frontmatter.terminated) {
      addDiagnostic(state, {
        severity: "error",
        source: "frontmatter",
        code: "unterminated-frontmatter",
        message: "Frontmatter opening delimiter has no closing --- or ... delimiter.",
        range: frontmatter.range,
        fatal: true,
      });
    }

    const yamlSource = source.slice(frontmatter.contentRange.start, frontmatter.contentRange.end);
    try {
      const yamlDocument = parseDocument(yamlSource, {
        keepSourceTokens: true,
        prettyErrors: false,
        strict: false,
        uniqueKeys: false,
      });
      yamlDocument.errors.forEach((error) => {
        const position = Array.isArray(error.pos)
          ? {
              start: frontmatter.contentRange!.start + error.pos[0],
              end: frontmatter.contentRange!.start + (error.pos[1] ?? error.pos[0]),
            }
          : frontmatter.contentRange!;
        addDiagnostic(state, {
          severity: "error",
          source: "yaml",
          code: error.code ?? error.name,
          message: error.message,
          range: position,
          fatal: false,
        });
      });
      yamlDocument.warnings.forEach((warning) => {
        const position = Array.isArray(warning.pos)
          ? {
              start: frontmatter.contentRange!.start + warning.pos[0],
              end: frontmatter.contentRange!.start + (warning.pos[1] ?? warning.pos[0]),
            }
          : frontmatter.contentRange!;
        addDiagnostic(state, {
          severity: "warning",
          source: "yaml",
          code: warning.code ?? warning.name,
          message: warning.message,
          range: position,
          fatal: false,
        });
      });
      if (yamlDocument.contents) {
        addYamlTree(
          state,
          yamlDocument.contents,
          frontmatterRoot.id,
          ["frontmatter", "value"],
          frontmatter.contentRange,
        );
      }
      try {
        frontmatter.value = yamlDocument.toJS({ maxAliasCount: 100 });
      } catch (error) {
        addDiagnostic(state, {
          severity: "warning",
          source: "yaml",
          code: "value-conversion-failed",
          message: error instanceof Error ? error.message : String(error),
          range: frontmatter.contentRange,
          fatal: false,
        });
      }
    } catch (error) {
      addDiagnostic(state, {
        severity: "error",
        source: "yaml",
        code: "parse-failed",
        message: error instanceof Error ? error.message : String(error),
        range: frontmatter.contentRange,
        fatal: false,
      });
    }
  }

  const bodyRange = frontmatter.bodyRange;
  const markdownRoot = addNode(state, {
    id: "markdown:root",
    parentId: root.id,
    domain: "markdown",
    kind: "root",
    path: [],
    range: bodyRange,
    contentRange: bodyRange,
    fieldRanges: { source: makeFieldRange(source, bodyRange) },
    coverageRole: "container",
    attributes: {},
  });
  const markdownSource = source.slice(bodyRange.start, bodyRange.end);
  try {
    const tree = fromMarkdown(markdownSource, {
      extensions: [gfm()],
      mdastExtensions: gfmFromMarkdown(),
    }) as unknown as MdastNodeLike;
    tree.children?.forEach((child, index) => {
      addMarkdownTree(state, child, markdownRoot.id, [index], bodyRange.start);
    });
  } catch (error) {
    addDiagnostic(state, {
      severity: "error",
      source: "markdown",
      code: "parse-failed",
      message: error instanceof Error ? error.message : String(error),
      range: bodyRange,
      fatal: false,
    });
  }

  const coverage = addCoverageTrivia(state, root.id);
  if (!coverage.complete) {
    addDiagnostic(state, {
      severity: "error",
      source: "coverage",
      code: "incomplete-source-coverage",
      message: `${coverage.coveredLength} of ${coverage.sourceLength} UTF-16 source units are covered.`,
      range: { start: 0, end: source.length },
      fatal: true,
    });
  }

  return {
    source,
    sourceHash: hashLosslessSource(source),
    revision: 0,
    bom,
    newline: profile.dominant,
    newlineProfile: profile,
    hasTrailingNewline: /(?:\r\n|\r|\n)$/.test(source),
    frontmatter,
    bodyRange,
    rootId: root.id,
    frontmatterRootId: frontmatterRoot?.id ?? null,
    markdownRootId: markdownRoot.id,
    root,
    frontmatterRoot,
    markdownRoot,
    nodes: state.nodes,
    nodeIndex: state.nodeIndex,
    diagnostics: state.diagnostics,
    coverage,
  };
}

/** Serialize byte-for-byte from the authoritative source string. */
export function serializeLosslessSkillDocument(document: LosslessSkillDocument): string {
  return document.source;
}
