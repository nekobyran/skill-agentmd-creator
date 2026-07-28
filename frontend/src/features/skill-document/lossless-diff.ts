import type {
  LosslessDiagnostic,
  LosslessNode,
  LosslessSkillDocument,
  SourceRange,
} from "./lossless-model";
import {
  applyLosslessSourceEdits,
  assertNonOverlappingSourceEdits,
  type LosslessLocality,
  type SourceEdit,
} from "./lossless-mutate";
import {
  hashLosslessSource,
  parseLosslessSkillDocument,
} from "./lossless-parse";

export type LosslessChangeKind = "update" | "insert" | "delete" | "move";

export interface LosslessChangeGroup {
  id: string;
  kind: LosslessChangeKind;
  baseRange: SourceRange;
  targetRange: SourceRange;
  baseRawHash: string;
  targetRawHash: string;
  path: Array<string | number>;
  summary: string;
  before: string;
  after: string;
  baseNodeIds: string[];
  targetNodeIds: string[];
  edits: SourceEdit[];
  relatedMoveId?: string;
}

export interface LosslessPatchSet {
  id: string;
  baseSourceHash: string;
  targetSourceHash: string;
  baseSourceLength: number;
  targetSourceLength: number;
  baseSource: string;
  targetSource: string;
  changes: LosslessChangeGroup[];
  baseAtomicNodeCount: number;
  targetAtomicNodeCount: number;
  diagnostics: LosslessDiagnostic[];
}

export interface LosslessPatchApplyResult {
  source: string;
  document: LosslessSkillDocument;
  edits: SourceEdit[];
  appliedChangeIds: string[];
  inverseSource: string;
  locality: LosslessLocality;
}

export type LosslessPatchErrorCode =
  | "invalid-document"
  | "stale-base"
  | "unknown-change"
  | "stale-change"
  | "fatal-reparse";

export class LosslessPatchError extends Error {
  readonly code: LosslessPatchErrorCode;
  readonly range?: SourceRange;

  constructor(code: LosslessPatchErrorCode, message: string, range?: SourceRange) {
    super(message);
    this.name = "LosslessPatchError";
    this.code = code;
    this.range = range;
  }
}

const MARKDOWN_ATOMIC_KINDS = new Set([
  "heading",
  "paragraph",
  "listitem",
  "code",
  "blockquote",
  "table",
  "html",
  "definition",
  "thematicbreak",
  "footnotedefinition",
]);

function normalizeKind(kind: string): string {
  return kind.replace(/[\s_.-]+/g, "").toLowerCase();
}

function asDocument(input: LosslessSkillDocument | string): LosslessSkillDocument {
  return typeof input === "string" ? parseLosslessSkillDocument(input) : input;
}

function assertDocumentIntegrity(document: LosslessSkillDocument): void {
  if (hashLosslessSource(document.source) !== document.sourceHash) {
    throw new LosslessPatchError(
      "invalid-document",
      "Lossless document source no longer matches its parsed source hash.",
    );
  }
}

/**
 * Select outermost atomic YAML pairs and Markdown blocks. This deliberately
 * chooses listItem/blockquote/table containers over their overlapping inline
 * descendants, yielding a source-ordered, non-overlapping sequence for LCS.
 */
export function losslessAtomicNodes(document: LosslessSkillDocument): LosslessNode[] {
  const candidates = document.nodes
    .filter((node) => {
      if (!node.editable || node.range.end <= node.range.start) return false;
      if (node.domain === "yaml") return normalizeKind(node.kind) === "pair";
      return node.domain === "markdown" && MARKDOWN_ATOMIC_KINDS.has(normalizeKind(node.kind));
    })
    .sort((left, right) => left.range.start - right.range.start || right.range.end - left.range.end);

  const selected: LosslessNode[] = [];
  candidates.forEach((candidate) => {
    const containing = selected.find((node) =>
      candidate.range.start >= node.range.start && candidate.range.end <= node.range.end);
    if (!containing) selected.push(candidate);
  });
  return selected.sort((left, right) => left.range.start - right.range.start || left.range.end - right.range.end);
}

function atomIdentity(node: LosslessNode): string {
  return `${node.domain}:${normalizeKind(node.kind)}:${node.raw}`;
}

interface LcsMatch {
  baseIndex: number;
  targetIndex: number;
}

function siblingLcs(base: LosslessNode[], target: LosslessNode[]): LcsMatch[] {
  const rows = base.length + 1;
  const columns = target.length + 1;
  const table = Array.from({ length: rows }, () => new Uint32Array(columns));
  for (let baseIndex = base.length - 1; baseIndex >= 0; baseIndex -= 1) {
    for (let targetIndex = target.length - 1; targetIndex >= 0; targetIndex -= 1) {
      table[baseIndex][targetIndex] = atomIdentity(base[baseIndex]) === atomIdentity(target[targetIndex])
        ? table[baseIndex + 1][targetIndex + 1] + 1
        : Math.max(table[baseIndex + 1][targetIndex], table[baseIndex][targetIndex + 1]);
    }
  }

  const matches: LcsMatch[] = [];
  let baseIndex = 0;
  let targetIndex = 0;
  while (baseIndex < base.length && targetIndex < target.length) {
    if (atomIdentity(base[baseIndex]) === atomIdentity(target[targetIndex])) {
      matches.push({ baseIndex, targetIndex });
      baseIndex += 1;
      targetIndex += 1;
    } else if (table[baseIndex + 1][targetIndex] >= table[baseIndex][targetIndex + 1]) {
      baseIndex += 1;
    } else {
      targetIndex += 1;
    }
  }
  return matches;
}

interface ShrunkChange {
  baseRange: SourceRange;
  targetRange: SourceRange;
  before: string;
  after: string;
}

function shrinkChange(
  baseSource: string,
  targetSource: string,
  baseRange: SourceRange,
  targetRange: SourceRange,
): ShrunkChange | null {
  const before = baseSource.slice(baseRange.start, baseRange.end);
  const after = targetSource.slice(targetRange.start, targetRange.end);
  if (before === after) return null;

  let prefix = 0;
  const prefixLimit = Math.min(before.length, after.length);
  while (prefix < prefixLimit && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix += 1;

  let suffix = 0;
  const suffixLimit = Math.min(before.length - prefix, after.length - prefix);
  while (
    suffix < suffixLimit
    && before.charCodeAt(before.length - suffix - 1) === after.charCodeAt(after.length - suffix - 1)
  ) {
    suffix += 1;
  }

  const shrunkBefore = before.slice(prefix, before.length - suffix);
  const shrunkAfter = after.slice(prefix, after.length - suffix);
  return {
    baseRange: {
      start: baseRange.start + prefix,
      end: baseRange.end - suffix,
    },
    targetRange: {
      start: targetRange.start + prefix,
      end: targetRange.end - suffix,
    },
    before: shrunkBefore,
    after: shrunkAfter,
  };
}

function nodesInRange(nodes: LosslessNode[], range: SourceRange): LosslessNode[] {
  return nodes.filter((node) => {
    if (range.start === range.end) return false;
    return node.range.start < range.end && node.range.end > range.start;
  });
}

function sameMultiset(left: string[], right: string[]): boolean {
  if (left.length !== right.length || left.length === 0) return false;
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((value, index) => value === rightSorted[index]);
}

function classifyChange(
  before: string,
  after: string,
  baseNodes: LosslessNode[],
  targetNodes: LosslessNode[],
): LosslessChangeKind {
  if (!before) return "insert";
  if (!after) return "delete";
  const baseAtoms = baseNodes.map(atomIdentity);
  const targetAtoms = targetNodes.map(atomIdentity);
  if (
    sameMultiset(baseAtoms, targetAtoms)
    && baseAtoms.some((value, index) => value !== targetAtoms[index])
  ) {
    return "move";
  }
  return "update";
}

function summarize(
  kind: LosslessChangeKind,
  before: string,
  after: string,
  nodes: LosslessNode[],
): string {
  const nodeKinds = [...new Set(nodes.map((node) => node.kind))].slice(0, 3).join("/");
  const sample = (after || before).replace(/\s+/g, " ").trim();
  const excerpt = sample.length <= 64 ? sample : `${sample.slice(0, 63)}…`;
  return `${kind}${nodeKinds ? ` ${nodeKinds}` : " source"}${excerpt ? ` · ${excerpt}` : ""}`;
}

function createGroup(
  index: number,
  baseDocument: LosslessSkillDocument,
  targetDocument: LosslessSkillDocument,
  baseAtoms: LosslessNode[],
  targetAtoms: LosslessNode[],
  change: ShrunkChange,
  contextBaseRange: SourceRange,
  contextTargetRange: SourceRange,
): LosslessChangeGroup {
  const baseNodes = nodesInRange(baseAtoms, contextBaseRange);
  const targetNodes = nodesInRange(targetAtoms, contextTargetRange);
  const contextNodes = baseNodes.length > 0 ? baseNodes : targetNodes;
  const kind = classifyChange(change.before, change.after, baseNodes, targetNodes);
  const digest = hashLosslessSource(`${change.before}\u0000${change.after}`).slice(-8);
  const id = `change:${String(index + 1).padStart(3, "0")}:${digest}`;
  const edit: SourceEdit = {
    start: change.baseRange.start,
    end: change.baseRange.end,
    replacement: change.after,
    expectedRawHash: hashLosslessSource(change.before),
    nodeId: baseNodes[0]?.id ?? targetNodes[0]?.id ?? "document:root",
    mutationKind: "patch",
    mutationIndex: index,
  };
  return {
    id,
    kind,
    baseRange: change.baseRange,
    targetRange: change.targetRange,
    baseRawHash: edit.expectedRawHash,
    targetRawHash: hashLosslessSource(change.after),
    path: [...(contextNodes[0]?.path ?? [])],
    summary: summarize(kind, change.before, change.after, contextNodes),
    before: change.before,
    after: change.after,
    baseNodeIds: baseNodes.map((node) => node.id),
    targetNodeIds: targetNodes.map((node) => node.id),
    edits: [edit],
  };
}

function pairMoveGroups(groups: LosslessChangeGroup[]): void {
  const insertions = groups.filter((group) => group.kind === "insert" && group.after);
  const paired = new Set<string>();
  groups.forEach((deletion) => {
    if (deletion.kind !== "delete" || !deletion.before || paired.has(deletion.id)) return;
    const insertion = insertions.find((candidate) =>
      !paired.has(candidate.id) && candidate.after === deletion.before);
    if (!insertion) return;
    deletion.kind = "move";
    insertion.kind = "move";
    deletion.relatedMoveId = insertion.id;
    insertion.relatedMoveId = deletion.id;
    deletion.summary = summarize("move", deletion.before, "", []);
    insertion.summary = summarize("move", "", insertion.after, []);
    paired.add(deletion.id);
    paired.add(insertion.id);
  });
}

function fullSourceFallback(
  baseDocument: LosslessSkillDocument,
  targetDocument: LosslessSkillDocument,
): LosslessChangeGroup[] {
  const change = shrinkChange(
    baseDocument.source,
    targetDocument.source,
    { start: 0, end: baseDocument.source.length },
    { start: 0, end: targetDocument.source.length },
  );
  if (!change) return [];
  return [createGroup(
    0,
    baseDocument,
    targetDocument,
    losslessAtomicNodes(baseDocument),
    losslessAtomicNodes(targetDocument),
    change,
    { start: 0, end: baseDocument.source.length },
    { start: 0, end: targetDocument.source.length },
  )];
}

/** Build independently selectable, base-relative source change groups. */
export function createLosslessPatchSet(
  before: LosslessSkillDocument | string,
  after: LosslessSkillDocument | string,
): LosslessPatchSet {
  const baseDocument = asDocument(before);
  const targetDocument = asDocument(after);
  assertDocumentIntegrity(baseDocument);
  assertDocumentIntegrity(targetDocument);
  const baseAtoms = losslessAtomicNodes(baseDocument);
  const targetAtoms = losslessAtomicNodes(targetDocument);
  const matches = siblingLcs(baseAtoms, targetAtoms);
  const groups: LosslessChangeGroup[] = [];

  let baseCursor = 0;
  let targetCursor = 0;
  matches.forEach((match) => {
    const baseAtom = baseAtoms[match.baseIndex];
    const targetAtom = targetAtoms[match.targetIndex];
    const contextBaseRange = { start: baseCursor, end: baseAtom.range.start };
    const contextTargetRange = { start: targetCursor, end: targetAtom.range.start };
    const change = shrinkChange(
      baseDocument.source,
      targetDocument.source,
      contextBaseRange,
      contextTargetRange,
    );
    if (change) {
      groups.push(createGroup(
        groups.length,
        baseDocument,
        targetDocument,
        baseAtoms,
        targetAtoms,
        change,
        contextBaseRange,
        contextTargetRange,
      ));
    }
    baseCursor = baseAtom.range.end;
    targetCursor = targetAtom.range.end;
  });

  const finalBaseRange = { start: baseCursor, end: baseDocument.source.length };
  const finalTargetRange = { start: targetCursor, end: targetDocument.source.length };
  const finalChange = shrinkChange(
    baseDocument.source,
    targetDocument.source,
    finalBaseRange,
    finalTargetRange,
  );
  if (finalChange) {
    groups.push(createGroup(
      groups.length,
      baseDocument,
      targetDocument,
      baseAtoms,
      targetAtoms,
      finalChange,
      finalBaseRange,
      finalTargetRange,
    ));
  }

  pairMoveGroups(groups);
  let changes = groups;
  try {
    const allEdits = groups.flatMap((group) => group.edits);
    assertNonOverlappingSourceEdits(allEdits);
    const rebuilt = applyLosslessSourceEdits(baseDocument.source, allEdits).source;
    if (rebuilt !== targetDocument.source) changes = fullSourceFallback(baseDocument, targetDocument);
  } catch {
    changes = fullSourceFallback(baseDocument, targetDocument);
  }

  return {
    id: `patch:${baseDocument.sourceHash.slice(-8)}:${targetDocument.sourceHash.slice(-8)}`,
    baseSourceHash: baseDocument.sourceHash,
    targetSourceHash: targetDocument.sourceHash,
    baseSourceLength: baseDocument.source.length,
    targetSourceLength: targetDocument.source.length,
    baseSource: baseDocument.source,
    targetSource: targetDocument.source,
    changes,
    baseAtomicNodeCount: baseAtoms.length,
    targetAtomicNodeCount: targetAtoms.length,
    diagnostics: [...baseDocument.diagnostics, ...targetDocument.diagnostics],
  };
}

/** Apply only the selected base-relative groups; all unselected slices stay exact. */
export function applySelectedLosslessChanges(
  base: LosslessSkillDocument | string,
  patchSet: LosslessPatchSet,
  selectedIds: Iterable<string>,
): LosslessPatchApplyResult {
  const document = asDocument(base);
  assertDocumentIntegrity(document);
  if (document.sourceHash !== patchSet.baseSourceHash) {
    throw new LosslessPatchError(
      "stale-base",
      `Patch ${patchSet.id} expects ${patchSet.baseSourceHash}, current source is ${document.sourceHash}.`,
    );
  }

  const selected = [...new Set(selectedIds)];
  const byId = new Map(patchSet.changes.map((change) => [change.id, change]));
  const unknown = selected.find((id) => !byId.has(id));
  if (unknown) {
    throw new LosslessPatchError("unknown-change", `Patch change ${unknown} does not exist.`);
  }
  const changes = selected.map((id) => byId.get(id)!);
  const edits = changes.flatMap((change, changeIndex) => change.edits.map((edit) => ({
    ...edit,
    mutationIndex: changeIndex,
  })));
  edits.forEach((edit) => {
    const current = document.source.slice(edit.start, edit.end);
    if (hashLosslessSource(current) !== edit.expectedRawHash) {
      throw new LosslessPatchError(
        "stale-change",
        `Patch change at ${edit.start}:${edit.end} no longer matches its base slice.`,
        { start: edit.start, end: edit.end },
      );
    }
  });

  const applied = applyLosslessSourceEdits(document.source, edits);
  if (applied.source === document.source) {
    return {
      source: document.source,
      document,
      edits: [],
      appliedChangeIds: selected,
      inverseSource: document.source,
      locality: applied.locality,
    };
  }
  const nextDocument = parseLosslessSkillDocument(applied.source);
  const fatal = nextDocument.diagnostics.find((diagnostic) => diagnostic.fatal);
  if (fatal) {
    throw new LosslessPatchError(
      "fatal-reparse",
      `Selected changes were rejected after reparse: ${fatal.code}: ${fatal.message}`,
      fatal.range,
    );
  }
  return {
    source: applied.source,
    document: nextDocument,
    edits,
    appliedChangeIds: selected,
    inverseSource: document.source,
    locality: applied.locality,
  };
}

