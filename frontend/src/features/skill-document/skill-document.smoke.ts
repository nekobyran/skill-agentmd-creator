import {
  ManagedBlockError,
  createFlutterDesignPreset,
  frontmatterStringValue,
  readManagedContract,
  readManagedWorkflow,
  serializeSkillDocument,
  parseSkillDocument,
  writeManagedContract,
  writeManagedWorkflow,
} from "./index";
import {
  FLUTTER_DESIGN_SOURCE,
  FLUTTER_DESIGN_SOURCE_CONSTRAINT_COUNT,
  FLUTTER_DESIGN_SOURCE_SHA256,
} from "./presets/flutter-design-source";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function encode(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function replaceMetadata(source: string, prefix: string, value: unknown): string {
  const start = source.indexOf(prefix);
  assert(start >= 0, `missing marker ${prefix}`);
  const payloadStart = start + prefix.length;
  const payloadEnd = source.indexOf(" -->", payloadStart);
  assert(payloadEnd >= 0, "missing metadata suffix");
  return `${source.slice(0, payloadStart)}${encode(value)}${source.slice(payloadEnd)}`;
}

function expectManagedError(run: () => unknown, expectedPath: string): void {
  let caught: unknown;
  try { run(); } catch (error) { caught = error; }
  assert(caught instanceof ManagedBlockError, `expected ManagedBlockError for ${expectedPath}`);
  assert(caught.message.includes(expectedPath), `error should identify ${expectedPath}: ${caught.message}`);
}

export async function runSkillDocumentSmoke(): Promise<void> {
  const preset = createFlutterDesignPreset();
  const realSource = serializeSkillDocument(preset.document);
  assert(readManagedContract(realSource) === null, "real preset source must not contain managed contract metadata");
  assert(readManagedWorkflow(realSource) === null, "real preset source must not contain managed workflow metadata");
  const source = writeManagedWorkflow(
    writeManagedContract(realSource, preset.contract),
    preset.workflow,
  );
  assert(readManagedContract(source)?.id === preset.contract.id, "valid contract should read");
  assert(readManagedWorkflow(source)?.id === preset.workflow.id, "valid workflow should read");

  const badObjectives = structuredClone(preset.contract) as any;
  badObjectives.objectives[0] = 7;
  expectManagedError(
    () => readManagedContract(replaceMetadata(source, "<!-- skill-document:skill-contract:metadata:v1:", badObjectives)),
    "Skill Contract.objectives[0]",
  );

  const badTrigger = structuredClone(preset.contract) as any;
  badTrigger.triggers[0].patterns = ["Flutter", false];
  expectManagedError(
    () => readManagedContract(replaceMetadata(source, "<!-- skill-document:skill-contract:metadata:v1:", badTrigger)),
    "Skill Contract.triggers[0].patterns[1]",
  );

  const badGate = structuredClone(preset.contract) as any;
  badGate.qualityGates[0].checks = [{}];
  expectManagedError(
    () => readManagedContract(replaceMetadata(source, "<!-- skill-document:skill-contract:metadata:v1:", badGate)),
    "Skill Contract.qualityGates[0].checks[0]",
  );

  const badStep = structuredClone(preset.workflow) as any;
  badStep.steps[0].action = 42;
  expectManagedError(
    () => readManagedWorkflow(replaceMetadata(source, "<!-- skill-document:workflow-blueprint:metadata:v1:", badStep)),
    "Workflow Blueprint.steps[0].action",
  );

  const badInput = structuredClone(preset.workflow) as any;
  badInput.steps[0].inputs[0].required = "yes";
  expectManagedError(
    () => readManagedWorkflow(replaceMetadata(source, "<!-- skill-document:workflow-blueprint:metadata:v1:", badInput)),
    "Workflow Blueprint.steps[0].inputs[0].required",
  );

  const badCondition = structuredClone(preset.workflow) as any;
  badCondition.steps[0].condition = { all: [{ not: { language: "sql" } }] };
  expectManagedError(
    () => readManagedWorkflow(replaceMetadata(source, "<!-- skill-document:workflow-blueprint:metadata:v1:", badCondition)),
    "Workflow Blueprint.steps[0].condition.all[0].not.language",
  );

  const badEvidence = structuredClone(preset.workflow) as any;
  badEvidence.steps[0].evidence[0].description = ["not", "text"];
  expectManagedError(
    () => readManagedWorkflow(replaceMetadata(source, "<!-- skill-document:workflow-blueprint:metadata:v1:", badEvidence)),
    "Workflow Blueprint.steps[0].evidence[0].description",
  );

  const crlf = "\uFEFF---\r\nname: \"Quoted # identity\"\r\nnested:\r\n  name: wrong\r\ndescription: >-\r\n  folded\r\n  identity\r\n---\r\n";
  assert(frontmatterStringValue(crlf, "name") === "Quoted # identity", "quoted/BOM/CRLF name failed");
  assert(frontmatterStringValue(crlf, "description") === "folded identity", "folded strip failed");
  const literal = "---\r\ndescription: |+\r\n  line one\r\n  line two\r\n\r\n---\r\n";
  assert(frontmatterStringValue(literal, "description") === "line one\nline two\n\n", "literal keep failed");
  assert(frontmatterStringValue("---\nname: plain value # comment\n---\n", "name") === "plain value", "plain comment failed");
  assert(frontmatterStringValue("---\nname: 'quoted # value' # comment\n---\n", "name") === "quoted # value", "single-quoted comment failed");
  assert(frontmatterStringValue("---\nname: 123\n---\n", "name") === "", "numeric identity must be rejected");
  assert(frontmatterStringValue("---\nouter:\n  name: nested-only\n---\n", "name") === "", "nested key must not match");

  assert(serializeSkillDocument(parseSkillDocument(FLUTTER_DESIGN_SOURCE)) === FLUTTER_DESIGN_SOURCE, "snapshot parse/serialize drift");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(FLUTTER_DESIGN_SOURCE));
  const digestHex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  assert(digestHex === FLUTTER_DESIGN_SOURCE_SHA256, `snapshot hash drift: ${digestHex}`);
  const constraints = [...FLUTTER_DESIGN_SOURCE.matchAll(/^- (.+)$/gm)].map((match) => match[1]);
  assert(constraints.length === 57 && constraints.length === FLUTTER_DESIGN_SOURCE_CONSTRAINT_COUNT, "57-constraint coverage failed");
  const anchors = [
    "main/", "Flutter UI, Material 3", "(wa)", "shared Flutter implementation", "responsive breakpoints",
    "ui-ux-pro-max", "Material 3 or existing project primitive", "bottom navigation", "one high-emphasis", "TextField", "Switch",
    "cancel/escape path", "ordinary content rows are not cards", "Material token roles", "IconData", "Preserve behavior",
    "one shared widget tree", "lib/pages/<page>/", "stable breakpoints", "Custom controls", "Visible text",
    "Cards/surfaces", "Two-column layouts", "Same-kind two-column", "nest cards", "Design references",
    "data/<category>/", "AppData", "recomputable files", "cache/<category>/", "shared app data/cache path helper",
    "background sync", "Provider/API configuration", "concrete file paths", "visible UI state change", "route enter/back",
    "shared motion tokens", "shared project entry", "cause and effect", "Reduced-motion", "source-level design contract",
    "Android-sensitive", "Windows-sensitive", "smallest affected-platform", "WPF", "one-off UI glue",
    "shared domain logic", "remove-legacy-compat", "smallest effective verification", "source audit comes before screenshots",
    "Tiny text/color/spacing", "Android-only impact", "Windows-only impact", "shared Flutter changes",
    "Screenshot comparison", "Chinese UI copy", "Completion reports",
  ];
  assert(anchors.length === 57, `expected 57 anchors, got ${anchors.length}`);
  anchors.forEach((anchor, index) => assert(constraints[index].includes(anchor), `constraint ${index + 1} missing anchor ${anchor}`));
  console.log("skill-document smoke: 7 malformed schemas + frontmatter semantics + exact Flutter snapshot/hash/57 constraints PASS");
}

void runSkillDocumentSmoke();
