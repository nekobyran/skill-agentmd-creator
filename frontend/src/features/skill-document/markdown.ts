import type {
  CustomPropertyValue,
  FrontmatterDocument,
  FrontmatterLine,
  Section,
  SkillDocument,
} from "./types";

interface RawLine {
  raw: string;
  content: string;
  eol: string;
  start: number;
  end: number;
}

interface ParsedFrontmatter {
  frontmatter: FrontmatterDocument;
  bodyOffset: number;
}

export interface ParseSkillDocumentOptions {
  id?: string;
  sourcePath?: string;
}

export interface FrontmatterUpdates {
  name?: CustomPropertyValue;
  description?: CustomPropertyValue;
  [key: string]: CustomPropertyValue | undefined;
}

export interface SectionInput {
  id?: string;
  title: string;
  body: string;
  rawBody?: boolean;
}

export interface UpsertSectionOptions {
  index?: number;
  matchTitle?: boolean;
}

const FRONTMATTER_PROPERTY = /^([A-Za-z_][A-Za-z0-9_.-]*)[\t ]*:[\t ]*(.*)$/;
const H2_HEADING = /^ {0,3}##(?!#)[\t ]+(.+?)[\t ]*$/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

export function parseSkillDocument(source: string, options: ParseSkillDocumentOptions = {}): SkillDocument {
  const bom = source.startsWith("\uFEFF") ? "\uFEFF" : "";
  const content = bom ? source.slice(1) : source;
  const newline = detectNewline(content);
  const parsedFrontmatter = parseFrontmatter(content, newline, bom.length);
  const body = content.slice(parsedFrontmatter.bodyOffset);
  const headings = findH2Headings(body);
  const preamble = headings.length > 0 ? body.slice(0, headings[0].start) : body;
  const titleCounts = new Map<string, number>();
  const sections = headings.map((heading, index): Section => {
    const nextOffset = headings[index + 1]?.start ?? body.length;
    const baseId = slugify(heading.title) || "section";
    const occurrence = (titleCounts.get(baseId) ?? 0) + 1;
    titleCounts.set(baseId, occurrence);
    const absoluteStart = bom.length + parsedFrontmatter.bodyOffset + heading.start;
    const absoluteEnd = bom.length + parsedFrontmatter.bodyOffset + nextOffset;
    return {
      id: occurrence === 1 ? baseId : `${baseId}-${occurrence}`,
      title: heading.title,
      headingRaw: heading.raw,
      body: body.slice(heading.end, nextOffset),
      order: index,
      sourceSpan: {
        startLine: lineNumberAt(source, absoluteStart),
        endLine: lineNumberAt(source, Math.max(absoluteStart, absoluteEnd - 1)),
        startOffset: absoluteStart,
        endOffset: absoluteEnd,
      },
    };
  });

  const frontmatterName = parsedFrontmatter.frontmatter.data.name;
  const inferredId = typeof frontmatterName === "string" && frontmatterName.trim()
    ? frontmatterName.trim()
    : "skill-document";

  return {
    schemaVersion: 1,
    id: options.id ?? inferredId,
    bom,
    newline,
    hasTrailingNewline: /(?:\r\n|\n|\r)$/.test(source),
    frontmatter: parsedFrontmatter.frontmatter,
    preamble,
    sections,
    sourcePath: options.sourcePath,
  };
}

/**
 * Reads the YAML string semantics of a top-level frontmatter key without
 * interpreting nested mappings. This deliberately returns an empty string for
 * absent keys and non-string scalar values so identity callers cannot silently
 * coerce booleans, numbers, arrays, or objects into names/descriptions.
 */
export function frontmatterStringValue(source: string, key: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key)) return "";
  const content = source.startsWith("\uFEFF") ? source.slice(1) : source;
  const lines = splitRawLines(content);
  if (lines.length === 0 || lines[0].content.trim() !== "---") return "";
  const closingIndex = lines.findIndex((line, index) =>
    index > 0 && /^(?:---|\.\.\.)[\t ]*$/.test(line.content));
  if (closingIndex < 0) return "";

  let result = "";
  for (let index = 1; index < closingIndex; index += 1) {
    const property = lines[index].content.match(FRONTMATTER_PROPERTY);
    if (!property || property[1] !== key) continue;
    const blockHeader = parseBlockScalarHeader(property[2]);
    if (!blockHeader) {
      const parsed = parseFrontmatterValue(stripPlainScalarComment(property[2]));
      result = typeof parsed === "string" ? parsed : "";
      continue;
    }

    const blockLines: RawLine[] = [];
    for (let cursor = index + 1; cursor < closingIndex; cursor += 1) {
      const line = lines[cursor];
      if (line.content && !/^[\t ]/.test(line.content)) break;
      blockLines.push(line);
    }
    result = decodeBlockScalar(blockLines, blockHeader);
  }
  return result;
}

export function serializeSkillDocument(document: SkillDocument): string {
  const frontmatter = serializeFrontmatter(document.frontmatter);
  const sections = document.sections.map((section) => `${section.headingRaw}${section.body}`).join("");
  return `${document.bom}${frontmatter}${document.preamble}${sections}`;
}

export function updateFrontmatter(source: string, updates: FrontmatterUpdates): string {
  return serializeSkillDocument(updateSkillDocumentFrontmatter(parseSkillDocument(source), updates));
}

export function updateSkillDocumentFrontmatter(
  document: SkillDocument,
  updates: FrontmatterUpdates,
): SkillDocument {
  const newline = document.frontmatter.newline || document.newline || "\n";
  let lines = document.frontmatter.lines.map((line) => ({ ...line }));
  let present = document.frontmatter.present;
  let openingRaw = document.frontmatter.openingRaw;
  let closingRaw = document.frontmatter.closingRaw;

  if (!present) {
    present = true;
    openingRaw = `---${newline}`;
    closingRaw = `---${newline}`;
    lines = [];
  }

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) {
      continue;
    }
    const serializedValue = serializeFrontmatterValue(value);
    const indices = lines
      .map((line, index) => line.kind === "property" && line.key === key ? index : -1)
      .filter((index) => index >= 0);
    const existingIndex = indices.at(-1);

    if (existingIndex === undefined) {
      const eol = newline;
      lines.push({
        kind: "property",
        raw: `${key}: ${serializedValue}${eol}`,
        content: `${key}: ${serializedValue}`,
        eol,
        key,
        value,
        rawValue: serializedValue,
      });
      continue;
    }

    const current = lines[existingIndex];
    const eol = current.eol || newline;
    lines[existingIndex] = {
      ...current,
      raw: `${key}: ${serializedValue}${eol}`,
      content: `${key}: ${serializedValue}`,
      eol,
      value,
      rawValue: serializedValue,
    };

    let continuationIndex = existingIndex + 1;
    while (continuationIndex < lines.length && lines[continuationIndex].kind !== "property") {
      if (lines[continuationIndex].kind === "continuation") {
        lines.splice(continuationIndex, 1);
      } else {
        continuationIndex += 1;
      }
    }
  }

  const rebuilt = rebuildFrontmatterData(lines);
  return {
    ...document,
    id: typeof rebuilt.data.name === "string" && rebuilt.data.name.trim()
      ? rebuilt.data.name.trim()
      : document.id,
    frontmatter: {
      ...document.frontmatter,
      present,
      openingRaw,
      closingRaw,
      lines,
      data: rebuilt.data,
      order: rebuilt.order,
      newline,
    },
  };
}

export function deleteFrontmatterProperty(document: SkillDocument, key: string): SkillDocument {
  const lines = document.frontmatter.lines.map((line) => ({ ...line }));
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].kind !== "property" || lines[index].key !== key) {
      continue;
    }
    let end = index + 1;
    while (end < lines.length && lines[end].kind === "continuation") {
      end += 1;
    }
    lines.splice(index, end - index);
  }
  const rebuilt = rebuildFrontmatterData(lines);
  return {
    ...document,
    frontmatter: {
      ...document.frontmatter,
      lines,
      data: rebuilt.data,
      order: rebuilt.order,
    },
  };
}

export function upsertSection(
  document: SkillDocument,
  input: SectionInput,
  options: UpsertSectionOptions = {},
): SkillDocument {
  const title = input.title.trim();
  if (!title) {
    throw new Error("Section title cannot be empty.");
  }

  const sections = document.sections.map((section) => ({ ...section }));
  const matchTitle = options.matchTitle ?? true;
  const existingIndex = sections.findIndex((section) =>
    (input.id && section.id === input.id)
    || (matchTitle && normalizeTitle(section.title) === normalizeTitle(title)));
  const body = input.rawBody ? input.body : formatSectionBody(input.body, document.newline);

  if (existingIndex >= 0) {
    const existing = sections[existingIndex];
    sections[existingIndex] = {
      ...existing,
      id: input.id ?? existing.id,
      title,
      headingRaw: title === existing.title ? existing.headingRaw : `## ${title}${document.newline}`,
      body,
      sourceSpan: undefined,
    };
    return withReindexedSections(document, sections);
  }

  const insertionIndex = clamp(options.index ?? sections.length, 0, sections.length);
  const id = uniqueSectionId(sections, (input.id ?? slugify(title)) || "section");
  const section: Section = {
    id,
    title,
    headingRaw: `## ${title}${document.newline}`,
    body,
    order: insertionIndex,
  };

  if (insertionIndex === 0 && sections.length === 0) {
    const preamble = ensureHeadingBoundary(document.preamble, document.newline);
    sections.splice(insertionIndex, 0, section);
    return withReindexedSections({ ...document, preamble }, sections);
  }

  if (insertionIndex === 0) {
    const preamble = ensureHeadingBoundary(document.preamble, document.newline);
    sections.splice(0, 0, section);
    return withReindexedSections({ ...document, preamble }, sections);
  }

  const previous = sections[insertionIndex - 1];
  sections[insertionIndex - 1] = {
    ...previous,
    body: ensureHeadingBoundary(previous.body, document.newline),
  };
  sections.splice(insertionIndex, 0, section);
  return withReindexedSections(document, sections);
}

export function removeSection(document: SkillDocument, idOrTitle: string): SkillDocument {
  const selector = idOrTitle.trim();
  const index = document.sections.findIndex((section) =>
    section.id === selector || normalizeTitle(section.title) === normalizeTitle(selector));
  if (index < 0) {
    return document;
  }
  const sections = document.sections.filter((_, sectionIndex) => sectionIndex !== index);
  return withReindexedSections(document, sections);
}

export function moveSection(document: SkillDocument, idOrTitle: string, targetIndex: number): SkillDocument {
  const selector = idOrTitle.trim();
  const sourceIndex = document.sections.findIndex((section) =>
    section.id === selector || normalizeTitle(section.title) === normalizeTitle(selector));
  if (sourceIndex < 0 || document.sections.length < 2) {
    return document;
  }
  const sections = document.sections.map((section) => ({ ...section }));
  const [section] = sections.splice(sourceIndex, 1);
  const destination = clamp(targetIndex, 0, sections.length);
  sections.splice(destination, 0, section);
  return withReindexedSections(document, sections);
}

export function findSection(document: SkillDocument, idOrTitle: string): Section | undefined {
  const selector = idOrTitle.trim();
  return document.sections.find((section) =>
    section.id === selector || normalizeTitle(section.title) === normalizeTitle(selector));
}

export function serializeFrontmatter(frontmatter: FrontmatterDocument): string {
  if (!frontmatter.present) {
    return "";
  }
  return `${frontmatter.openingRaw}${frontmatter.lines.map((line) => line.raw).join("")}${frontmatter.closingRaw}`;
}

function parseFrontmatter(content: string, newline: string, offsetAdjustment: number): ParsedFrontmatter {
  const lines = splitRawLines(content);
  if (lines.length === 0 || lines[0].content.trim() !== "---") {
    return {
      bodyOffset: 0,
      frontmatter: emptyFrontmatter(newline),
    };
  }

  const closingIndex = lines.findIndex((line, index) =>
    index > 0 && /^(?:---|\.\.\.)[\t ]*$/.test(line.content));
  if (closingIndex < 0) {
    return {
      bodyOffset: 0,
      frontmatter: emptyFrontmatter(newline),
    };
  }

  const contentLines = lines.slice(1, closingIndex).map(parseFrontmatterLine);
  const rebuilt = rebuildFrontmatterData(contentLines);
  return {
    bodyOffset: lines[closingIndex].end,
    frontmatter: {
      present: true,
      openingRaw: lines[0].raw,
      closingRaw: lines[closingIndex].raw,
      lines: contentLines,
      data: rebuilt.data,
      order: rebuilt.order,
      newline,
      sourceSpan: {
        startLine: 1,
        endLine: closingIndex + 1,
        startOffset: offsetAdjustment,
        endOffset: offsetAdjustment + lines[closingIndex].end,
      },
    },
  };
}

function emptyFrontmatter(newline: string): FrontmatterDocument {
  return {
    present: false,
    openingRaw: "",
    closingRaw: "",
    lines: [],
    data: {},
    order: [],
    newline,
  };
}

function parseFrontmatterLine(line: RawLine): FrontmatterLine {
  if (!line.content.trim()) {
    return { kind: "blank", raw: line.raw, content: line.content, eol: line.eol };
  }
  if (/^[\t ]*#/.test(line.content)) {
    return { kind: "comment", raw: line.raw, content: line.content, eol: line.eol };
  }
  const property = line.content.match(FRONTMATTER_PROPERTY);
  if (property) {
    return {
      kind: "property",
      raw: line.raw,
      content: line.content,
      eol: line.eol,
      key: property[1],
      rawValue: property[2],
      value: parseFrontmatterValue(property[2]),
    };
  }
  if (/^[\t ]+/.test(line.content)) {
    return { kind: "continuation", raw: line.raw, content: line.content, eol: line.eol };
  }
  return { kind: "raw", raw: line.raw, content: line.content, eol: line.eol };
}

function rebuildFrontmatterData(lines: FrontmatterLine[]): {
  data: Record<string, CustomPropertyValue>;
  order: string[];
} {
  const data: Record<string, CustomPropertyValue> = {};
  const order: string[] = [];
  lines.forEach((line, index) => {
    if (line.kind !== "property" || !line.key) {
      return;
    }
    let continuation = "";
    for (let next = index + 1; next < lines.length && lines[next].kind !== "property"; next += 1) {
      if (lines[next].kind === "continuation") {
        continuation += lines[next].raw;
      }
    }
    const rawValue = line.rawValue ?? "";
    data[line.key] = continuation && (!rawValue.trim() || rawValue.trim() === "|" || rawValue.trim() === ">")
      ? `${rawValue}${continuation}`
      : line.value ?? parseFrontmatterValue(rawValue);
    order.push(line.key);
  });
  return { data, order };
}

function parseFrontmatterValue(rawValue: string): CustomPropertyValue {
  const value = rawValue.trim();
  if (!value) {
    return "";
  }
  if (value === "~" || value.toLowerCase() === "null") {
    return null;
  }
  if (/^(?:true|false)$/i.test(value)) {
    return value.toLowerCase() === "true";
  }
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : value;
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as CustomPropertyValue;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if ((value.startsWith("[") && value.endsWith("]")) || (value.startsWith("{") && value.endsWith("}"))) {
    try {
      return JSON.parse(value) as CustomPropertyValue;
    } catch {
      return value;
    }
  }
  return value;
}

interface BlockScalarHeader {
  style: "literal" | "folded";
  chomp: "clip" | "strip" | "keep";
  indentation?: number;
}

function parseBlockScalarHeader(rawValue: string): BlockScalarHeader | null {
  const withoutComment = rawValue.trim().replace(/[\t ]+#.*$/, "");
  const match = withoutComment.match(/^([|>])([1-9+-]{0,2})$/);
  if (!match) return null;
  const indicators = match[2];
  const chomps = [...indicators].filter((character) => character === "+" || character === "-");
  const indents = [...indicators].filter((character) => /[1-9]/.test(character));
  if (chomps.length > 1 || indents.length > 1 || chomps.length + indents.length !== indicators.length) {
    return null;
  }
  return {
    style: match[1] === "|" ? "literal" : "folded",
    chomp: chomps[0] === "+" ? "keep" : chomps[0] === "-" ? "strip" : "clip",
    indentation: indents.length ? Number(indents[0]) : undefined,
  };
}

function decodeBlockScalar(lines: RawLine[], header: BlockScalarHeader): string {
  const indentation = header.indentation ?? inferBlockIndentation(lines);
  const values = lines.map((line) => stripIndentation(line.content, indentation));
  let result = header.style === "literal" ? literalBlock(values) : foldedBlock(values);
  if (header.chomp === "strip") return result.replace(/\n+$/g, "");
  if (header.chomp === "clip") {
    result = result.replace(/\n+$/g, "");
    return result ? `${result}\n` : "";
  }
  return result;
}

function inferBlockIndentation(lines: RawLine[]): number {
  const candidates = lines
    .filter((line) => line.content.trim().length > 0)
    .map((line) => line.content.match(/^[\t ]*/)?.[0].length ?? 0)
    .filter((indentation) => indentation > 0);
  return candidates.length ? Math.min(...candidates) : 0;
}

function stripIndentation(value: string, count: number): string {
  let cursor = 0;
  while (cursor < value.length && cursor < count && (value[cursor] === " " || value[cursor] === "\t")) {
    cursor += 1;
  }
  return value.slice(cursor);
}

function literalBlock(lines: string[]): string {
  return lines.length ? `${lines.join("\n")}\n` : "";
}

function foldedBlock(lines: string[]): string {
  if (!lines.length) return "";
  let output = "";
  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index];
    const next = lines[index + 1];
    output += current;
    if (next === undefined) {
      output += "\n";
    } else if (current === "") {
      output += "\n";
    } else if (next !== "") {
      output += " ";
    }
  }
  return output;
}

function stripPlainScalarComment(rawValue: string): string {
  const trimmed = rawValue.trim();
  let quote: "single" | "double" | undefined;
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (quote === "double") {
      if (character === "\\") index += 1;
      else if (character === '"') quote = undefined;
      continue;
    }
    if (quote === "single") {
      if (character === "'" && trimmed[index + 1] === "'") index += 1;
      else if (character === "'") quote = undefined;
      continue;
    }
    if (character === '"') quote = "double";
    else if (character === "'") quote = "single";
    else if (character === "#" && index > 0 && /[\t ]/.test(trimmed[index - 1])) {
      return trimmed.slice(0, index).trimEnd();
    }
  }
  return trimmed;
}

function serializeFrontmatterValue(value: CustomPropertyValue): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(value);
}

function findH2Headings(body: string): Array<{ start: number; end: number; raw: string; title: string }> {
  const headings: Array<{ start: number; end: number; raw: string; title: string }> = [];
  const lines = splitRawLines(body);
  let fence: { character: "`" | "~"; length: number } | undefined;

  for (const line of lines) {
    if (fence) {
      if (isFenceClose(line.content, fence)) {
        fence = undefined;
      }
      continue;
    }

    const fenceMatch = line.content.match(FENCE_OPEN);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      fence = { character: marker[0] as "`" | "~", length: marker.length };
      continue;
    }

    const headingMatch = line.content.match(H2_HEADING);
    if (!headingMatch) {
      continue;
    }
    const title = headingMatch[1].replace(/[\t ]+#+[\t ]*$/, "").trim();
    if (!title) {
      continue;
    }
    headings.push({ start: line.start, end: line.end, raw: line.raw, title });
  }
  return headings;
}

function isFenceClose(content: string, fence: { character: "`" | "~"; length: number }): boolean {
  const escaped = fence.character === "`" ? "`" : "~";
  return new RegExp(`^ {0,3}${escaped}{${fence.length},}[\\t ]*$`).test(content);
}

function splitRawLines(value: string): RawLine[] {
  const lines: RawLine[] = [];
  let offset = 0;
  while (offset < value.length) {
    let cursor = offset;
    while (cursor < value.length && value[cursor] !== "\r" && value[cursor] !== "\n") {
      cursor += 1;
    }
    let eol = "";
    if (cursor < value.length) {
      if (value[cursor] === "\r" && value[cursor + 1] === "\n") {
        eol = "\r\n";
      } else {
        eol = value[cursor];
      }
    }
    const end = cursor + eol.length;
    lines.push({
      raw: value.slice(offset, end),
      content: value.slice(offset, cursor),
      eol,
      start: offset,
      end,
    });
    offset = end;
  }
  return lines;
}

function detectNewline(value: string): string {
  return value.match(/\r\n|\n|\r/)?.[0] ?? "\n";
}

function lineNumberAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\n") {
      line += 1;
    } else if (source[index] === "\r" && source[index + 1] !== "\n") {
      line += 1;
    }
  }
  return line;
}

function formatSectionBody(body: string, newline: string): string {
  const normalized = body.replace(/\r\n|\r|\n/g, newline).replace(/^(?:\r\n|\r|\n)+|(?:\r\n|\r|\n)+$/g, "");
  return normalized ? `${newline}${normalized}${newline}${newline}` : newline;
}

function ensureHeadingBoundary(value: string, newline: string): string {
  if (!value) {
    return "";
  }
  const withoutTrailingBreaks = value.replace(/(?:\r\n|\r|\n)+$/g, "");
  return `${withoutTrailingBreaks}${newline}${newline}`;
}

function withReindexedSections(document: SkillDocument, sections: Section[]): SkillDocument {
  return {
    ...document,
    sections: sections.map((section, index) => ({ ...section, order: index, sourceSpan: undefined })),
  };
}

function uniqueSectionId(sections: Section[], preferredId: string): string {
  const ids = new Set(sections.map((section) => section.id));
  if (!ids.has(preferredId)) {
    return preferredId;
  }
  let suffix = 2;
  while (ids.has(`${preferredId}-${suffix}`)) {
    suffix += 1;
  }
  return `${preferredId}-${suffix}`;
}

function normalizeTitle(title: string): string {
  return title.trim().toLocaleLowerCase();
}

function slugify(title: string): string {
  return title
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
