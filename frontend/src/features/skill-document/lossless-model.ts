/** A half-open UTF-16 source range. Offsets use JavaScript string indices. */
export interface SourceRange {
  start: number;
  end: number;
}

/** A source range that can be addressed by a structured editor. */
export interface FieldRange extends SourceRange {
  raw: string;
  editable: boolean;
}

export type LosslessNodeDomain = "document" | "yaml" | "markdown" | "trivia";

/**
 * A flattened source node. Container nodes may overlap their descendants;
 * coverage leaf nodes and trivia nodes do not overlap one another.
 */
export interface LosslessNode {
  id: string;
  parentId: string | null;
  children: string[];
  domain: LosslessNodeDomain;
  kind: string;
  path: Array<string | number>;
  range: SourceRange;
  contentRange?: SourceRange;
  fieldRanges: Record<string, FieldRange>;
  raw: string;
  rawHash: string;
  editable: boolean;
  coverageRole: "container" | "leaf" | "trivia";
  attributes: Record<string, unknown>;
}

export type LosslessDiagnosticSeverity = "info" | "warning" | "error";

export interface LosslessDiagnostic {
  id: string;
  severity: LosslessDiagnosticSeverity;
  source: "frontmatter" | "yaml" | "markdown" | "coverage";
  code: string;
  message: string;
  range?: SourceRange;
  fatal: boolean;
}

export interface NewlineProfile {
  first: "\r\n" | "\n" | "\r" | "";
  dominant: "\r\n" | "\n" | "\r" | "";
  crlf: number;
  lf: number;
  cr: number;
  mixed: boolean;
}

export interface FrontmatterBoundary {
  present: boolean;
  terminated: boolean;
  marker: "---" | null;
  closingMarker: "---" | "..." | null;
  range: SourceRange | null;
  openingRange: SourceRange | null;
  contentRange: SourceRange | null;
  closingRange: SourceRange | null;
  bodyRange: SourceRange;
  rootId: string | null;
  value: unknown;
}

export interface LosslessCoverage {
  sourceLength: number;
  coveredLength: number;
  semanticLength: number;
  triviaLength: number;
  percent: number;
  complete: boolean;
  overlapCount: number;
  gapCount: number;
  semanticNodeCount: number;
  triviaNodeCount: number;
  editableNodeCount: number;
  uneditableNodeCount: number;
  nodeIds: string[];
}

/** The source string is the sole serialization authority. */
export interface LosslessSkillDocument {
  source: string;
  sourceHash: string;
  revision: number;
  bom: "\uFEFF" | "";
  newline: "\r\n" | "\n" | "\r" | "";
  newlineProfile: NewlineProfile;
  hasTrailingNewline: boolean;
  frontmatter: FrontmatterBoundary;
  bodyRange: SourceRange;
  rootId: string;
  frontmatterRootId: string | null;
  markdownRootId: string;
  root: LosslessNode;
  frontmatterRoot: LosslessNode | null;
  markdownRoot: LosslessNode;
  nodes: LosslessNode[];
  nodeIndex: Record<string, LosslessNode>;
  diagnostics: LosslessDiagnostic[];
  coverage: LosslessCoverage;
}

