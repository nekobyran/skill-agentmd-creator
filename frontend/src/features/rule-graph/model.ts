export type RuleGraphNodeKind =
  | "skill"
  | "top-rule"
  | "local-rule"
  | "trigger"
  | "limit"
  | "condition-route"
  | "branch-condition"
  | "route"
  | "step"
  | "result"
  | "empty";

export interface RuleGraphTopRuleInput {
  id: string;
  name: string;
  category: string;
  ruleType: string;
  content: string;
}

export interface RuleGraphConditionInput {
  id: string;
  label: string;
}

export interface RuleGraphTriggerRouteInput {
  id: string;
  triggerId: string;
  matchMode: "all" | "any";
}

export interface RuleGraphLimitInput extends RuleGraphConditionInput {
  triggerId: string;
  routeId: string;
}

export interface RuleGraphRouteInput {
  id: string;
  label: string;
  matchMode: "all" | "any";
  conditions: RuleGraphConditionInput[];
  resultKind: "requirement" | "flow";
  result: string;
  steps: string[];
}

export interface RuleGraphLocalRuleInput {
  id: string;
  index: number;
  name: string;
  category: string;
  editorType: "rule" | "route";
  triggers: RuleGraphConditionInput[];
  triggerRoutes: RuleGraphTriggerRouteInput[];
  limits: RuleGraphLimitInput[];
  triggerConditions: RuleGraphConditionInput[];
  limitConditions: RuleGraphConditionInput[];
  routes: RuleGraphRouteInput[];
}

export interface RuleGraphInput {
  skillName: string;
  topRules: RuleGraphTopRuleInput[];
  localRules: RuleGraphLocalRuleInput[];
}

export interface RuleGraphNode {
  id: string;
  kind: RuleGraphNodeKind;
  title: string;
  detail: string;
  eyebrow: string;
  x: number;
  y: number;
  width: number;
  height: number;
  localRuleIndex?: number;
}

export interface RuleGraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  tone: "structure" | "trigger" | "limit" | "route" | "result";
}

export interface RuleGraphLayout {
  nodes: RuleGraphNode[];
  edges: RuleGraphEdge[];
  width: number;
  height: number;
}

const NODE_WIDTH = 208;
const NODE_HEIGHT = 72;
const ROW_GAP = 22;
const GROUP_GAP = 46;
const PADDING = 40;

export function buildRuleGraphLayout(input: RuleGraphInput): RuleGraphLayout {
  const nodes: RuleGraphNode[] = [];
  const edges: RuleGraphEdge[] = [];
  let cursorY = PADDING;
  let edgeSequence = 0;

  const addNode = (
    value: Omit<RuleGraphNode, "width" | "height"> & Partial<Pick<RuleGraphNode, "width" | "height">>,
  ) => {
    const node: RuleGraphNode = {
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      ...value,
    };
    nodes.push(node);
    return node;
  };

  const addEdge = (
    source: string,
    target: string,
    label: string,
    tone: RuleGraphEdge["tone"],
  ) => {
    edgeSequence += 1;
    edges.push({
      id: `edge-${edgeSequence}-${source}-${target}`,
      source,
      target,
      label,
      tone,
    });
  };

  const root = addNode({
    id: "skill-root",
    kind: "skill",
    title: display(input.skillName, "未命名 Skill"),
    detail: `${input.topRules.length} 条顶部规则 · ${input.localRules.length} 条局部规则`,
    eyebrow: "SKILL",
    x: PADDING,
    y: PADDING,
    width: 220,
  });
  const firstLayerNodes: RuleGraphNode[] = [];

  for (const [index, rule] of input.topRules.entries()) {
    const node = addNode({
      id: `top-${rule.id || index}`,
      kind: "top-rule",
      title: display(rule.name, `顶部规则 ${index + 1}`),
      detail: display(rule.content, "尚未填写规则内容"),
      eyebrow: [rule.ruleType || "规则", rule.category].filter(Boolean).join(" · "),
      x: 300,
      y: cursorY,
    });
    firstLayerNodes.push(node);
    addEdge(root.id, node.id, "顶部规则", "structure");
    cursorY += NODE_HEIGHT + ROW_GAP;
  }

  if (input.topRules.length > 0 && input.localRules.length > 0) {
    cursorY += GROUP_GAP;
  }

  for (const [ruleOrder, rule] of input.localRules.entries()) {
    const clusterStart = cursorY;
    const ruleNode = addNode({
      id: `local-${rule.id || ruleOrder}`,
      kind: "local-rule",
      title: display(rule.name, `局部规则 ${ruleOrder + 1}`),
      detail: display(rule.category, rule.editorType === "rule" ? "条件规则" : "路线规则"),
      eyebrow: rule.editorType === "rule" ? "条件规则" : "路线规则",
      x: 300,
      y: clusterStart,
      localRuleIndex: rule.index,
    });
    firstLayerNodes.push(ruleNode);
    addEdge(root.id, ruleNode.id, "局部规则", "structure");

    if (rule.editorType === "rule") {
      cursorY = layoutConditionalRule(rule, ruleNode, cursorY, addNode, addEdge);
    } else {
      cursorY = layoutRouteRule(rule, ruleNode, cursorY, addNode, addEdge);
    }

    const clusterEnd = Math.max(cursorY, clusterStart + NODE_HEIGHT);
    ruleNode.y = clusterStart + (clusterEnd - clusterStart - ruleNode.height) / 2;
    cursorY = clusterEnd + GROUP_GAP;
  }

  if (input.topRules.length === 0 && input.localRules.length === 0) {
    const empty = addNode({
      id: "empty-rules",
      kind: "empty",
      title: "暂无规则关系",
      detail: "添加顶部规则或局部规则后，这里会自动生成连接图。",
      eyebrow: "EMPTY",
      x: 300,
      y: PADDING,
      width: 260,
    });
    firstLayerNodes.push(empty);
    addEdge(root.id, empty.id, "尚未添加", "structure");
    cursorY = PADDING + NODE_HEIGHT;
  }

  if (firstLayerNodes.length > 0) {
    root.y = average(firstLayerNodes.map((node) => node.y + node.height / 2)) - root.height / 2;
  }

  const maxRight = Math.max(...nodes.map((node) => node.x + node.width), 960);
  const maxBottom = Math.max(...nodes.map((node) => node.y + node.height), 520);
  return {
    nodes,
    edges,
    width: maxRight + PADDING,
    height: maxBottom + PADDING,
  };
}

type AddNode = (
  value: Omit<RuleGraphNode, "width" | "height"> & Partial<Pick<RuleGraphNode, "width" | "height">>,
) => RuleGraphNode;
type AddEdge = (
  source: string,
  target: string,
  label: string,
  tone: RuleGraphEdge["tone"],
) => void;

function layoutConditionalRule(
  rule: RuleGraphLocalRuleInput,
  ruleNode: RuleGraphNode,
  startY: number,
  addNode: AddNode,
  addEdge: AddEdge,
) {
  let cursorY = startY;
  const routes = rule.triggerRoutes.length > 0
    ? rule.triggerRoutes
    : rule.triggers.map((trigger, index) => ({
        id: `fallback-route-${index}`,
        triggerId: trigger.id,
        matchMode: "all" as const,
      }));
  const triggerRouteCenters = new Map<string, number[]>();

  for (const [routeIndex, route] of routes.entries()) {
    const routeLimits = rule.limits.filter((limit) => limit.routeId === route.id);
    const routeStart = cursorY;
    const limitNodes: RuleGraphNode[] = [];
    const visibleLimits = routeLimits.length > 0
      ? routeLimits
      : [{
          id: `empty-limit-${routeIndex}`,
          label: "尚未填写限制条件",
          triggerId: route.triggerId,
          routeId: route.id,
        }];

    for (const [limitIndex, limit] of visibleLimits.entries()) {
      const limitNode = addNode({
        id: `limit-${rule.id}-${limit.id || limitIndex}`,
        kind: "limit",
        title: display(limit.label, `限制条件 ${limitIndex + 1}`),
        detail: "满足此条件后进入关联路线",
        eyebrow: "限制条件",
        x: 540,
        y: cursorY,
        localRuleIndex: rule.index,
      });
      limitNodes.push(limitNode);
      addEdge(ruleNode.id, limitNode.id, "限制", "limit");
      cursorY += NODE_HEIGHT + ROW_GAP;
    }

    const routeY = average(limitNodes.map((node) => node.y + node.height / 2)) - NODE_HEIGHT / 2;
    const routeNode = addNode({
      id: `condition-route-${rule.id}-${route.id || routeIndex}`,
      kind: "condition-route",
      title: `条件路线 ${routeIndex + 1}`,
      detail: route.matchMode === "any" ? "任一限制条件满足" : "所有限制条件同时满足",
      eyebrow: route.matchMode === "any" ? "ANY · 任意" : "ALL · 同时",
      x: 800,
      y: routeY,
      localRuleIndex: rule.index,
    });
    for (const limitNode of limitNodes) {
      addEdge(limitNode.id, routeNode.id, route.matchMode === "any" ? "任意" : "同时", "route");
    }

    const centers = triggerRouteCenters.get(route.triggerId) ?? [];
    centers.push(routeNode.y + routeNode.height / 2);
    triggerRouteCenters.set(route.triggerId, centers);
    cursorY = Math.max(cursorY, routeStart + NODE_HEIGHT + ROW_GAP);
  }

  const triggerNodes = new Map<string, RuleGraphNode>();
  for (const [triggerIndex, trigger] of rule.triggers.entries()) {
    const centers = triggerRouteCenters.get(trigger.id) ?? [startY + triggerIndex * (NODE_HEIGHT + ROW_GAP)];
    const node = addNode({
      id: `trigger-${rule.id}-${trigger.id || triggerIndex}`,
      kind: "trigger",
      title: display(trigger.label, `触发 ${triggerIndex + 1}`),
      detail: "限制条件成立时执行此触发",
      eyebrow: "触发结果",
      x: 1060,
      y: average(centers) - NODE_HEIGHT / 2,
      localRuleIndex: rule.index,
    });
    triggerNodes.set(trigger.id, node);
  }

  for (const [routeIndex, route] of routes.entries()) {
    const source = `condition-route-${rule.id}-${route.id || routeIndex}`;
    const triggerNode = triggerNodes.get(route.triggerId);
    if (triggerNode) addEdge(source, triggerNode.id, "则", "trigger");
  }

  return Math.max(cursorY, ...[...triggerNodes.values()].map((node) => node.y + node.height));
}

function layoutRouteRule(
  rule: RuleGraphLocalRuleInput,
  ruleNode: RuleGraphNode,
  startY: number,
  addNode: AddNode,
  addEdge: AddEdge,
) {
  let cursorY = startY;
  const conditions = [
    ...rule.triggerConditions.map((condition) => ({ ...condition, kind: "trigger" as const })),
    ...rule.limitConditions.map((condition) => ({ ...condition, kind: "limit" as const })),
  ].filter((condition) => condition.label.trim());
  const conditionNodes: RuleGraphNode[] = [];

  for (const [conditionIndex, condition] of conditions.entries()) {
    const node = addNode({
      id: `${condition.kind}-${rule.id}-${condition.id || conditionIndex}`,
      kind: condition.kind,
      title: display(condition.label, `${condition.kind === "trigger" ? "触发" : "限制"}条件 ${conditionIndex + 1}`),
      detail: condition.kind === "trigger" ? "决定规则何时进入路线" : "收窄路线适用范围",
      eyebrow: condition.kind === "trigger" ? "触发条件" : "限制条件",
      x: 540,
      y: cursorY,
      localRuleIndex: rule.index,
    });
    conditionNodes.push(node);
    addEdge(ruleNode.id, node.id, condition.kind === "trigger" ? "触发" : "限制", condition.kind);
    cursorY += NODE_HEIGHT + ROW_GAP;
  }

  const routeInputs = rule.routes.length > 0
    ? rule.routes
    : [{
        id: "empty-route",
        label: "",
        matchMode: "all" as const,
        conditions: [],
        resultKind: "requirement" as const,
        result: "",
        steps: [],
      }];
  const hub = conditionNodes.length > 0
    ? addNode({
        id: `condition-hub-${rule.id}`,
        kind: "condition-route",
        title: "条件汇合",
        detail: "触发条件与限制条件共同决定后续路线",
        eyebrow: "CONDITIONS",
        x: 790,
        y: average(conditionNodes.map((node) => node.y + node.height / 2)) - NODE_HEIGHT / 2,
        localRuleIndex: rule.index,
      })
    : null;

  for (const conditionNode of conditionNodes) {
    if (hub) addEdge(conditionNode.id, hub.id, "汇合", "route");
  }

  const routeStart = Math.max(startY, cursorY);
  const sourceNode = hub ?? ruleNode;
  const routeRows = new Map<string, number>();
  routeInputs.forEach((route, routeIndex) => {
    routeRows.set(route.id || String(routeIndex), routeStart + routeIndex * (NODE_HEIGHT + ROW_GAP));
  });

  const flowRoutes = routeInputs.filter((route) => route.resultKind === "flow" && route.steps.length);
  const prefixRoutes = new Map<string, Set<string>>();
  for (const [routeIndex, route] of flowRoutes.entries()) {
    const routeKey = route.id || String(routeIndex);
    route.steps.map((step) => step.trim()).filter(Boolean).forEach((_, stepIndex, steps) => {
      const prefix = flowPrefixKey(steps.slice(0, stepIndex + 1));
      const owners = prefixRoutes.get(prefix) ?? new Set<string>();
      owners.add(routeKey);
      prefixRoutes.set(prefix, owners);
    });
  }

  const stepNodes = new Map<string, RuleGraphNode>();
  for (const [prefix, owners] of prefixRoutes) {
    const parts = prefix.split("\u001f");
    const ownerRows = [...owners].map((owner) => routeRows.get(owner) ?? routeStart);
    stepNodes.set(prefix, addNode({
      id: `step-${rule.id}-${stableTextId(prefix)}`,
      kind: "step",
      title: parts.at(-1) || "未命名步骤",
      detail: `流程步骤 ${parts.length}`,
      eyebrow: `STEP ${parts.length}`,
      x: 1300 + (parts.length - 1) * 470,
      y: average(ownerRows),
      localRuleIndex: rule.index,
    }));
  }

  const addedTransitions = new Set<string>();
  for (const [routeIndex, route] of flowRoutes.entries()) {
    const routeKey = route.id || String(routeIndex);
    const steps = route.steps.map((step) => step.trim()).filter(Boolean);
    let previousNode = sourceNode;
    let parentOwners = flowRoutes.length;
    for (let stepIndex = 0; stepIndex < steps.length; stepIndex += 1) {
      const prefix = flowPrefixKey(steps.slice(0, stepIndex + 1));
      const stepNode = stepNodes.get(prefix)!;
      const childOwners = prefixRoutes.get(prefix)?.size ?? 1;
      const isBranch = childOwners < parentOwners;
      const routeConditionText = branchConditionText(route);
      const transitionKey = `${previousNode.id}->${stepNode.id}`;
      if (isBranch && (routeConditionText || route.label.trim())) {
        const branchNode = addNode({
          id: `branch-${rule.id}-${routeKey}-${stepIndex}`,
          kind: "branch-condition",
          title: routeConditionText || display(route.label, `路线 ${routeIndex + 1}`),
          detail: route.label.trim()
            ? `进入“${route.label.trim()}”路线`
            : `进入路线 ${routeIndex + 1}`,
          eyebrow: route.matchMode === "any" ? "IF ANY" : "IF ALL",
          x: stepNode.x - 230,
          y: routeRows.get(routeKey) ?? routeStart,
          localRuleIndex: rule.index,
        });
        addEdge(previousNode.id, branchNode.id, "判断", "limit");
        addEdge(branchNode.id, stepNode.id, route.label.trim() || "通过", "route");
      } else if (!addedTransitions.has(transitionKey)) {
        addEdge(
          previousNode.id,
          stepNode.id,
          stepIndex === 0 ? display(route.label, "进入流程") : "下一步",
          stepIndex === 0 ? "route" : "result",
        );
        addedTransitions.add(transitionKey);
      }
      previousNode = stepNode;
      parentOwners = childOwners;
    }
  }

  const nonFlowNodes: RuleGraphNode[] = [];
  routeInputs.forEach((route, routeIndex) => {
    if (route.resultKind === "flow" && route.steps.length) return;
    const routeKey = route.id || String(routeIndex);
    const rowY = routeRows.get(routeKey) ?? routeStart;
    const branchText = branchConditionText(route);
    const branchNode = branchText
      ? addNode({
          id: `branch-${rule.id}-${routeKey}`,
          kind: "branch-condition",
          title: branchText,
          detail: route.label.trim() ? `进入“${route.label.trim()}”路线` : "决定是否进入该路线",
          eyebrow: route.matchMode === "any" ? "IF ANY" : "IF ALL",
          x: 1040,
          y: rowY,
          localRuleIndex: rule.index,
        })
      : null;
    const routeNode = addNode({
      id: `route-${rule.id}-${routeKey}`,
      kind: "route",
      title: display(route.label, `默认路线 ${routeIndex + 1}`),
      detail: route.label.trim() ? "命名路线" : "未命名的默认路线",
      eyebrow: "路线",
      x: branchNode ? 1290 : 1040,
      y: rowY,
      localRuleIndex: rule.index,
    });
    const resultNode = addNode({
      id: `result-${rule.id}-${routeKey}`,
      kind: "result",
      title: "要求结果",
      detail: display(route.result, "尚未填写触发结果"),
      eyebrow: "REQUIREMENT",
      x: branchNode ? 1540 : 1290,
      y: rowY,
      localRuleIndex: rule.index,
    });
    nonFlowNodes.push(...[branchNode, routeNode, resultNode].filter((node): node is RuleGraphNode => Boolean(node)));
    addEdge(sourceNode.id, (branchNode ?? routeNode).id, branchNode ? "判断" : "进入", branchNode ? "limit" : "route");
    if (branchNode) addEdge(branchNode.id, routeNode.id, "通过", "route");
    addEdge(routeNode.id, resultNode.id, "那么", "result");
  });

  const contentNodes = [
    ...conditionNodes,
    ...stepNodes.values(),
    ...nonFlowNodes,
  ];
  return Math.max(
    routeStart + routeInputs.length * (NODE_HEIGHT + ROW_GAP),
    ...contentNodes.map((node) => node.y + node.height),
  );
}

function branchConditionText(route: RuleGraphRouteInput) {
  const conditions = route.conditions.map((condition) => condition.label.trim()).filter(Boolean);
  if (!conditions.length) return "";
  return conditions.join(route.matchMode === "any" ? " 或 " : " 且 ");
}

function flowPrefixKey(steps: string[]) {
  return steps.join("\u001f");
}

function stableTextId(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function display(value: string, fallback: string) {
  return value.trim() || fallback;
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}
