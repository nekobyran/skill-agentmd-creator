import { invoke } from "@tauri-apps/api/core";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  AiSkillStudio,
  type AiDesignRequest,
  type AiSkillProposal,
} from "./features/ai-assistant";
import {
  findSection,
  createFlutterDesignPreset,
  createWorkflowTaskPreset,
  frontmatterStringValue,
  parseSkillDocument,
  removeSection,
  serializeSkillDocument,
  updateSkillDocumentFrontmatter,
  upsertSection,
  type SkillPreset,
} from "./features/skill-document";
import { AdvancedSkillStudio } from "./features/skill-editor";
import {
  SkillLibrary,
  type CodexSkillCatalog,
  type CodexSkillImportResult,
} from "./features/skill-library";
import { RuleGraph, type RuleGraphInput } from "./features/rule-graph";

type SkillSummary = {
  id: string;
  name: string;
  description: string;
  filePath: string;
  updatedAt: number;
};

type SkillContent = SkillSummary & {
  content: string;
};

type CreateResult = {
  filePath: string;
  entryPath: string;
  content: string;
};

type SkillDraft = {
  name: string;
  description: string;
  aliases: string[];
  content: string;
  sourceMarkdown?: string;
  sourceAuthoritative?: boolean;
  topRules: TopRuleKnowledge[];
  rules: LocalRule[];
  commandTools: CommandTool[];
};

type TopRuleType = "规则" | "流程";

type TopRuleKnowledge = {
  clientId?: string;
  name: string;
  writeName: boolean;
  alias: string;
  category: string;
  content: string;
  displayContent?: string;
  ruleType?: TopRuleType;
};

type RuleResultKind = "requirement" | "flow";

type RuleResult = {
  kind: RuleResultKind;
  requirement: string;
  steps: string[];
};

type RuleRoute = {
  clientId: string;
  route: string;
  matchMode: RuleMatchMode;
  conditions: RuleCondition[];
  result: RuleResult;
};

type RuleCondition = {
  alias: string;
  content: string;
};

type RuleMatchMode = "all" | "any";

type RuleTrigger = {
  clientId: string;
  displayContent: string;
  content: string;
};

type RuleTriggerRoute = {
  clientId: string;
  triggerId: string;
  matchMode: RuleMatchMode;
};

type RuleLimitLink = {
  clientId: string;
  displayContent: string;
  content: string;
  triggerId: string;
  routeId: string;
};

type LocalRule = {
  clientId?: string;
  name: string;
  category: string;
  triggerConditions: RuleCondition[];
  limitConditions: RuleCondition[];
  routes: RuleRoute[];
  editorType?: "rule" | "route";
  ruleTriggers: RuleTrigger[];
  ruleTriggerRoutes: RuleTriggerRoute[];
  ruleLimitLinks: RuleLimitLink[];
};

type CommandTool = {
  clientId?: string;
  name: string;
  alias: string;
  command: string;
  usage: string;
};

type ActivePanel = "identity" | "top" | "local" | "command";
type ActivePage = "editor" | "advanced" | "ai" | "library" | "settings";
type BackendStatus = "connecting" | "connected" | "disconnected";
type CodexModelStatus = {
  authFileDetected: boolean;
  connected: boolean;
  checkedAt: number;
  message: string;
  model: string;
  reasoningEffort: string;
  fastMode: boolean;
  availableModels: CodexModelOption[];
};

type CodexModelOption = {
  slug: string;
  displayName: string;
  reasoningLevels: string[];
  supportsFast: boolean;
};

type TranslationResult = {
  translatedText: string;
  model: string;
  sourceId?: string | null;
};

type AiDesignBackendResult = {
  assistantMessage: string;
  markdown: string;
  model: string;
};

type SortablePanel = "top" | "local" | "command";

type DragState = {
  panel: SortablePanel;
  index: number;
  draggedId: string;
  originalOrder: string[];
};

type CategoryDragState = {
  panel: "top" | "local";
  index: number;
  category: string;
  originalOrder: string[];
};

type PendingAutosave = {
  id: string;
  draft: SkillDraft;
  revision: number;
};

type EditorDraftCache = {
  content: string;
  sourceMarkdown?: string;
  sourceAuthoritative?: boolean;
  skillName?: string;
  skillDescription?: string;
  skillAliases?: string[];
  topRules: TopRuleKnowledge[];
  localRules: LocalRule[];
  commandTools: CommandTool[];
  topRuleCategories?: string[];
  localRuleCategories?: string[];
  activePanel?: ActivePanel;
  activeTopCategory?: string;
  activeLocalCategory?: string;
};

type EditorState = Omit<EditorDraftCache, "content">;
type EditorStateValue<T> = T[] | ((current: T[]) => T[]);

const FLUTTER_DESIGN_PRESET = createFlutterDesignPreset();
const WORKFLOW_TASK_PRESET = createWorkflowTaskPreset();

const emptyTopRule = (): TopRuleKnowledge => ({
  clientId: createClientId("top"),
  name: "",
  writeName: false,
  alias: "",
  category: "",
  content: "",
  ruleType: "规则",
});

const emptyCondition = (): RuleCondition => ({
  alias: "",
  content: "",
});

const emptyRoute = (): RuleRoute => ({
  clientId: createClientId("flow-route"),
  route: "",
  matchMode: "all",
  conditions: [emptyCondition()],
  result: {
    kind: "flow",
    requirement: "",
    steps: [""],
  },
});

const emptyLocalRule = (): LocalRule => {
  const triggerId = createClientId("rule-trigger");
  const routeId = createClientId("rule-route");
  return {
    clientId: createClientId("local"),
    name: "",
    category: "",
    triggerConditions: [emptyCondition()],
    limitConditions: [emptyCondition()],
    routes: [emptyRoute()],
    editorType: "rule",
    ruleTriggers: [{ clientId: triggerId, displayContent: "", content: "" }],
    ruleTriggerRoutes: [{ clientId: routeId, triggerId, matchMode: "all" }],
    ruleLimitLinks: [{
      clientId: createClientId("rule-limit"),
      displayContent: "",
      content: "",
      triggerId,
      routeId,
    }],
  };
};

const emptyCommandTool = (): CommandTool => ({
  clientId: createClientId("command"),
  name: "",
  alias: "",
  command: "",
  usage: "",
});

const API_BASE_URL = "http://127.0.0.1:1421/api";
const TOP_ALL_CATEGORY = "__all_top__";
const LOCAL_ALL_CATEGORY = "__all__";

function App() {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [selected, setSelected] = useState<SkillContent | null>(null);
  const [topRules, setTopRules] = useState<TopRuleKnowledge[]>([emptyTopRule()]);
  const [localRules, setLocalRules] = useState<LocalRule[]>([emptyLocalRule()]);
  const [commandTools, setCommandTools] = useState<CommandTool[]>([emptyCommandTool()]);
  const [skillName, setSkillName] = useState("");
  const [skillDescription, setSkillDescription] = useState("");
  const [skillAliases, setSkillAliases] = useState<string[]>([]);
  const [sourceMarkdown, setSourceMarkdown] = useState("");
  const [sourceAuthoritative, setSourceAuthoritative] = useState(false);
  const [topRuleCategories, setTopRuleCategories] = useState<string[]>([]);
  const [activeTopCategory, setActiveTopCategory] = useState(TOP_ALL_CATEGORY);
  const [localRuleCategories, setLocalRuleCategories] = useState<string[]>([]);
  const [activeLocalCategory, setActiveLocalCategory] = useState(LOCAL_ALL_CATEGORY);
  const [selectedRuleIndex, setSelectedRuleIndex] = useState(0);
  const [selectedLocalRuleIndex, setSelectedLocalRuleIndex] = useState(0);
  const [selectedCommandToolIndex, setSelectedCommandToolIndex] = useState(0);
  const [activePanel, setActivePanel] = useState<ActivePanel>("identity");
  const [dragState, setDragStateValue] = useState<DragState | null>(null);
  const [categoryDragState, setCategoryDragState] = useState<CategoryDragState | null>(null);
  const [revealedSkillId, setRevealedSkillId] = useState("");
  const [skillSwipeOffset, setSkillSwipeOffset] = useState<{ id: string; value: number } | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteSkillCandidate, setDeleteSkillCandidate] = useState<SkillSummary | null>(null);
  const [newSkillName, setNewSkillName] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewKind, setPreviewKind] = useState<"body" | "sample" | "graph">("body");
  const [activePage, setActivePage] = useState<ActivePage>("editor");
  const [busy, setBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [toast, setToast] = useState("");
  const [backendStatus, setBackendStatus] = useState<BackendStatus>("connecting");
  const [codexStatus, setCodexStatus] = useState<CodexModelStatus | null>(null);
  const [codexSkillCatalog, setCodexSkillCatalog] = useState<CodexSkillCatalog | null>(null);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const longPressTimerRef = useRef<number | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const ruleGridRef = useRef<HTMLDivElement | null>(null);
  const categoryStripRef = useRef<HTMLDivElement | null>(null);
  const categoryDragStateRef = useRef<CategoryDragState | null>(null);
  const skillSwipeRef = useRef<{ id: string; startX: number; startOffset: number } | null>(null);
  const suppressClickRef = useRef(false);
  const autosaveTimerRef = useRef<number | null>(null);
  const autosaveReadyRef = useRef(false);
  const lastSavedContentRef = useRef("");
  const autosaveChainRef = useRef<Promise<void>>(Promise.resolve());
  const editRevisionRef = useRef(0);
  const selectTokenRef = useRef(0);
  const pendingAutosaveRef = useRef<PendingAutosave | null>(null);
  const translationVersionsRef = useRef(new Map<string, number>());
  const translationPromisesRef = useRef(new Map<string, Promise<void>>());
  const [translationActivityCount, setTranslationActivityCount] = useState(0);
  const selectedRef = useRef<SkillContent | null>(selected);
  const activePanelRef = useRef<ActivePanel>(activePanel);
  const topRulesRef = useRef(topRules);
  const localRulesRef = useRef(localRules);
  const commandToolsRef = useRef(commandTools);
  const skillNameRef = useRef(skillName);
  const skillDescriptionRef = useRef(skillDescription);
  const skillAliasesRef = useRef(skillAliases);
  const sourceMarkdownRef = useRef(sourceMarkdown);
  const sourceAuthoritativeRef = useRef(false);
  const topRuleCategoriesRef = useRef(topRuleCategories);
  const activeTopCategoryRef = useRef(activeTopCategory);
  const localRuleCategoriesRef = useRef(localRuleCategories);
  const activeLocalCategoryRef = useRef(activeLocalCategory);

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    function syncPageFromHash() {
      const hash = window.location.hash;
      setActivePage(
        hash === "#settings"
          ? "settings"
          : hash === "#advanced"
            ? "advanced"
            : hash === "#ai"
              ? "ai"
              : hash === "#library"
                ? "library"
                : "editor",
      );
      setPreviewOpen(hash === "#preview");
    }

    syncPageFromHash();
    window.addEventListener("hashchange", syncPageFromHash);
    return () => window.removeEventListener("hashchange", syncPageFromHash);
  }, []);

  useEffect(
    () => () => {
      clearLongPressTimer();
      clearAutosaveTimer();
    },
    [],
  );

  useEffect(() => {
    if (activePage === "settings" && backendStatus === "connected") {
      void loadCodexStatus();
    }
  }, [activePage, backendStatus]);

  useEffect(() => {
    if (activePage === "library" && backendStatus === "connected" && !codexSkillCatalog) {
      void loadCodexSkillCatalog();
    }
  }, [activePage, backendStatus, codexSkillCatalog]);

  const selectedId = selected?.id ?? "";
  const draft = useMemo(
    () => buildDraft(
      topRules,
      localRules,
      commandTools,
      selected,
      { name: skillName, description: skillDescription, aliases: skillAliases },
      sourceMarkdown,
      sourceAuthoritative,
    ),
    [topRules, localRules, commandTools, selected, skillName, skillDescription, skillAliases, sourceMarkdown, sourceAuthoritative],
  );
  const hasDraftRules =
    draft.topRules.length > 0 || draft.rules.length > 0 || draft.commandTools.length > 0;
  const previewText = selected ? renderDraft(draft) : "";
  const advancedPreset = useMemo(
    () => presetForSkill(selected, skillName),
    [selected, skillName],
  );
  const samplePreviewText = hasDraftRules
    ? renderDraft({
        ...draft,
        topRules: draft.topRules.map((rule, index) => ({
          ...rule,
          content: topRuleDisplayContent(topRules[index] ?? rule),
        })),
      })
    : previewText;
  const ruleGraphData = useMemo<RuleGraphInput>(
    () => ({
      skillName: skillName || selected?.name || "未命名 Skill",
      topRules: topRules.map((rule, index) => ({
        id: rule.clientId ?? `top-${index}`,
        name: rule.name,
        category: rule.category,
        ruleType: rule.ruleType ?? "规则",
        content: topRuleDisplayContent(rule),
      })),
      localRules: localRules.map((rule, index) => ({
        id: rule.clientId ?? `local-${index}`,
        index,
        name: rule.name,
        category: rule.category,
        editorType: rule.editorType ?? "route",
        triggers: rule.ruleTriggers.map((trigger, triggerIndex) => ({
          id: trigger.clientId || `trigger-${triggerIndex}`,
          label: trigger.displayContent || trigger.content,
        })),
        triggerRoutes: rule.ruleTriggerRoutes.map((route, routeIndex) => ({
          id: route.clientId || `condition-route-${routeIndex}`,
          triggerId: route.triggerId,
          matchMode: route.matchMode,
        })),
        limits: rule.ruleLimitLinks.map((limit, limitIndex) => ({
          id: limit.clientId || `limit-${limitIndex}`,
          label: limit.displayContent || limit.content,
          triggerId: limit.triggerId,
          routeId: limit.routeId,
        })),
        triggerConditions: rule.triggerConditions.map((condition, conditionIndex) => ({
          id: `trigger-condition-${conditionIndex}`,
          label: condition.alias || condition.content,
        })),
        limitConditions: rule.limitConditions.map((condition, conditionIndex) => ({
          id: `limit-condition-${conditionIndex}`,
          label: condition.alias || condition.content,
        })),
        routes: rule.routes.map((route, routeIndex) => ({
          id: route.clientId || `route-${routeIndex}`,
          label: route.route,
          matchMode: route.matchMode,
          conditions: route.conditions.map((condition, conditionIndex) => ({
            id: `${route.clientId || routeIndex}-branch-${conditionIndex}`,
            label: condition.alias || condition.content,
          })),
          resultKind: route.result.kind,
          result: renderResult(route.result),
          steps: route.result.steps,
        })),
      })),
    }),
    [skillName, selected?.name, topRules, localRules],
  );

  useEffect(() => {
    if (!categoryDragState) return;
    const handlePointerMove = (event: PointerEvent) => {
      const bounds = categoryStripRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const margin = 36;
      if (
        event.clientX < bounds.left - margin || event.clientX > bounds.right + margin ||
        event.clientY < bounds.top - margin || event.clientY > bounds.bottom + margin
      ) {
        cancelCategoryDrag();
      }
    };
    window.addEventListener("pointermove", handlePointerMove);
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, [categoryDragState]);
  const topCategoryOptions = useMemo(
    () => mergeRuleCategories(topRuleCategories, topRules),
    [topRuleCategories, topRules],
  );
  const safeActiveTopCategory =
    activeTopCategory === TOP_ALL_CATEGORY || topCategoryOptions.includes(activeTopCategory)
      ? activeTopCategory
      : TOP_ALL_CATEGORY;
  const topVisibleEntries = useMemo(
    () =>
      topRules
        .map((rule, index) => ({ rule, index }))
        .filter(({ rule }) =>
          safeActiveTopCategory === TOP_ALL_CATEGORY
            ? true
            : normalizeCategory(rule.category) === safeActiveTopCategory,
        ),
    [topRules, safeActiveTopCategory],
  );
  const selectedRuleEntry =
    topVisibleEntries.find((entry) => entry.index === selectedRuleIndex) ??
    topVisibleEntries[0] ??
    null;
  const selectedRuleIndexForEditor = selectedRuleEntry?.index ?? selectedRuleIndex;
  const selectedRule = selectedRuleEntry?.rule ?? emptyTopRule();
  const selectedRuleDisplayContent = topRuleDisplayContent(selectedRule);
  const localCategoryOptions = useMemo(
    () => mergeLocalRuleCategories(localRuleCategories, localRules),
    [localRuleCategories, localRules],
  );
  const safeActiveLocalCategory =
    activeLocalCategory === LOCAL_ALL_CATEGORY || localCategoryOptions.includes(activeLocalCategory)
      ? activeLocalCategory
      : LOCAL_ALL_CATEGORY;
  const localVisibleEntries = useMemo(
    () =>
      localRules
        .map((rule, index) => ({ rule, index }))
        .filter(({ rule }) =>
          safeActiveLocalCategory === LOCAL_ALL_CATEGORY
            ? true
            : normalizeCategory(rule.category) === safeActiveLocalCategory,
        ),
    [localRules, safeActiveLocalCategory],
  );
  const selectedLocalEntry =
    localVisibleEntries.find((entry) => entry.index === selectedLocalRuleIndex) ??
    localVisibleEntries[0] ??
    null;
  const selectedLocalRuleIndexForEditor = selectedLocalEntry?.index ?? selectedLocalRuleIndex;
  const selectedLocalRule =
    selectedLocalEntry?.rule ?? emptyLocalRule();
  const selectedCommandTool =
    commandTools[selectedCommandToolIndex] ?? commandTools[0] ?? emptyCommandTool();
  const currentRuleCount =
    activePanel === "identity"
      ? 0
      : activePanel === "top"
      ? topVisibleEntries.length
      : activePanel === "local"
        ? localVisibleEntries.length
        : commandTools.length;
  const selectedCodexModel = codexStatus?.availableModels.find(
    (model) => model.slug === codexStatus.model,
  ) ?? codexStatus?.availableModels[0];

  useEffect(() => {
    if (!selected) {
      autosaveReadyRef.current = false;
      lastSavedContentRef.current = "";
      setSaveStatus("");
      clearAutosaveTimer();
      return;
    }

    if (backendStatus !== "connected" || !isEditableSkill(selected)) {
      return;
    }

    if (hasPendingTopRuleTranslation(topRules)) {
      clearAutosaveTimer();
      pendingAutosaveRef.current = null;
      setSaveStatus(translationActivityCount ? `翻译中 ${translationActivityCount}` : "待翻译");
      return;
    }

    const nextContent = renderDraft(draft);
    if (!autosaveReadyRef.current) {
      autosaveReadyRef.current = true;
      lastSavedContentRef.current = normalizeRenderedContent(selected.content);
      return;
    }

    if (normalizeRenderedContent(nextContent) === lastSavedContentRef.current) {
      pendingAutosaveRef.current = null;
      return;
    }

    clearAutosaveTimer();
    setSaveStatus("保存中");
    pendingAutosaveRef.current = {
      id: selected.id,
      draft: { ...draft, sourceMarkdown: nextContent },
      revision: editRevisionRef.current,
    };
    autosaveTimerRef.current = window.setTimeout(() => {
      void flushAutosaveNow();
    }, 650);

    return clearAutosaveTimer;
  }, [backendStatus, draft, selected, translationActivityCount]);

  async function bootstrap() {
    try {
      await callBackend("ping_backend");
      setBackendStatus("connected");
      await callBackend("ensure_manifest");
      await loadCodexStatus();
      await loadSkills();
      return;
    } catch (error) {
      setBackendStatus("disconnected");
      setToast(error instanceof Error ? error.message : String(error));
    }
  }

  async function loadSkills(selectId?: string) {
    const nextSkills = await callBackend<SkillSummary[]>("list_skills");
    setSkills(nextSkills);
    if (selectId) {
      await selectSkill(selectId);
    }
  }

  async function loadCodexStatus() {
    try {
      const status = await callBackend<CodexModelStatus>("codex_status");
      setCodexStatus(status);
    } catch (error) {
      setCodexStatus({
        authFileDetected: false,
        connected: false,
        checkedAt: Math.floor(Date.now() / 1000),
        message: error instanceof Error ? error.message : String(error),
        model: "gpt-5.3-codex-spark",
        reasoningEffort: "medium",
        fastMode: false,
        availableModels: [],
      });
    }
  }

  async function loadCodexSkillCatalog() {
    setLibraryBusy(true);
    setLibraryError("");
    try {
      const catalog = await callBackend<CodexSkillCatalog>("list_codex_skills");
      setCodexSkillCatalog(catalog);
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : String(error));
    } finally {
      setLibraryBusy(false);
    }
  }

  async function importCodexSkills(ids: string[]) {
    setLibraryBusy(true);
    setLibraryError("");
    try {
      const result = await callBackend<CodexSkillImportResult>("import_codex_skills", { ids });
      const [catalog] = await Promise.all([
        callBackend<CodexSkillCatalog>("list_codex_skills"),
        loadSkills(),
      ]);
      setCodexSkillCatalog(catalog);
      const summary = result.errors.length
        ? `已导入 ${result.imported.length} 个，${result.errors.length} 个失败`
        : `已导入 ${result.imported.length} 个，跳过 ${result.skipped.length} 个`;
      setToast(summary);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLibraryError(message);
      throw error;
    } finally {
      setLibraryBusy(false);
    }
  }

  function openSkillLibrary() {
    setActivePage("library");
    window.location.hash = "#library";
    if (!codexSkillCatalog && !libraryBusy) {
      void loadCodexSkillCatalog();
    }
  }

  async function selectSkill(id: string, openPreview = false) {
    const selectToken = ++selectTokenRef.current;
    const previousSkillId = currentSelectedSkill()?.id;
    if (previousSkillId && previousSkillId !== id) {
      await translateSelectedTopRule();
      await waitForSkillTranslations(previousSkillId);
    }
    cacheCurrentEditorState();
    await flushAutosaveNow();
    if (selectToken !== selectTokenRef.current) {
      return;
    }

    const content = await callBackend<SkillContent>("read_skill", { id });
    if (selectToken !== selectTokenRef.current) {
      return;
    }

    autosaveReadyRef.current = false;
    lastSavedContentRef.current = normalizeRenderedContent(content.content);
    setSaveStatus("");
    selectedRef.current = content;
    setSelected(content);
    loadEditorFromSkillContent(content);
    setActivePage("editor");
    window.location.hash = "#editor";
    if (openPreview) {
      setPreviewOpen(true);
    }
  }

  function loadEditorFromSkillContent(skill: SkillContent) {
    const parsed = parseSkillContent(skill);
    const cached = readEditorDraftCache(skill);
    const cachedTopRules = cached?.topRules ?? [];
    const cachedLocalRules = cached?.localRules ?? [];
    const cachedCommandTools = cached?.commandTools ?? [];
    const nextTopRules = ensureTopRuleClientIds(cachedTopRules.length
      ? cachedTopRules
      : parsed.topRules.length
        ? parsed.topRules
        : [emptyTopRule()]);
    const nextLocalRules = ensureLocalRuleClientIds(cachedLocalRules.length
      ? cachedLocalRules
      : parsed.rules.length
        ? parsed.rules
        : [emptyLocalRule()]);
    const nextCommandTools = ensureCommandToolClientIds(cachedCommandTools.length
      ? cachedCommandTools
      : parsed.commandTools.length
        ? parsed.commandTools
        : [emptyCommandTool()]);
    const nextTopRuleCategories = mergeRuleCategories(
      cached?.topRuleCategories ?? [],
      nextTopRules,
    );
    const nextActiveTopCategory =
      cached?.activeTopCategory === TOP_ALL_CATEGORY ||
      nextTopRuleCategories.includes(cached?.activeTopCategory ?? "")
        ? cached?.activeTopCategory ?? TOP_ALL_CATEGORY
        : TOP_ALL_CATEGORY;
    const nextLocalRuleCategories = mergeLocalRuleCategories(
      cached?.localRuleCategories ?? [],
      nextLocalRules,
    );
    const nextActiveLocalCategory =
      cached?.activeLocalCategory === LOCAL_ALL_CATEGORY ||
      nextLocalRuleCategories.includes(cached?.activeLocalCategory ?? "")
        ? cached?.activeLocalCategory ?? LOCAL_ALL_CATEGORY
        : LOCAL_ALL_CATEGORY;

    setEditorStateLatest({
      skillName: cached?.skillName ?? parsed.name,
      skillDescription: cached?.skillDescription ?? parsed.description,
      skillAliases: cached?.skillAliases ?? parsed.aliases,
      sourceMarkdown: cached?.sourceMarkdown ?? skill.content,
      sourceAuthoritative: cached?.sourceAuthoritative ?? true,
      topRules: nextTopRules,
      localRules: nextLocalRules,
      commandTools: nextCommandTools,
      topRuleCategories: nextTopRuleCategories,
      activeTopCategory: nextActiveTopCategory,
      localRuleCategories: nextLocalRuleCategories,
      activeLocalCategory: nextActiveLocalCategory,
    });
    setSelectedRuleIndex(0);
    setSelectedLocalRuleIndex(0);
    setSelectedCommandToolIndex(0);
    setActivePanelLatest(
      cached?.activePanel ??
        "identity",
    );
    setDragState(null);
  }

  function setActivePanelLatest(nextPanel: ActivePanel) {
    activePanelRef.current = nextPanel;
    setActivePanel(nextPanel);
  }

  async function changeCodexPreferences(
    model: string,
    reasoningEffort: string,
    fastMode: boolean,
  ) {
    setBusy(true);
    try {
      const status = await callBackend<CodexModelStatus>("set_codex_model", {
        model,
        reasoningEffort,
        fastMode,
      });
      setCodexStatus(status);
      setToast("翻译配置已保存");
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function requestAiSkillDesign(
    request: AiDesignRequest,
    context: { signal: AbortSignal },
  ) {
    if (context.signal.aborted) throw new DOMException("AI request cancelled", "AbortError");
    const result = await callBackend<AiDesignBackendResult>("design_skill", {
      mode: request.mode,
      prompt: request.prompt,
      currentSource: request.currentSource,
      history: request.conversation,
    });
    if (context.signal.aborted) throw new DOMException("AI request cancelled", "AbortError");
    return {
      message: result.assistantMessage,
      title: request.mode === "create" ? "创建 Skill 提案" : `修改 ${request.targetSkill?.name ?? "Skill"}`,
      summary: `由 ${result.model} 生成；应用前请检查完整差异。`,
      before: request.currentSource,
      after: result.markdown,
      changedFiles: [request.targetSkill?.filePath ?? "SKILL.md"],
      warnings: result.markdown.trim().startsWith("---") ? [] : ["提案缺少标准 YAML frontmatter"],
    };
  }

  async function applyAiSkillProposal(proposal: AiSkillProposal) {
    if (!proposal.after.trim()) throw new Error("AI 提案没有可应用的 SKILL.md 内容");
    const proposalDraft = draftFromSourceMarkdown(proposal.after, selectedRef.current);
    if (proposal.mode === "create") {
      const result = await callBackend<CreateResult>("create_skill", { draft: proposalDraft });
      const createdId = skillIdFromFilePath(result.filePath);
      if (!createdId) throw new Error("AI Skill 已写入，但无法识别新技能目录");
      await refreshSkillAfterAiApply(createdId);
      setToast("AI Skill 已创建");
      return;
    }

    const current = selectedRef.current;
    if (!current) throw new Error("要修改的 Skill 已不存在");
    await flushAutosaveNow();
    await callBackend<CreateResult>("update_skill", { id: current.id, draft: proposalDraft });
    localStorage.removeItem(editorDraftCacheKey(current.id));
    await refreshSkillAfterAiApply(current.id);
    setToast("AI 提案已应用");
  }

  async function refreshSkillAfterAiApply(id: string) {
    const [nextSkills, content] = await Promise.all([
      callBackend<SkillSummary[]>("list_skills"),
      callBackend<SkillContent>("read_skill", { id }),
    ]);
    setSkills(nextSkills);
    autosaveReadyRef.current = false;
    lastSavedContentRef.current = normalizeRenderedContent(content.content);
    selectedRef.current = content;
    setSelected(content);
    loadEditorFromSkillContent(content);
  }

  function openPreview(kind: "body" | "sample" | "graph") {
    setPreviewKind(kind);
    setPreviewOpen(true);
    if (window.location.hash !== "#preview") {
      window.history.pushState(null, "", "#preview");
    }
  }

  function closePreview() {
    setPreviewOpen(false);
    if (window.location.hash === "#preview") {
      window.history.replaceState(null, "", "#editor");
    }
  }

  async function deleteSkill(id: string) {
    setBusy(true);
    try {
      await callBackend<void>("delete_skill", { id });
      localStorage.removeItem(editorDraftCacheKey(id));
      setRevealedSkillId("");
      const nextSkills = await callBackend<SkillSummary[]>("list_skills");
      setSkills(nextSkills);
      if (selectedRef.current?.id === id) {
        selectedRef.current = null;
        setSelected(null);
        if (nextSkills[0]) await selectSkill(nextSkills[0].id);
      }
      setToast("技能已删除");
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function switchActivePanel(nextPanel: ActivePanel) {
    if (activePanelRef.current === "top" && nextPanel !== "top") {
      void translateSelectedTopRule();
    }
    setActivePanelLatest(nextPanel);
    cacheCurrentEditorState();
  }

  function setEditorStateLatest(nextState: EditorState) {
    if (typeof nextState.skillName === "string") {
      skillNameRef.current = nextState.skillName;
      setSkillName(nextState.skillName);
    }
    if (typeof nextState.skillDescription === "string") {
      skillDescriptionRef.current = nextState.skillDescription;
      setSkillDescription(nextState.skillDescription);
    }
    if (nextState.skillAliases) {
      skillAliasesRef.current = nextState.skillAliases;
      setSkillAliases(nextState.skillAliases);
    }
    if (typeof nextState.sourceMarkdown === "string") {
      sourceMarkdownRef.current = nextState.sourceMarkdown;
      setSourceMarkdown(nextState.sourceMarkdown);
    }
    if (typeof nextState.sourceAuthoritative === "boolean") {
      sourceAuthoritativeRef.current = nextState.sourceAuthoritative;
      setSourceAuthoritative(nextState.sourceAuthoritative);
    }
    topRulesRef.current = nextState.topRules;
    localRulesRef.current = nextState.localRules;
    commandToolsRef.current = nextState.commandTools;
    topRuleCategoriesRef.current = nextState.topRuleCategories ?? topRuleCategoriesRef.current;
    activeTopCategoryRef.current = nextState.activeTopCategory ?? activeTopCategoryRef.current;
    localRuleCategoriesRef.current = nextState.localRuleCategories ?? localRuleCategoriesRef.current;
    activeLocalCategoryRef.current = nextState.activeLocalCategory ?? activeLocalCategoryRef.current;
    setTopRules(nextState.topRules);
    setLocalRules(nextState.localRules);
    setCommandTools(nextState.commandTools);
    if (nextState.topRuleCategories) {
      setTopRuleCategories(nextState.topRuleCategories);
    }
    if (nextState.activeTopCategory) {
      setActiveTopCategory(nextState.activeTopCategory);
    }
    if (nextState.localRuleCategories) {
      setLocalRuleCategories(nextState.localRuleCategories);
    }
    if (nextState.activeLocalCategory) {
      setActiveLocalCategory(nextState.activeLocalCategory);
    }
  }

  function updateSkillIdentity(value: {
    name?: string;
    description?: string;
    aliases?: string[];
  }) {
    markStructuredEditorDirty();
    if (typeof value.name === "string") {
      skillNameRef.current = value.name;
      setSkillName(value.name);
    }
    if (typeof value.description === "string") {
      skillDescriptionRef.current = value.description;
      setSkillDescription(value.description);
    }
    if (value.aliases) {
      skillAliasesRef.current = value.aliases;
      setSkillAliases(value.aliases);
    }
    cacheCurrentEditorState();
  }

  function setTopRulesLatest(nextValue: EditorStateValue<TopRuleKnowledge>) {
    markStructuredEditorDirty();
    const next = typeof nextValue === "function"
      ? nextValue(topRulesRef.current)
      : nextValue;
    topRulesRef.current = next;
    setTopRules(next);
    cacheCurrentEditorState();
    return next;
  }

  function setLocalRulesLatest(nextValue: EditorStateValue<LocalRule>) {
    markStructuredEditorDirty();
    const next = typeof nextValue === "function"
      ? nextValue(localRulesRef.current)
      : nextValue;
    localRulesRef.current = next;
    setLocalRules(next);
    cacheCurrentEditorState();
    return next;
  }

  function setTopRuleCategoriesLatest(nextCategories: string[]) {
    const next = mergeRuleCategories(nextCategories, topRulesRef.current);
    topRuleCategoriesRef.current = next;
    setTopRuleCategories(next);
    cacheCurrentEditorState();
    return next;
  }

  function setActiveTopCategoryLatest(nextCategory: string) {
    activeTopCategoryRef.current = nextCategory;
    setActiveTopCategory(nextCategory);
    cacheCurrentEditorState();
  }

  function setLocalRuleCategoriesLatest(nextCategories: string[]) {
    const next = mergeLocalRuleCategories(nextCategories, localRulesRef.current);
    localRuleCategoriesRef.current = next;
    setLocalRuleCategories(next);
    cacheCurrentEditorState();
    return next;
  }

  function setActiveLocalCategoryLatest(nextCategory: string) {
    activeLocalCategoryRef.current = nextCategory;
    setActiveLocalCategory(nextCategory);
    cacheCurrentEditorState();
  }

  function setCommandToolsLatest(nextValue: EditorStateValue<CommandTool>) {
    markStructuredEditorDirty();
    const next = typeof nextValue === "function"
      ? nextValue(commandToolsRef.current)
      : nextValue;
    commandToolsRef.current = next;
    setCommandTools(next);
    cacheCurrentEditorState();
    return next;
  }

  function markStructuredEditorDirty() {
    editRevisionRef.current += 1;
    if (!sourceAuthoritativeRef.current) return;
    sourceAuthoritativeRef.current = false;
    setSourceAuthoritative(false);
  }

  function setSourceMarkdownLatest(nextSource: string) {
    editRevisionRef.current += 1;
    sourceMarkdownRef.current = nextSource;
    sourceAuthoritativeRef.current = true;
    const nextName = frontmatterStringValue(nextSource, "name");
    const nextDescription = frontmatterStringValue(nextSource, "description");
    const nextAliases = parseAliases(nextSource);
    const parsedTopRules = parseTopRules(nextSource);
    const parsedLocalRules = parseLocalRules(nextSource);
    const parsedCommandTools = parseCommandTools(nextSource);
    const nextTopRules = ensureTopRuleClientIds(parsedTopRules.length ? parsedTopRules : [emptyTopRule()]);
    const nextLocalRules = ensureLocalRuleClientIds(parsedLocalRules.length ? parsedLocalRules : [emptyLocalRule()]);
    const nextCommandTools = ensureCommandToolClientIds(
      parsedCommandTools.length ? parsedCommandTools : [emptyCommandTool()],
    );
    if (nextName) {
      skillNameRef.current = nextName;
      setSkillName(nextName);
    }
    if (nextDescription) {
      skillDescriptionRef.current = nextDescription;
      setSkillDescription(nextDescription);
    }
    skillAliasesRef.current = nextAliases;
    topRulesRef.current = nextTopRules;
    localRulesRef.current = nextLocalRules;
    commandToolsRef.current = nextCommandTools;
    setSkillAliases(nextAliases);
    setTopRules(nextTopRules);
    setLocalRules(nextLocalRules);
    setCommandTools(nextCommandTools);
    setSourceMarkdown(nextSource);
    setSourceAuthoritative(true);
    cacheCurrentEditorState();
  }

  async function createNamedSkill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newSkillName.trim();
    if (!name) {
      setToast("先填写 skill 名称");
      return;
    }
    if (backendStatus !== "connected") {
      setToast("后端未连接，暂时无法创建");
      return;
    }

    setBusy(true);
    try {
      await flushAutosaveNow();
      const result = await callBackend<CreateResult>("create_skill", {
        draft: {
          name,
          description: "",
          aliases: [],
          content: "",
          topRules: [],
          rules: [],
          commandTools: [],
        },
      });
      const id = skillIdFromFilePath(result.filePath);
      setCreateDialogOpen(false);
      setNewSkillName("");
      setToast(`已创建 ${id}`);
      await loadSkills(id);
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function openCreateSkillDialog() {
    if (backendStatus !== "connected") {
      setToast("后端未连接，先确认桌面窗口启动");
      return;
    }
    setNewSkillName("");
    setCreateDialogOpen(true);
  }

  function addTopRule() {
    void translateSelectedTopRule();
    setTopRulesLatest((current) => {
      const category =
        activeTopCategoryRef.current === TOP_ALL_CATEGORY ? "" : activeTopCategoryRef.current;
      const nextIndex = current.length;
      setSelectedRuleIndex(nextIndex);
      setActivePanelLatest("top");
      return [...current, { ...emptyTopRule(), category }];
    });
  }

  function addActiveRule() {
    if (activePanel === "identity") {
      return;
    }
    if (activePanel === "command") {
      addCommandTool();
    } else if (activePanel === "local") {
      addLocalRule();
    } else {
      addTopRule();
    }
  }

  function updateTopRule(index: number, value: Partial<TopRuleKnowledge>) {
    setTopRulesLatest((current) =>
      current.map((rule, ruleIndex) => (ruleIndex === index ? { ...rule, ...value } : rule)),
    );
  }

  function translateTopRule(index: number, force = false): Promise<void> {
    const skillId = currentSelectedSkill()?.id;
    const rule = topRulesRef.current[index];
    const sourceText = rule ? topRuleDisplayContent(rule).trim() : "";
    if (!skillId || !rule || !sourceText || backendStatus !== "connected") {
      if (force) {
        setToast(sourceText ? "后端未连接" : "先填写中文内容");
      }
      return Promise.resolve();
    }
    if (!force && rule.content.trim()) {
      return Promise.resolve();
    }

    const ruleId = rule.clientId ?? createClientId("top");
    if (!rule.clientId) {
      updateTopRule(index, { clientId: ruleId });
    }
    const key = translationTaskKey(skillId, ruleId);
    const version = (translationVersionsRef.current.get(key) ?? 0) + 1;
    translationVersionsRef.current.set(key, version);

    let task!: Promise<void>;
    task = (async () => {
      try {
        const result = await callBackend<TranslationResult>("translate_rule", { text: sourceText });
        const translatedText = result.translatedText.trim();
        if (!translatedText) {
          throw new Error("Codex 没有返回英文译文");
        }
        if (
          translationVersionsRef.current.get(key) !== version ||
          currentSelectedSkill()?.id !== skillId
        ) {
          return;
        }
        const currentIndex = topRulesRef.current.findIndex(
          (currentRule) => currentRule.clientId === ruleId,
        );
        const currentRule = topRulesRef.current[currentIndex];
        if (!currentRule || topRuleDisplayContent(currentRule).trim() !== sourceText) {
          return;
        }
        setTopRulesLatest((current) =>
          current.map((item) =>
            item.clientId === ruleId
              ? { ...item, displayContent: sourceText, content: translatedText }
              : item,
          ),
        );
        setSaveStatus("保存中");
      } catch (error) {
        if (currentSelectedSkill()?.id === skillId) {
          setSaveStatus("翻译失败");
          setToast(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (translationPromisesRef.current.get(key) === task) {
          translationPromisesRef.current.delete(key);
        }
        setTranslationActivityCount(translationPromisesRef.current.size);
      }
    })();

    translationPromisesRef.current.set(key, task);
    setTranslationActivityCount(translationPromisesRef.current.size);
    setSaveStatus(`翻译中 ${translationPromisesRef.current.size}`);
    return task;
  }

  function translateSelectedTopRule(force = false) {
    if (activePanelRef.current !== "top") {
      return Promise.resolve();
    }
    return translateTopRule(selectedRuleIndexForEditor, force);
  }

  async function waitForSkillTranslations(skillId: string) {
    const prefix = `${skillId}:`;
    const pending = [...translationPromisesRef.current.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, promise]) => promise);
    if (pending.length) {
      await Promise.allSettled(pending);
    }
  }

  function removeTopRule(index: number) {
    setTopRulesLatest((current) => {
      const next = current.length === 1
        ? [emptyTopRule()]
        : current.filter((_, ruleIndex) => ruleIndex !== index);
      const nextVisibleIndices = visibleTopRuleIndices(next, activeTopCategoryRef.current);
      setSelectedRuleIndex(nextVisibleIndices[0] ?? Math.max(0, Math.min(index, next.length - 1)));
      return next;
    });
  }

  function createTopCategory() {
    void translateSelectedTopRule();
    const nextCategory = nextCategoryName(topRuleCategoriesRef.current);
    setTopRuleCategoriesLatest([...topRuleCategoriesRef.current, nextCategory]);
    setActiveTopCategoryLatest(nextCategory);
    setSelectedRuleIndex(0);
    setActivePanelLatest("top");
  }

  function selectTopCategory(category: string) {
    void translateSelectedTopRule();
    setActiveTopCategoryLatest(category);
    const visibleIndices = visibleTopRuleIndices(topRulesRef.current, category);
    if (visibleIndices.length) {
      setSelectedRuleIndex(visibleIndices[0]);
    }
    setActivePanelLatest("top");
  }

  function deleteTopCategory(category: string) {
    setTopRuleCategoriesLatest(topRuleCategoriesRef.current.filter((item) => item !== category));
    setTopRulesLatest((current) =>
      current.map((rule) => normalizeCategory(rule.category) === category ? { ...rule, category: "" } : rule),
    );
    if (activeTopCategoryRef.current === category) {
      setActiveTopCategoryLatest(TOP_ALL_CATEGORY);
      setSelectedRuleIndex(0);
    }
  }

  function addLocalRule() {
    setLocalRulesLatest((current) => {
      const category =
        activeLocalCategoryRef.current === LOCAL_ALL_CATEGORY
          ? ""
          : activeLocalCategoryRef.current;
      const nextRule = { ...emptyLocalRule(), category };
      const nextIndex = current.length;
      setSelectedLocalRuleIndex(nextIndex);
      setActivePanelLatest("local");
      return [...current, nextRule];
    });
  }

  function updateLocalRule(index: number, value: Partial<LocalRule>) {
    setLocalRulesLatest((current) =>
      current.map((rule, ruleIndex) => (ruleIndex === index ? { ...rule, ...value } : rule)),
    );
  }

  function removeLocalRule(index: number) {
    setLocalRulesLatest((current) => {
      const next = current.length === 1
        ? [emptyLocalRule()]
        : current.filter((_, ruleIndex) => ruleIndex !== index);
      const nextVisibleIndices = visibleLocalRuleIndices(next, activeLocalCategoryRef.current);
      const nextSelectedIndex = nextVisibleIndices[0] ?? Math.max(0, Math.min(index, next.length - 1));
      setSelectedLocalRuleIndex(nextSelectedIndex);
      return next;
    });
  }

  async function translateSelectedLocalRule() {
    const rule = localRulesRef.current[selectedLocalRuleIndexForEditor];
    const values = rule
      ? [...rule.ruleTriggers, ...rule.ruleLimitLinks]
          .map((value) => value.displayContent.trim())
          .filter(Boolean)
      : [];
    if (!rule || !values.length || backendStatus !== "connected") {
      setToast(values.length ? "后端未连接" : "先填写触发或限制条件");
      return;
    }
    setTranslationActivityCount((count) => count + 1);
    try {
      const translated = new Map<string, string>();
      for (const sourceText of [...new Set(values)]) {
        const result = await callBackend<TranslationResult>("translate_rule", { text: sourceText });
        translated.set(sourceText, result.translatedText.trim());
      }
      updateLocalRule(selectedLocalRuleIndexForEditor, {
        ruleTriggers: rule.ruleTriggers.map((trigger) => ({
          ...trigger,
          content: translated.get(trigger.displayContent.trim()) ?? trigger.content,
        })),
        ruleLimitLinks: rule.ruleLimitLinks.map((limit) => ({
          ...limit,
          content: translated.get(limit.displayContent.trim()) ?? limit.content,
        })),
      });
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    } finally {
      setTranslationActivityCount((count) => Math.max(0, count - 1));
    }
  }

  function addRuleTrigger(ruleIndex: number) {
    const triggerId = createClientId("rule-trigger");
    const routeId = createClientId("rule-route");
    setLocalRulesLatest((current) => current.map((rule, index) => index === ruleIndex ? {
      ...rule,
      ruleTriggers: [...rule.ruleTriggers, { clientId: triggerId, displayContent: "", content: "" }],
      ruleTriggerRoutes: [...rule.ruleTriggerRoutes, { clientId: routeId, triggerId, matchMode: "all" }],
    } : rule));
  }

  function updateRuleTrigger(ruleIndex: number, triggerId: string, displayContent: string) {
    setLocalRulesLatest((current) => current.map((rule, index) => index === ruleIndex ? {
      ...rule,
      ruleTriggers: rule.ruleTriggers.map((trigger) => trigger.clientId === triggerId
        ? { ...trigger, displayContent, content: "" }
        : trigger),
    } : rule));
  }

  function removeRuleTrigger(ruleIndex: number, triggerId: string) {
    setLocalRulesLatest((current) => current.map((rule, index) => {
      if (index !== ruleIndex || rule.ruleTriggers.length === 1) return rule;
      return {
        ...rule,
        ruleTriggers: rule.ruleTriggers.filter((trigger) => trigger.clientId !== triggerId),
        ruleTriggerRoutes: rule.ruleTriggerRoutes.filter((route) => route.triggerId !== triggerId),
        ruleLimitLinks: rule.ruleLimitLinks.filter((limit) => limit.triggerId !== triggerId),
      };
    }));
  }

  function addRuleTriggerRoute(ruleIndex: number, triggerId?: string) {
    setLocalRulesLatest((current) => current.map((rule, index) => {
      if (index !== ruleIndex) return rule;
      return {
        ...rule,
        ruleTriggerRoutes: [...rule.ruleTriggerRoutes, {
          clientId: createClientId("rule-route"),
          triggerId: triggerId ?? rule.ruleTriggers[0].clientId,
          matchMode: "all",
        }],
      };
    }));
  }

  function updateRuleTriggerRoute(ruleIndex: number, routeId: string, value: Partial<RuleTriggerRoute>) {
    setLocalRulesLatest((current) => current.map((rule, index) => {
      if (index !== ruleIndex) return rule;
      const currentRoute = rule.ruleTriggerRoutes.find((route) => route.clientId === routeId);
      let routes = rule.ruleTriggerRoutes;
      if (
        currentRoute && value.triggerId && value.triggerId !== currentRoute.triggerId &&
        routes.filter((route) => route.triggerId === currentRoute.triggerId).length === 1
      ) {
        routes = [...routes, {
          clientId: createClientId("rule-route"),
          triggerId: currentRoute.triggerId,
          matchMode: "all",
        }];
      }
      return {
        ...rule,
        ruleTriggerRoutes: routes.map((route) => route.clientId === routeId ? { ...route, ...value } : route),
        ruleLimitLinks: value.triggerId
          ? rule.ruleLimitLinks.map((limit) => limit.routeId === routeId ? { ...limit, triggerId: value.triggerId! } : limit)
          : rule.ruleLimitLinks,
      };
    }));
  }

  function removeRuleTriggerRoute(ruleIndex: number, routeId: string) {
    setLocalRulesLatest((current) => current.map((rule, index) => {
      if (index !== ruleIndex) return rule;
      const target = rule.ruleTriggerRoutes.find((route) => route.clientId === routeId);
      if (!target || rule.ruleTriggerRoutes.filter((route) => route.triggerId === target.triggerId).length === 1) return rule;
      return {
        ...rule,
        ruleTriggerRoutes: rule.ruleTriggerRoutes.filter((route) => route.clientId !== routeId),
        ruleLimitLinks: rule.ruleLimitLinks.filter((limit) => limit.routeId !== routeId),
      };
    }));
  }

  function addRuleLimit(ruleIndex: number) {
    setLocalRulesLatest((current) => current.map((rule, index) => {
      if (index !== ruleIndex) return rule;
      const route = rule.ruleTriggerRoutes[0];
      return {
        ...rule,
        ruleLimitLinks: [...rule.ruleLimitLinks, {
          clientId: createClientId("rule-limit"),
          displayContent: "",
          content: "",
          triggerId: route.triggerId,
          routeId: route.clientId,
        }],
      };
    }));
  }

  function updateRuleLimit(ruleIndex: number, limitId: string, value: Partial<RuleLimitLink>) {
    setLocalRulesLatest((current) => current.map((rule, index) => index === ruleIndex ? {
      ...rule,
      ruleLimitLinks: rule.ruleLimitLinks.map((limit) => limit.clientId === limitId ? { ...limit, ...value } : limit),
    } : rule));
  }

  function removeRuleLimit(ruleIndex: number, limitId: string) {
    setLocalRulesLatest((current) => current.map((rule, index) => {
      if (index !== ruleIndex) return rule;
      return { ...rule, ruleLimitLinks: rule.ruleLimitLinks.filter((limit) => limit.clientId !== limitId) };
    }));
  }

  function createLocalCategory() {
    const nextCategory = nextLocalCategoryName(localRuleCategoriesRef.current);
    setLocalRuleCategoriesLatest([...localRuleCategoriesRef.current, nextCategory]);
    setActiveLocalCategoryLatest(nextCategory);
    setSelectedLocalRuleIndex(0);
    setActivePanelLatest("local");
  }

  function deleteLocalCategory(category: string) {
    setLocalRuleCategoriesLatest(localRuleCategoriesRef.current.filter((item) => item !== category));
    setLocalRulesLatest((current) =>
      current.map((rule) => normalizeCategory(rule.category) === category ? { ...rule, category: "" } : rule),
    );
    if (activeLocalCategoryRef.current === category) {
      setActiveLocalCategoryLatest(LOCAL_ALL_CATEGORY);
      setSelectedLocalRuleIndex(0);
    }
  }

  function beginCategoryPress(panel: "top" | "local", index: number, category: string) {
    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      const originalOrder = panel === "top" ? [...topCategoryOptions] : [...localCategoryOptions];
      const next = { panel, index, category, originalOrder };
      categoryDragStateRef.current = next;
      setCategoryDragState(next);
      suppressClickRef.current = true;
    }, 360);
  }

  function hoverCategory(panel: "top" | "local", targetIndex: number) {
    const current = categoryDragStateRef.current;
    if (!current || current.panel !== panel || current.index === targetIndex) return;
    const categories = panel === "top" ? [...topCategoryOptions] : [...localCategoryOptions];
    const from = categories.indexOf(current.category);
    if (from < 0) return;
    const before = captureSortableRects(categoryStripRef.current);
    const [moved] = categories.splice(from, 1);
    categories.splice(targetIndex, 0, moved);
    panel === "top" ? setTopRuleCategoriesLatest(categories) : setLocalRuleCategoriesLatest(categories);
    const next = { ...current, index: targetIndex };
    categoryDragStateRef.current = next;
    setCategoryDragState(next);
    window.requestAnimationFrame(() => animateSortableRects(categoryStripRef.current, before));
  }

  function finishCategoryPress() {
    clearLongPressTimer();
    if (categoryDragStateRef.current) {
      categoryDragStateRef.current = null;
      setCategoryDragState(null);
      window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    }
  }

  function cancelCategoryDrag() {
    clearLongPressTimer();
    const current = categoryDragStateRef.current;
    if (!current) return;
    current.panel === "top"
      ? setTopRuleCategoriesLatest(current.originalOrder)
      : setLocalRuleCategoriesLatest(current.originalOrder);
    categoryDragStateRef.current = null;
    setCategoryDragState(null);
    window.setTimeout(() => { suppressClickRef.current = false; }, 0);
  }

  function selectLocalCategory(category: string) {
    setActiveLocalCategoryLatest(category);
    const visibleIndices = visibleLocalRuleIndices(localRulesRef.current, category);
    if (visibleIndices.length) {
      setSelectedLocalRuleIndex(visibleIndices[0]);
    }
    setActivePanelLatest("local");
  }

  function addCommandTool() {
    setCommandToolsLatest((current) => {
      setSelectedCommandToolIndex(current.length);
      setActivePanelLatest("command");
      return [...current, emptyCommandTool()];
    });
  }

  function updateCommandTool(index: number, value: Partial<CommandTool>) {
    setCommandToolsLatest((current) =>
      current.map((tool, toolIndex) => (toolIndex === index ? { ...tool, ...value } : tool)),
    );
  }

  function removeCommandTool(index: number) {
    setCommandToolsLatest((current) => {
      const next = current.length === 1
        ? [emptyCommandTool()]
        : current.filter((_, toolIndex) => toolIndex !== index);
      setSelectedCommandToolIndex(
        Math.max(0, Math.min(selectedCommandToolIndex, next.length - 1)),
      );
      return next;
    });
  }

  function clearLongPressTimer() {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function clearAutosaveTimer() {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  }


  async function flushAutosaveNow() {
    const queued = pendingAutosaveRef.current;
    const pending = queued?.revision === editRevisionRef.current
      ? queued
      : pendingAutosaveFromCurrentDraft();
    if (!pending || backendStatus !== "connected") {
      return;
    }

    clearAutosaveTimer();
    pendingAutosaveRef.current = null;
    const operation = autosaveChainRef.current.then(async () => {
      try {
        const result = await callBackend<CreateResult>("update_skill", {
          id: pending.id,
          draft: pending.draft,
        });
        const current = currentSelectedSkill();
        const revisionIsCurrent = pending.revision === editRevisionRef.current;
        if (current?.id === pending.id) {
          if (revisionIsCurrent) {
            storeEditorDraftCache(pending.id, result.content, {
              skillName: skillNameRef.current,
              skillDescription: skillDescriptionRef.current,
              skillAliases: skillAliasesRef.current,
              sourceMarkdown: pending.draft.sourceMarkdown ?? result.content,
              sourceAuthoritative: sourceAuthoritativeRef.current,
              topRules: topRulesRef.current,
              localRules: localRulesRef.current,
              commandTools: commandToolsRef.current,
              topRuleCategories: topRuleCategoriesRef.current,
              localRuleCategories: localRuleCategoriesRef.current,
              activePanel: activePanelRef.current,
              activeTopCategory: activeTopCategoryRef.current,
              activeLocalCategory: activeLocalCategoryRef.current,
            });
          }
          lastSavedContentRef.current = normalizeRenderedContent(result.content);
          if (revisionIsCurrent) {
            sourceMarkdownRef.current = result.content;
            setSourceMarkdown(result.content);
            setSaveStatus("已自动保存");
          } else {
            setSaveStatus("仍有未保存修改");
          }
        }
        setSelected((currentSkill) =>
          currentSkill && currentSkill.id === pending.id
            ? (selectedRef.current = {
                ...currentSkill,
                name: pending.draft.name,
                description: pending.draft.description,
                filePath: result.filePath,
                content: result.content,
              })
            : currentSkill,
        );
        setSkills((current) =>
          current.map((skill) =>
            skill.id === pending.id
              ? { ...skill, name: pending.draft.name, description: pending.draft.description }
              : skill,
          ),
        );
      } catch (error) {
        setSaveStatus("保存失败");
        setToast(error instanceof Error ? error.message : String(error));
      }
    });
    autosaveChainRef.current = operation;
    await operation;
  }

  function pendingAutosaveFromCurrentDraft(): PendingAutosave | null {
    const current = currentSelectedSkill();
    if (!current || !isEditableSkill(current)) {
      return null;
    }
    if (hasPendingTopRuleTranslation(topRulesRef.current)) {
      return null;
    }

    const latestDraft = currentDraftFromEditorState();
    const nextContent = renderDraft(latestDraft);
    if (normalizeRenderedContent(nextContent) === lastSavedContentRef.current) {
      return null;
    }

    return { id: current.id, draft: latestDraft, revision: editRevisionRef.current };
  }

  function cacheCurrentEditorState() {
    const current = currentSelectedSkill();
    if (!current || !isEditableSkill(current)) {
      return;
    }

    storeEditorDraftCache(current.id, current.content, {
      skillName: skillNameRef.current,
      skillDescription: skillDescriptionRef.current,
      skillAliases: skillAliasesRef.current,
      sourceMarkdown: sourceMarkdownRef.current,
      sourceAuthoritative: sourceAuthoritativeRef.current,
      topRules: topRulesRef.current,
      localRules: localRulesRef.current,
      commandTools: commandToolsRef.current,
      topRuleCategories: topRuleCategoriesRef.current,
      localRuleCategories: localRuleCategoriesRef.current,
      activePanel: activePanelRef.current,
      activeTopCategory: activeTopCategoryRef.current,
      activeLocalCategory: activeLocalCategoryRef.current,
    });
  }

  function currentDraftFromEditorState() {
    const latest = buildDraft(
      topRulesRef.current,
      localRulesRef.current,
      commandToolsRef.current,
      currentSelectedSkill(),
      {
        name: skillNameRef.current,
        description: skillDescriptionRef.current,
        aliases: skillAliasesRef.current,
      },
      sourceMarkdownRef.current,
      sourceAuthoritativeRef.current,
    );
    return { ...latest, sourceMarkdown: renderDraft(latest) };
  }

  function currentSelectedSkill() {
    return selectedRef.current;
  }

  function setDragState(next: DragState | null) {
    dragStateRef.current = next;
    setDragStateValue(next);
  }

  function beginRulePress(panel: SortablePanel, index: number) {
    clearLongPressTimer();
    suppressClickRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
      suppressClickRef.current = true;
      selectSortableRule(panel, index);
      const originalOrder = sortableOrder(panel);
      setDragState({
        panel,
        index,
        draggedId: originalOrder[index] ?? "",
        originalOrder,
      });
    }, 360);
  }

  function finishRulePress() {
    clearLongPressTimer();
    if (dragStateRef.current) {
      setDragState(null);
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
  }

  function cancelRuleDrag() {
    clearLongPressTimer();
    const current = dragStateRef.current;
    if (!current) {
      return;
    }
    animateRuleGridReorder(() => {
      if (current.panel === "top") {
        const restored = restoreSortableOrder(topRulesRef.current, current.originalOrder);
        setTopRulesLatest(restored);
        setSelectedRuleIndex(Math.max(0, restored.findIndex((rule) => rule.clientId === current.draggedId)));
      } else if (current.panel === "local") {
        const restored = restoreSortableOrder(localRulesRef.current, current.originalOrder);
        setLocalRulesLatest(restored);
        setSelectedLocalRuleIndex(Math.max(0, restored.findIndex((rule) => rule.clientId === current.draggedId)));
      } else {
        const restored = restoreSortableOrder(commandToolsRef.current, current.originalOrder);
        setCommandToolsLatest(restored);
        setSelectedCommandToolIndex(Math.max(0, restored.findIndex((tool) => tool.clientId === current.draggedId)));
      }
      setDragState(null);
    });
    suppressClickRef.current = false;
  }

  function handleRuleClick(panel: SortablePanel, index: number) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    selectSortableRule(panel, index);
  }

  function selectSortableRule(panel: SortablePanel, index: number) {
    if (
      activePanelRef.current === "top" &&
      (panel !== "top" || index !== selectedRuleIndexForEditor)
    ) {
      void translateSelectedTopRule();
    }
    setActivePanelLatest(panel);
    if (panel === "top") {
      setSelectedRuleIndex(index);
    } else if (panel === "local") {
      setSelectedLocalRuleIndex(index);
    } else {
      setSelectedCommandToolIndex(index);
    }
  }

  function hoverSortableRule(panel: SortablePanel, index: number) {
    const current = dragStateRef.current;
    if (!current || current.panel !== panel || current.index === index) {
      return;
    }

    animateRuleGridReorder(() => {
      if (panel === "top") {
        setTopRulesLatest((rules) => moveItem(rules, current.index, index));
        setSelectedRuleIndex(index);
      } else if (panel === "local") {
        setLocalRulesLatest((rules) => moveItem(rules, current.index, index));
        setSelectedLocalRuleIndex(index);
      } else {
        setCommandToolsLatest((tools) => moveItem(tools, current.index, index));
        setSelectedCommandToolIndex(index);
      }
      setDragState({ ...current, index });
    });
  }

  function sortableOrder(panel: SortablePanel) {
    const items = panel === "top"
      ? topRulesRef.current
      : panel === "local"
        ? localRulesRef.current
        : commandToolsRef.current;
    return items.map((item, index) => item.clientId ?? `${panel}-${index}`);
  }

  function animateRuleGridReorder(update: () => void) {
    const grid = ruleGridRef.current;
    const before = captureSortableRects(grid);
    flushSync(update);
    animateSortableRects(grid, before);
  }

  function updateCondition(
    ruleIndex: number,
    kind: "triggerConditions" | "limitConditions",
    conditionIndex: number,
    value: Partial<RuleCondition>,
  ) {
    setLocalRulesLatest((current) =>
      current.map((rule, index) => {
        if (index !== ruleIndex) {
          return rule;
        }
        return {
          ...rule,
          [kind]: rule[kind].map((condition, nextIndex) =>
            nextIndex === conditionIndex ? { ...condition, ...value } : condition,
          ),
        };
      }),
    );
  }

  function addCondition(ruleIndex: number, kind: "triggerConditions" | "limitConditions") {
    setLocalRulesLatest((current) =>
      current.map((rule, index) =>
        index === ruleIndex ? { ...rule, [kind]: [...rule[kind], emptyCondition()] } : rule,
      ),
    );
  }

  function removeCondition(
    ruleIndex: number,
    kind: "triggerConditions" | "limitConditions",
    conditionIndex: number,
  ) {
    setLocalRulesLatest((current) =>
      current.map((rule, index) => {
        if (index !== ruleIndex) {
          return rule;
        }
        const next = rule[kind].length === 1
          ? [emptyCondition()]
          : rule[kind].filter((_, nextIndex) => nextIndex !== conditionIndex);
        return { ...rule, [kind]: next };
      }),
    );
  }

  function updateRoute(ruleIndex: number, routeIndex: number, value: Partial<RuleRoute>) {
    setLocalRulesLatest((current) =>
      current.map((rule, index) => {
        if (index !== ruleIndex) {
          return rule;
        }
        return {
          ...rule,
          routes: rule.routes.map((route, nextIndex) =>
            nextIndex === routeIndex ? { ...route, ...value } : route,
          ),
        };
      }),
    );
  }

  function updateRouteResult(
    ruleIndex: number,
    routeIndex: number,
    value: Partial<RuleResult>,
  ) {
    setLocalRulesLatest((current) =>
      current.map((rule, index) => {
        if (index !== ruleIndex) {
          return rule;
        }
        return {
          ...rule,
          routes: rule.routes.map((route, nextIndex) =>
            nextIndex === routeIndex
              ? { ...route, result: { ...route.result, ...value } }
              : route,
          ),
        };
      }),
    );
  }

  function addRoute(ruleIndex: number) {
    setLocalRulesLatest((current) =>
      current.map((rule, index) =>
        index === ruleIndex ? { ...rule, routes: [...rule.routes, emptyRoute()] } : rule,
      ),
    );
  }

  function removeRoute(ruleIndex: number, routeIndex: number) {
    setLocalRulesLatest((current) =>
      current.map((rule, index) => {
        if (index !== ruleIndex) {
          return rule;
        }
        const next = rule.routes.length === 1
          ? [emptyRoute()]
          : rule.routes.filter((_, nextIndex) => nextIndex !== routeIndex);
        return { ...rule, routes: next };
      }),
    );
  }

  function updateRouteCondition(
    ruleIndex: number,
    routeIndex: number,
    conditionIndex: number,
    value: Partial<RuleCondition>,
  ) {
    setLocalRulesLatest((current) =>
      current.map((rule, index) => index !== ruleIndex
        ? rule
        : {
            ...rule,
            routes: rule.routes.map((route, nextRouteIndex) => nextRouteIndex !== routeIndex
              ? route
              : {
                  ...route,
                  conditions: route.conditions.map((condition, nextConditionIndex) =>
                    nextConditionIndex === conditionIndex
                      ? { ...condition, ...value }
                      : condition,
                  ),
                }),
          }),
    );
  }

  function addRouteCondition(ruleIndex: number, routeIndex: number) {
    setLocalRulesLatest((current) =>
      current.map((rule, index) => index !== ruleIndex
        ? rule
        : {
            ...rule,
            routes: rule.routes.map((route, nextRouteIndex) =>
              nextRouteIndex === routeIndex
                ? { ...route, conditions: [...route.conditions, emptyCondition()] }
                : route,
            ),
          }),
    );
  }

  function removeRouteCondition(
    ruleIndex: number,
    routeIndex: number,
    conditionIndex: number,
  ) {
    setLocalRulesLatest((current) =>
      current.map((rule, index) => index !== ruleIndex
        ? rule
        : {
            ...rule,
            routes: rule.routes.map((route, nextRouteIndex) => {
              if (nextRouteIndex !== routeIndex) return route;
              return {
                ...route,
                conditions: route.conditions.length === 1
                  ? [emptyCondition()]
                  : route.conditions.filter((_, nextConditionIndex) =>
                      nextConditionIndex !== conditionIndex
                    ),
              };
            }),
          }),
    );
  }

  function updateFlowStep(
    ruleIndex: number,
    routeIndex: number,
    stepIndex: number,
    value: string,
  ) {
    setLocalRulesLatest((current) =>
      current.map((rule, index) => {
        if (index !== ruleIndex) {
          return rule;
        }
        return {
          ...rule,
          routes: rule.routes.map((route, nextIndex) => {
            if (nextIndex !== routeIndex) {
              return route;
            }
            return {
              ...route,
              result: {
                ...route.result,
                steps: route.result.steps.map((step, nextStepIndex) =>
                  nextStepIndex === stepIndex ? value : step,
                ),
              },
            };
          }),
        };
      }),
    );
  }

  function addFlowStep(ruleIndex: number, routeIndex: number) {
    setLocalRulesLatest((current) =>
      current.map((rule, index) => {
        if (index !== ruleIndex) {
          return rule;
        }
        return {
          ...rule,
          routes: rule.routes.map((route, nextIndex) =>
            nextIndex === routeIndex
              ? {
                  ...route,
                  result: { ...route.result, steps: [...route.result.steps, ""] },
                }
              : route,
          ),
        };
      }),
    );
  }

  function removeFlowStep(ruleIndex: number, routeIndex: number, stepIndex: number) {
    setLocalRulesLatest((current) =>
      current.map((rule, index) => {
        if (index !== ruleIndex) {
          return rule;
        }
        return {
          ...rule,
          routes: rule.routes.map((route, nextIndex) => {
            if (nextIndex !== routeIndex) {
              return route;
            }
            const nextSteps = route.result.steps.length === 1
              ? [""]
              : route.result.steps.filter((_, nextStepIndex) => nextStepIndex !== stepIndex);
            return {
              ...route,
              result: { ...route.result, steps: nextSteps },
            };
          }),
        };
      }),
    );
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <aside className="skill-list">
          <div className="list-head">
            <span>Skill 工程</span>
            <div className="list-head-actions">
              <span className="skill-count">{skills.length}</span>
              <span className={`backend-pill ${backendStatus}`}>
                {backendStatus === "connected" ? "后台已连" : backendStatus === "connecting" ? "后台连接中" : "后台未连"}
              </span>
              <a
                className={`settings-button library-nav-button ${activePage === "library" ? "is-active" : ""}`}
                href="#library"
                aria-label="打开 Codex 技能库"
                title="Codex 技能库"
                onClick={openSkillLibrary}
              >
                库
              </a>
              <a
                className={`settings-button ai-nav-button ${activePage === "ai" ? "is-active" : ""}`}
                href="#ai"
                aria-label="打开 AI Skill 工作台"
                title="AI Skill 工作台"
                onClick={() => setActivePage("ai")}
              >
                AI
              </a>
              <a
                className={`settings-button ${activePage === "settings" ? "is-active" : ""}`}
                href="#settings"
                aria-label="设置"
                title="设置"
                onPointerDown={(event) => event.stopPropagation()}
                onPointerUp={() => setActivePage("settings")}
                onClick={() => setActivePage("settings")}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 8.25a3.75 3.75 0 1 0 0 7.5 3.75 3.75 0 0 0 0-7.5Z" />
                  <path d="M19.1 13.4a7.5 7.5 0 0 0 .05-1.4l1.55-1.2-1.75-3.03-1.84.74a7.6 7.6 0 0 0-1.22-.7L15.6 5.85h-3.5l-.3 1.96c-.43.2-.84.44-1.21.7l-1.84-.74L7 10.8 8.55 12a7.5 7.5 0 0 0 .05 1.4l-1.55 1.2 1.75 3.03 1.84-.74c.37.27.78.5 1.21.7l.3 1.96h3.5l.3-1.96c.43-.2.84-.43 1.21-.7l1.84.74 1.75-3.03-1.65-1.2Z" />
                </svg>
              </a>
            </div>
          </div>
          <div className="list-scroll">
            {skills.length === 0 ? (
              <div className="project-empty">暂无工程目录</div>
            ) : null}
            {skills.map((skill) => (
              <div className="skill-swipe-row" key={skill.id}>
                <button
                  className={`skill-row ${skill.id === selectedId ? "is-active" : ""} ${revealedSkillId === skill.id ? "is-revealed" : ""}`}
                  type="button"
                  style={skillSwipeOffset?.id === skill.id ? { transform: `translateX(${skillSwipeOffset.value}px)`, transition: "none" } : undefined}
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    skillSwipeRef.current = {
                      id: skill.id,
                      startX: event.clientX,
                      startOffset: revealedSkillId === skill.id ? -66 : 0,
                    };
                  }}
                  onPointerMove={(event) => {
                    const swipe = skillSwipeRef.current;
                    if (!swipe || swipe.id !== skill.id) return;
                    const value = Math.max(-66, Math.min(0, swipe.startOffset + event.clientX - swipe.startX));
                    setSkillSwipeOffset({ id: skill.id, value });
                  }}
                  onPointerUp={(event) => {
                    const swipe = skillSwipeRef.current;
                    skillSwipeRef.current = null;
                    if (!swipe || swipe.id !== skill.id) return;
                    const delta = event.clientX - swipe.startX;
                    const finalOffset = Math.max(-66, Math.min(0, swipe.startOffset + delta));
                    setSkillSwipeOffset(null);
                    if (finalOffset < -33) setRevealedSkillId(skill.id);
                    else setRevealedSkillId("");
                    if (Math.abs(delta) < 5 && revealedSkillId !== skill.id) void selectSkill(skill.id);
                  }}
                  onPointerCancel={() => { skillSwipeRef.current = null; setSkillSwipeOffset(null); }}
                >
                  <span>{projectDirectoryName(skill)}</span>
                  <small>{skill.description || skill.name || skill.id}</small>
                </button>
                <button
                  className="skill-swipe-delete"
                  type="button"
                  disabled={busy}
                  onClick={() => setDeleteSkillCandidate(skill)}
                >
                  删除
                </button>
              </div>
            ))}
          </div>
          <button
            className="skill-create-button"
            type="button"
            aria-label="创建 skill"
            title="创建 skill"
            onClick={openCreateSkillDialog}
          >
            +
          </button>
        </aside>

        {activePage === "library" ? (
          <SkillLibrary
            catalog={codexSkillCatalog}
            busy={libraryBusy}
            error={libraryError}
            onRefresh={loadCodexSkillCatalog}
            onImport={importCodexSkills}
            onOpenImported={(id) => void selectSkill(id)}
            onClose={() => {
              setActivePage("editor");
              window.location.hash = "#editor";
            }}
          />
        ) : activePage === "settings" ? (
          <section className="settings-page">
            <div className="settings-head">
              <div>
                <strong>设置</strong>
                <span>Skill Creator</span>
              </div>
              <a className="ghost-button" href="#editor" onClick={() => setActivePage("editor")}>
                返回编辑
              </a>
            </div>
            <div className="settings-body">
              <section className="settings-section codex-status-section">
                <div className="settings-section-head">
                  <strong>本地 Codex</strong>
                  <span className={codexStatus?.connected ? "status-ok" : "status-warn"}>
                    {codexStatus?.connected ? "已连接" : "未连接"}
                  </span>
                </div>
                <div className="model-settings" aria-busy={busy}>
                  <div className="setting-row model-row">
                    <div className="setting-label">
                      <strong>翻译模型</strong>
                      <small>来自当前 Codex 账号</small>
                    </div>
                    <div className="model-choice-list" role="radiogroup" aria-label="翻译模型">
                      {codexStatus?.availableModels.map((model) => (
                        <button
                          className={model.slug === codexStatus.model ? "is-selected" : ""}
                          type="button"
                          role="radio"
                          aria-checked={model.slug === codexStatus.model}
                          disabled={busy}
                          key={model.slug}
                          onClick={() => {
                            const effort = model.reasoningLevels.includes(codexStatus.reasoningEffort)
                              ? codexStatus.reasoningEffort
                              : model.reasoningLevels.includes("medium") ? "medium" : model.reasoningLevels[0];
                            void changeCodexPreferences(model.slug, effort, model.supportsFast && codexStatus.fastMode);
                          }}
                        >
                          <span>{model.displayName}</span>
                          {model.supportsFast ? <small>Fast</small> : null}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="setting-row">
                    <div className="setting-label">
                      <strong>思考程度</strong>
                      <small>控制翻译前的推理深度</small>
                    </div>
                    <div className="effort-selector" role="radiogroup" aria-label="思考程度">
                      {selectedCodexModel?.reasoningLevels.map((effort) => (
                        <button
                          className={effort === codexStatus?.reasoningEffort ? "is-selected" : ""}
                          type="button"
                          role="radio"
                          aria-checked={effort === codexStatus?.reasoningEffort}
                          disabled={busy}
                          key={effort}
                          onClick={() => void changeCodexPreferences(codexStatus!.model, effort, codexStatus!.fastMode)}
                        >
                          {reasoningEffortLabel(effort)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="setting-row">
                    <div className="setting-label">
                      <strong>Fast</strong>
                      <small>{selectedCodexModel?.supportsFast ? "1.5× 响应速度，增加用量" : "当前模型不支持"}</small>
                    </div>
                    <button
                      className={`fast-switch ${codexStatus?.fastMode ? "is-on" : ""}`}
                      type="button"
                      role="switch"
                      aria-checked={codexStatus?.fastMode ?? false}
                      disabled={busy || !selectedCodexModel?.supportsFast}
                      onClick={() => void changeCodexPreferences(
                        codexStatus!.model,
                        codexStatus!.reasoningEffort,
                        !codexStatus!.fastMode,
                      )}
                    >
                      <span />
                    </button>
                  </div>
                </div>
              </section>
            </div>
          </section>
        ) : activePage === "advanced" && selected ? (
          <AdvancedSkillStudio
            source={previewText}
            name={skillName || selected.name}
            onSourceChange={setSourceMarkdownLatest}
            onClose={() => {
              setActivePage("editor");
              window.location.hash = "#editor";
            }}
            onOpenAi={() => {
              setActivePage("ai");
              window.location.hash = "#ai";
            }}
            contractPreset={advancedPreset}
            workflowPreset={advancedPreset}
          />
        ) : activePage === "ai" ? (
          <AiSkillStudio
            selectedSkill={selected ? {
              id: selected.id,
              name: skillName || selected.name,
              description: skillDescription || selected.description,
              filePath: selected.filePath,
              content: previewText,
            } : null}
            currentSource={previewText}
            backendStatus={backendStatus}
            modelStatus={codexStatus}
            onCallDesign={requestAiSkillDesign}
            onApplyProposal={applyAiSkillProposal}
            onClose={() => {
              setActivePage("editor");
              window.location.hash = "#editor";
            }}
          />
        ) : selected ? (
        <section className="editor-pane">
          <section className="editor-surface">
            <div className="editor-head">
              <div>
                <strong>编辑</strong>
                <span>
                  {skillName || selected.name || "未命名"}
                  {saveStatus ? ` · ${saveStatus}` : ""}
                </span>
              </div>
              <div className="editor-actions">
                <button
                  className="bamboo-button"
                  type="button"
                  onClick={() => {
                    setActivePage("advanced");
                    window.location.hash = "#advanced";
                  }}
                >
                  详细设计
                </button>
                <button
                  className="ghost-button ai-action-button"
                  type="button"
                  onClick={() => {
                    setActivePage("ai");
                    window.location.hash = "#ai";
                  }}
                >
                  AI 修改
                </button>
                <button
                  className="ghost-button graph-action-button"
                  type="button"
                  onClick={() => openPreview("graph")}
                >
                  规则关系图
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => openPreview("sample")}
                >
                  预览样本
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => openPreview("body")}
                >
                  预览本体
                </button>
              </div>
            </div>

            <div className="editor-body single">
              <div className="rule-type-strip" role="tablist" aria-label="编辑内容切换">
                <button
                  className={`top-rule-selector ${activePanel === "identity" ? "is-selected" : ""}`}
                  type="button"
                  role="tab"
                  aria-selected={activePanel === "identity"}
                  onClick={() => switchActivePanel("identity")}
                >
                  <span>本体信息</span>
                </button>
                <button
                  className={`top-rule-selector ${activePanel === "top" ? "is-selected" : ""}`}
                  type="button"
                  role="tab"
                  aria-selected={activePanel === "top"}
                  onClick={() => switchActivePanel("top")}
                >
                  <span>顶部规则</span>
                  <small>{topRules.length}</small>
                </button>
                <button
                  className={`top-rule-selector ${activePanel === "local" ? "is-selected" : ""}`}
                  type="button"
                  role="tab"
                  aria-selected={activePanel === "local"}
                  onClick={() => switchActivePanel("local")}
                >
                  <span>局部规则</span>
                  <small>{localRules.length}</small>
                </button>
                <button
                  className={`top-rule-selector ${activePanel === "command" ? "is-selected" : ""}`}
                  type="button"
                  role="tab"
                  aria-selected={activePanel === "command"}
                  onClick={() => switchActivePanel("command")}
                >
                  <span>纯命令</span>
                  <small>{commandTools.length}</small>
                </button>
              </div>
              <section className="middle-rule-list">
                <div className="middle-rule-list-head">
                  <span>
                    {activePanel === "identity"
                      ? "技能本体"
                      : activePanel === "top"
                      ? "顶部规则列表"
                      : activePanel === "local"
                        ? "局部规则列表"
                        : "命令工具列表"}
                  </span>
                  <div className="middle-rule-list-head-actions">
                    {activePanel !== "identity" ? <small>{currentRuleCount} 条</small> : null}
                    {activePanel === "top" ? (
                      <button
                        className="top-category-add-button"
                        type="button"
                        aria-label="创建顶部规则分类"
                        title="创建分类"
                        onClick={createTopCategory}
                      >
                        +
                      </button>
                    ) : null}
                  </div>
                </div>
                {activePanel === "top" ? (
                  <div className="local-category-strip" aria-label="顶部规则分类" ref={categoryStripRef}>
                    <button
                      className={safeActiveTopCategory === TOP_ALL_CATEGORY ? "is-active" : ""}
                      type="button"
                      onClick={() => selectTopCategory(TOP_ALL_CATEGORY)}
                    >
                      <span>全部</span>
                      <small>{topRules.length}</small>
                    </button>
                    {topCategoryOptions.map((category) => {
                      const count = topRules.filter(
                        (rule) => normalizeCategory(rule.category) === category,
                      ).length;
                      return (
                        <div
                          className={`category-item ${categoryDragState?.panel === "top" && categoryDragState.category === category ? "is-dragging" : ""}`}
                          key={`top-category-${category}`}
                          data-sort-key={`top-category-${category}`}
                          onPointerEnter={() => hoverCategory("top", topCategoryOptions.indexOf(category))}
                        >
                        <button
                          className={safeActiveTopCategory === category ? "is-active" : ""}
                          type="button"
                          onClick={() => { if (!suppressClickRef.current) selectTopCategory(category); }}
                          onPointerDown={() => beginCategoryPress("top", topCategoryOptions.indexOf(category), category)}
                          onPointerUp={finishCategoryPress}
                          onPointerCancel={cancelCategoryDrag}
                        >
                          <span>{category}</span>
                          <small>{count}</small>
                        </button>
                        <button
                          className="category-remove-button"
                          type="button"
                          aria-label={`删除分类 ${category}`}
                          title="删除分类"
                          onClick={() => deleteTopCategory(category)}
                        >
                          ×
                        </button>
                        </div>
                      );
                    })}
                  </div>
                ) : activePanel === "local" ? (
                  <div className="local-category-strip" aria-label="局部规则分类" ref={categoryStripRef}>
                    <button
                      className={safeActiveLocalCategory === LOCAL_ALL_CATEGORY ? "is-active" : ""}
                      type="button"
                      onClick={() => selectLocalCategory(LOCAL_ALL_CATEGORY)}
                    >
                      <span>全部</span>
                      <small>{localRules.length}</small>
                    </button>
                    {localCategoryOptions.map((category) => {
                      const count = localRules.filter(
                        (rule) => normalizeCategory(rule.category) === category,
                      ).length;
                      return (
                        <div
                          className={`category-item ${categoryDragState?.panel === "local" && categoryDragState.category === category ? "is-dragging" : ""}`}
                          key={`local-category-${category}`}
                          data-sort-key={`local-category-${category}`}
                          onPointerEnter={() => hoverCategory("local", localCategoryOptions.indexOf(category))}
                        >
                        <button
                          className={safeActiveLocalCategory === category ? "is-active" : ""}
                          type="button"
                          onClick={() => { if (!suppressClickRef.current) selectLocalCategory(category); }}
                          onPointerDown={() => beginCategoryPress("local", localCategoryOptions.indexOf(category), category)}
                          onPointerUp={finishCategoryPress}
                          onPointerCancel={cancelCategoryDrag}
                        >
                          <span>{category}</span>
                          <small>{count}</small>
                        </button>
                        <button
                          className="category-remove-button"
                          type="button"
                          aria-label={`删除分类 ${category}`}
                          title="删除分类"
                          onClick={() => deleteLocalCategory(category)}
                        >
                          ×
                        </button>
                        </div>
                      );
                    })}
                    <button
                      className="local-category-add"
                      type="button"
                      onClick={createLocalCategory}
                    >
                      新分类
                    </button>
                  </div>
                ) : null}
                <div
                  className={`middle-rule-scroll ${activePanel === "identity" ? "is-identity" : ""}`}
                  ref={ruleGridRef}
                  onPointerLeave={cancelRuleDrag}
                >
                  {activePanel === "identity" ? (
                    <div className="identity-overview">
                      <div>
                        <span>名称</span>
                        <strong>{skillName || "未命名"}</strong>
                      </div>
                      <div>
                        <span>描述</span>
                        <strong>{skillDescription || "未填写"}</strong>
                      </div>
                    </div>
                  ) : activePanel === "top"
                    ? topVisibleEntries.map(({ rule, index }) => {
                        return (
                        <button
                          className={`middle-rule-row ${
                            index === selectedRuleIndex ? "is-active" : ""
                          } ${
                            dragState?.panel === "top" && dragState.index === index
                              ? "is-dragging"
                              : ""
                          }`}
                          key={rule.clientId ?? `top-list-${index}`}
                          data-sort-key={rule.clientId}
                          type="button"
                          onClick={() => handleRuleClick("top", index)}
                          onPointerDown={() => beginRulePress("top", index)}
                          onPointerEnter={() => hoverSortableRule("top", index)}
                          onPointerLeave={clearLongPressTimer}
                          onPointerUp={finishRulePress}
                          onPointerCancel={cancelRuleDrag}
                        >
                          <span>{rule.name || `#${index + 1}`}</span>
                          <small>
                            长按拖动排序 · {rule.ruleType ?? "规则"} · {topRuleDisplayContent(rule) || "未填写内容"}
                          </small>
                        </button>
                        );
                      })
                    : activePanel === "local"
                      ? localVisibleEntries.map(({ rule, index }) => {
                        const firstTrigger = rule.triggerConditions.find(
                          (condition) => condition.alias || condition.content,
                        );
                        const firstLimit = rule.limitConditions.find(
                          (condition) => condition.alias || condition.content,
                        );
                        return (
                          <button
                            className={`middle-rule-row ${
                              index === selectedLocalRuleIndex ? "is-active" : ""
                            } ${
                              dragState?.panel === "local" && dragState.index === index
                                ? "is-dragging"
                                : ""
                            }`}
                            key={rule.clientId ?? `local-list-${index}`}
                            data-sort-key={rule.clientId}
                            type="button"
                            onClick={() => handleRuleClick("local", index)}
                            onPointerDown={() => beginRulePress("local", index)}
                            onPointerEnter={() => hoverSortableRule("local", index)}
                            onPointerLeave={clearLongPressTimer}
                            onPointerUp={finishRulePress}
                            onPointerCancel={cancelRuleDrag}
                          >
                            <span>{rule.name || `#${index + 1}`}</span>
                            <small>
                              长按拖动排序 · {(rule.editorType ?? "rule") === "rule"
                                ? `规则 · ${rule.ruleTriggers.find((trigger) => trigger.displayContent || trigger.content)?.displayContent || rule.ruleTriggers.find((trigger) => trigger.content)?.content || "未填写触发"}`
                                : firstTrigger?.alias ||
                                firstTrigger?.content ||
                                firstLimit?.alias ||
                                firstLimit?.content ||
                                `${rule.routes.length} 条路线`}
                            </small>
                          </button>
                        );
                      })
                      : commandTools.map((tool, index) => {
                          return (
                          <button
                            className={`middle-rule-row ${
                              index === selectedCommandToolIndex ? "is-active" : ""
                            } ${
                              dragState?.panel === "command" && dragState.index === index
                                ? "is-dragging"
                                : ""
                            }`}
                            key={tool.clientId ?? `command-list-${index}`}
                            data-sort-key={tool.clientId}
                            type="button"
                            onClick={() => handleRuleClick("command", index)}
                            onPointerDown={() => beginRulePress("command", index)}
                            onPointerEnter={() => hoverSortableRule("command", index)}
                            onPointerLeave={clearLongPressTimer}
                            onPointerUp={finishRulePress}
                            onPointerCancel={cancelRuleDrag}
                          >
                            <span>{tool.name || tool.alias || `#${index + 1}`}</span>
                            <small>长按拖动排序 · {tool.command || tool.usage || "未填写命令"}</small>
                          </button>
                          );
                        })}
                </div>
                {activePanel !== "identity" ? (
                  <button className="middle-add-button" type="button" onClick={addActiveRule}>
                    +
                  </button>
                ) : null}
              </section>
            </div>
          </section>

          <aside className="category-panel">
            {activePanel === "identity" ? (
              <>
                <div className="category-head">
                  <div className="category-title">
                    <span>本体信息</span>
                    <strong>{skillName || selected.id}</strong>
                  </div>
                </div>
                <div className="detail-editor-card identity-editor-card rule-line is-selected">
                  <label className="top-rule-field">
                    <span>技能名称</span>
                    <input
                      className="paper-input"
                      value={skillName}
                      onChange={(event) => updateSkillIdentity({ name: event.target.value })}
                    />
                  </label>
                  <label className="top-rule-field">
                    <span>技能描述</span>
                    <textarea
                      className="paper-textarea identity-description"
                      value={skillDescription}
                      onChange={(event) => updateSkillIdentity({ description: event.target.value })}
                    />
                  </label>
                  <label className="top-rule-field">
                    <span>多语言别名</span>
                    <textarea
                      className="paper-textarea short"
                      value={skillAliases.join("\n")}
                      placeholder="每行一个别名"
                      onChange={(event) => updateSkillIdentity({ aliases: parseAliasInput(event.target.value) })}
                    />
                  </label>
                </div>
              </>
            ) : activePanel === "top" ? (
              selectedRuleEntry ? (
              <>
                <div className="category-head">
                  <div className="category-title">
                    <span>顶部规则</span>
                    <strong>{selectedRule.name || `#${selectedRuleIndexForEditor + 1}`}</strong>
                  </div>
                  <button
                    className="category-delete-button"
                    type="button"
                    onClick={() => removeTopRule(selectedRuleIndexForEditor)}
                  >
                    删除
                  </button>
                </div>
                <div className="detail-editor-card local-rule-card rule-line is-selected">
                  <label className="top-rule-field">
                    <span>规则名</span>
                    <input
                      className="paper-input"
                      value={selectedRule.name}
                      onChange={(event) =>
                        updateTopRule(selectedRuleIndexForEditor, { name: event.target.value })
                      }
                    />
                  </label>
                  <label className="top-rule-field">
                    <span>类型</span>
                    <select
                      value={selectedRule.ruleType ?? "规则"}
                      onChange={(event) =>
                        updateTopRule(selectedRuleIndexForEditor, {
                          ruleType: event.target.value as TopRuleType,
                        })
                      }
                    >
                      <option value="规则">规则</option>
                      <option value="流程">流程</option>
                    </select>
                  </label>
                  <label className="top-rule-field">
                    <span>分类</span>
                    <input
                      className="paper-input"
                      value={selectedRule.category}
                      placeholder="例如：Motion / Verification"
                      onChange={(event) =>
                        updateTopRule(selectedRuleIndexForEditor, { category: event.target.value })
                      }
                    />
                  </label>
                  <label className="boolean-field">
                    <input
                      type="checkbox"
                      checked={selectedRule.writeName}
                      onChange={(event) =>
                        updateTopRule(selectedRuleIndexForEditor, { writeName: event.target.checked })
                      }
                    />
                    <span>将规则名写入 SKILL.md</span>
                  </label>
                  <label className="top-rule-field">
                    <span>中文内容</span>
                    <textarea
                      className="paper-textarea actual"
                      value={selectedRuleDisplayContent}
                      onChange={(event) =>
                        updateTopRule(selectedRuleIndexForEditor, {
                          displayContent: event.target.value,
                          content: "",
                        })
                      }
                    />
                  </label>
                  <button
                    className="translate-confirm-button"
                    type="button"
                    disabled={isTranslationPending(
                      translationPromisesRef.current,
                      selected.id,
                      selectedRule.clientId,
                    )}
                    onClick={() => void translateSelectedTopRule(true)}
                  >
                    {isTranslationPending(
                      translationPromisesRef.current,
                      selected.id,
                      selectedRule.clientId,
                    )
                      ? "翻译中"
                      : "确认"}
                  </button>
                </div>
              </>
              ) : (
              <>
                <div className="category-head">
                  <div className="category-title">
                    <span>顶部规则</span>
                    <strong>
                      {safeActiveTopCategory === TOP_ALL_CATEGORY ? "全部" : safeActiveTopCategory}
                    </strong>
                  </div>
                </div>
                <div className="local-category-empty">
                  <span>当前分类暂无顶部规则</span>
                  <button type="button" onClick={addTopRule}>添加顶部规则</button>
                </div>
              </>
              )
            ) : activePanel === "local" ? (
              selectedLocalEntry ? (
              <>
                <div className="category-head">
                  <div className="category-title">
                    <span>局部规则分类</span>
                    <strong>{selectedLocalRule.name || `局部规则 ${selectedLocalRuleIndexForEditor + 1}`}</strong>
                  </div>
                  <button
                    className="category-delete-button"
                    type="button"
                    onClick={() => removeLocalRule(selectedLocalRuleIndexForEditor)}
                  >
                    删除
                  </button>
                </div>
                <div className="detail-editor-card local-rule-card rule-line is-selected">
                  <label className="top-rule-field">
                    <span>规则名</span>
                    <input className="paper-input" value={selectedLocalRule.name} onChange={(event) => updateLocalRule(selectedLocalRuleIndexForEditor, { name: event.target.value })} />
                  </label>
                  <label className="top-rule-field">
                    <span>类型</span>
                    <select value={selectedLocalRule.editorType ?? "rule"} onChange={(event) => updateLocalRule(selectedLocalRuleIndexForEditor, { editorType: event.target.value as "rule" | "route" })}>
                      <option value="rule">规则</option>
                      <option value="route">路线</option>
                    </select>
                  </label>
                  <label className="top-rule-field">
                    <span>分类</span>
                    <input
                      className="paper-input"
                      value={selectedLocalRule.category}
                      placeholder="例如：协作 / 门禁 / 平台"
                      onChange={(event) =>
                        updateLocalRule(selectedLocalRuleIndexForEditor, { category: event.target.value })
                      }
                    />
                  </label>
                  {(selectedLocalRule.editorType ?? "rule") === "rule" ? (
                    <div className="structured-rule-editor">
                      <div className="rule-section-title">
                        <span>触发</span>
                        <button type="button" aria-label="添加触发" onClick={() => addRuleTrigger(selectedLocalRuleIndexForEditor)}>+</button>
                      </div>
                      {selectedLocalRule.ruleTriggers.map((trigger, triggerIndex) => (
                        <div className="structured-rule-row" key={trigger.clientId}>
                          <span className="rule-row-index">{triggerIndex + 1}</span>
                          <input
                            className="paper-input"
                            aria-label={`触发 ${triggerIndex + 1}`}
                            placeholder="触发内容"
                            value={trigger.displayContent}
                            onChange={(event) => updateRuleTrigger(selectedLocalRuleIndexForEditor, trigger.clientId, event.target.value)}
                          />
                          <button
                            className="row-remove-button"
                            type="button"
                            aria-label={`删除触发 ${triggerIndex + 1}`}
                            disabled={selectedLocalRule.ruleTriggers.length === 1}
                            onClick={() => removeRuleTrigger(selectedLocalRuleIndexForEditor, trigger.clientId)}
                          >×</button>
                        </div>
                      ))}

                      <div className="rule-section-title">
                        <span>触发路线</span>
                        <button type="button" aria-label="添加触发路线" onClick={() => addRuleTriggerRoute(selectedLocalRuleIndexForEditor)}>+</button>
                      </div>
                      {selectedLocalRule.ruleTriggerRoutes.map((route, routeIndex) => (
                        <div className="trigger-route-row" key={route.clientId}>
                          <span className="rule-row-index">{routeIndex + 1}</span>
                          <select
                            aria-label={`路线 ${routeIndex + 1} 的触发`}
                            value={route.triggerId}
                            onChange={(event) => updateRuleTriggerRoute(selectedLocalRuleIndexForEditor, route.clientId, { triggerId: event.target.value })}
                          >
                            {selectedLocalRule.ruleTriggers.map((trigger, triggerIndex) => (
                              <option key={trigger.clientId} value={trigger.clientId}>触发 {triggerIndex + 1}</option>
                            ))}
                          </select>
                          <select
                            aria-label={`路线 ${routeIndex + 1} 类型`}
                            value={route.matchMode}
                            onChange={(event) => updateRuleTriggerRoute(selectedLocalRuleIndexForEditor, route.clientId, { matchMode: event.target.value as RuleMatchMode })}
                          >
                            <option value="all">同时</option>
                            <option value="any">任意</option>
                          </select>
                          <button
                            className="row-remove-button"
                            type="button"
                            aria-label={`删除触发路线 ${routeIndex + 1}`}
                            disabled={selectedLocalRule.ruleTriggerRoutes.filter((item) => item.triggerId === route.triggerId).length === 1}
                            onClick={() => removeRuleTriggerRoute(selectedLocalRuleIndexForEditor, route.clientId)}
                          >×</button>
                        </div>
                      ))}

                      <div className="rule-section-title">
                        <span>限制条件</span>
                        <button type="button" aria-label="添加限制条件" onClick={() => addRuleLimit(selectedLocalRuleIndexForEditor)}>+</button>
                      </div>
                      {selectedLocalRule.ruleLimitLinks.map((limit, limitIndex) => {
                        const routes = selectedLocalRule.ruleTriggerRoutes.filter((route) => route.triggerId === limit.triggerId);
                        return (
                          <div className="limit-link-row" key={limit.clientId}>
                            <span className="rule-row-index">{limitIndex + 1}</span>
                            <input
                              className="paper-input"
                              aria-label={`限制条件 ${limitIndex + 1}`}
                              placeholder="限制条件"
                              value={limit.displayContent}
                              onChange={(event) => updateRuleLimit(selectedLocalRuleIndexForEditor, limit.clientId, { displayContent: event.target.value, content: "" })}
                            />
                            <select
                              aria-label={`限制条件 ${limitIndex + 1} 的触发`}
                              value={limit.triggerId}
                              onChange={(event) => {
                                const triggerId = event.target.value;
                                const routeId = selectedLocalRule.ruleTriggerRoutes.find((route) => route.triggerId === triggerId)?.clientId ?? "";
                                updateRuleLimit(selectedLocalRuleIndexForEditor, limit.clientId, { triggerId, routeId });
                              }}
                            >
                              {selectedLocalRule.ruleTriggers.map((trigger, triggerIndex) => (
                                <option key={trigger.clientId} value={trigger.clientId}>触发 {triggerIndex + 1}</option>
                              ))}
                            </select>
                            <select
                              aria-label={`限制条件 ${limitIndex + 1} 的路线`}
                              value={limit.routeId}
                              onChange={(event) => updateRuleLimit(selectedLocalRuleIndexForEditor, limit.clientId, { routeId: event.target.value })}
                            >
                              {routes.map((route) => {
                                const routeIndex = selectedLocalRule.ruleTriggerRoutes.indexOf(route);
                                return <option key={route.clientId} value={route.clientId}>路线 {routeIndex + 1}</option>;
                              })}
                            </select>
                            <button
                              className="row-remove-button"
                              type="button"
                              aria-label={`删除限制条件 ${limitIndex + 1}`}
                              onClick={() => removeRuleLimit(selectedLocalRuleIndexForEditor, limit.clientId)}
                            >×</button>
                          </div>
                        );
                      })}
                      <button className="translate-confirm-button" type="button" disabled={translationActivityCount > 0} onClick={() => void translateSelectedLocalRule()}>
                        {translationActivityCount > 0 ? "翻译中" : "确认"}
                      </button>
                    </div>
                  ) : (
                    <>
                  <div className="rule-section-title">
                    <span>触发条件</span>
                    <button
                      type="button"
                      onClick={() => addCondition(selectedLocalRuleIndexForEditor, "triggerConditions")}
                    >
                      +
                    </button>
                  </div>
                  {selectedLocalRule.triggerConditions.map((condition, conditionIndex) => (
                    <div
                      className="condition-pair"
                      key={`trigger-${selectedLocalRuleIndexForEditor}-${conditionIndex}`}
                    >
                      <input
                        className="paper-input"
                        placeholder="触发条件别名"
                        value={condition.alias}
                        onChange={(event) =>
                          updateCondition(
                            selectedLocalRuleIndexForEditor,
                            "triggerConditions",
                            conditionIndex,
                            { alias: event.target.value },
                          )
                        }
                      />
                      <input
                        className="paper-input"
                        placeholder="触发条件英文实际"
                        value={condition.content}
                        onChange={(event) =>
                          updateCondition(
                            selectedLocalRuleIndexForEditor,
                            "triggerConditions",
                            conditionIndex,
                            { content: event.target.value },
                          )
                        }
                      />
                      <button
                        type="button"
                        onClick={() =>
                          removeCondition(
                            selectedLocalRuleIndexForEditor,
                            "triggerConditions",
                            conditionIndex,
                          )
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}

                  <div className="rule-section-title">
                    <span>限制条件</span>
                    <button
                      type="button"
                      onClick={() => addCondition(selectedLocalRuleIndexForEditor, "limitConditions")}
                    >
                      +
                    </button>
                  </div>
                  {selectedLocalRule.limitConditions.map((condition, conditionIndex) => (
                    <div
                      className="condition-pair"
                      key={`limit-${selectedLocalRuleIndexForEditor}-${conditionIndex}`}
                    >
                      <input
                        className="paper-input"
                        placeholder="限制条件别名"
                        value={condition.alias}
                        onChange={(event) =>
                          updateCondition(
                            selectedLocalRuleIndexForEditor,
                            "limitConditions",
                            conditionIndex,
                            { alias: event.target.value },
                          )
                        }
                      />
                      <input
                        className="paper-input"
                        placeholder="限制条件英文实际"
                        value={condition.content}
                        onChange={(event) =>
                          updateCondition(
                            selectedLocalRuleIndexForEditor,
                            "limitConditions",
                            conditionIndex,
                            { content: event.target.value },
                          )
                        }
                      />
                      <button
                        type="button"
                        onClick={() =>
                          removeCondition(
                            selectedLocalRuleIndexForEditor,
                            "limitConditions",
                            conditionIndex,
                          )
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}

                  <div className="rule-section-title">
                    <span>路线 / 触发结果</span>
                    <button type="button" onClick={() => addRoute(selectedLocalRuleIndexForEditor)}>
                      +
                    </button>
                  </div>
                  {selectedLocalRule.routes.map((route, routeIndex) => (
                    <div className="route-card" key={`route-${selectedLocalRuleIndexForEditor}-${routeIndex}`}>
                      <div className="route-top">
                        <input
                          className="paper-input"
                          placeholder="路线"
                          value={route.route}
                          onChange={(event) =>
                            updateRoute(selectedLocalRuleIndexForEditor, routeIndex, {
                              route: event.target.value,
                            })
                          }
                        />
                        <select
                          value={route.result.kind}
                          onChange={(event) =>
                            updateRouteResult(selectedLocalRuleIndexForEditor, routeIndex, {
                              kind: event.target.value as RuleResultKind,
                            })
                          }
                        >
                          <option value="requirement">要求</option>
                          <option value="flow">流程</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => removeRoute(selectedLocalRuleIndexForEditor, routeIndex)}
                        >
                          ×
                        </button>
                      </div>

                      <div className="route-condition-head">
                        <span>分支判断</span>
                        <select
                          aria-label={`路线 ${routeIndex + 1} 的判断方式`}
                          value={route.matchMode}
                          onChange={(event) =>
                            updateRoute(selectedLocalRuleIndexForEditor, routeIndex, {
                              matchMode: event.target.value as RuleMatchMode,
                            })
                          }
                        >
                          <option value="all">ALL · 全部满足</option>
                          <option value="any">ANY · 任一满足</option>
                        </select>
                        <button
                          type="button"
                          aria-label={`为路线 ${routeIndex + 1} 添加分支条件`}
                          onClick={() =>
                            addRouteCondition(selectedLocalRuleIndexForEditor, routeIndex)
                          }
                        >
                          +
                        </button>
                      </div>
                      <div className="route-condition-list">
                        {route.conditions.map((condition, conditionIndex) => (
                          <div
                            className="condition-pair"
                            key={`${route.clientId}-condition-${conditionIndex}`}
                          >
                            <input
                              className="paper-input"
                              aria-label={`路线 ${routeIndex + 1} 条件 ${conditionIndex + 1} 别名`}
                              placeholder={`判断 ${conditionIndex + 1}，例如 if4`}
                              value={condition.alias}
                              onChange={(event) =>
                                updateRouteCondition(
                                  selectedLocalRuleIndexForEditor,
                                  routeIndex,
                                  conditionIndex,
                                  { alias: event.target.value },
                                )
                              }
                            />
                            <input
                              className="paper-input"
                              aria-label={`路线 ${routeIndex + 1} 条件 ${conditionIndex + 1} 实际规则`}
                              placeholder="实际条件，例如 context includes 4"
                              value={condition.content}
                              onChange={(event) =>
                                updateRouteCondition(
                                  selectedLocalRuleIndexForEditor,
                                  routeIndex,
                                  conditionIndex,
                                  { content: event.target.value },
                                )
                              }
                            />
                            <button
                              type="button"
                              aria-label={`删除路线 ${routeIndex + 1} 条件 ${conditionIndex + 1}`}
                              onClick={() =>
                                removeRouteCondition(
                                  selectedLocalRuleIndexForEditor,
                                  routeIndex,
                                  conditionIndex,
                                )
                              }
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>

                      {route.result.kind === "flow" ? (
                        <div className="flow-steps">
                          {route.result.steps.map((step, stepIndex) => (
                            <div
                              className="flow-step"
                              key={`step-${selectedLocalRuleIndexForEditor}-${routeIndex}-${stepIndex}`}
                            >
                              <input
                                className="paper-input"
                                placeholder={`步骤 ${stepIndex + 1}`}
                                value={step}
                                onChange={(event) =>
                                  updateFlowStep(
                                    selectedLocalRuleIndexForEditor,
                                    routeIndex,
                                    stepIndex,
                                    event.target.value,
                                  )
                                }
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  removeFlowStep(selectedLocalRuleIndexForEditor, routeIndex, stepIndex)
                                }
                              >
                                ×
                              </button>
                            </div>
                          ))}
                          <button
                            className="ghost-button compact"
                            type="button"
                            onClick={() => addFlowStep(selectedLocalRuleIndexForEditor, routeIndex)}
                          >
                            添加步骤
                          </button>
                        </div>
                      ) : (
                        <textarea
                          className="paper-textarea short"
                          placeholder="要求内容"
                          value={route.result.requirement}
                          onChange={(event) =>
                            updateRouteResult(selectedLocalRuleIndexForEditor, routeIndex, {
                              requirement: event.target.value,
                            })
                          }
                        />
                      )}
                    </div>
                  ))}
                    </>
                  )}
                </div>
              </>
              ) : (
              <>
                <div className="category-head">
                  <div className="category-title">
                    <span>局部规则分类</span>
                    <strong>
                      {safeActiveLocalCategory === LOCAL_ALL_CATEGORY ? "全部" : safeActiveLocalCategory}
                    </strong>
                  </div>
                </div>
                <div className="local-category-empty">
                  <span>当前分类暂无局部规则</span>
                  <button type="button" onClick={addLocalRule}>
                    添加局部规则
                  </button>
                </div>
              </>
              )
            ) : (
              <>
                <div className="category-head">
                  <div className="category-title">
                    <span>纯命令工具</span>
                    <strong>{selectedCommandTool.name || `命令工具 ${selectedCommandToolIndex + 1}`}</strong>
                  </div>
                  <button
                    className="category-delete-button"
                    type="button"
                    onClick={() => removeCommandTool(selectedCommandToolIndex)}
                  >
                    删除
                  </button>
                </div>
                <div className="detail-editor-card command-tool-card rule-line is-selected">
                  <div className="local-rule-head">
                    <span>{selectedCommandTool.name || `命令工具 ${selectedCommandToolIndex + 1}`}</span>
                    <button
                      type="button"
                      onClick={() => removeCommandTool(selectedCommandToolIndex)}
                    >
                      ×
                    </button>
                  </div>
                  <input
                    className="paper-input"
                    placeholder="工具名"
                    value={selectedCommandTool.name}
                    onChange={(event) =>
                      updateCommandTool(selectedCommandToolIndex, { name: event.target.value })
                    }
                  />
                  <input
                    className="paper-input"
                    placeholder="别名（用于看懂）"
                    value={selectedCommandTool.alias}
                    onChange={(event) =>
                      updateCommandTool(selectedCommandToolIndex, { alias: event.target.value })
                    }
                  />
                  <textarea
                    className="paper-textarea short"
                    placeholder="命令，例如：tool-name --json <args>"
                    value={selectedCommandTool.command}
                    onChange={(event) =>
                      updateCommandTool(selectedCommandToolIndex, { command: event.target.value })
                    }
                  />
                  <textarea
                    className="paper-textarea"
                    placeholder="用途 / 参数说明"
                    value={selectedCommandTool.usage}
                    onChange={(event) =>
                      updateCommandTool(selectedCommandToolIndex, { usage: event.target.value })
                    }
                  />
                </div>
              </>
            )}
          </aside>
        </section>
        ) : (
          <section className="empty-selection-page">
            <div className="empty-selection-panel">
              <strong>未选择 Skill 工程</strong>
              <span>从左侧选择一个工程后再编辑</span>
            </div>
          </section>
        )}
      </section>

      {previewOpen ? (
        <div
          className="dialog-layer"
          role="presentation"
          onClick={closePreview}
        >
          <section
            aria-label={previewKind === "graph" ? "规则关系图" : "技能本体预览"}
            className={`paper-dialog preview-dialog${previewKind === "graph" ? " preview-dialog--graph" : ""}`}
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="preview-dialog-head">
              <div>
                <strong>
                  {previewKind === "graph"
                    ? "规则关系图"
                    : previewKind === "sample"
                      ? "预览样本"
                      : "预览本体"}
                </strong>
                <span>{hasDraftRules ? draft.name : selected?.name || "未命名"}</span>
              </div>
              <button
                className="ghost-button"
                type="button"
                onClick={closePreview}
              >
                关闭
              </button>
            </div>
            {previewKind === "graph" ? (
              <RuleGraph
                data={ruleGraphData}
                selectedLocalRuleIndex={selectedLocalRuleIndexForEditor}
                onSelectLocalRule={(index) => {
                  setActiveLocalCategoryLatest(LOCAL_ALL_CATEGORY);
                  setSelectedLocalRuleIndex(index);
                  setActivePanelLatest("local");
                }}
              />
            ) : (
              <pre>{(previewKind === "sample" ? samplePreviewText : previewText) || "暂无可预览内容"}</pre>
            )}
          </section>
        </div>
      ) : null}

      {createDialogOpen ? (
        <div className="dialog-layer" role="presentation">
          <form className="paper-dialog skill-name-dialog" onSubmit={createNamedSkill}>
            <div className="dialog-title">
              <strong>创建 skill</strong>
              <span>输入名称后会创建标准 `skill-name/SKILL.md`。</span>
            </div>
            <input
              autoFocus
              className="paper-input"
              placeholder="skill 名称"
              value={newSkillName}
              onChange={(event) => setNewSkillName(event.target.value)}
            />
            <div className="dialog-actions">
              <button
                className="ghost-button"
                type="button"
                onClick={() => setCreateDialogOpen(false)}
              >
                取消
              </button>
              <button
                className="bamboo-button"
                type="submit"
                disabled={busy || !newSkillName.trim()}
              >
                {busy ? "创建中" : "确认创建"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {deleteSkillCandidate ? (
        <div className="dialog-layer" role="presentation">
          <section className="paper-dialog skill-name-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-skill-title">
            <div className="dialog-title">
              <strong id="delete-skill-title">删除这个技能？</strong>
              <span>“{projectDirectoryName(deleteSkillCandidate)}”删除后无法恢复。</span>
            </div>
            <div className="dialog-actions">
              <button className="ghost-button" type="button" onClick={() => setDeleteSkillCandidate(null)}>
                取消
              </button>
              <button
                className="danger-button"
                type="button"
                disabled={busy}
                onClick={() => {
                  const id = deleteSkillCandidate.id;
                  setDeleteSkillCandidate(null);
                  void deleteSkill(id);
                }}
              >
                {busy ? "删除中" : "确认删除"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {toast ? (
        <button className="toast" type="button" onClick={() => setToast("")}>
          {toast}
        </button>
      ) : null}
    </main>
  );
}

function buildDraft(
  topRules: TopRuleKnowledge[],
  localRules: LocalRule[],
  commandTools: CommandTool[],
  selected: SkillContent | null,
  identity?: { name: string; description: string; aliases: string[] },
  sourceMarkdown = "",
  sourceAuthoritative = false,
): SkillDraft {
  const cleanedRules = topRules
    .map((rule) => ({
      name: rule.name.trim(),
      writeName: rule.writeName,
      alias: rule.ruleType ?? "规则",
      category: rule.category.trim(),
      content: rule.content.trim(),
    }))
    .filter((rule) => rule.content);
  const cleanedLocalRules = localRules
    .map((rule) => {
      const editorType = rule.editorType ?? "rule";
      return {
        name: rule.name.trim(),
        category: rule.category.trim(),
        editorType,
        ruleTriggers: rule.ruleTriggers
          .map((trigger) => ({
            ...trigger,
            displayContent: trigger.displayContent.trim(),
            content: (trigger.content || trigger.displayContent).trim(),
          }))
          .filter((trigger) => trigger.content),
        ruleTriggerRoutes: rule.ruleTriggerRoutes,
        ruleLimitLinks: rule.ruleLimitLinks
          .map((limit) => ({
            ...limit,
            displayContent: limit.displayContent.trim(),
            content: (limit.content || limit.displayContent).trim(),
          }))
          .filter((limit) => limit.content),
        triggerConditions: cleanConditions(rule.triggerConditions),
        limitConditions: cleanConditions(rule.limitConditions),
        routes: rule.routes
          .map((route) => ({
            clientId: route.clientId,
            route: route.route.trim(),
            matchMode: route.matchMode,
            conditions: cleanConditions(route.conditions),
            result: {
              kind: route.result.kind,
              requirement: route.result.requirement.trim(),
              steps: route.result.steps.map((step) => step.trim()).filter(Boolean),
            },
          }))
          .filter((route) =>
            route.result.kind === "flow" ? route.result.steps.length > 0 : route.result.requirement,
          ),
      };
    })
    .filter(
      (rule) => rule.editorType === "rule"
        ? rule.ruleTriggers.length > 0 && rule.ruleLimitLinks.length > 0
        : rule.routes.length > 0 && (
          rule.triggerConditions.length > 0
          || rule.limitConditions.length > 0
          || rule.routes.some((route) => route.conditions.length > 0)
        ),
    );
  const cleanedCommandTools = commandTools
    .map((tool) => ({
      name: tool.name.trim(),
      alias: tool.alias.trim(),
      command: tool.command.trim(),
      usage: tool.usage.trim(),
    }))
    .filter((tool) => tool.command || tool.usage || tool.name);
  const resolvedName = identity?.name.trim() || selected?.name || "top-rules-skill";
  const resolvedDescription = identity
    ? identity.description.trim() || defaultSkillDescription(resolvedName)
    : selected?.description || defaultSkillDescription(resolvedName);
  return {
    name: resolvedName,
    description: resolvedDescription,
    aliases: identity?.aliases.map((alias) => alias.trim()).filter(Boolean) ?? [],
    content: markdownSectionWithBlanks(sourceMarkdown, "Content").join("\n").trim(),
    sourceMarkdown,
    sourceAuthoritative,
    topRules: cleanedRules,
    rules: cleanedLocalRules,
    commandTools: cleanedCommandTools,
  };
}

function createClientId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function ensureTopRuleClientIds(rules: TopRuleKnowledge[]) {
  return rules.map((rule) => ({
    ...rule,
    clientId: rule.clientId || createClientId("top"),
  }));
}

function ensureLocalRuleClientIds(rules: LocalRule[]) {
  return rules.map((rule) => {
    const fallback = emptyLocalRule();
    const ruleTriggers = rule.ruleTriggers?.length ? rule.ruleTriggers : fallback.ruleTriggers;
    const ruleTriggerRoutes = rule.ruleTriggerRoutes?.length
      ? rule.ruleTriggerRoutes
      : fallback.ruleTriggerRoutes.map((route) => ({ ...route, triggerId: ruleTriggers[0].clientId }));
    return {
      ...rule,
      clientId: rule.clientId || createClientId("local"),
      routes: (rule.routes?.length ? rule.routes : fallback.routes).map((route) => ({
        ...route,
        clientId: route.clientId || createClientId("flow-route"),
        matchMode: (route.matchMode === "any" ? "any" : "all") as RuleMatchMode,
        conditions: route.conditions?.length ? route.conditions : [emptyCondition()],
      })),
      ruleTriggers,
      ruleTriggerRoutes,
      ruleLimitLinks: rule.ruleLimitLinks?.length
        ? rule.ruleLimitLinks
        : fallback.ruleLimitLinks.map((limit) => ({
            ...limit,
            triggerId: ruleTriggers[0].clientId,
            routeId: ruleTriggerRoutes[0].clientId,
          })),
    };
  });
}

function ensureCommandToolClientIds(tools: CommandTool[]) {
  return tools.map((tool) => ({
    ...tool,
    clientId: tool.clientId || createClientId("command"),
  }));
}

function restoreSortableOrder<T extends { clientId?: string }>(items: T[], order: string[]) {
  const positions = new Map(order.map((id, index) => [id, index]));
  return [...items].sort((left, right) => {
    const leftIndex = left.clientId ? positions.get(left.clientId) : undefined;
    const rightIndex = right.clientId ? positions.get(right.clientId) : undefined;
    return (leftIndex ?? Number.MAX_SAFE_INTEGER) - (rightIndex ?? Number.MAX_SAFE_INTEGER);
  });
}

function captureSortableRects(grid: HTMLDivElement | null) {
  const rects = new Map<string, DOMRect>();
  grid?.querySelectorAll<HTMLElement>("[data-sort-key]").forEach((element) => {
    const key = element.dataset.sortKey;
    if (key) {
      rects.set(key, element.getBoundingClientRect());
    }
  });
  return rects;
}

function animateSortableRects(grid: HTMLDivElement | null, before: Map<string, DOMRect>) {
  if (!grid || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }
  grid.querySelectorAll<HTMLElement>("[data-sort-key]").forEach((element) => {
    const key = element.dataset.sortKey;
    const previous = key ? before.get(key) : undefined;
    if (!previous) {
      return;
    }
    const next = element.getBoundingClientRect();
    const deltaX = previous.left - next.left;
    const deltaY = previous.top - next.top;
    if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
      return;
    }
    const scale = element.classList.contains("is-dragging") ? " scale(1.045)" : "";
    element.animate(
      [
        { transform: `translate(${deltaX}px, ${deltaY}px)${scale}` },
        { transform: `translate(0, 0)${scale}` },
      ],
      { duration: 190, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  });
}

function translationTaskKey(skillId: string, ruleId: string) {
  return `${skillId}:${ruleId}`;
}

function isTranslationPending(
  tasks: Map<string, Promise<void>>,
  skillId: string,
  ruleId?: string,
) {
  return Boolean(ruleId && tasks.has(translationTaskKey(skillId, ruleId)));
}

function parseAliasInput(value: string) {
  return value
    .split(/[\n,，]/)
    .map((alias) => alias.trim())
    .filter((alias, index, aliases) => alias && aliases.indexOf(alias) === index);
}

function defaultSkillDescription(name: string) {
  return `Use when the user asks for the ${name} skill.`;
}

function reasoningEffortLabel(effort: string) {
  return ({ low: "低", medium: "中", high: "高", xhigh: "极高", max: "最大", ultra: "自动" } as Record<string, string>)[effort] ?? effort;
}

function topRuleDisplayContent(rule: TopRuleKnowledge) {
  return rule.displayContent ?? rule.content;
}

function normalizeRenderedContent(content: string) {
  return content.trimEnd();
}

function hasPendingTopRuleTranslation(topRules: TopRuleKnowledge[]) {
  return topRules.some(
    (rule) => Boolean(rule.displayContent?.trim()) && !Boolean(rule.content.trim()),
  );
}

function normalizeCategory(category: string) {
  return category.trim();
}

function mergeRuleCategories(
  categories: string[],
  rules: Array<{ category: string }>,
) {
  const merged: string[] = [];
  const add = (category: string) => {
    const normalized = normalizeCategory(category);
    if (normalized && !merged.includes(normalized)) {
      merged.push(normalized);
    }
  };
  categories.forEach(add);
  rules.forEach((rule) => add(rule.category));
  return merged;
}

function mergeLocalRuleCategories(categories: string[], localRules: LocalRule[]) {
  return mergeRuleCategories(categories, localRules);
}

function visibleTopRuleIndices(topRules: TopRuleKnowledge[], category: string) {
  return topRules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) =>
      category === TOP_ALL_CATEGORY ? true : normalizeCategory(rule.category) === category,
    )
    .map(({ index }) => index);
}

function visibleLocalRuleIndices(localRules: LocalRule[], category: string) {
  return localRules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) =>
      category === LOCAL_ALL_CATEGORY ? true : normalizeCategory(rule.category) === category,
    )
    .map(({ index }) => index);
}

function nextCategoryName(categories: string[]) {
  let index = categories.length + 1;
  let candidate = `分类 ${index}`;
  while (categories.includes(candidate)) {
    index += 1;
    candidate = `分类 ${index}`;
  }
  return candidate;
}

function nextLocalCategoryName(categories: string[]) {
  return nextCategoryName(categories);
}

function parseSkillContent(skill: SkillContent): SkillDraft {
  return {
    name: skill.name || skill.id || "top-rules-skill",
    description: skill.description || "",
    aliases: parseAliases(skill.content),
    content: markdownSection(skill.content, "Content").join("\n").trim(),
    sourceMarkdown: skill.content,
    topRules: parseTopRules(skill.content),
    rules: parseLocalRules(skill.content),
    commandTools: parseCommandTools(skill.content),
  };
}

function parseAliases(content: string) {
  return markdownSection(content, "Aliases")
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);
}

function parseTopRules(content: string): TopRuleKnowledge[] {
  return markdownSection(content, "顶部规则")
    .map((line) => line.replace(/^\d+[.、]\s*/, "").trim())
    .filter(Boolean)
    .map((line) => {
      const nameMatch = line.match(/^([^:：]{1,80})[:：]\s+(.+)$/);
      if (nameMatch) {
        return {
          ...emptyTopRule(),
          name: nameMatch[1].trim(),
          writeName: true,
          content: nameMatch[2].trim(),
        };
      }
      return {
        ...emptyTopRule(),
        content: line,
      };
    });
}

function parseLocalRules(content: string): LocalRule[] {
  const blocks: string[][] = [];
  let block: string[] = [];
  for (const rawLine of markdownSectionWithBlanks(content, "规则")) {
    const line = rawLine.replace(/^[-*]\s+/, "").trim();
    if (!line) {
      if (block.length) blocks.push(block);
      block = [];
    } else {
      block.push(line);
    }
  }
  if (block.length) blocks.push(block);
  const rules: LocalRule[] = [];
  for (const lines of blocks) {
    const structuredLines = lines.map((line) => line.match(/^若\s+(.+)\s+则\s+(.+)$/));
    if (structuredLines.every(Boolean)) {
      const structuredRule: LocalRule = {
        ...emptyLocalRule(),
        ruleTriggers: [],
        ruleTriggerRoutes: [],
        ruleLimitLinks: [],
      };
      rules.push(structuredRule);
      structuredLines.forEach((structured) => {
        const conditionText = structured![1].trim();
        const triggerContent = structured![2].trim();
        let trigger = structuredRule.ruleTriggers.find((item) => item.content === triggerContent);
        if (!trigger) {
          trigger = { clientId: createClientId("rule-trigger"), displayContent: triggerContent, content: triggerContent };
          structuredRule.ruleTriggers.push(trigger);
        }
        const matchMode: RuleMatchMode = conditionText.includes(" 或 ") ? "any" : "all";
        const route: RuleTriggerRoute = {
          clientId: createClientId("rule-route"),
          triggerId: trigger.clientId,
          matchMode,
        };
        structuredRule.ruleTriggerRoutes.push(route);
        const separator = matchMode === "any" ? " 或 " : " 且 ";
        conditionText.split(separator).map((value) => value.trim()).filter(Boolean).forEach((value) => {
          structuredRule.ruleLimitLinks.push({
            clientId: createClientId("rule-limit"),
            displayContent: value,
            content: value,
            triggerId: trigger!.clientId,
            routeId: route.clientId,
          });
        });
      });
    } else {
      const parsedLines = lines
        .map((line) => parseLocalRuleLine(line))
        .filter((rule): rule is LocalRule => Boolean(rule));
      const routeRules = parsedLines.filter((rule) => rule.editorType === "route");
      const sameRouteRuleBase = routeRules.length === parsedLines.length
        && routeRules.every((rule) => localRuleConditionKey(rule) === localRuleConditionKey(routeRules[0]));
      if (sameRouteRuleBase && routeRules.length > 0) {
        rules.push({
          ...routeRules[0],
          routes: routeRules.flatMap((rule) => rule.routes),
        });
      } else {
        rules.push(...parsedLines);
      }
    }
  }
  return rules;
}

function localRuleConditionKey(rule: LocalRule) {
  const contents = (conditions: RuleCondition[]) => conditions
    .map((condition) => condition.content.trim())
    .filter(Boolean);
  return JSON.stringify({
    triggerConditions: contents(rule.triggerConditions),
    limitConditions: contents(rule.limitConditions),
  });
}

function draftFromSourceMarkdown(source: string, fallback: SkillContent | null): SkillDraft {
  const name = frontmatterStringValue(source, "name") || fallback?.name || "ai-created-skill";
  const description = frontmatterStringValue(source, "description")
    || fallback?.description
    || defaultSkillDescription(name);
  const parsed = parseSkillContent({
    id: fallback?.id ?? name,
    name,
    description,
    filePath: fallback?.filePath ?? "SKILL.md",
    updatedAt: fallback?.updatedAt ?? 0,
    content: source,
  });
  return { ...parsed, name, description, sourceMarkdown: source, sourceAuthoritative: true };
}

function parseLocalRuleLine(line: string): LocalRule | null {
  const match = line.match(/^如果\s+(.+)\s+那么\s+(.+)$/);
  if (!match) {
    const rule = emptyLocalRule();
    rule.ruleTriggers[0] = {
      ...rule.ruleTriggers[0],
      displayContent: line,
      content: line,
    };
    return rule;
  }

  const rawConditionText = match[1].trim();
  const resultText = match[2].trim();
  let route = "";
  let routeMatchMode: RuleMatchMode = "all";
  let routeConditionText = "";
  const baseSegments: string[] = [];
  for (const segment of rawConditionText.split("，").map((value) => value.trim()).filter(Boolean)) {
    if (segment.startsWith("路线 ")) {
      route = segment.slice("路线 ".length).trim();
      continue;
    }
    const branch = segment.match(/^分支条件[（(](ALL|ANY)[）)]\s*(.*)$/i);
    if (branch) {
      routeMatchMode = branch[1].toLowerCase() === "any" ? "any" : "all";
      routeConditionText = branch[2].trim();
      continue;
    }
    baseSegments.push(segment);
  }
  let conditionText = baseSegments.join("，");

  let triggerText = conditionText;
  let limitText = "";
  const limitMarker = "，限制 ";
  const limitIndex = conditionText.indexOf(limitMarker);
  if (limitIndex >= 0) {
    triggerText = conditionText.slice(0, limitIndex).trim();
    limitText = conditionText.slice(limitIndex + limitMarker.length).trim();
  } else if (conditionText.startsWith("限制 ")) {
    triggerText = "";
    limitText = conditionText.slice("限制 ".length).trim();
  }

  return {
    ...emptyLocalRule(),
    editorType: "route",
    triggerConditions: parseConditionText(triggerText),
    limitConditions: parseConditionText(limitText),
    routes: [
      {
        clientId: createClientId("flow-route"),
        route,
        matchMode: routeMatchMode,
        conditions: parseBranchConditionText(routeConditionText, routeMatchMode),
        result: parseRuleResult(resultText),
      },
    ],
  };
}

function parseBranchConditionText(text: string, matchMode: RuleMatchMode) {
  const separator = matchMode === "any" ? " 或 " : " 且 ";
  const conditions = text
    .split(separator)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((content) => ({ alias: content, content }));
  return conditions.length ? conditions : [emptyCondition()];
}

function parseConditionText(text: string): RuleCondition[] {
  const conditions = text
    .split(" 并且 ")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((content) => ({ alias: content, content }));
  return conditions.length ? conditions : [emptyCondition()];
}

function parseRuleResult(text: string): RuleResult {
  if (text.includes("→")) {
    return {
      kind: "flow",
      requirement: "",
      steps: text.split("→").map((step) => step.trim()).filter(Boolean),
    };
  }
  return {
    kind: "requirement",
    requirement: text,
    steps: [""],
  };
}

function parseCommandTools(content: string): CommandTool[] {
  return markdownSection(content, "纯命令工具")
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean)
    .map((line) => {
      const commandMatch = line.match(/^(.+?):\s+`([^`]+)`(?:，用途：(.+))?$/);
      if (commandMatch) {
        return {
          name: commandMatch[1].trim(),
          alias: "",
          command: commandMatch[2].trim(),
          usage: commandMatch[3]?.trim() ?? "",
        };
      }

      const usageMatch = line.match(/^(.+?):\s+(.+)$/);
      if (usageMatch) {
        return {
          ...emptyCommandTool(),
          name: usageMatch[1].trim(),
          usage: usageMatch[2].trim(),
        };
      }

      return {
        ...emptyCommandTool(),
        usage: line,
      };
    });
}

function markdownSection(content: string, title: string) {
  return markdownSectionWithBlanks(content, title).filter(Boolean);
}

function markdownSectionWithBlanks(content: string, title: string) {
  const section = findSection(parseSkillDocument(content), title);
  if (!section) return [];
  const lines = section.body.split(/\r?\n/).map((line) => line.trim());
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines.at(-1)) lines.pop();
  return lines;
}

const MANAGED_SECTION_TITLES = ["Aliases", "Content", "顶部规则", "规则", "纯命令工具"] as const;

function renderDraft(draft: SkillDraft) {
  const structured = renderStructuredDraft(draft);
  if (!draft.sourceMarkdown?.trim()) {
    return structured;
  }

  if (draft.sourceAuthoritative) {
    return draft.sourceMarkdown;
  }

  let document = updateSkillDocumentFrontmatter(
    parseSkillDocument(draft.sourceMarkdown),
    { name: draft.name, description: draft.description },
  );
  const structuredDocument = parseSkillDocument(structured);
  MANAGED_SECTION_TITLES.forEach((title) => {
    const replacement = findSection(structuredDocument, title);
    document = replacement
      ? upsertSection(document, { title, body: replacement.body, rawBody: true })
      : removeSection(document, title);
  });
  return serializeSkillDocument(document);
}

function renderStructuredDraft(draft: SkillDraft) {
  const lines = [
    "---",
    `name: "${escapeText(draft.name)}"`,
    `description: "${escapeText(draft.description)}"`,
    "---",
    "",
    `# ${draft.name}`,
  ];

  if (draft.aliases.length) {
    lines.push("", "## Aliases");
    draft.aliases.forEach((alias) => lines.push(`- ${alias}`));
  }

  if (draft.topRules.length) {
    lines.push("", "## 顶部规则");
    draft.topRules.forEach((rule, index) => {
      const value = rule.writeName && rule.name ? `${rule.name}: ${rule.content}` : rule.content;
      lines.push(`${index + 1}. ${value}`);
    });
  }

  if (draft.rules.length) {
    lines.push("", "## 规则");
    const ruleGroups: string[][] = [];
    draft.rules.forEach((rule) => {
      const group: string[] = [];
      if ((rule.editorType ?? "route") === "rule") {
        rule.ruleTriggerRoutes.forEach((route) => {
          const trigger = rule.ruleTriggers.find((item) => item.clientId === route.triggerId);
          const limits = rule.ruleLimitLinks
            .filter((limit) => limit.routeId === route.clientId)
            .map((limit) => limit.content.trim())
            .filter(Boolean);
          if (!trigger?.content.trim() || !limits.length) return;
          const joiner = route.matchMode === "any" ? " 或 " : " 且 ";
          group.push(`- 若 ${limits.join(joiner)} 则 ${trigger.content.trim()}`);
        });
      } else {
        rule.routes.forEach((route) => {
          const result = renderResult(route.result);
          if (!result) return;
          const clauses: string[] = [];
          const conditionText = renderConditionText(rule);
          if (conditionText) clauses.push(conditionText);
          if (route.route.trim()) clauses.push(`路线 ${route.route.trim()}`);
          const routeConditions = route.conditions
            .map((condition) => condition.content.trim())
            .filter(Boolean);
          if (routeConditions.length) {
            const mode = route.matchMode === "any" ? "ANY" : "ALL";
            const joiner = route.matchMode === "any" ? " 或 " : " 且 ";
            clauses.push(`分支条件（${mode}） ${routeConditions.join(joiner)}`);
          }
          if (!clauses.length) return;
          group.push(`- 如果 ${clauses.join("，")} 那么 ${result}`);
        });
      }
      if (group.length) ruleGroups.push(group);
    });
    ruleGroups.forEach((group, index) => {
      if (index > 0) lines.push("");
      lines.push(...group);
    });
  }

  if (draft.commandTools.length) {
    lines.push("", "## 纯命令工具");
    draft.commandTools.forEach((tool) => {
      const name = tool.name || tool.alias || "command-tool";
      if (tool.command && tool.usage) {
        lines.push(`- ${name}: \`${tool.command}\`，用途：${tool.usage}`);
      } else if (tool.command) {
        lines.push(`- ${name}: \`${tool.command}\``);
      } else if (tool.usage) {
        lines.push(`- ${name}: ${tool.usage}`);
      }
    });
  }

  return lines.join("\n");
}

function skillIdFromFilePath(filePath: string) {
  const parts = filePath.split(/[\\/]/).filter(Boolean);
  if (!parts.length) {
    return undefined;
  }
  const last = parts.at(-1);
  if (last?.toLowerCase() === "skill.md") {
    return parts.at(-2);
  }
  return last;
}

function projectDirectoryName(skill: SkillSummary) {
  return skillIdFromFilePath(skill.filePath) || skill.id || skill.name;
}

function presetForSkill(skill: SkillContent | null, editedName: string): SkillPreset | undefined {
  if (!skill) return undefined;
  const identity = [skill.id, skill.name, editedName, skill.filePath].join(" ").toLowerCase();
  if (identity.includes("workflow-task") || identity.includes("project-workflow")) {
    return WORKFLOW_TASK_PRESET;
  }
  if (identity.includes("flutter") || identity.includes("material")) {
    return FLUTTER_DESIGN_PRESET;
  }
  return FLUTTER_DESIGN_PRESET;
}

function isEditableSkill(skill: SkillSummary) {
  return /[\\/]SKILL\.md$/i.test(skill.filePath) || /\.agentmd$/i.test(skill.filePath);
}

function readEditorDraftCache(skill: SkillContent): EditorDraftCache | null {
  if (typeof window === "undefined" || !isEditableSkill(skill)) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(editorDraftCacheKey(skill.id));
    if (!raw) {
      return null;
    }

    const cached = JSON.parse(raw) as Partial<EditorDraftCache>;
    if (
      typeof cached.content !== "string" ||
      normalizeRenderedContent(cached.content) !== normalizeRenderedContent(skill.content)
    ) {
      return null;
    }
    const topRules = Array.isArray(cached.topRules) ? cached.topRules : [];
    const localRules = Array.isArray(cached.localRules) ? cached.localRules : [];
    const commandTools = Array.isArray(cached.commandTools) ? cached.commandTools : [];
    const topRuleCategories = Array.isArray(cached.topRuleCategories)
      ? cached.topRuleCategories.filter((category): category is string => typeof category === "string")
      : [];
    const localRuleCategories = Array.isArray(cached.localRuleCategories)
      ? cached.localRuleCategories.filter((category): category is string => typeof category === "string")
      : [];
    if (
      !topRules.length &&
      !localRules.length &&
      !commandTools.length &&
      !topRuleCategories.length &&
      !localRuleCategories.length
    ) {
      return null;
    }

    return {
      content: typeof cached.content === "string" ? cached.content : skill.content,
      sourceMarkdown:
        typeof cached.sourceMarkdown === "string" ? cached.sourceMarkdown : skill.content,
      sourceAuthoritative:
        typeof cached.sourceAuthoritative === "boolean" ? cached.sourceAuthoritative : undefined,
      skillName: typeof cached.skillName === "string" ? cached.skillName : undefined,
      skillDescription:
        typeof cached.skillDescription === "string" ? cached.skillDescription : undefined,
      skillAliases: Array.isArray(cached.skillAliases)
        ? cached.skillAliases.filter((alias): alias is string => typeof alias === "string")
        : undefined,
      topRules,
      localRules,
      commandTools,
      topRuleCategories,
      localRuleCategories,
      activePanel: isActivePanel(cached.activePanel) ? cached.activePanel : undefined,
      activeTopCategory:
        typeof cached.activeTopCategory === "string" ? cached.activeTopCategory : undefined,
      activeLocalCategory:
        typeof cached.activeLocalCategory === "string" ? cached.activeLocalCategory : undefined,
    };
  } catch {
    return null;
  }
}

function isActivePanel(value: unknown): value is ActivePanel {
  return value === "identity" || value === "top" || value === "local" || value === "command";
}

function storeEditorDraftCache(
  id: string,
  content: string,
  state: Omit<EditorDraftCache, "content">,
) {
  if (typeof window === "undefined" || !id) {
    return;
  }

  try {
    window.localStorage.setItem(
      editorDraftCacheKey(id),
      JSON.stringify({
        content,
        sourceMarkdown: state.sourceMarkdown,
        sourceAuthoritative: state.sourceAuthoritative,
        skillName: state.skillName,
        skillDescription: state.skillDescription,
        skillAliases: state.skillAliases,
        topRules: state.topRules,
        localRules: state.localRules,
        commandTools: state.commandTools,
        topRuleCategories: state.topRuleCategories,
        localRuleCategories: state.localRuleCategories,
        activePanel: state.activePanel,
        activeTopCategory: state.activeTopCategory,
        activeLocalCategory: state.activeLocalCategory,
      }),
    );
  } catch {
    // Local draft cache is best-effort; backend persistence remains authoritative.
  }
}

function editorDraftCacheKey(id: string) {
  return `skill-agentmd-creator:draft:${id}`;
}

function renderResult(result: RuleResult) {
  return result.kind === "flow" ? result.steps.join("→") : result.requirement;
}

function cleanConditions(conditions: RuleCondition[]) {
  return conditions
    .map((condition) => ({
      alias: condition.alias.trim(),
      content: condition.content.trim(),
    }))
    .filter((condition) => condition.content);
}

function renderConditionText(rule: LocalRule) {
  const triggers = rule.triggerConditions.map((condition) => condition.content).filter(Boolean);
  const limits = rule.limitConditions.map((condition) => condition.content).filter(Boolean);
  if (triggers.length && limits.length) {
    return `${triggers.join(" 并且 ")}，限制 ${limits.join(" 并且 ")}`;
  }
  if (triggers.length) {
    return triggers.join(" 并且 ");
  }
  if (limits.length) {
    return `限制 ${limits.join(" 并且 ")}`;
  }
  return "";
}

function escapeText(value: string) {
  return value.replaceAll("\"", "\\\"");
}

function isTauriRuntime() {
  return typeof window !== "undefined" &&
    Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

async function callBackend<T = unknown>(command: string, payload?: unknown): Promise<T> {
  if (isTauriRuntime()) {
    return invoke<T>(command, payload as Record<string, unknown> | undefined);
  }

  return callLocalApi<T>(command, payload);
}

async function callLocalApi<T>(command: string, payload?: unknown): Promise<T> {
  const request = localApiRequest(command, payload);
  const response = await fetch(`${API_BASE_URL}${request.path}`, {
    method: request.method,
    headers: request.body ? { "Content-Type": "application/json" } : undefined,
    body: request.body ? JSON.stringify(request.body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    throw new Error(data?.error || `本地 API 请求失败：${response.status}`);
  }
  if (command === "ping_backend") {
    return true as T;
  }
  return data as T;
}

function localApiRequest(command: string, payload?: unknown) {
  const body = payload as {
    id?: string;
    draft?: SkillDraft;
    text?: string;
    model?: string;
    reasoningEffort?: string;
    fastMode?: boolean;
    mode?: string;
    prompt?: string;
    currentSource?: string;
    history?: Array<{ role: string; content: string }>;
    ids?: string[];
  } | undefined;
  switch (command) {
    case "ping_backend":
      return { method: "GET", path: "/health" };
    case "ensure_manifest":
      return { method: "POST", path: "/ensure_manifest" };
    case "codex_status":
      return { method: "GET", path: "/codex_status" };
    case "translate_rule":
      return { method: "POST", path: "/translate_rule", body: { text: body?.text } };
    case "design_skill":
      return {
        method: "POST",
        path: "/design_skill",
        body: {
          mode: body?.mode,
          prompt: body?.prompt,
          currentSource: body?.currentSource,
          history: body?.history,
        },
      };
    case "set_codex_model":
      return {
        method: "PUT",
        path: "/codex_model",
        body: {
          model: body?.model,
          reasoningEffort: body?.reasoningEffort,
          fastMode: body?.fastMode,
        },
      };
    case "list_skills":
      return { method: "GET", path: "/skills" };
    case "list_codex_skills":
      return { method: "GET", path: "/codex_skills" };
    case "import_codex_skills":
      return {
        method: "POST",
        path: "/codex_skills/import",
        body: { ids: body?.ids ?? [] },
      };
    case "read_skill":
      return { method: "GET", path: `/skills/${encodeURIComponent(body?.id ?? "")}` };
    case "create_skill":
      return { method: "POST", path: "/skills", body: { draft: body?.draft } };
    case "update_skill":
      return {
        method: "PUT",
        path: `/skills/${encodeURIComponent(body?.id ?? "")}`,
        body: { draft: body?.draft },
      };
    case "delete_skill":
      return { method: "DELETE", path: `/skills/${encodeURIComponent(body?.id ?? "")}` };
    default:
      throw new Error(`未知后台命令：${command}`);
  }
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number) {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return items;
  }
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

export default App;



