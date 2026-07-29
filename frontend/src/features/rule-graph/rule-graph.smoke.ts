import { buildRuleGraphLayout, type RuleGraphInput } from "./model.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const input: RuleGraphInput = {
  skillName: "graph-smoke",
  topRules: [{
    id: "top-1",
    name: "Always verify",
    category: "quality",
    ruleType: "规则",
    content: "Verify before completion.",
  }],
  localRules: [
    {
      id: "conditional",
      index: 0,
      name: "Conditional rule",
      category: "routing",
      editorType: "rule",
      triggers: [{ id: "trigger-1", label: "Run verification" }],
      triggerRoutes: [{ id: "condition-route-1", triggerId: "trigger-1", matchMode: "all" }],
      limits: [{
        id: "limit-1",
        label: "Code changed",
        triggerId: "trigger-1",
        routeId: "condition-route-1",
      }],
      triggerConditions: [],
      limitConditions: [],
      routes: [],
    },
    {
      id: "route",
      index: 1,
      name: "Route rule",
      category: "platform",
      editorType: "route",
      triggers: [],
      triggerRoutes: [],
      limits: [],
      triggerConditions: [{ id: "condition-1", label: "UI work" }],
      limitConditions: [{ id: "condition-2", label: "Windows" }],
      routes: [{
        id: "route-1",
        label: "Desktop",
        matchMode: "all",
        conditions: [{ id: "branch-1", label: "if Windows" }],
        resultKind: "flow",
        result: "analyze → implement → verify",
        steps: ["analyze", "implement", "verify"],
      }, {
        id: "route-2",
        label: "Mobile",
        matchMode: "all",
        conditions: [{ id: "branch-2", label: "if Android" }],
        resultKind: "flow",
        result: "analyze → implement → device test",
        steps: ["analyze", "implement", "device test"],
      }],
    },
  ],
};

const layout = buildRuleGraphLayout(input);
const kinds = new Set(layout.nodes.map((node) => node.kind));
assert(kinds.has("skill"), "skill root missing");
assert(kinds.has("top-rule"), "top rule missing");
assert(kinds.has("local-rule"), "local rule missing");
assert(kinds.has("condition-route"), "condition route missing");
assert(kinds.has("trigger"), "structured trigger missing");
assert(kinds.has("limit"), "limit condition missing");
assert(kinds.has("step"), "flow step missing");
assert(kinds.has("branch-condition"), "branch condition missing");
assert(layout.edges.some((edge) => edge.label === "同时"), "match-mode relationship missing");
assert(layout.edges.some((edge) => edge.label === "判断"), "branch relationship missing");
const stepTitles = layout.nodes.filter((node) => node.kind === "step").map((node) => node.title);
assert(stepTitles.filter((title) => title === "analyze").length === 1, "shared first step was duplicated");
assert(stepTitles.filter((title) => title === "implement").length === 1, "shared route prefix was duplicated");
assert(stepTitles.includes("verify") && stepTitles.includes("device test"), "branch destinations missing");
assert(layout.nodes.every((node) => node.x >= 0 && node.y >= 0), "node escaped graph bounds");
assert(layout.width > 1000 && layout.height >= 520, "graph bounds are unexpectedly small");

const empty = buildRuleGraphLayout({ skillName: "", topRules: [], localRules: [] });
assert(empty.nodes.some((node) => node.kind === "empty"), "empty state node missing");

console.log(`rule-graph smoke passed: ${layout.nodes.length} nodes, ${layout.edges.length} edges`);
