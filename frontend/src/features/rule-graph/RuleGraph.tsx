import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildRuleGraphLayout,
  type RuleGraphEdge,
  type RuleGraphInput,
  type RuleGraphNode,
} from "./model";
import "./RuleGraph.css";

export interface RuleGraphProps {
  data: RuleGraphInput;
  selectedLocalRuleIndex: number;
  onSelectLocalRule: (index: number) => void;
}

const MIN_ZOOM = 0.55;
const MAX_ZOOM = 1.4;
const ZOOM_STEP = 0.15;

export function RuleGraph({ data, selectedLocalRuleIndex, onSelectLocalRule }: RuleGraphProps) {
  const layout = useMemo(() => buildRuleGraphLayout(data), [data]);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [selectedNodeId, setSelectedNodeId] = useState<string>("");
  const nodeById = useMemo(
    () => new Map(layout.nodes.map((node) => [node.id, node])),
    [layout.nodes],
  );
  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) : undefined;
  const connectedEdgeIds = useMemo(
    () => new Set(
      layout.edges
        .filter((edge) => edge.source === selectedNode?.id || edge.target === selectedNode?.id)
        .map((edge) => edge.id),
    ),
    [layout.edges, selectedNode?.id],
  );
  const connectedNodeIds = useMemo(() => {
    const result = new Set<string>(selectedNode ? [selectedNode.id] : []);
    for (const edge of layout.edges) {
      if (!connectedEdgeIds.has(edge.id)) continue;
      result.add(edge.source);
      result.add(edge.target);
    }
    return result;
  }, [connectedEdgeIds, layout.edges, selectedNode]);

  function fitGraph() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const availableWidth = Math.max(320, viewport.clientWidth - 32);
    setZoom(clamp(availableWidth / layout.width, MIN_ZOOM, 1));
    viewport.scrollTo({ left: 0, top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }

  useEffect(() => {
    fitGraph();
  }, [layout.width]);

  function selectNode(node: RuleGraphNode) {
    setSelectedNodeId(node.id);
    if (node.kind === "local-rule" && node.localRuleIndex !== undefined) {
      onSelectLocalRule(node.localRuleIndex);
    }
  }

  const scale = Number(zoom.toFixed(2));
  return (
    <section className="rule-graph" aria-label="规则关系图">
      <header className="rule-graph__toolbar">
        <div className="rule-graph__summary">
          <span>关系图</span>
          <strong>{data.skillName || "未命名 Skill"}</strong>
          <small>{layout.nodes.length} 个节点 · {layout.edges.length} 条关系</small>
        </div>
        <div className="rule-graph__controls" aria-label="关系图缩放">
          <button
            type="button"
            aria-label="缩小关系图"
            disabled={scale <= MIN_ZOOM}
            onClick={() => setZoom((value) => clamp(value - ZOOM_STEP, MIN_ZOOM, MAX_ZOOM))}
          >
            <MinusIcon />
          </button>
          <output aria-live="polite">{Math.round(scale * 100)}%</output>
          <button
            type="button"
            aria-label="放大关系图"
            disabled={scale >= MAX_ZOOM}
            onClick={() => setZoom((value) => clamp(value + ZOOM_STEP, MIN_ZOOM, MAX_ZOOM))}
          >
            <PlusIcon />
          </button>
          <button className="rule-graph__fit" type="button" onClick={fitGraph}>
            适应宽度
          </button>
        </div>
      </header>

      <div className="rule-graph__body">
        <div className="rule-graph__viewport" ref={viewportRef} tabIndex={0}>
          <div
            className="rule-graph__stage"
            style={{ width: layout.width * scale, height: layout.height * scale }}
          >
            <div
              className="rule-graph__canvas"
              style={{
                width: layout.width,
                height: layout.height,
                transform: `scale(${scale})`,
              }}
            >
              <svg
                className="rule-graph__edges"
                width={layout.width}
                height={layout.height}
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                aria-hidden="true"
              >
                <defs>
                  <marker id="rule-graph-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                    <path d="M0,0 L8,4 L0,8 Z" />
                  </marker>
                </defs>
                {layout.edges.map((edge) => (
                  <GraphEdge
                    edge={edge}
                    key={edge.id}
                    source={nodeById.get(edge.source)}
                    target={nodeById.get(edge.target)}
                    isDimmed={Boolean(selectedNode) && !connectedEdgeIds.has(edge.id)}
                    isHighlighted={connectedEdgeIds.has(edge.id)}
                  />
                ))}
              </svg>

              {layout.nodes.map((node) => {
                const isSelected = node.id === selectedNode?.id;
                const isEditorActive =
                  node.kind === "local-rule" && node.localRuleIndex === selectedLocalRuleIndex;
                const isDimmed = Boolean(selectedNode) && !connectedNodeIds.has(node.id);
                return (
                  <button
                    className={`rule-graph-node${isSelected ? " is-selected" : ""}${isEditorActive ? " is-editor-active" : ""}${isDimmed ? " is-dimmed" : ""}`}
                    data-kind={node.kind}
                    key={node.id}
                    style={{ left: node.x, top: node.y, width: node.width, minHeight: node.height }}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => selectNode(node)}
                  >
                    <span>{node.eyebrow}</span>
                    <strong>{node.title}</strong>
                    <small>{node.detail}</small>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="rule-graph__inspector" aria-live="polite">
          <span>{selectedNode?.eyebrow ?? "节点"}</span>
          <strong>{selectedNode?.title ?? "选择一个节点"}</strong>
          <p>{selectedNode?.detail ?? "点击图中的节点查看它的直接关系。"}</p>
          {selectedNode?.kind === "local-rule" ? (
            <small>已同步定位到右侧规则编辑器</small>
          ) : (
            <small>高亮显示当前节点的一跳关系</small>
          )}
          <div className="rule-graph__legend" aria-label="节点图例">
            <i data-kind="top-rule" />顶部规则
            <i data-kind="trigger" />触发
            <i data-kind="limit" />限制
            <i data-kind="branch-condition" />判断
            <i data-kind="step" />步骤
            <i data-kind="result" />结果
          </div>
        </aside>
      </div>
    </section>
  );
}

function GraphEdge({
  edge,
  source,
  target,
  isDimmed,
  isHighlighted,
}: {
  edge: RuleGraphEdge;
  source?: RuleGraphNode;
  target?: RuleGraphNode;
  isDimmed: boolean;
  isHighlighted: boolean;
}) {
  if (!source || !target) return null;
  const startX = source.x + source.width;
  const startY = source.y + source.height / 2;
  const endX = target.x;
  const endY = target.y + target.height / 2;
  const curve = Math.max(46, (endX - startX) * 0.45);
  const path = `M ${startX} ${startY} C ${startX + curve} ${startY}, ${endX - curve} ${endY}, ${endX} ${endY}`;
  const labelX = startX + (endX - startX) / 2;
  const labelY = startY + (endY - startY) / 2 - 7;
  return (
    <g
      className={`rule-graph-edge is-${edge.tone}${isDimmed ? " is-dimmed" : ""}${isHighlighted ? " is-highlighted" : ""}`}
    >
      <path d={path} markerEnd="url(#rule-graph-arrow)" />
      <text x={labelX} y={labelY} textAnchor="middle">{edge.label}</text>
    </g>
  );
}

function PlusIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
}

function MinusIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
