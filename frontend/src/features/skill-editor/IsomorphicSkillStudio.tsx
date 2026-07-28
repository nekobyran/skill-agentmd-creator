import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CSSProperties,
  KeyboardEvent,
  ReactNode,
} from "react";
import {
  hashLosslessSource,
  parseLosslessSkillDocument,
} from "../skill-document/lossless-parse";
import {
  applyLosslessMutation,
  isLosslessAddressableBlock,
} from "../skill-document/lossless-mutate";
import type {
  LosslessMutation,
  LosslessMutationKind,
  LosslessMutationResult,
} from "../skill-document/lossless-mutate";
import type {
  FieldRange,
  LosslessDiagnostic,
  LosslessNode,
  LosslessSkillDocument,
  SourceRange,
} from "../skill-document/lossless-model";
import type {
  FidelityBinding,
  FidelityReport,
  ApplyNodeEditInput,
  IsomorphicSkillStudioProps,
  IsomorphicNodeEditKind,
  IsomorphicNodeEditResult,
  NodeEdit,
} from "./isomorphic-model";
import "./IsomorphicSkillStudio.css";

type StudioStage = "tree" | "inspect";
type InsertMode = "insert-before" | "insert-after" | "insert-child";
type StudioEditKind = LosslessMutationKind | "undo";

interface VisibleTreeRow {
  node: LosslessNode;
  depth: number;
}

interface HistoryEntry {
  before: string;
  after: string;
  nodeId: string;
  kind: IsomorphicNodeEditKind;
}

interface InsertDialogState {
  mode: InsertMode;
  raw: string;
}

export default function IsomorphicSkillStudio({
  source,
  name,
  profile,
  onSourceChange,
  onClose,
  onOpenAi,
  className,
}: IsomorphicSkillStudioProps) {
  const titleId = useId();
  const treeId = useId();
  const [workingSource, setWorkingSource] = useState(source);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState<StudioStage>("tree");
  const [notice, setNotice] = useState("同构节点编辑器已就绪");
  const [noticeState, setNoticeState] = useState<"idle" | "error">("idle");
  const [insertDialog, setInsertDialog] = useState<InsertDialogState | null>(null);
  const [historyRevision, setHistoryRevision] = useState(0);
  const historyRef = useRef<HistoryEntry[]>([]);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const insertTextAreaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setWorkingSource(source);
  }, [source]);

  const document = useMemo(
    () => parseLosslessSkillDocument(workingSource),
    [workingSource],
  );
  const fidelity = useMemo(
    () => profile?.inspect(document) ?? genericFidelityReport(document),
    [document, profile],
  );
  const bindingsByNodeId = useMemo(() => {
    const index = new Map<string, FidelityBinding[]>();
    fidelity.bindings.forEach((binding) => {
      if (!binding.nodeId) return;
      const current = index.get(binding.nodeId) ?? [];
      current.push(binding);
      index.set(binding.nodeId, current);
    });
    return index;
  }, [fidelity]);

  useEffect(() => {
    const defaults = defaultExpandedNodes(document);
    setExpandedNodeIds((current) => current.size ? current : defaults);
  }, [document.rootId]);

  useEffect(() => {
    if (selectedNodeId && document.nodeIndex[selectedNodeId]) return;
    const preferredBinding = fidelity.bindings.find((binding) => binding.nodeId && binding.editable);
    const preferred = preferredBinding?.nodeId
      ? document.nodeIndex[preferredBinding.nodeId]
      : document.nodes.find((node) => node.editable && node.coverageRole !== "container");
    setSelectedNodeId(preferred?.id ?? document.rootId);
  }, [document, fidelity, selectedNodeId]);

  useEffect(() => {
    if (!insertDialog) return;
    const timer = window.setTimeout(() => insertTextAreaRef.current?.focus(), 0);
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setInsertDialog(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [insertDialog]);

  const visibleRows = useMemo(
    () => flattenVisibleTree(document, expandedNodeIds, search, bindingsByNodeId),
    [document, expandedNodeIds, search, bindingsByNodeId],
  );
  const selectedNode = selectedNodeId ? document.nodeIndex[selectedNodeId] ?? null : null;
  const selectedBindings = selectedNode ? bindingsByNodeId.get(selectedNode.id) ?? [] : [];
  const selectedDiagnostics = selectedNode
    ? document.diagnostics.filter((diagnostic) => rangesOverlap(diagnostic.range, selectedNode.range))
    : [];
  const historyAvailable = historyRef.current.length > 0;
  const rootClass = ["isomorphic-studio", className].filter(Boolean).join(" ");

  const emitNodeEdit = (result: IsomorphicNodeEditResult, nextSelectionId?: string | null) => {
    if (result.source === result.previousSource) {
      setNotice("源码未发生变化");
      setNoticeState("idle");
      return;
    }
    historyRef.current.push({
      before: result.previousSource,
      after: result.source,
      nodeId: result.nodeId,
      kind: result.kind,
    });
    setHistoryRevision((revision) => revision + 1);
    setWorkingSource(result.source);
    onSourceChange(result.source, result);
    if (nextSelectionId !== undefined) setSelectedNodeId(nextSelectionId);
    setNotice(`${editKindLabel(result.kind)}已应用 · 仅修改 ${result.changedRange.start}:${result.changedRange.end}`);
    setNoticeState("idle");
  };

  const commitEdits = (
    node: LosslessNode,
    kind: ApplyNodeEditInput["kind"],
    edits: NodeEdit[],
    nextSelectionId?: string | null,
  ) => {
    try {
      const result = applyNodeEdit({
        document,
        nodeId: node.id,
        expectedRawHash: node.rawHash,
        kind,
        edits,
      });
      emitNodeEdit(result, nextSelectionId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
      setNoticeState("error");
    }
  };

  const commitField = (node: LosslessNode, fieldName: string, field: FieldRange, value: string) => {
    if (!field.editable) {
      setNotice(`字段 ${fieldName} 不可编辑`);
      setNoticeState("error");
      return;
    }
    commitEdits(node, "set-field", [{ range: field, replacement: value }]);
  };

  const commitRawNode = (node: LosslessNode, value: string) => {
    commitEdits(node, "replace-node", [{ range: node.range, replacement: value }]);
  };

  const deleteSelectedNode = () => {
    if (!selectedNode || selectedNode.id === document.rootId) return;
    if (!window.confirm(`删除节点“${nodeTitle(selectedNode)}”？只会删除范围 ${formatRange(selectedNode.range)}。`)) return;
    commitEdits(
      selectedNode,
      "delete-node",
      [{ range: selectedNode.range, replacement: "" }],
      selectedNode.parentId,
    );
  };

  const moveSelectedNode = (direction: -1 | 1) => {
    if (!selectedNode?.parentId) return;
    const siblings = siblingNodes(document, selectedNode);
    const selectedIndex = siblings.findIndex((node) => node.id === selectedNode.id);
    const other = siblings[selectedIndex + direction];
    if (!other) return;
    const first = direction < 0 ? other : selectedNode;
    const second = direction < 0 ? selectedNode : other;
    const gap = document.source.slice(first.range.end, second.range.start);
    const replacement = `${second.raw}${gap}${first.raw}`;
    commitEdits(
      selectedNode,
      direction < 0 ? "move-up" : "move-down",
      [{ range: { start: first.range.start, end: second.range.end }, replacement }],
    );
  };

  const confirmInsert = () => {
    if (!selectedNode || !insertDialog) return;
    const insertionOffset = insertOffset(document, selectedNode, insertDialog.mode);
    commitEdits(selectedNode, insertDialog.mode, [{
      range: { start: insertionOffset, end: insertionOffset },
      replacement: insertDialog.raw,
    }]);
    setInsertDialog(null);
  };

  const undo = () => {
    const entry = historyRef.current.at(-1);
    if (!entry) return;
    if (workingSource !== entry.after) {
      setNotice("撤销已暂停：当前源码与最近编辑结果不一致");
      setNoticeState("error");
      return;
    }
    historyRef.current.pop();
    setHistoryRevision((revision) => revision + 1);
    const result: IsomorphicNodeEditResult = {
      kind: "undo",
      nodeId: entry.nodeId,
      previousSource: workingSource,
      source: entry.before,
      changedRange: { start: 0, end: workingSource.length },
      replacementRange: { start: 0, end: entry.before.length },
    };
    setWorkingSource(entry.before);
    onSourceChange(entry.before, result);
    setSelectedNodeId(entry.nodeId);
    setNotice(`已撤销 ${editKindLabel(entry.kind)}`);
    setNoticeState("idle");
  };

  const selectNode = (id: string, inspect = false) => {
    setSelectedNodeId(id);
    if (inspect) setStage("inspect");
  };

  const handleTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>, rowIndex: number) => {
    const row = visibleRows[rowIndex];
    if (!row) return;
    const node = row.node;
    const focusRow = (index: number) => {
      const target = visibleRows[Math.max(0, Math.min(visibleRows.length - 1, index))];
      if (!target) return;
      selectNode(target.node.id);
      window.setTimeout(() => rowRefs.current.get(target.node.id)?.focus(), 0);
    };
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusRow(rowIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusRow(rowIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusRow(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusRow(visibleRows.length - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      if (node.children.length && !expandedNodeIds.has(node.id)) toggleExpanded(node.id, setExpandedNodeIds);
      else if (node.children[0]) {
        const childIndex = visibleRows.findIndex((item) => item.node.id === node.children[0]);
        if (childIndex >= 0) focusRow(childIndex);
      }
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (node.children.length && expandedNodeIds.has(node.id)) toggleExpanded(node.id, setExpandedNodeIds);
      else if (node.parentId) {
        const parentIndex = visibleRows.findIndex((item) => item.node.id === node.parentId);
        if (parentIndex >= 0) focusRow(parentIndex);
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      selectNode(node.id, true);
    } else if (event.key === " " && node.children.length) {
      event.preventDefault();
      toggleExpanded(node.id, setExpandedNodeIds);
    }
  };

  return (
    <section className={rootClass} data-stage={stage} aria-labelledby={titleId}>
      <header className="iso-header">
        <div className="iso-header__title">
          <span className="iso-header__eyebrow">LOSSLESS NODE WORKBENCH</span>
          <h2 id={titleId}>完全同构编辑 · {name || fidelity.profileName}</h2>
          <p>每个字段都绑定真实 nodeId 与 source range；未知语法也作为原始节点保留。</p>
        </div>
        <div className="iso-metrics" aria-label="同构覆盖指标">
          <Metric label="语义覆盖" value={`${fidelity.mapped}/${fidelity.expected}`} state={fidelity.unmapped ? "warn" : "pass"} />
          <Metric label="可编辑" value={`${fidelity.editable}`} state={fidelity.uneditable ? "warn" : "pass"} />
          <Metric label="源码覆盖" value={`${document.coverage.percent.toFixed(2)}%`} state={document.coverage.complete ? "pass" : "warn"} />
        </div>
        <div className="iso-header__actions">
          <button type="button" className="iso-button--quiet" onClick={undo} disabled={!historyAvailable} data-history-revision={historyRevision}>
            撤销
          </button>
          {onOpenAi && (
            <button type="button" className="iso-button--primary" onClick={() => onOpenAi(selectedNode ?? undefined)}>
              AI 修改节点
            </button>
          )}
          {onClose && <button type="button" className="iso-button--quiet" onClick={onClose}>关闭</button>}
        </div>
      </header>

      <div className="iso-toolbar">
        <div className="iso-mobile-switch" aria-label="窄屏编辑阶段">
          <button type="button" aria-pressed={stage === "tree"} onClick={() => setStage("tree")}>1 节点</button>
          <button type="button" aria-pressed={stage === "inspect"} onClick={() => setStage("inspect")} disabled={!selectedNode}>2 编辑</button>
        </div>
        <label className="iso-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="筛选 kind、path、内容或语义映射"
            aria-label="筛选全部源码节点"
          />
        </label>
        <button type="button" onClick={() => setExpandedNodeIds(new Set(document.nodes.filter((node) => node.children.length).map((node) => node.id)))}>
          全部展开
        </button>
        <button type="button" onClick={() => setExpandedNodeIds(new Set([document.rootId]))}>
          收起
        </button>
        <span className="iso-toolbar__summary">
          {document.nodes.length} nodes · {document.coverage.triviaNodeCount} trivia · {workingSource.length.toLocaleString()} chars
        </span>
      </div>

      <div className="iso-workspace">
        <section className="iso-pane iso-pane--tree" aria-labelledby={`${treeId}-heading`}>
          <div className="iso-pane__heading">
            <h3 id={`${treeId}-heading`}>全部节点树</h3>
            <span>{visibleRows.length}/{document.nodes.length}</span>
          </div>
          <div id={treeId} className="iso-tree" role="tree" aria-label="SKILL.md 全部 YAML、Markdown 与 trivia 节点">
            {visibleRows.length ? visibleRows.map((row, index) => {
              const node = row.node;
              const bindings = bindingsByNodeId.get(node.id) ?? [];
              const expanded = node.children.length ? expandedNodeIds.has(node.id) : undefined;
              const diagnostic = document.diagnostics.some((item) => rangesOverlap(item.range, node.range));
              return (
                <div
                  key={node.id}
                  ref={(element) => {
                    if (element) rowRefs.current.set(node.id, element);
                    else rowRefs.current.delete(node.id);
                  }}
                  role="treeitem"
                  aria-level={row.depth + 1}
                  aria-expanded={expanded}
                  aria-selected={selectedNode?.id === node.id}
                  tabIndex={selectedNode?.id === node.id ? 0 : -1}
                  className="iso-tree-row"
                  data-diagnostic={diagnostic || undefined}
                  style={{ "--iso-depth": row.depth } as CSSProperties}
                  onClick={() => selectNode(node.id)}
                  onDoubleClick={() => selectNode(node.id, true)}
                  onKeyDown={(event) => handleTreeKeyDown(event, index)}
                >
                  {node.children.length ? (
                    <button
                      type="button"
                      className="iso-tree-toggle"
                      tabIndex={-1}
                      aria-label={expanded ? `折叠 ${nodeTitle(node)}` : `展开 ${nodeTitle(node)}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleExpanded(node.id, setExpandedNodeIds);
                      }}
                    >
                      {expanded ? "▾" : "▸"}
                    </button>
                  ) : <span />}
                  <span className="iso-tree-glyph" aria-hidden="true">{nodeGlyph(node)}</span>
                  <span className="iso-tree-copy">
                    <strong>{nodeTitle(node)}</strong>
                    <small>{node.path.length ? node.path.join(" / ") : node.id} · {formatRange(node.range)}</small>
                  </span>
                  {bindings.length > 0 && <span className="iso-node-badge">{bindings.length} MAP</span>}
                </div>
              );
            }) : (
              <div className="iso-tree-empty">没有节点匹配“{search}”</div>
            )}
          </div>
        </section>

        <section className="iso-pane iso-pane--inspector" aria-labelledby="iso-inspector-heading">
          <div className="iso-pane__heading">
            <h3 id="iso-inspector-heading">Typed Inspector</h3>
            <span>{selectedNode ? `${selectedNode.domain}/${selectedNode.kind}` : "NO SELECTION"}</span>
          </div>
          {selectedNode ? (
            <NodeInspector
              key={`${selectedNode.id}:${selectedNode.rawHash}`}
              document={document}
              node={selectedNode}
              bindings={selectedBindings}
              diagnostics={selectedDiagnostics}
              canMoveUp={canMove(document, selectedNode, -1)}
              canMoveDown={canMove(document, selectedNode, 1)}
              onCommitField={commitField}
              onCommitRaw={commitRawNode}
              onInsert={(mode) => setInsertDialog({ mode, raw: defaultInsertionRaw(document, selectedNode) })}
              onMove={moveSelectedNode}
              onDelete={deleteSelectedNode}
              onOpenAi={onOpenAi ? () => onOpenAi(selectedNode) : undefined}
              evidence={(
                <div className="iso-mobile-evidence">
                  <EvidencePanel idPrefix="mobile" document={document} node={selectedNode} fidelity={fidelity} />
                </div>
              )}
            />
          ) : (
            <div className="iso-inspector-empty">从节点树选择 YAML、Markdown、代码或 trivia 节点。</div>
          )}
        </section>

        <section className="iso-pane iso-pane--source" aria-labelledby="iso-source-heading">
          <div className="iso-pane__heading">
            <h3 id="iso-source-heading">范围与覆盖证据</h3>
            <span>{selectedNode ? selectedNode.rawHash : document.sourceHash}</span>
          </div>
          {selectedNode ? (
            <EvidencePanel idPrefix="desktop" document={document} node={selectedNode} fidelity={fidelity} />
          ) : (
            <div className="iso-inspector-empty">选择节点后显示准确 source range。</div>
          )}
        </section>
      </div>

      <footer className="iso-notice" data-state={noticeState} aria-live="polite">
        {notice} · revision {document.revision} · {document.newlineProfile.mixed ? "mixed newline" : newlineLabel(document.newline)}
      </footer>

      {insertDialog && selectedNode && (
        <div className="iso-dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setInsertDialog(null);
        }}>
          <section className="iso-dialog" role="dialog" aria-modal="true" aria-labelledby="iso-insert-title">
            <h3 id="iso-insert-title">{insertModeLabel(insertDialog.mode)}</h3>
            <p>输入将按原样插入到精确 offset；编辑器不会自动规范化缩进、标记或换行。</p>
            <label className="iso-field iso-field--raw">
              <span>原始节点源码</span>
              <textarea
                ref={insertTextAreaRef}
                value={insertDialog.raw}
                spellCheck={false}
                onChange={(event) => setInsertDialog({ ...insertDialog, raw: event.target.value })}
              />
            </label>
            <div className="iso-dialog__actions">
              <button type="button" onClick={() => setInsertDialog(null)}>取消</button>
              <button type="button" className="iso-button--primary" onClick={confirmInsert} disabled={!insertDialog.raw}>精确插入</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

interface NodeInspectorProps {
  document: LosslessSkillDocument;
  node: LosslessNode;
  bindings: FidelityBinding[];
  diagnostics: LosslessDiagnostic[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  onCommitField: (node: LosslessNode, name: string, field: FieldRange, value: string) => void;
  onCommitRaw: (node: LosslessNode, value: string) => void;
  onInsert: (mode: InsertMode) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
  onOpenAi?: () => void;
  evidence: ReactNode;
}

function NodeInspector({
  document,
  node,
  bindings,
  diagnostics,
  canMoveUp,
  canMoveDown,
  onCommitField,
  onCommitRaw,
  onInsert,
  onMove,
  onDelete,
  onOpenAi,
  evidence,
}: NodeInspectorProps) {
  const fieldEntries = Object.entries(node.fieldRanges);
  const attributeEntries = Object.entries(node.attributes);
  return (
    <div className="iso-inspector">
      <div className="iso-inspector__identity">
        <code>{node.id}</code>
        <h3>{nodeTitle(node)}</h3>
        <p>{node.domain} / {node.kind} · {node.coverageRole} · range {formatRange(node.range)}</p>
        {bindings.map((binding) => (
          <p key={binding.semanticId}>{binding.semanticId} · {binding.label}</p>
        ))}
      </div>

      <div className="iso-inspector__actions" aria-label="节点操作">
        <button type="button" onClick={() => onInsert("insert-before")}>前插</button>
        <button type="button" onClick={() => onInsert("insert-after")}>后插</button>
        <button type="button" onClick={() => onInsert("insert-child")} disabled={!node.children.length && !node.contentRange}>插入子节点</button>
        <button type="button" onClick={() => onMove(-1)} disabled={!canMoveUp}>上移</button>
        <button type="button" onClick={() => onMove(1)} disabled={!canMoveDown}>下移</button>
        {onOpenAi && <button type="button" onClick={onOpenAi}>AI 修改</button>}
        <button type="button" className="iso-button--danger" onClick={onDelete} disabled={node.id === document.rootId}>删除</button>
      </div>

      <fieldset className="iso-fieldset">
        <legend>可寻址字段 · {fieldEntries.length}</legend>
        {fieldEntries.length ? fieldEntries.map(([name, field]) => (
          <DraftRangeField
            key={`${name}:${field.start}:${field.end}`}
            name={name}
            field={field}
            onCommit={(value) => onCommitField(node, name, field, value)}
          />
        )) : <p className="iso-tree-empty">此节点没有 typed field range，可使用下方原始节点编辑器。</p>}
      </fieldset>

      {attributeEntries.length > 0 && (
        <fieldset className="iso-fieldset">
          <legend>解析属性 · read only</legend>
          {attributeEntries.map(([name, value]) => (
            <label key={name} className="iso-field">
              <span>{name}</span>
              <input value={formatAttribute(value)} readOnly aria-readonly="true" />
            </label>
          ))}
        </fieldset>
      )}

      <fieldset className="iso-fieldset">
        <legend>Generic Raw Node Inspector</legend>
        <DraftRawNode value={node.raw} onCommit={(value) => onCommitRaw(node, value)} />
      </fieldset>

      {diagnostics.length > 0 && (
        <fieldset className="iso-fieldset">
          <legend>节点诊断 · {diagnostics.length}</legend>
          <ul className="iso-diagnostics">
            {diagnostics.map((diagnostic) => (
              <li key={diagnostic.id} data-severity={diagnostic.severity}>
                <span>{diagnostic.message}</span>
                <strong>{diagnostic.code}</strong>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      {evidence}
    </div>
  );
}

function DraftRangeField({
  name,
  field,
  onCommit,
}: {
  name: string;
  field: FieldRange;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(field.raw);
  useEffect(() => setDraft(field.raw), [field.raw]);
  const multiline = /\r|\n/.test(field.raw) || field.raw.length > 100 || ["source", "text", "value"].includes(name);
  const commit = () => {
    if (draft !== field.raw) onCommit(draft);
  };
  return (
    <label className="iso-field">
      <span>{fieldLabel(name)}</span>
      {multiline ? (
        <textarea
          value={draft}
          disabled={!field.editable}
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              commit();
            } else if (event.key === "Escape") {
              setDraft(field.raw);
            }
          }}
        />
      ) : (
        <input
          value={draft}
          disabled={!field.editable}
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            } else if (event.key === "Escape") {
              setDraft(field.raw);
            }
          }}
        />
      )}
      <small>{formatRange(field)} · {field.editable ? "blur / Ctrl+Enter 保存" : "只读"}</small>
    </label>
  );
}

function DraftRawNode({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div className="iso-field iso-field--raw">
      <span>节点原始源码</span>
      <textarea value={draft} spellCheck={false} onChange={(event) => setDraft(event.target.value)} />
      <small>替换当前节点 range；未修改切片保持逐字符一致。</small>
      <div className="iso-field__commit">
        <button type="button" onClick={() => onCommit(draft)} disabled={draft === value}>替换节点</button>
      </div>
    </div>
  );
}

function EvidencePanel({
  idPrefix,
  document,
  node,
  fidelity,
}: {
  idPrefix: string;
  document: LosslessSkillDocument;
  node: LosslessNode;
  fidelity: FidelityReport;
}) {
  const preview = rangePreview(document.source, node.range, 150);
  const location = lineAndColumn(document.source, node.range.start);
  return (
    <div className="iso-source">
      <dl className="iso-source__meta">
        <div><dt>START / END</dt><dd>{formatRange(node.range)}</dd></div>
        <div><dt>LINE / COLUMN</dt><dd>{location.line}:{location.column}</dd></div>
        <div><dt>NODE HASH</dt><dd>{node.rawHash}</dd></div>
        <div><dt>DOCUMENT HASH</dt><dd>{document.sourceHash}</dd></div>
      </dl>
      <pre className="iso-source-range" aria-label="所选节点源范围预览">
        {preview.before}<mark>{preview.selected || "∅"}</mark>{preview.after}
      </pre>
      <section className="iso-coverage" aria-labelledby={`iso-coverage-title-${idPrefix}`}>
        <div className="iso-coverage__heading">
          <h4 id={`iso-coverage-title-${idPrefix}`}>{fidelity.profileName}</h4>
          <strong>{fidelity.mapped}/{fidelity.expected} · {fidelity.coveragePercent}%</strong>
        </div>
        <ul className="iso-coverage-list">
          {fidelity.groups.map((group) => (
            <li
              key={group.id}
              data-state={group.unmapped ? "unmapped" : group.uneditable ? "uneditable" : "mapped"}
            >
              <span>{group.label}</span>
              <strong>{group.mapped}/{group.expected}{group.unmapped ? ` · U${group.unmapped}` : ""}{group.uneditable ? ` · R${group.uneditable}` : ""}</strong>
            </li>
          ))}
        </ul>
      </section>
      {fidelity.diagnostics.length > 0 && (
        <section className="iso-coverage" aria-labelledby={`iso-profile-diagnostics-${idPrefix}`}>
          <div className="iso-coverage__heading">
            <h4 id={`iso-profile-diagnostics-${idPrefix}`}>Profile diagnostics</h4>
            <strong>{fidelity.diagnostics.length}</strong>
          </div>
          <ul className="iso-diagnostics">
            {fidelity.diagnostics.slice(0, 12).map((message, index) => (
              <li key={`${index}:${message}`} data-severity="warning">
                <span>{message}</span><strong>CHECK</strong>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Metric({ label, value, state }: { label: string; value: string; state: "pass" | "warn" }) {
  return (
    <div className="iso-metric" data-state={state}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

/**
 * The only source splice entry. It rejects stale node hashes, invalid ranges,
 * overlapping edits, and edits outside the selected node unless insertion or
 * sibling movement explicitly requires an adjacent range.
 */
export function applyNodeEdit(input: ApplyNodeEditInput): IsomorphicNodeEditResult {
  const node = input.document.nodeIndex[input.nodeId];
  if (!node) throw new Error(`节点已不存在：${input.nodeId}`);
  const liveRaw = input.document.source.slice(node.range.start, node.range.end);
  if (node.rawHash !== input.expectedRawHash || hashLosslessSource(liveRaw) !== input.expectedRawHash) {
    throw new Error("节点源码已变化，请重新选择后再编辑");
  }
  if (!input.edits.length) throw new Error("没有可应用的 source edit");

  const edits = input.edits
    .map((edit) => ({
      range: normalizeRange(edit.range, input.document.source.length),
      replacement: edit.replacement,
    }))
    .sort((left, right) => right.range.start - left.range.start || right.range.end - left.range.end);

  edits.forEach((edit) => {
    const insideNode = edit.range.start >= node.range.start && edit.range.end <= node.range.end;
    if (["set-field", "replace-node", "delete-node"].includes(input.kind) && !insideNode) {
      throw new Error(`${input.kind} 超出目标节点 range，已原子拒绝`);
    }
    if (input.kind === "insert-before" && (edit.range.start !== node.range.start || edit.range.end !== node.range.start)) {
      throw new Error("前插 offset 与节点起点不一致");
    }
    if (input.kind === "insert-after" && (edit.range.start !== node.range.end || edit.range.end !== node.range.end)) {
      throw new Error("后插 offset 与节点终点不一致");
    }
    if (input.kind === "insert-child" && (!insideNode || edit.range.start !== edit.range.end)) {
      throw new Error("子节点插入点必须位于目标节点内部");
    }
    if (input.kind === "move-up" || input.kind === "move-down") {
      const parent = node.parentId ? input.document.nodeIndex[node.parentId] : undefined;
      if (!parent || edit.range.start < parent.range.start || edit.range.end > parent.range.end) {
        throw new Error("移动范围超出父节点，已原子拒绝");
      }
    }
  });

  for (let index = 0; index < edits.length; index += 1) {
    const edit = edits[index];
    const next = edits[index + 1];
    if (next && next.range.end > edit.range.start) throw new Error("source edits 发生重叠，已原子拒绝");
  }

  let nextSource = input.document.source;
  edits.forEach((edit) => {
    nextSource = `${nextSource.slice(0, edit.range.start)}${edit.replacement}${nextSource.slice(edit.range.end)}`;
  });
  const changedStart = Math.min(...edits.map((edit) => edit.range.start));
  const changedEnd = Math.max(...edits.map((edit) => edit.range.end));
  const replacementLength = edits.reduce((sum, edit) => sum + edit.replacement.length, 0);
  return {
    kind: input.kind,
    nodeId: node.id,
    previousSource: input.document.source,
    source: nextSource,
    changedRange: { start: changedStart, end: changedEnd },
    replacementRange: { start: changedStart, end: changedStart + replacementLength },
  };
}

function genericFidelityReport(document: LosslessSkillDocument): FidelityReport {
  const targetNodes = document.nodes.filter((node) => node.coverageRole !== "container");
  const bindings: FidelityBinding[] = targetNodes.map((node) => ({
    semanticId: `generic.${node.id}`,
    category: node.domain,
    label: nodeTitle(node),
    expectedKind: node.kind,
    state: node.editable ? "mapped" : "uneditable",
    nodeId: node.id,
    range: { ...node.range },
    editable: node.editable,
  }));
  const categories = ["yaml", "markdown", "trivia"];
  const groups = categories.map((category) => {
    const items = bindings.filter((binding) => binding.category === category);
    return {
      id: category,
      label: category === "yaml" ? "YAML 节点" : category === "markdown" ? "Markdown 节点" : "Trivia / Unknown",
      expected: items.length,
      mapped: items.filter((item) => item.state === "mapped").length,
      unmapped: 0,
      uneditable: items.filter((item) => item.state === "uneditable").length,
    };
  }).filter((group) => group.expected > 0);
  const mapped = bindings.filter((binding) => binding.state === "mapped").length;
  const uneditable = bindings.length - mapped;
  return {
    profileId: "generic-lossless",
    profileName: "通用 Lossless Skill",
    sourceMatched: true,
    sourceHash: document.sourceHash,
    expected: bindings.length,
    mapped,
    unmapped: 0,
    uneditable,
    editable: mapped,
    coveragePercent: bindings.length ? Number(((mapped / bindings.length) * 100).toFixed(2)) : 100,
    bindings,
    groups,
    diagnostics: document.diagnostics.map((item) => `${item.code}: ${item.message}`),
  };
}

function flattenVisibleTree(
  document: LosslessSkillDocument,
  expanded: Set<string>,
  search: string,
  bindingsByNodeId: Map<string, FidelityBinding[]>,
): VisibleTreeRow[] {
  const query = search.trim().toLocaleLowerCase();
  const included = new Set<string>();
  if (query) {
    document.nodes.forEach((node) => {
      const mapping = bindingsByNodeId.get(node.id)?.map((item) => `${item.semanticId} ${item.label}`).join(" ") ?? "";
      const haystack = `${node.id} ${node.domain} ${node.kind} ${node.path.join(" ")} ${node.raw} ${mapping}`.toLocaleLowerCase();
      if (!haystack.includes(query)) return;
      let current: LosslessNode | undefined = node;
      while (current) {
        included.add(current.id);
        current = current.parentId ? document.nodeIndex[current.parentId] : undefined;
      }
    });
  }

  const rows: VisibleTreeRow[] = [];
  const visit = (node: LosslessNode, depth: number) => {
    if (query && !included.has(node.id)) return;
    rows.push({ node, depth });
    if (!query && !expanded.has(node.id)) return;
    sortedChildren(document, node).forEach((child) => visit(child, depth + 1));
  };
  visit(document.root, 0);
  return rows;
}

function defaultExpandedNodes(document: LosslessSkillDocument): Set<string> {
  const expanded = new Set<string>([document.rootId, document.markdownRootId]);
  if (document.frontmatterRootId) expanded.add(document.frontmatterRootId);
  document.nodes.forEach((node) => {
    if (!node.children.length) return;
    if (node.domain === "yaml" || node.kind === "heading" || node.kind === "list") expanded.add(node.id);
  });
  return expanded;
}

function sortedChildren(document: LosslessSkillDocument, node: LosslessNode): LosslessNode[] {
  return node.children
    .map((id) => document.nodeIndex[id])
    .filter((child): child is LosslessNode => Boolean(child))
    .sort((left, right) => left.range.start - right.range.start || right.range.end - left.range.end);
}

function siblingNodes(document: LosslessSkillDocument, node: LosslessNode): LosslessNode[] {
  const parent = node.parentId ? document.nodeIndex[node.parentId] : undefined;
  if (!parent || parent.domain === "document" || node.domain === "trivia") return [];
  return sortedChildren(document, parent).filter((candidate) =>
    candidate.domain !== "trivia"
    && (candidate.id === node.id
      || candidate.range.end <= node.range.start
      || candidate.range.start >= node.range.end));
}

function canMove(document: LosslessSkillDocument, node: LosslessNode, direction: -1 | 1): boolean {
  const siblings = siblingNodes(document, node);
  const index = siblings.findIndex((item) => item.id === node.id);
  return index >= 0 && Boolean(siblings[index + direction]);
}

function insertOffset(document: LosslessSkillDocument, node: LosslessNode, mode: InsertMode): number {
  if (mode === "insert-before") return node.range.start;
  if (mode === "insert-after") return node.range.end;
  const children = sortedChildren(document, node);
  if (children.length) return children.at(-1)!.range.end;
  return node.contentRange?.end ?? node.range.end;
}

function defaultInsertionRaw(document: LosslessSkillDocument, node: LosslessNode): string {
  const newline = document.newline || "\n";
  if (node.kind === "listItem") return `- 新条目${newline}`;
  if (node.kind === "heading") return `段落内容${newline}${newline}`;
  if (node.domain === "yaml") return `key: value${newline}`;
  return newline;
}

function nodeTitle(node: LosslessNode): string {
  const attributes = node.attributes;
  const preferred = [attributes.text, attributes.key, attributes.label, attributes.value, attributes.identifier]
    .find((value) => typeof value === "string" || typeof value === "number" || typeof value === "boolean");
  if (preferred !== undefined) {
    const text = String(preferred).replace(/\s+/g, " ").trim();
    if (text) return `${node.kind} · ${truncate(text, 58)}`;
  }
  const raw = node.raw.replace(/\s+/g, " ").trim();
  return raw ? `${node.kind} · ${truncate(raw, 58)}` : node.kind;
}

function nodeGlyph(node: LosslessNode): string {
  if (node.domain === "yaml") return "Y";
  if (node.domain === "trivia") return "·";
  if (node.kind === "heading") return `H${String(node.attributes.depth ?? "")}`;
  if (node.kind === "listItem") return "LI";
  if (node.kind === "inlineCode" || node.kind === "code") return "<>";
  if (node.kind === "paragraph") return "P";
  if (node.kind === "link") return "L";
  return node.kind.slice(0, 2);
}

function fieldLabel(name: string): string {
  return ({
    source: "完整范围",
    raw: "原始内容",
    key: "YAML Key",
    value: "值",
    text: "文本",
    label: "显示文本",
    url: "URL",
    checkbox: "任务复选框",
    info: "代码语言 / Meta",
    opening: "Frontmatter 开始标记",
    closing: "Frontmatter 结束标记",
  } as Record<string, string>)[name] ?? name;
}

function formatAttribute(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";
  return JSON.stringify(value);
}

function formatRange(range: SourceRange): string {
  return `${range.start}:${range.end}`;
}

function normalizeRange(range: SourceRange, sourceLength: number): SourceRange {
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) throw new Error("source range 必须是整数");
  if (range.start < 0 || range.end < range.start || range.end > sourceLength) {
    throw new Error(`source range 越界：${formatRange(range)} / ${sourceLength}`);
  }
  return { start: range.start, end: range.end };
}

function rangesOverlap(range: SourceRange | undefined, target: SourceRange): boolean {
  if (!range) return false;
  return range.start < target.end && target.start < range.end;
}

function rangePreview(source: string, range: SourceRange, radius: number) {
  const start = Math.max(0, range.start - radius);
  const end = Math.min(source.length, range.end + radius);
  return {
    before: `${start > 0 ? "…" : ""}${source.slice(start, range.start)}`,
    selected: source.slice(range.start, range.end),
    after: `${source.slice(range.end, end)}${end < source.length ? "…" : ""}`,
  };
}

function lineAndColumn(source: string, offset: number) {
  let line = 1;
  let column = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\n") {
      line += 1;
      column = 1;
    } else if (source[index] === "\r" && source[index + 1] !== "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function toggleExpanded(id: string, setter: (value: Set<string> | ((current: Set<string>) => Set<string>)) => void) {
  setter((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, Math.max(1, length - 1))}…`;
}

function newlineLabel(value: string): string {
  return value === "\r\n" ? "CRLF" : value === "\r" ? "CR" : value === "\n" ? "LF" : "no newline";
}

function insertModeLabel(mode: InsertMode): string {
  return mode === "insert-before" ? "在节点之前插入" : mode === "insert-after" ? "在节点之后插入" : "插入子节点";
}

function editKindLabel(kind: IsomorphicNodeEditKind): string {
  return ({
    "set-field": "字段修改",
    "replace-node": "原始节点替换",
    "insert-before": "前置插入",
    "insert-after": "后置插入",
    "insert-child": "子节点插入",
    "delete-node": "节点删除",
    "move-up": "节点上移",
    "move-down": "节点下移",
    undo: "撤销",
  } as Record<IsomorphicNodeEditKind, string>)[kind];
}
