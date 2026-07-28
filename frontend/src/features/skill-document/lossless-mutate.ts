import type {
  LosslessNode,
  LosslessSkillDocument,
  SourceRange,
} from "./lossless-model";
import {
  hashLosslessSource,
  parseLosslessSkillDocument,
} from "./lossless-parse";

export type LosslessMutationKind =
  | "set-field"
  | "replace-node"
  | "insert-before"
  | "insert-after"
  | "delete-node"
  | "move-before"
  | "move-after";

export interface LosslessMutationBase {
  kind: LosslessMutationKind;
  nodeId: string;
  expectedNodeHash: string;
  /** When supplied, rejects a mutation created from any other source revision. */
  expectedSourceHash?: string;
}

export interface SetFieldMutation extends LosslessMutationBase {
  kind: "set-field";
  field: string;
  value: string;
}

export interface ReplaceNodeMutation extends LosslessMutationBase {
  kind: "replace-node";
  replacement: string;
}

export interface InsertBeforeMutation extends LosslessMutationBase {
  kind: "insert-before";
  content: string;
}

export interface InsertAfterMutation extends LosslessMutationBase {
  kind: "insert-after";
  content: string;
}

export interface DeleteNodeMutation extends LosslessMutationBase {
  kind: "delete-node";
}

export interface MoveBeforeMutation extends LosslessMutationBase {
  kind: "move-before";
  targetNodeId: string;
  targetExpectedNodeHash?: string;
}

export interface MoveAfterMutation extends LosslessMutationBase {
  kind: "move-after";
  targetNodeId: string;
  targetExpectedNodeHash?: string;
}

export type LosslessMutation =
  | SetFieldMutation
  | ReplaceNodeMutation
  | InsertBeforeMutation
  | InsertAfterMutation
  | DeleteNodeMutation
  | MoveBeforeMutation
  | MoveAfterMutation;

export interface SourceEdit {
  start: number;
  end: number;
  replacement: string;
  expectedRawHash: string;
  nodeId: string;
  mutationKind: LosslessMutationKind | "patch";
  mutationIndex: number;
}

export interface LosslessLocality {
  noOp: boolean;
  beforeRanges: SourceRange[];
  afterRanges: SourceRange[];
  beforeChangedRange: SourceRange | null;
  afterChangedRange: SourceRange | null;
  preservedPrefixLength: number;
  preservedSuffixLength: number;
  unchangedOutsideEdits: boolean;
}

export interface LosslessMutationResult {
  source: string;
  document: LosslessSkillDocument;
  edits: SourceEdit[];
  inverseSource: string;
  locality: LosslessLocality;
}

export type LosslessMutationErrorCode =
  | "invalid-document"
  | "stale-source"
  | "missing-node"
  | "stale-node"
  | "missing-field"
  | "uneditable-field"
  | "unaddressable-block"
  | "different-parent"
  | "invalid-target"
  | "overlapping-edits"
  | "stale-edit"
  | "fatal-reparse";

export class LosslessMutationError extends Error {
  readonly code: LosslessMutationErrorCode;
  readonly range?: SourceRange;
  readonly mutationIndex?: number;

  constructor(
    code: LosslessMutationErrorCode,
    message: string,
    options: { range?: SourceRange; mutationIndex?: number } = {},
  ) {
    super(message);
    this.name = "LosslessMutationError";
    this.code = code;
    this.range = options.range;
    this.mutationIndex = options.mutationIndex;
  }
}

const ADDRESSABLE_MARKDOWN_BLOCKS = new Set([
  "heading",
  "paragraph",
  "listitem",
  "blockquote",
  "code",
  "thematicbreak",
  "html",
  "table",
  "definition",
  "footnotedefinition",
]);

function normalizeKind(kind: string): string {
  return kind.replace(/[\s_.-]+/g, "").toLowerCase();
}

export function isLosslessAddressableBlock(node: LosslessNode): boolean {
  if (!node.editable || node.range.end < node.range.start) return false;
  if (node.domain === "yaml") return normalizeKind(node.kind) === "pair";
  return node.domain === "markdown" && ADDRESSABLE_MARKDOWN_BLOCKS.has(normalizeKind(node.kind));
}

function asDocument(input: LosslessSkillDocument | string): LosslessSkillDocument {
  return typeof input === "string" ? parseLosslessSkillDocument(input) : input;
}

function assertDocumentIntegrity(document: LosslessSkillDocument): void {
  const actualHash = hashLosslessSource(document.source);
  if (actualHash !== document.sourceHash) {
    throw new LosslessMutationError(
      "invalid-document",
      `Document source hash is ${actualHash}, but its node model expects ${document.sourceHash}.`,
    );
  }
  const indexedRoot = document.nodeIndex[document.rootId];
  if (!indexedRoot || indexedRoot.raw !== document.source) {
    throw new LosslessMutationError(
      "invalid-document",
      "Document root and authoritative source are inconsistent.",
    );
  }
}

function assertMutationSource(
  document: LosslessSkillDocument,
  mutation: LosslessMutation,
  mutationIndex: number,
): void {
  if (mutation.expectedSourceHash && mutation.expectedSourceHash !== document.sourceHash) {
    throw new LosslessMutationError(
      "stale-source",
      `Mutation expects source ${mutation.expectedSourceHash}, current source is ${document.sourceHash}.`,
      { mutationIndex },
    );
  }
}

function requireNode(
  document: LosslessSkillDocument,
  nodeId: string,
  expectedNodeHash: string,
  mutationIndex: number,
): LosslessNode {
  const node = document.nodeIndex[nodeId];
  if (!node) {
    throw new LosslessMutationError(
      "missing-node",
      `Node ${nodeId} is not present in the current document.`,
      { mutationIndex },
    );
  }
  const currentRaw = document.source.slice(node.range.start, node.range.end);
  const currentHash = hashLosslessSource(currentRaw);
  if (currentRaw !== node.raw || currentHash !== node.rawHash || currentHash !== expectedNodeHash) {
    throw new LosslessMutationError(
      "stale-node",
      `Node ${nodeId} changed (expected ${expectedNodeHash}, current ${currentHash}).`,
      { range: node.range, mutationIndex },
    );
  }
  return node;
}

function editForRange(
  document: LosslessSkillDocument,
  range: SourceRange,
  replacement: string,
  nodeId: string,
  mutationKind: SourceEdit["mutationKind"],
  mutationIndex: number,
): SourceEdit {
  return {
    start: range.start,
    end: range.end,
    replacement,
    expectedRawHash: hashLosslessSource(document.source.slice(range.start, range.end)),
    nodeId,
    mutationKind,
    mutationIndex,
  };
}

function siblingAddressableIds(document: LosslessSkillDocument, node: LosslessNode): string[] {
  if (!node.parentId) return [];
  const parent = document.nodeIndex[node.parentId];
  return (parent?.children ?? []).filter((id) => {
    const sibling = document.nodeIndex[id];
    return Boolean(sibling && isLosslessAddressableBlock(sibling));
  });
}

function endsWithLineBreak(value: string): boolean {
  return /(?:\r\n|\r|\n)$/.test(value);
}

function startsWithLineBreak(value: string): boolean {
  return /^(?:\r\n|\r|\n)/.test(value);
}

function movedInsertion(
  document: LosslessSkillDocument,
  node: LosslessNode,
  target: LosslessNode,
  placement: "before" | "after",
): string {
  const newline = document.newline || "\n";
  if (placement === "before") {
    return endsWithLineBreak(node.raw) || startsWithLineBreak(target.raw)
      ? node.raw
      : `${node.raw}${newline}`;
  }
  return endsWithLineBreak(target.raw) || startsWithLineBreak(node.raw)
    ? node.raw
    : `${newline}${node.raw}`;
}

function compileMutation(
  document: LosslessSkillDocument,
  mutation: LosslessMutation,
  mutationIndex: number,
): SourceEdit[] {
  assertMutationSource(document, mutation, mutationIndex);
  const node = requireNode(
    document,
    mutation.nodeId,
    mutation.expectedNodeHash,
    mutationIndex,
  );

  switch (mutation.kind) {
    case "set-field": {
      const field = node.fieldRanges[mutation.field];
      if (!field) {
        throw new LosslessMutationError(
          "missing-field",
          `Node ${node.id} does not expose field ${mutation.field}.`,
          { range: node.range, mutationIndex },
        );
      }
      if (!field.editable) {
        throw new LosslessMutationError(
          "uneditable-field",
          `Field ${mutation.field} on node ${node.id} is read-only.`,
          { range: field, mutationIndex },
        );
      }
      if (document.source.slice(field.start, field.end) === mutation.value) return [];
      return [editForRange(
        document,
        field,
        mutation.value,
        node.id,
        mutation.kind,
        mutationIndex,
      )];
    }
    case "replace-node":
      if (node.raw === mutation.replacement) return [];
      return [editForRange(
        document,
        node.range,
        mutation.replacement,
        node.id,
        mutation.kind,
        mutationIndex,
      )];
    case "insert-before":
      if (!mutation.content) return [];
      return [editForRange(
        document,
        { start: node.range.start, end: node.range.start },
        mutation.content,
        node.id,
        mutation.kind,
        mutationIndex,
      )];
    case "insert-after":
      if (!mutation.content) return [];
      return [editForRange(
        document,
        { start: node.range.end, end: node.range.end },
        mutation.content,
        node.id,
        mutation.kind,
        mutationIndex,
      )];
    case "delete-node":
      if (!isLosslessAddressableBlock(node)) {
        throw new LosslessMutationError(
          "unaddressable-block",
          `Node ${node.id} (${node.domain}:${node.kind}) cannot be deleted as an addressable block.`,
          { range: node.range, mutationIndex },
        );
      }
      if (!node.raw) return [];
      return [editForRange(
        document,
        node.range,
        "",
        node.id,
        mutation.kind,
        mutationIndex,
      )];
    case "move-before":
    case "move-after": {
      if (!isLosslessAddressableBlock(node)) {
        throw new LosslessMutationError(
          "unaddressable-block",
          `Node ${node.id} (${node.domain}:${node.kind}) cannot be moved as an addressable block.`,
          { range: node.range, mutationIndex },
        );
      }
      if (mutation.targetNodeId === node.id) return [];
      const target = document.nodeIndex[mutation.targetNodeId];
      if (!target || !isLosslessAddressableBlock(target)) {
        throw new LosslessMutationError(
          "invalid-target",
          `Move target ${mutation.targetNodeId} is not an addressable block.`,
          { mutationIndex },
        );
      }
      const targetCurrentHash = hashLosslessSource(
        document.source.slice(target.range.start, target.range.end),
      );
      if (
        target.rawHash !== targetCurrentHash
        || (mutation.targetExpectedNodeHash && mutation.targetExpectedNodeHash !== targetCurrentHash)
      ) {
        throw new LosslessMutationError(
          "stale-node",
          `Move target ${target.id} changed before the mutation was applied.`,
          { range: target.range, mutationIndex },
        );
      }
      if (!node.parentId || node.parentId !== target.parentId) {
        throw new LosslessMutationError(
          "different-parent",
          `Move nodes ${node.id} and ${target.id} must have the same parent.`,
          { range: node.range, mutationIndex },
        );
      }

      const siblings = siblingAddressableIds(document, node);
      const nodeIndex = siblings.indexOf(node.id);
      const targetIndex = siblings.indexOf(target.id);
      const alreadyPlaced = mutation.kind === "move-before"
        ? nodeIndex === targetIndex - 1
        : nodeIndex === targetIndex + 1;
      if (alreadyPlaced) return [];

      const placement = mutation.kind === "move-before" ? "before" : "after";
      const insertionOffset = placement === "before" ? target.range.start : target.range.end;
      return [
        editForRange(
          document,
          node.range,
          "",
          node.id,
          mutation.kind,
          mutationIndex,
        ),
        editForRange(
          document,
          { start: insertionOffset, end: insertionOffset },
          movedInsertion(document, node, target, placement),
          node.id,
          mutation.kind,
          mutationIndex,
        ),
      ];
    }
  }
}

function editsOverlap(left: SourceEdit, right: SourceEdit): boolean {
  if (left.start === right.start) return true;
  if (left.start === left.end) return left.start > right.start && left.start < right.end;
  if (right.start === right.end) return right.start > left.start && right.start < left.end;
  return left.start < right.end && right.start < left.end;
}

export function assertNonOverlappingSourceEdits(edits: SourceEdit[]): void {
  const ordered = [...edits].sort((left, right) => left.start - right.start || left.end - right.end);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (editsOverlap(previous, current)) {
      throw new LosslessMutationError(
        "overlapping-edits",
        `Source edits overlap at ${previous.start}:${previous.end} and ${current.start}:${current.end}.`,
        {
          range: {
            start: Math.min(previous.start, current.start),
            end: Math.max(previous.end, current.end),
          },
          mutationIndex: current.mutationIndex,
        },
      );
    }
  }
}

function sourceRangeUnion(ranges: SourceRange[]): SourceRange | null {
  if (ranges.length === 0) return null;
  return {
    start: Math.min(...ranges.map((range) => range.start)),
    end: Math.max(...ranges.map((range) => range.end)),
  };
}

function localityForEdits(
  before: string,
  after: string,
  edits: SourceEdit[],
): LosslessLocality {
  if (edits.length === 0) {
    return {
      noOp: true,
      beforeRanges: [],
      afterRanges: [],
      beforeChangedRange: null,
      afterChangedRange: null,
      preservedPrefixLength: before.length,
      preservedSuffixLength: before.length,
      unchangedOutsideEdits: before === after,
    };
  }

  const ordered = [...edits].sort((left, right) => left.start - right.start || left.end - right.end);
  const beforeRanges = ordered.map(({ start, end }) => ({ start, end }));
  const afterRanges: SourceRange[] = [];
  let delta = 0;
  let unchangedOutsideEdits = true;
  let beforeCursor = 0;
  let afterCursor = 0;

  ordered.forEach((edit) => {
    const afterStart = edit.start + delta;
    const afterEnd = afterStart + edit.replacement.length;
    afterRanges.push({ start: afterStart, end: afterEnd });
    const beforeUnchanged = before.slice(beforeCursor, edit.start);
    const afterUnchanged = after.slice(afterCursor, afterStart);
    if (beforeUnchanged !== afterUnchanged) unchangedOutsideEdits = false;
    beforeCursor = edit.end;
    afterCursor = afterEnd;
    delta += edit.replacement.length - (edit.end - edit.start);
  });
  if (before.slice(beforeCursor) !== after.slice(afterCursor)) unchangedOutsideEdits = false;

  const last = ordered[ordered.length - 1];
  return {
    noOp: false,
    beforeRanges,
    afterRanges,
    beforeChangedRange: sourceRangeUnion(beforeRanges),
    afterChangedRange: sourceRangeUnion(afterRanges),
    preservedPrefixLength: ordered[0].start,
    preservedSuffixLength: before.length - last.end,
    unchangedOutsideEdits,
  };
}

export function applyLosslessSourceEdits(
  source: string,
  edits: SourceEdit[],
): { source: string; locality: LosslessLocality } {
  assertNonOverlappingSourceEdits(edits);
  edits.forEach((edit) => {
    if (edit.start < 0 || edit.end < edit.start || edit.end > source.length) {
      throw new LosslessMutationError(
        "stale-edit",
        `Source edit ${edit.start}:${edit.end} is outside the current source.`,
        { range: { start: Math.max(0, edit.start), end: Math.max(0, edit.end) } },
      );
    }
    const actualHash = hashLosslessSource(source.slice(edit.start, edit.end));
    if (actualHash !== edit.expectedRawHash) {
      throw new LosslessMutationError(
        "stale-edit",
        `Source edit expected ${edit.expectedRawHash}, current slice is ${actualHash}.`,
        { range: { start: edit.start, end: edit.end }, mutationIndex: edit.mutationIndex },
      );
    }
  });

  if (edits.length === 0) return { source, locality: localityForEdits(source, source, []) };
  let nextSource = source;
  const descending = [...edits].sort((left, right) => right.start - left.start || right.end - left.end);
  descending.forEach((edit) => {
    nextSource = `${nextSource.slice(0, edit.start)}${edit.replacement}${nextSource.slice(edit.end)}`;
  });
  return { source: nextSource, locality: localityForEdits(source, nextSource, edits) };
}

/** Compile, validate, and atomically apply one or more source-range mutations. */
export function applyLosslessMutation(
  input: LosslessSkillDocument | string,
  mutation: LosslessMutation | LosslessMutation[],
): LosslessMutationResult {
  const document = asDocument(input);
  assertDocumentIntegrity(document);
  const mutations = Array.isArray(mutation) ? mutation : [mutation];
  const edits = mutations.flatMap((item, index) => compileMutation(document, item, index));
  const applied = applyLosslessSourceEdits(document.source, edits);
  if (applied.source === document.source) {
    return {
      source: document.source,
      document,
      edits: [],
      inverseSource: document.source,
      locality: localityForEdits(document.source, document.source, []),
    };
  }

  const nextDocument = parseLosslessSkillDocument(applied.source);
  const fatal = nextDocument.diagnostics.find((diagnostic) => diagnostic.fatal);
  if (fatal) {
    throw new LosslessMutationError(
      "fatal-reparse",
      `Mutation was rejected after reparse: ${fatal.code}: ${fatal.message}`,
      { range: fatal.range },
    );
  }
  return {
    source: applied.source,
    document: nextDocument,
    edits,
    inverseSource: document.source,
    locality: applied.locality,
  };
}

