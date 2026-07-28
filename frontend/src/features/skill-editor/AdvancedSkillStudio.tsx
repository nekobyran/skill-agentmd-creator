import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { KeyboardEvent, ReactNode } from "react";
import {
  moveSection,
  parseSkillDocument,
  removeSection,
  serializeSkillDocument,
  upsertSection,
} from "../skill-document/markdown";
import {
  readManagedContract,
  readManagedWorkflow,
  removeManagedContract,
  removeManagedWorkflow,
  writeManagedContract,
  writeManagedWorkflow,
} from "../skill-document/managed-blocks";
import type {
  ContractQualityGate,
  ContractRule,
  ContractScopeRoute,
  ContractTrigger,
  Resource,
  Section,
  SkillContract,
  SkillDocument,
  WorkflowBlueprint,
  WorkflowStep,
} from "../skill-document/types";
import {
  cloneValue,
  contractFromPreset,
  createEmptyContract,
  createEmptyWorkflow,
  createEmptyWorkflowStep,
  formatStructuredValue,
  listToText,
  parseStructuredValue,
  presetName,
  splitEditableSectionBody,
  textToList,
  uniqueEntityId,
  withWorkflowStepOrder,
  workflowFromPreset,
} from "./helpers";
import type {
  AdvancedSkillStudioProps,
  AdvancedSkillStudioView,
} from "./model";
import IsomorphicSkillStudio from "./IsomorphicSkillStudio";
import { FLUTTER_FIDELITY_PROFILE } from "../skill-document/profiles/flutter-fidelity";
import { WORKFLOW_FIDELITY_PROFILE } from "../skill-document/profiles/workflow-fidelity";

type ContractCollection = "triggers" | "scopeRoutes" | "rules" | "resources" | "qualityGates";

type ReadResult<T> = {
  value: T | null;
  error: string | null;
};

const VIEW_TABS: Array<{ id: AdvancedSkillStudioView; label: string; hint: string }> = [
  { id: "isomorphic", label: "完全同构", hint: "真实节点逐项编辑 · 100% 覆盖" },
  { id: "sections", label: "章节", hint: "无损编辑 Markdown 章节" },
  { id: "contract", label: "技能合同", hint: "触发、范围、规则与质量门禁" },
  { id: "workflow", label: "任务流程", hint: "步骤、依赖、风险与证据" },
  { id: "source", label: "完整源码", hint: "直接编辑全部 SKILL.md" },
];

const CONTRACT_TABS: Array<{ id: ContractCollection; label: string }> = [
  { id: "triggers", label: "触发条件" },
  { id: "scopeRoutes", label: "范围路由" },
  { id: "rules", label: "规则" },
  { id: "resources", label: "资源" },
  { id: "qualityGates", label: "质量门禁" },
];

export default function AdvancedSkillStudio({
  source,
  name,
  onSourceChange,
  onClose,
  onOpenAi,
  contractPreset,
  workflowPreset,
  initialView = "isomorphic",
  className,
}: AdvancedSkillStudioProps) {
  const titleId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [workingSource, setWorkingSource] = useState(source);
  const [activeView, setActiveView] = useState<AdvancedSkillStudioView>(initialView);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [contractCollection, setContractCollection] = useState<ContractCollection>("rules");
  const [selectedContractItemId, setSelectedContractItemId] = useState<string | null>(null);
  const [selectedWorkflowStepId, setSelectedWorkflowStepId] = useState<string | null>(null);
  const [notice, setNotice] = useState("详细设计编辑器已就绪");
  const [operationError, setOperationError] = useState<string | null>(null);

  useEffect(() => {
    setWorkingSource(source);
  }, [source]);

  const documentResult = useMemo(() => readDocument(workingSource, name), [workingSource, name]);
  const contractResult = useMemo(
    () => readManaged(workingSource, readManagedContract, "技能合同"),
    [workingSource],
  );
  const workflowResult = useMemo(
    () => readManaged(workingSource, readManagedWorkflow, "任务流程"),
    [workingSource],
  );
  const document = documentResult.value;
  const contract = contractResult.value;
  const workflow = workflowResult.value;
  const fidelityProfile = useMemo(() => {
    const identity = `${name}\n${workingSource.slice(0, 512)}`.toLowerCase();
    if (identity.includes("project-workflow-task")) return WORKFLOW_FIDELITY_PROFILE;
    if (identity.includes("flutter-app-design")) return FLUTTER_FIDELITY_PROFILE;
    return undefined;
  }, [name, workingSource]);

  useEffect(() => {
    if (!document?.sections.length) {
      setSelectedSectionId(null);
      return;
    }
    if (!selectedSectionId || !document.sections.some((section) => section.id === selectedSectionId)) {
      setSelectedSectionId(document.sections[0].id);
    }
  }, [document, selectedSectionId]);

  useEffect(() => {
    const items = contract?.[contractCollection] ?? [];
    if (!items.length) {
      setSelectedContractItemId(null);
      return;
    }
    if (!selectedContractItemId || !items.some((item) => item.id === selectedContractItemId)) {
      setSelectedContractItemId(items[0].id);
    }
  }, [contract, contractCollection, selectedContractItemId]);

  useEffect(() => {
    if (!workflow?.steps.length) {
      setSelectedWorkflowStepId(null);
      return;
    }
    if (!selectedWorkflowStepId || !workflow.steps.some((step) => step.id === selectedWorkflowStepId)) {
      setSelectedWorkflowStepId(workflow.steps[0].id);
    }
  }, [workflow, selectedWorkflowStepId]);

  const emitSource = (nextSource: string, message: string) => {
    setWorkingSource(nextSource);
    onSourceChange(nextSource);
    setOperationError(null);
    setNotice(message);
  };

  const reportFailure = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    setOperationError(message);
    setNotice("修改未应用，请检查错误提示");
  };

  const writeContract = (nextContract: SkillContract, message = "技能合同已更新") => {
    try {
      emitSource(writeManagedContract(workingSource, nextContract), message);
    } catch (error) {
      reportFailure(error);
    }
  };

  const writeWorkflow = (nextWorkflow: WorkflowBlueprint, message = "任务流程已更新") => {
    try {
      emitSource(writeManagedWorkflow(workingSource, nextWorkflow), message);
    } catch (error) {
      reportFailure(error);
    }
  };

  const commitSectionDocument = (nextDocument: SkillDocument, message: string) => {
    try {
      let nextSource = serializeSkillDocument(nextDocument);
      // A managed block normally moves losslessly with its containing section. If the user
      // deletes that section, restore only the missing metadata instead of rewriting both blocks.
      if (contract && !readManagedContract(nextSource)) nextSource = writeManagedContract(nextSource, contract);
      if (workflow && !readManagedWorkflow(nextSource)) nextSource = writeManagedWorkflow(nextSource, workflow);
      emitSource(nextSource, message);
    } catch (error) {
      reportFailure(error);
    }
  };

  const changeView = (view: AdvancedSkillStudioView) => {
    setActiveView(view);
    setNotice(`${VIEW_TABS.find((item) => item.id === view)?.label ?? view}视图已打开`);
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let target = index;
    if (event.key === "ArrowRight") target = (index + 1) % VIEW_TABS.length;
    else if (event.key === "ArrowLeft") target = (index - 1 + VIEW_TABS.length) % VIEW_TABS.length;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = VIEW_TABS.length - 1;
    else return;
    event.preventDefault();
    changeView(VIEW_TABS[target].id);
    tabRefs.current[target]?.focus();
  };

  const selectedSection = document?.sections.find((section) => section.id === selectedSectionId) ?? null;
  const rootClass = ["advanced-studio", className].filter(Boolean).join(" ");
  const structuredEditingBlocked = Boolean(documentResult.error || contractResult.error || workflowResult.error);

  return (
    <section className={rootClass} aria-labelledby={titleId}>
      <header className="advanced-studio__header">
        <div className="advanced-studio__heading">
          <span className="advanced-studio__eyebrow">SKILL DESIGN STUDIO</span>
          <h2 id={titleId}>详细设计 · {name || "未命名技能"}</h2>
          <p>逐项塑造章节、技能合同与可执行任务流；所有结构化内容都会回写到完整源码。</p>
        </div>
        <div className="advanced-studio__header-actions">
          <button
            type="button"
            className="advanced-studio__ai-button"
            onClick={() => onOpenAi({
              view: activeView,
              selectedSectionId: selectedSectionId ?? undefined,
              selectedWorkflowStepId: selectedWorkflowStepId ?? undefined,
            })}
          >
            AI 智能修改
          </button>
          <button type="button" className="advanced-studio__close-button" onClick={onClose} aria-label="关闭详细设计">
            关闭
          </button>
        </div>
      </header>

      <nav className="advanced-studio__tabs" role="tablist" aria-label="详细设计视图">
        {VIEW_TABS.map((tab, index) => (
          <button
            key={tab.id}
            ref={(element) => { tabRefs.current[index] = element; }}
            type="button"
            role="tab"
            id={`advanced-studio-tab-${tab.id}`}
            aria-controls={`advanced-studio-panel-${tab.id}`}
            aria-selected={activeView === tab.id}
            tabIndex={activeView === tab.id ? 0 : -1}
            className="advanced-studio__tab"
            onClick={() => changeView(tab.id)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >
            <strong>{tab.label}</strong>
            <span>{tab.hint}</span>
          </button>
        ))}
      </nav>

      {(documentResult.error || contractResult.error || workflowResult.error || operationError) && (
        <div className="advanced-studio__error" role="alert">
          <strong>结构化编辑暂时受限</strong>
          {[documentResult.error, contractResult.error, workflowResult.error, operationError]
            .filter(Boolean)
            .map((message) => <p key={message}>{message}</p>)}
          <button type="button" onClick={() => changeView("source")}>打开完整源码修复</button>
        </div>
      )}

      {activeView === "isomorphic" && (
        <div
          id="advanced-studio-panel-isomorphic"
          role="tabpanel"
          aria-labelledby="advanced-studio-tab-isomorphic"
          className="advanced-studio__panel advanced-studio__panel--isomorphic"
        >
          <IsomorphicSkillStudio
            source={workingSource}
            name={name}
            profile={fidelityProfile}
            onSourceChange={(nextSource) => emitSource(nextSource, "真实源码节点已精确更新")}
            onOpenAi={(node) => onOpenAi({ view: "isomorphic", selectedNodeId: node?.id })}
          />
        </div>
      )}

      {activeView === "sections" && (
        <div
          id="advanced-studio-panel-sections"
          role="tabpanel"
          aria-labelledby="advanced-studio-tab-sections"
          className="advanced-studio__panel"
        >
          <SectionsEditor
            document={document}
            selectedSection={selectedSection}
            disabled={structuredEditingBlocked}
            onSelect={setSelectedSectionId}
            onCommit={commitSectionDocument}
            onError={reportFailure}
          />
        </div>
      )}

      {activeView === "contract" && (
        <div
          id="advanced-studio-panel-contract"
          role="tabpanel"
          aria-labelledby="advanced-studio-tab-contract"
          className="advanced-studio__panel"
        >
          <ContractEditor
            contract={contract}
            error={contractResult.error}
            skillName={name}
            preset={contractPreset}
            collection={contractCollection}
            selectedItemId={selectedContractItemId}
            onCollectionChange={setContractCollection}
            onSelectItem={setSelectedContractItemId}
            onWrite={writeContract}
            onRemove={() => {
              if (!window.confirm("移除完整技能合同？Markdown 正文会保留。")) return;
              try {
                emitSource(removeManagedContract(workingSource), "技能合同已移除");
              } catch (error) {
                reportFailure(error);
              }
            }}
          />
        </div>
      )}

      {activeView === "workflow" && (
        <div
          id="advanced-studio-panel-workflow"
          role="tabpanel"
          aria-labelledby="advanced-studio-tab-workflow"
          className="advanced-studio__panel"
        >
          <WorkflowEditor
            workflow={workflow}
            error={workflowResult.error}
            skillName={name}
            preset={workflowPreset}
            selectedStepId={selectedWorkflowStepId}
            onSelectStep={setSelectedWorkflowStepId}
            onWrite={writeWorkflow}
            onRemove={() => {
              if (!window.confirm("移除完整任务流程？Markdown 正文会保留。")) return;
              try {
                emitSource(removeManagedWorkflow(workingSource), "任务流程已移除");
              } catch (error) {
                reportFailure(error);
              }
            }}
          />
        </div>
      )}

      {activeView === "source" && (
        <div
          id="advanced-studio-panel-source"
          role="tabpanel"
          aria-labelledby="advanced-studio-tab-source"
          className="advanced-studio__panel advanced-source-editor"
        >
          <div className="advanced-source-editor__heading">
            <div>
              <h3>完整 SKILL.md 源码</h3>
              <p>这里不会隐藏托管元数据。每次输入都会同步到当前草稿。</p>
            </div>
            <span>{workingSource.length.toLocaleString()} 字符</span>
          </div>
          <label className="advanced-field advanced-field--source">
            <span>完整源码</span>
            <textarea
              value={workingSource}
              spellCheck={false}
              onChange={(event) => emitSource(event.target.value, "完整源码已更新")}
              aria-invalid={Boolean(documentResult.error || contractResult.error || workflowResult.error)}
            />
          </label>
        </div>
      )}

      <footer className="advanced-studio__footer">
        <span className="advanced-studio__live" aria-live="polite">{notice}</span>
        <span>{workingSource.split(/\r?\n/).length} 行 · {workingSource.length.toLocaleString()} 字符</span>
      </footer>
    </section>
  );
}

interface SectionsEditorProps {
  document: SkillDocument | null;
  selectedSection: Section | null;
  disabled: boolean;
  onSelect: (id: string) => void;
  onCommit: (document: SkillDocument, message: string) => void;
  onError: (error: unknown) => void;
}

function SectionsEditor({
  document,
  selectedSection,
  disabled,
  onSelect,
  onCommit,
  onError,
}: SectionsEditorProps) {
  if (!document) {
    return <EmptyState title="无法解析章节" description="请在完整源码视图修复 Markdown 后继续。" />;
  }

  const addSection = () => {
    try {
      const title = uniqueSectionTitle(document.sections, "新章节");
      const id = uniqueEntityId(document.sections.map((section) => section.id), title);
      const next = upsertSection(
        document,
        { id, title, body: document.newline, rawBody: true },
        { index: document.sections.length, matchTitle: false },
      );
      onCommit(next, `章节“${title}”已添加`);
      onSelect(id);
    } catch (error) {
      onError(error);
    }
  };

  const updateSection = (section: Section, title: string, editableBody: string) => {
    try {
      const split = splitEditableSectionBody(section.body);
      const next = upsertSection(
        document,
        { id: section.id, title, body: `${editableBody}${split.managedSuffix}`, rawBody: true },
        { matchTitle: false },
      );
      onCommit(next, `章节“${title}”已更新`);
    } catch (error) {
      onError(error);
    }
  };

  const selectedIndex = selectedSection
    ? document.sections.findIndex((section) => section.id === selectedSection.id)
    : -1;
  const splitBody = selectedSection ? splitEditableSectionBody(selectedSection.body) : null;

  return (
    <div className="section-editor">
      <aside className="section-editor__navigator" aria-label="Markdown 章节">
        <div className="section-editor__navigator-heading">
          <div>
            <h3>章节结构</h3>
            <span>{document.sections.length} 个二级章节</span>
          </div>
          <button type="button" onClick={addSection} disabled={disabled}>添加章节</button>
        </div>
        <ol className="section-editor__list">
          {document.sections.map((section, index) => (
            <li key={section.id}>
              <button
                type="button"
                className="section-editor__item"
                aria-current={selectedSection?.id === section.id ? "true" : undefined}
                onClick={() => onSelect(section.id)}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{section.title}</strong>
              </button>
            </li>
          ))}
        </ol>
      </aside>

      <main className="section-editor__detail">
        {!selectedSection || !splitBody ? (
          <EmptyState
            title="还没有章节"
            description="添加一个二级章节，或在完整源码里输入 ## 标题。"
            action={<button type="button" onClick={addSection} disabled={disabled}>添加第一个章节</button>}
          />
        ) : (
          <>
            <div className="section-editor__toolbar">
              <span>章节 {selectedIndex + 1} / {document.sections.length}</span>
              <div>
                <button
                  type="button"
                  disabled={disabled || selectedIndex <= 0}
                  onClick={() => onCommit(moveSection(document, selectedSection.id, selectedIndex - 1), "章节已上移")}
                >
                  上移
                </button>
                <button
                  type="button"
                  disabled={disabled || selectedIndex >= document.sections.length - 1}
                  onClick={() => onCommit(moveSection(document, selectedSection.id, selectedIndex + 1), "章节已下移")}
                >
                  下移
                </button>
                <button
                  type="button"
                  className="advanced-button--danger"
                  disabled={disabled}
                  onClick={() => {
                    if (!window.confirm(`删除章节“${selectedSection.title}”？`)) return;
                    onCommit(removeSection(document, selectedSection.id), "章节已删除");
                  }}
                >
                  删除
                </button>
              </div>
            </div>
            <DraftTextInput
              label="章节标题"
              value={selectedSection.title}
              required
              disabled={disabled}
              onCommit={(title) => updateSection(selectedSection, title, splitBody.editableBody)}
            />
            {splitBody.managedTailHidden && (
              <p className="section-editor__managed-note">
                此章节尾部包含技能合同或任务流托管块；正文框已安全隐藏它们，保存时会原样带回。
              </p>
            )}
            <label className="advanced-field advanced-field--fill">
              <span>章节正文（Markdown）</span>
              <textarea
                value={splitBody.editableBody}
                spellCheck={false}
                disabled={disabled}
                onChange={(event) => updateSection(selectedSection, selectedSection.title, event.target.value)}
              />
            </label>
          </>
        )}
      </main>
    </div>
  );
}

interface ContractEditorProps {
  contract: SkillContract | null;
  error: string | null;
  skillName: string;
  preset: AdvancedSkillStudioProps["contractPreset"];
  collection: ContractCollection;
  selectedItemId: string | null;
  onCollectionChange: (collection: ContractCollection) => void;
  onSelectItem: (id: string | null) => void;
  onWrite: (contract: SkillContract, message?: string) => void;
  onRemove: () => void;
}

type ContractEntity = ContractTrigger | ContractScopeRoute | ContractRule | Resource | ContractQualityGate;

function ContractEditor({
  contract,
  error,
  skillName,
  preset,
  collection,
  selectedItemId,
  onCollectionChange,
  onSelectItem,
  onWrite,
  onRemove,
}: ContractEditorProps) {
  if (error) {
    return <EmptyState title="技能合同元数据无法读取" description="请在完整源码视图修复托管块。" />;
  }
  if (!contract) {
    return (
      <EmptyState
        title="还没有技能合同"
        description="创建空白合同后可逐项定义目标、触发、范围路由、规则、资源和质量门禁。"
        action={(
          <div className="advanced-empty__actions">
            <button type="button" onClick={() => onWrite(createEmptyContract(skillName), "空白技能合同已创建")}>
              创建空白合同
            </button>
            {preset && (
              <button
                type="button"
                onClick={() => onWrite(contractFromPreset(preset), `已载入合同预设“${presetName(preset)}”`)}
              >
                使用 {presetName(preset)} 预设
              </button>
            )}
          </div>
        )}
      />
    );
  }

  const activeItems = contract[collection] as ContractEntity[];
  const selectedItem = activeItems.find((item) => item.id === selectedItemId) ?? null;

  const updateContract = (patch: Partial<SkillContract>, message?: string) => {
    onWrite({ ...contract, ...patch }, message);
  };

  const writeItems = (items: ContractEntity[], message: string) => {
    onWrite(replaceContractCollection(contract, collection, items), message);
  };

  const addItem = () => {
    const item = createContractEntity(collection, activeItems);
    writeItems([...activeItems, item], `${contractCollectionLabel(collection)}已添加`);
    onSelectItem(item.id);
  };

  const updateItem = (item: ContractEntity, message = `${contractCollectionLabel(collection)}已更新`) => {
    writeItems(activeItems.map((current) => current.id === selectedItem?.id ? item : current), message);
    if (item.id !== selectedItem?.id) onSelectItem(item.id);
  };

  const renameItem = (nextId: string) => {
    if (!selectedItem) return;
    const existingIds = activeItems.filter((item) => item.id !== selectedItem.id).map((item) => item.id);
    const id = uniqueEntityId(existingIds, nextId);
    updateItem({ ...selectedItem, id }, "条目标识已更新");
  };

  const selectedIndex = selectedItem
    ? activeItems.findIndex((item) => item.id === selectedItem.id)
    : -1;

  return (
    <div className="contract-editor">
      <section className="contract-editor__overview" aria-labelledby="contract-overview-title">
        <div className="advanced-section-heading">
          <div>
            <span>CONTRACT PROFILE</span>
            <h3 id="contract-overview-title">合同概要</h3>
          </div>
          <div className="advanced-section-heading__actions">
            {preset && (
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm(`用“${presetName(preset)}”覆盖当前技能合同？`)) return;
                  onWrite(contractFromPreset(preset), "合同预设已应用");
                }}
              >
                载入预设
              </button>
            )}
            <button type="button" className="advanced-button--danger" onClick={onRemove}>移除合同</button>
          </div>
        </div>

        <div className="advanced-form-grid advanced-form-grid--three">
          <DraftTextInput
            label="合同 ID"
            value={contract.id}
            required
            onCommit={(id) => updateContract({ id }, "合同 ID 已更新")}
          />
          <TextInput label="合同名称" value={contract.name} onChange={(name) => updateContract({ name })} />
          <NumberInput
            label="Schema 版本"
            value={contract.schemaVersion}
            onChange={(schemaVersion) => {
              if (schemaVersion !== undefined) updateContract({ schemaVersion });
            }}
          />
        </div>
        <TextAreaInput label="摘要" value={contract.summary} onChange={(summary) => updateContract({ summary })} rows={3} />
        <div className="advanced-form-grid advanced-form-grid--two">
          <TextListField
            label="目标（每行一项）"
            value={contract.objectives}
            onChange={(objectives) => updateContract({ objectives })}
          />
          <TextListField
            label="依赖技能（每行一项）"
            value={contract.requiredSkills}
            onChange={(requiredSkills) => updateContract({ requiredSkills })}
          />
          <TextListField
            label="完成报告字段（每行一项）"
            value={contract.completionReportFields ?? []}
            onChange={(completionReportFields) => updateContract({ completionReportFields })}
          />
          <StructuredValueEditor
            label="合同自定义属性"
            value={contract.properties}
            expected="array"
            placeholder="[]"
            onCommit={(properties) => updateContract({ properties: properties as SkillContract["properties"] })}
          />
          <StructuredValueEditor
            label="合同输入定义"
            value={contract.inputs}
            expected="array"
            onCommit={(inputs) => updateContract({ inputs: inputs as SkillContract["inputs"] })}
          />
          <StructuredValueEditor
            label="合同输出定义"
            value={contract.outputs}
            expected="array"
            onCommit={(outputs) => updateContract({ outputs: outputs as SkillContract["outputs"] })}
          />
        </div>
        <StructuredValueEditor
          label="合同扩展属性"
          value={contract.extensions}
          expected="object"
          placeholder="{}"
          onCommit={(extensions) => updateContract({ extensions: extensions as SkillContract["extensions"] })}
        />
      </section>

      <section className="contract-editor__collections" aria-labelledby="contract-items-title">
        <div className="advanced-section-heading">
          <div>
            <span>STRUCTURED CAPABILITIES</span>
            <h3 id="contract-items-title">逐项能力设计</h3>
          </div>
          <button type="button" onClick={addItem}>添加{contractCollectionLabel(collection)}</button>
        </div>

        <div className="contract-editor__collection-tabs" role="tablist" aria-label="合同条目类型">
          {CONTRACT_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`contract-editor-tab-${tab.id}`}
              aria-controls="contract-editor-collection-panel"
              aria-selected={collection === tab.id}
              className="contract-editor__collection-tab"
              onClick={() => {
                onCollectionChange(tab.id);
                onSelectItem(null);
              }}
            >
              {tab.label}
              <span>{contract[tab.id].length}</span>
            </button>
          ))}
        </div>

        <div
          id="contract-editor-collection-panel"
          className="contract-editor__workspace"
          role="tabpanel"
          aria-labelledby={`contract-editor-tab-${collection}`}
        >
          <ItemNavigator
            label={contractCollectionLabel(collection)}
            items={activeItems.map((item) => ({
              id: item.id,
              title: contractEntityTitle(item),
              caption: contractEntityCaption(item),
            }))}
            selectedId={selectedItem?.id ?? null}
            onSelect={onSelectItem}
            onAdd={addItem}
          />
          <div className="contract-editor__item-detail">
            {!selectedItem ? (
              <EmptyState
                title={`还没有${contractCollectionLabel(collection)}`}
                description="从左侧添加一项后，可在这里编辑全部属性。"
                action={<button type="button" onClick={addItem}>添加第一项</button>}
              />
            ) : (
              <>
                <ItemToolbar
                  index={selectedIndex}
                  count={activeItems.length}
                  onMoveUp={() => writeItems(moveArrayItem(activeItems, selectedIndex, selectedIndex - 1), "条目已上移")}
                  onMoveDown={() => writeItems(moveArrayItem(activeItems, selectedIndex, selectedIndex + 1), "条目已下移")}
                  onDelete={() => {
                    if (!window.confirm(`删除“${contractEntityTitle(selectedItem)}”？`)) return;
                    writeItems(activeItems.filter((item) => item.id !== selectedItem.id), "条目已删除");
                    onSelectItem(null);
                  }}
                />
                <DraftTextInput label="条目 ID" value={selectedItem.id} required onCommit={renameItem} />
                <ContractItemFields
                  collection={collection}
                  item={selectedItem}
                  onChange={updateItem}
                />
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

interface ContractItemFieldsProps {
  collection: ContractCollection;
  item: ContractEntity;
  onChange: (item: ContractEntity, message?: string) => void;
}

function ContractItemFields({ collection, item, onChange }: ContractItemFieldsProps) {
  if (collection === "triggers") {
    const trigger = item as ContractTrigger;
    const update = (patch: Partial<ContractTrigger>) => onChange({ ...trigger, ...patch });
    return (
      <div className="contract-fields contract-fields--trigger">
        <TextInput label="显示名称" value={trigger.label} onChange={(label) => update({ label })} />
        <TextAreaInput label="说明" value={trigger.description ?? ""} onChange={(description) => update({ description })} />
        <div className="advanced-form-grid advanced-form-grid--two">
          <TextListField label="匹配模式" value={trigger.patterns ?? []} onChange={(patterns) => update({ patterns })} />
          <TextListField label="平台" value={trigger.platforms ?? []} onChange={(platforms) => update({ platforms })} />
          <TextListField label="生效条件" value={trigger.conditions ?? []} onChange={(conditions) => update({ conditions })} />
          <TextListField label="路由目标" value={trigger.routesTo ?? []} onChange={(routesTo) => update({ routesTo })} />
        </div>
        <StructuredValueEditor
          label="触发扩展属性"
          value={trigger.extensions}
          expected="object"
          onCommit={(extensions) => update({ extensions: extensions as ContractTrigger["extensions"] })}
        />
      </div>
    );
  }

  if (collection === "scopeRoutes") {
    const route = item as ContractScopeRoute;
    const update = (patch: Partial<ContractScopeRoute>) => onChange({ ...route, ...patch });
    return (
      <div className="contract-fields contract-fields--scope">
        <div className="advanced-form-grid advanced-form-grid--two">
          <TextInput label="路由标签" value={route.label} onChange={(label) => update({ label })} />
          <TextInput label="范围标记" value={route.marker ?? ""} onChange={(marker) => update({ marker })} />
        </div>
        <TextAreaInput label="说明" value={route.description ?? ""} onChange={(description) => update({ description })} />
        <div className="advanced-switch-row">
          <CheckboxField label="默认路由" checked={route.default ?? false} onChange={(value) => update({ default: value })} />
          <CheckboxField
            label="要求共享实现"
            checked={route.sharedImplementation ?? false}
            onChange={(sharedImplementation) => update({ sharedImplementation })}
          />
        </div>
        <div className="advanced-form-grid advanced-form-grid--two">
          <TextListField label="目标平台" value={route.platforms} onChange={(platforms) => update({ platforms })} />
          <TextListField label="路由条件" value={route.conditions ?? []} onChange={(conditions) => update({ conditions })} />
          <TextListField
            label="验证目标"
            value={route.verificationTargets ?? []}
            onChange={(verificationTargets) => update({ verificationTargets })}
          />
          <TextListField
            label="关联技能"
            value={route.relatedSkills ?? []}
            onChange={(relatedSkills) => update({ relatedSkills })}
          />
        </div>
        <StructuredValueEditor
          label="范围扩展属性"
          value={route.extensions}
          expected="object"
          onCommit={(extensions) => update({ extensions: extensions as ContractScopeRoute["extensions"] })}
        />
      </div>
    );
  }

  if (collection === "rules") {
    const rule = item as ContractRule;
    const update = (patch: Partial<ContractRule>) => onChange({ ...rule, ...patch });
    return (
      <div className="contract-fields contract-fields--rule">
        <TextInput label="规则标题" value={rule.title} onChange={(title) => update({ title })} />
        <TextAreaInput label="规则陈述" value={rule.statement} onChange={(statement) => update({ statement })} rows={4} />
        <div className="advanced-form-grid advanced-form-grid--three">
          <SelectField
            label="规则种类"
            value={rule.kind}
            options={[
              "trigger", "scope-route", "component-selection", "restriction", "data-path", "motion",
              "platform-boundary", "verification", "evidence", "completion-report", "collaboration",
              "conflict", "audit", "lifecycle", "custom",
            ]}
            onChange={(kind) => update({ kind: kind as ContractRule["kind"] })}
          />
          <SelectField
            label="约束强度"
            value={rule.strength}
            options={["required", "prohibited", "default", "preferred", "allowed", "conditional"]}
            onChange={(strength) => update({ strength: strength as ContractRule["strength"] })}
          />
          <SelectField
            label="严重级别"
            value={rule.severity ?? ""}
            options={["", "info", "warning", "error", "blocking"]}
            optionLabels={{ "": "未设置" }}
            onChange={(severity) => update({ severity: severity ? severity as ContractRule["severity"] : undefined })}
          />
        </div>
        <div className="advanced-switch-row">
          <CheckboxField label="启用规则" checked={rule.enabled ?? true} onChange={(enabled) => update({ enabled })} />
          <NumberInput
            label="排序值"
            value={rule.order}
            onChange={(order) => update({ order })}
          />
        </div>
        <div className="advanced-form-grid advanced-form-grid--two">
          <TextListField label="作用目标" value={rule.targets ?? []} onChange={(targets) => update({ targets })} />
          <TextListField label="目标平台" value={rule.platforms ?? []} onChange={(platforms) => update({ platforms })} />
          <TextListField label="关联触发" value={rule.triggers ?? []} onChange={(triggers) => update({ triggers })} />
          <TextListField label="生效条件" value={rule.conditions ?? []} onChange={(conditions) => update({ conditions })} />
          <TextListField label="例外情况" value={rule.exceptions ?? []} onChange={(exceptions) => update({ exceptions })} />
          <TextListField label="示例" value={rule.examples ?? []} onChange={(examples) => update({ examples })} />
          <TextListField label="路径模式" value={rule.pathPatterns ?? []} onChange={(pathPatterns) => update({ pathPatterns })} />
          <TextListField
            label="必需证据"
            value={rule.requiredEvidence ?? []}
            onChange={(requiredEvidence) => update({ requiredEvidence })}
          />
          <TextListField
            label="验证规则"
            value={rule.verificationRules ?? []}
            onChange={(verificationRules) => update({ verificationRules })}
          />
          <TextListField
            label="关联技能"
            value={rule.relatedSkills ?? []}
            onChange={(relatedSkills) => update({ relatedSkills })}
          />
        </div>
        <TextAreaInput label="设计理由" value={rule.rationale ?? ""} onChange={(rationale) => update({ rationale })} />
        <TextAreaInput label="修复措施" value={rule.remediation ?? ""} onChange={(remediation) => update({ remediation })} />
        <div className="advanced-form-grid advanced-form-grid--two">
          <StructuredValueEditor
            label="规则自定义属性"
            value={rule.properties}
            expected="array"
            onCommit={(properties) => update({ properties: properties as ContractRule["properties"] })}
          />
          <StructuredValueEditor
            label="规则扩展属性"
            value={rule.extensions}
            expected="object"
            onCommit={(extensions) => update({ extensions: extensions as ContractRule["extensions"] })}
          />
        </div>
      </div>
    );
  }

  if (collection === "resources") {
    const resource = item as Resource;
    const update = (patch: Partial<Resource>) => onChange({ ...resource, ...patch });
    return (
      <div className="contract-fields contract-fields--resource">
        <div className="advanced-form-grid advanced-form-grid--two">
          <TextInput label="资源名称" value={resource.name} onChange={(name) => update({ name })} />
          <SelectField
            label="资源种类"
            value={resource.kind}
            options={["file", "directory", "url", "command", "tool", "asset", "template", "reference", "other"]}
            onChange={(kind) => update({ kind: kind as Resource["kind"] })}
          />
        </div>
        <TextAreaInput label="资源说明" value={resource.description ?? ""} onChange={(description) => update({ description })} />
        <div className="advanced-form-grid advanced-form-grid--two">
          <TextInput label="本地路径" value={resource.path ?? ""} onChange={(path) => update({ path })} />
          <TextInput label="URI" value={resource.uri ?? ""} onChange={(uri) => update({ uri })} />
          <TextInput label="媒体类型" value={resource.mediaType ?? ""} onChange={(mediaType) => update({ mediaType })} />
          <TextInput label="用途角色" value={resource.role ?? ""} onChange={(role) => update({ role })} />
          <TextInput label="校验和" value={resource.checksum ?? ""} onChange={(checksum) => update({ checksum })} />
          <TextListField label="适用平台" value={resource.platforms ?? []} onChange={(platforms) => update({ platforms })} />
        </div>
        <CheckboxField label="必需资源" checked={resource.required ?? false} onChange={(required) => update({ required })} />
        <TextAreaInput label="内嵌内容" value={resource.content ?? ""} onChange={(content) => update({ content })} rows={5} />
        <div className="advanced-form-grid advanced-form-grid--two">
          <StructuredValueEditor
            label="资源自定义属性"
            value={resource.properties}
            expected="array"
            onCommit={(properties) => update({ properties: properties as Resource["properties"] })}
          />
          <StructuredValueEditor
            label="资源扩展属性"
            value={resource.extensions}
            expected="object"
            onCommit={(extensions) => update({ extensions: extensions as Resource["extensions"] })}
          />
        </div>
      </div>
    );
  }

  const gate = item as ContractQualityGate;
  const update = (patch: Partial<ContractQualityGate>) => onChange({ ...gate, ...patch });
  return (
    <div className="contract-fields contract-fields--gate">
      <TextInput label="门禁名称" value={gate.name} onChange={(name) => update({ name })} />
      <TextAreaInput label="门禁说明" value={gate.description ?? ""} onChange={(description) => update({ description })} />
      <CheckboxField label="必需门禁" checked={gate.required} onChange={(required) => update({ required })} />
      <TextInput label="执行条件" value={gate.condition ?? ""} onChange={(condition) => update({ condition })} />
      <div className="advanced-form-grid advanced-form-grid--two">
        <TextListField label="检查项" value={gate.checks} onChange={(checks) => update({ checks })} />
        <TextListField label="所需证据" value={gate.evidence ?? []} onChange={(evidence) => update({ evidence })} />
      </div>
      <TextAreaInput label="失败消息" value={gate.failureMessage ?? ""} onChange={(failureMessage) => update({ failureMessage })} />
      <StructuredValueEditor
        label="门禁扩展属性"
        value={gate.extensions}
        expected="object"
        onCommit={(extensions) => update({ extensions: extensions as ContractQualityGate["extensions"] })}
      />
    </div>
  );
}

interface WorkflowEditorProps {
  workflow: WorkflowBlueprint | null;
  error: string | null;
  skillName: string;
  preset: AdvancedSkillStudioProps["workflowPreset"];
  selectedStepId: string | null;
  onSelectStep: (id: string | null) => void;
  onWrite: (workflow: WorkflowBlueprint, message?: string) => void;
  onRemove: () => void;
}

function WorkflowEditor({
  workflow,
  error,
  skillName,
  preset,
  selectedStepId,
  onSelectStep,
  onWrite,
  onRemove,
}: WorkflowEditorProps) {
  if (error) {
    return <EmptyState title="任务流程元数据无法读取" description="请在完整源码视图修复托管块。" />;
  }
  if (!workflow) {
    return (
      <EmptyState
        title="还没有任务流程"
        description="创建空白流程后，可为每个步骤定义动作、依赖、执行器、风险、审批、证据和结果。"
        action={(
          <div className="advanced-empty__actions">
            <button type="button" onClick={() => onWrite(createEmptyWorkflow(skillName), "空白任务流程已创建")}>
              创建空白流程
            </button>
            {preset && (
              <button
                type="button"
                onClick={() => onWrite(workflowFromPreset(preset), `已载入流程预设“${presetName(preset)}”`)}
              >
                使用 {presetName(preset)} 预设
              </button>
            )}
          </div>
        )}
      />
    );
  }

  const selectedStep = workflow.steps.find((step) => step.id === selectedStepId) ?? null;
  const selectedIndex = selectedStep
    ? workflow.steps.findIndex((step) => step.id === selectedStep.id)
    : -1;

  const updateWorkflow = (patch: Partial<WorkflowBlueprint>, message?: string) => {
    onWrite({ ...workflow, ...patch }, message);
  };

  const writeSteps = (steps: WorkflowStep[], message: string) => {
    updateWorkflow({ steps: withWorkflowStepOrder(steps) }, message);
  };

  const addStep = () => {
    const step = createEmptyWorkflowStep(workflow);
    onWrite({
      ...workflow,
      steps: withWorkflowStepOrder([...workflow.steps, step]),
      entryStepIds: workflow.entryStepIds.length ? workflow.entryStepIds : [step.id],
      terminalStepIds: workflow.terminalStepIds.length ? workflow.terminalStepIds : [step.id],
    }, `步骤“${step.name}”已添加`);
    onSelectStep(step.id);
  };

  const updateStep = (nextStep: WorkflowStep, message = "流程步骤已更新") => {
    writeSteps(
      workflow.steps.map((step) => step.id === selectedStep?.id ? nextStep : step),
      message,
    );
    if (nextStep.id !== selectedStep?.id) onSelectStep(nextStep.id);
  };

  const renameStep = (requestedId: string) => {
    if (!selectedStep) return;
    const oldId = selectedStep.id;
    const id = uniqueEntityId(workflow.steps.filter((step) => step.id !== oldId).map((step) => step.id), requestedId);
    const renameReferences = (ids: string[] | undefined) => ids?.map((value) => value === oldId ? id : value);
    onWrite({
      ...workflow,
      entryStepIds: renameReferences(workflow.entryStepIds) ?? [],
      terminalStepIds: renameReferences(workflow.terminalStepIds) ?? [],
      steps: withWorkflowStepOrder(workflow.steps.map((step) => ({
        ...step,
        id: step.id === oldId ? id : step.id,
        dependsOn: renameReferences(step.dependsOn) ?? [],
        success: step.success ? { ...step.success, next: renameReferences(step.success.next) } : undefined,
        failure: step.failure ? { ...step.failure, next: renameReferences(step.failure.next) } : undefined,
      }))),
      transitions: workflow.transitions?.map((transition) => ({
        ...transition,
        from: transition.from === oldId ? id : transition.from,
        to: transition.to === oldId ? id : transition.to,
      })),
    }, "步骤 ID 与全部引用已同步更新");
    onSelectStep(id);
  };

  const deleteSelectedStep = () => {
    if (!selectedStep || !window.confirm(`删除步骤“${selectedStep.name}”？相关依赖和转移引用也会移除。`)) return;
    const id = selectedStep.id;
    onWrite({
      ...workflow,
      entryStepIds: workflow.entryStepIds.filter((value) => value !== id),
      terminalStepIds: workflow.terminalStepIds.filter((value) => value !== id),
      steps: withWorkflowStepOrder(workflow.steps
        .filter((step) => step.id !== id)
        .map((step) => ({
          ...step,
          dependsOn: step.dependsOn.filter((value) => value !== id),
          success: step.success ? { ...step.success, next: step.success.next?.filter((value) => value !== id) } : undefined,
          failure: step.failure ? { ...step.failure, next: step.failure.next?.filter((value) => value !== id) } : undefined,
        }))),
      transitions: workflow.transitions?.filter((transition) => transition.from !== id && transition.to !== id),
    }, "步骤及其引用已删除");
    onSelectStep(null);
  };

  return (
    <div className="workflow-editor">
      <section className="workflow-editor__overview" aria-labelledby="workflow-overview-title">
        <div className="advanced-section-heading">
          <div>
            <span>WORKFLOW BLUEPRINT</span>
            <h3 id="workflow-overview-title">流程概要</h3>
          </div>
          <div className="advanced-section-heading__actions">
            {preset && (
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm(`用“${presetName(preset)}”覆盖当前任务流程？`)) return;
                  onWrite(workflowFromPreset(preset), "任务流预设已应用");
                }}
              >
                载入预设
              </button>
            )}
            <button type="button" className="advanced-button--danger" onClick={onRemove}>移除流程</button>
          </div>
        </div>
        <div className="advanced-form-grid advanced-form-grid--three">
          <DraftTextInput label="流程 ID" value={workflow.id} required onCommit={(id) => updateWorkflow({ id }, "流程 ID 已更新")} />
          <TextInput label="流程名称" value={workflow.name} onChange={(name) => updateWorkflow({ name })} />
          <NumberInput
            label="Schema 版本"
            value={workflow.schemaVersion}
            onChange={(schemaVersion) => {
              if (schemaVersion !== undefined) updateWorkflow({ schemaVersion });
            }}
          />
        </div>
        <TextAreaInput label="流程说明" value={workflow.description} onChange={(description) => updateWorkflow({ description })} rows={3} />
        <div className="advanced-form-grid advanced-form-grid--three">
          <TextListField label="入口步骤 ID" value={workflow.entryStepIds} onChange={(entryStepIds) => updateWorkflow({ entryStepIds })} />
          <TextListField label="终止步骤 ID" value={workflow.terminalStepIds} onChange={(terminalStepIds) => updateWorkflow({ terminalStepIds })} />
          <TextListField label="流程状态" value={workflow.states ?? []} onChange={(states) => updateWorkflow({ states })} />
        </div>
        <details className="advanced-field-group">
          <summary>流程级高级属性</summary>
          <div className="advanced-form-grid advanced-form-grid--two">
            <StructuredValueEditor
              label="参数定义"
              value={workflow.parameters}
              expected="array"
              onCommit={(parameters) => updateWorkflow({ parameters: parameters as WorkflowBlueprint["parameters"] })}
            />
            <StructuredValueEditor
              label="转移定义"
              value={workflow.transitions}
              expected="array"
              onCommit={(transitions) => updateWorkflow({ transitions: transitions as WorkflowBlueprint["transitions"] })}
            />
            <StructuredValueEditor
              label="流程资源"
              value={workflow.resources}
              expected="array"
              onCommit={(resources) => updateWorkflow({ resources: resources as WorkflowBlueprint["resources"] })}
            />
            <StructuredValueEditor
              label="流程质量门禁"
              value={workflow.qualityGates}
              expected="array"
              onCommit={(qualityGates) => updateWorkflow({ qualityGates: qualityGates as WorkflowBlueprint["qualityGates"] })}
            />
            <StructuredValueEditor
              label="流程自定义属性"
              value={workflow.properties}
              expected="array"
              onCommit={(properties) => updateWorkflow({ properties: properties as WorkflowBlueprint["properties"] })}
            />
            <StructuredValueEditor
              label="流程扩展属性"
              value={workflow.extensions}
              expected="object"
              onCommit={(extensions) => updateWorkflow({ extensions: extensions as WorkflowBlueprint["extensions"] })}
            />
          </div>
        </details>
      </section>

      <section className="workflow-editor__steps" aria-labelledby="workflow-steps-title">
        <div className="advanced-section-heading">
          <div>
            <span>EXECUTION GRAPH</span>
            <h3 id="workflow-steps-title">步骤详细设计</h3>
          </div>
          <button type="button" onClick={addStep}>添加步骤</button>
        </div>

        <div className="workflow-editor__workspace">
          <ItemNavigator
            label="流程步骤"
            items={workflow.steps.map((step, index) => ({
              id: step.id,
              title: step.name || step.id,
              caption: `${String(index + 1).padStart(2, "0")} · ${step.kind}${step.enabled === false ? " · 已停用" : ""}`,
            }))}
            selectedId={selectedStep?.id ?? null}
            onSelect={onSelectStep}
            onAdd={addStep}
          />

          <div className="workflow-editor__step-detail">
            {!selectedStep ? (
              <EmptyState
                title="还没有流程步骤"
                description="添加步骤后，可独立编辑动作、依赖、执行器、结果、证据、风险和审批。"
                action={<button type="button" onClick={addStep}>添加第一个步骤</button>}
              />
            ) : (
              <>
                <ItemToolbar
                  index={selectedIndex}
                  count={workflow.steps.length}
                  onMoveUp={() => writeSteps(moveArrayItem(workflow.steps, selectedIndex, selectedIndex - 1), "步骤已上移")}
                  onMoveDown={() => writeSteps(moveArrayItem(workflow.steps, selectedIndex, selectedIndex + 1), "步骤已下移")}
                  onDelete={deleteSelectedStep}
                />
                <WorkflowStepFields step={selectedStep} onChange={updateStep} onRename={renameStep} />
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

interface WorkflowStepFieldsProps {
  step: WorkflowStep;
  onChange: (step: WorkflowStep, message?: string) => void;
  onRename: (id: string) => void;
}

function WorkflowStepFields({ step, onChange, onRename }: WorkflowStepFieldsProps) {
  const update = (patch: Partial<WorkflowStep>) => onChange({ ...step, ...patch });
  return (
    <div className="workflow-fields">
      <details className="advanced-field-group" open>
        <summary>基础与动作</summary>
        <div className="advanced-form-grid advanced-form-grid--two">
          <DraftTextInput label="步骤 ID" value={step.id} required onCommit={onRename} />
          <TextInput label="步骤名称" value={step.name} onChange={(name) => update({ name })} />
          <TextInput label="执行动作" value={step.action} onChange={(action) => update({ action })} />
          <SelectField
            label="步骤种类"
            value={step.kind}
            options={["intake", "action", "decision", "implementation", "verification", "handoff", "collaboration", "audit", "cleanup", "completion", "custom"]}
            onChange={(kind) => update({ kind: kind as WorkflowStep["kind"] })}
          />
          <NumberInput label="排序值" value={step.order} onChange={(order) => update({ order })} />
          <CheckboxField label="启用步骤" checked={step.enabled ?? true} onChange={(enabled) => update({ enabled })} />
        </div>
        <TextAreaInput label="步骤说明" value={step.description ?? ""} onChange={(description) => update({ description })} rows={3} />
      </details>

      <details className="advanced-field-group" open>
        <summary>路由、平台与责任主体</summary>
        <div className="advanced-form-grid advanced-form-grid--two">
          <StructuredValueEditor
            label="执行条件（文本或条件对象）"
            value={step.condition}
            allowPlainString
            onCommit={(condition) => update({ condition: condition as WorkflowStep["condition"] })}
          />
          <TextListField label="目标平台" value={step.platforms} onChange={(platforms) => update({ platforms })} />
          <TextInput label="负责人" value={step.owner ?? ""} onChange={(owner) => update({ owner })} />
          <TextInput label="Agent 类型" value={step.agentType ?? ""} onChange={(agentType) => update({ agentType })} />
          <TextInput label="模型" value={step.model ?? ""} onChange={(model) => update({ model })} />
          <TextListField label="依赖步骤 ID" value={step.dependsOn} onChange={(dependsOn) => update({ dependsOn })} />
          <StructuredValueEditor
            label="并行策略（布尔值或对象）"
            value={step.parallel}
            onCommit={(parallel) => update({ parallel: (parallel ?? false) as WorkflowStep["parallel"] })}
          />
        </div>
      </details>

      <details className="advanced-field-group" open>
        <summary>输入、输出与执行器</summary>
        <div className="advanced-form-grid advanced-form-grid--two">
          <StructuredValueEditor
            label="输入定义"
            value={step.inputs}
            expected="array"
            onCommit={(inputs) => update({ inputs: (inputs ?? []) as WorkflowStep["inputs"] })}
          />
          <StructuredValueEditor
            label="输出定义"
            value={step.outputs}
            expected="array"
            onCommit={(outputs) => update({ outputs: (outputs ?? []) as WorkflowStep["outputs"] })}
          />
          <StructuredValueEditor
            label="命令执行器"
            value={step.command}
            expected="object"
            onCommit={(command) => update({ command: command as WorkflowStep["command"] })}
          />
          <StructuredValueEditor
            label="工具调用"
            value={step.tool}
            expected="object"
            onCommit={(tool) => update({ tool: tool as WorkflowStep["tool"] })}
          />
          <StructuredValueEditor
            label="超时策略（秒数或对象）"
            value={step.timeout}
            onCommit={(timeout) => update({ timeout: timeout as WorkflowStep["timeout"] })}
          />
          <StructuredValueEditor
            label="重试策略"
            value={step.retry}
            expected="object"
            onCommit={(retry) => update({ retry: retry as WorkflowStep["retry"] })}
          />
        </div>
      </details>

      <details className="advanced-field-group" open>
        <summary>成功、失败与证据</summary>
        <div className="advanced-form-grid advanced-form-grid--two">
          <StructuredValueEditor
            label="成功结果"
            value={step.success}
            expected="object"
            onCommit={(success) => update({ success: success as WorkflowStep["success"] })}
          />
          <StructuredValueEditor
            label="失败结果"
            value={step.failure}
            expected="object"
            onCommit={(failure) => update({ failure: failure as WorkflowStep["failure"] })}
          />
          <StructuredValueEditor
            label="证据要求"
            value={step.evidence}
            expected="array"
            onCommit={(evidence) => update({ evidence: evidence as WorkflowStep["evidence"] })}
          />
        </div>
      </details>

      <details className="advanced-field-group" open>
        <summary>风险、审批与破坏性操作</summary>
        <div className="advanced-form-grid advanced-form-grid--three">
          <StructuredValueEditor
            label="风险策略"
            value={step.risk}
            expected="object"
            onCommit={(risk) => update({ risk: risk as WorkflowStep["risk"] })}
          />
          <StructuredValueEditor
            label="审批策略"
            value={step.approval}
            expected="object"
            onCommit={(approval) => update({ approval: approval as WorkflowStep["approval"] })}
          />
          <StructuredValueEditor
            label="破坏性策略（布尔值或对象）"
            value={step.destructive}
            onCommit={(destructive) => update({ destructive: destructive as WorkflowStep["destructive"] })}
          />
        </div>
      </details>

      <details className="advanced-field-group">
        <summary>自定义属性与扩展</summary>
        <div className="advanced-form-grid advanced-form-grid--two">
          <StructuredValueEditor
            label="步骤自定义属性"
            value={step.properties}
            expected="array"
            onCommit={(properties) => update({ properties: properties as WorkflowStep["properties"] })}
          />
          <StructuredValueEditor
            label="步骤扩展属性"
            value={step.extensions}
            expected="object"
            onCommit={(extensions) => update({ extensions: extensions as WorkflowStep["extensions"] })}
          />
        </div>
      </details>
    </div>
  );
}

interface ItemNavigatorProps {
  label: string;
  items: Array<{ id: string; title: string; caption?: string }>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
}

function ItemNavigator({ label, items, selectedId, onSelect, onAdd }: ItemNavigatorProps) {
  return (
    <aside className="item-navigator" aria-label={`${label}列表`}>
      <div className="item-navigator__heading">
        <strong>{label}</strong>
        <span>{items.length} 项</span>
      </div>
      {items.length ? (
        <ol className="item-navigator__list">
          {items.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                className="item-navigator__item"
                aria-current={selectedId === item.id ? "true" : undefined}
                onClick={() => onSelect(item.id)}
              >
                <span className="item-navigator__index">{String(index + 1).padStart(2, "0")}</span>
                <span className="item-navigator__copy">
                  <strong>{item.title}</strong>
                  {item.caption && <small>{item.caption}</small>}
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="item-navigator__empty">暂无条目</p>
      )}
      <button type="button" className="item-navigator__add" onClick={onAdd}>添加{label}</button>
    </aside>
  );
}

interface ItemToolbarProps {
  index: number;
  count: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}

function ItemToolbar({ index, count, onMoveUp, onMoveDown, onDelete }: ItemToolbarProps) {
  return (
    <div className="item-toolbar">
      <span>条目 {index + 1} / {count}</span>
      <div className="item-toolbar__actions">
        <button type="button" disabled={index <= 0} onClick={onMoveUp}>上移</button>
        <button type="button" disabled={index >= count - 1} onClick={onMoveDown}>下移</button>
        <button type="button" className="advanced-button--danger" onClick={onDelete}>删除</button>
      </div>
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
}

function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="advanced-empty">
      <span className="advanced-empty__mark" aria-hidden="true">＋</span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

interface TextInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

function TextInput({ label, value, onChange, placeholder, disabled }: TextInputProps) {
  return (
    <label className="advanced-field">
      <span>{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

interface DraftTextInputProps {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
}

function DraftTextInput({ label, value, onCommit, required, disabled }: DraftTextInputProps) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(value);
    setError(null);
  }, [value]);

  const commit = () => {
    const normalized = draft.trim();
    if (required && !normalized) {
      setError(`${label}不能为空`);
      return;
    }
    setError(null);
    if (normalized !== value) onCommit(normalized);
  };

  return (
    <label className="advanced-field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type="text"
        value={draft}
        required={required}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            setDraft(value);
            setError(null);
          }
        }}
      />
      {error && <small id={`${id}-error`} className="advanced-field__error" role="alert">{error}</small>}
    </label>
  );
}

interface TextAreaInputProps extends TextInputProps {
  rows?: number;
}

function TextAreaInput({ label, value, onChange, placeholder, disabled, rows = 3 }: TextAreaInputProps) {
  return (
    <label className="advanced-field">
      <span>{label}</span>
      <textarea
        value={value}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

interface TextListFieldProps {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}

function TextListField({ label, value, onChange, placeholder = "每行一项" }: TextListFieldProps) {
  const formatted = useMemo(() => listToText(value), [value]);
  const [draft, setDraft] = useState(formatted);

  useEffect(() => {
    setDraft(formatted);
  }, [formatted]);

  const commit = () => {
    const next = textToList(draft);
    if (listToText(next) !== formatted) onChange(next);
  };

  return (
    <label className="advanced-field advanced-field--list">
      <span>{label}</span>
      <textarea
        value={draft}
        rows={4}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
      />
      <small>每行一项，离开输入框时保存</small>
    </label>
  );
}

interface SelectFieldProps {
  label: string;
  value: string;
  options: string[];
  optionLabels?: Record<string, string>;
  onChange: (value: string) => void;
}

function SelectField({ label, value, options, optionLabels, onChange }: SelectFieldProps) {
  return (
    <label className="advanced-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option || "__empty"} value={option}>{optionLabels?.[option] ?? option}</option>
        ))}
      </select>
    </label>
  );
}

interface CheckboxFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function CheckboxField({ label, checked, onChange }: CheckboxFieldProps) {
  return (
    <label className="advanced-check">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

interface NumberInputProps {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}

function NumberInput({ label, value, onChange }: NumberInputProps) {
  return (
    <label className="advanced-field advanced-field--number">
      <span>{label}</span>
      <input
        type="number"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))}
      />
    </label>
  );
}

interface StructuredValueEditorProps {
  label: string;
  value: unknown;
  onCommit: (value: unknown) => void;
  expected?: "array" | "object";
  allowPlainString?: boolean;
  placeholder?: string;
}

function StructuredValueEditor({
  label,
  value,
  onCommit,
  expected,
  allowPlainString = false,
  placeholder,
}: StructuredValueEditorProps) {
  const id = useId();
  const formatted = useMemo(() => formatStructuredValue(value), [value]);
  const [draft, setDraft] = useState(formatted);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(formatted);
    setError(null);
  }, [formatted]);

  const commit = () => {
    try {
      const parsed = parseStructuredValue(draft, allowPlainString);
      if (expected === "array" && parsed !== undefined && !Array.isArray(parsed)) {
        throw new Error("这里需要 JSON 数组，例如 []");
      }
      if (expected === "object" && parsed !== undefined
        && (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))) {
        throw new Error("这里需要 JSON 对象，例如 {}");
      }
      setError(null);
      onCommit(parsed);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : String(parseError));
    }
  };

  return (
    <div className="advanced-field advanced-field--structured">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        value={draft}
        rows={6}
        spellCheck={false}
        placeholder={placeholder ?? (expected === "array" ? "[]" : expected === "object" ? "{}" : "JSON 或留空")}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : `${id}-hint`}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="advanced-field__structured-actions">
        <small id={`${id}-hint`}>{allowPlainString ? "支持普通文本或 JSON" : "修改后点击保存到元数据"}</small>
        <button type="button" onClick={commit}>保存到元数据</button>
      </div>
      {error && <small id={`${id}-error`} className="advanced-field__error" role="alert">{error}</small>}
    </div>
  );
}

function readDocument(source: string, name: string): ReadResult<SkillDocument> {
  try {
    return { value: parseSkillDocument(source, { id: name }), error: null };
  } catch (error) {
    return {
      value: null,
      error: `Markdown 文档解析失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function readManaged<T>(
  source: string,
  reader: (source: string) => T | null,
  label: string,
): ReadResult<T> {
  try {
    return { value: reader(source), error: null };
  } catch (error) {
    return {
      value: null,
      error: `${label}读取失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function replaceContractCollection(
  contract: SkillContract,
  collection: ContractCollection,
  items: ContractEntity[],
): SkillContract {
  const normalized = collection === "rules"
    ? items.map((item, order) => ({ ...item, order }))
    : items;
  return { ...contract, [collection]: cloneValue(normalized) } as SkillContract;
}

function createContractEntity(collection: ContractCollection, current: ContractEntity[]): ContractEntity {
  const ids = current.map((item) => item.id);
  if (collection === "triggers") {
    return {
      id: uniqueEntityId(ids, "trigger"),
      label: "新触发条件",
      description: "",
      patterns: [],
      platforms: [],
      conditions: [],
      routesTo: [],
      extensions: {},
    } satisfies ContractTrigger;
  }
  if (collection === "scopeRoutes") {
    return {
      id: uniqueEntityId(ids, "scope"),
      marker: "",
      label: "新范围路由",
      description: "",
      platforms: [],
      default: false,
      sharedImplementation: false,
      conditions: [],
      verificationTargets: [],
      relatedSkills: [],
      extensions: {},
    } satisfies ContractScopeRoute;
  }
  if (collection === "rules") {
    return {
      id: uniqueEntityId(ids, "rule"),
      title: "新规则",
      statement: "",
      kind: "custom",
      strength: "required",
      severity: "warning",
      enabled: true,
      order: current.length,
      targets: [],
      platforms: [],
      triggers: [],
      conditions: [],
      exceptions: [],
      examples: [],
      pathPatterns: [],
      requiredEvidence: [],
      verificationRules: [],
      relatedSkills: [],
      properties: [],
      extensions: {},
    } satisfies ContractRule;
  }
  if (collection === "resources") {
    return {
      id: uniqueEntityId(ids, "resource"),
      name: "新资源",
      kind: "file",
      description: "",
      required: false,
      platforms: [],
      properties: [],
      extensions: {},
    } satisfies Resource;
  }
  return {
    id: uniqueEntityId(ids, "quality-gate"),
    name: "新质量门禁",
    description: "",
    required: true,
    condition: "",
    checks: [],
    evidence: [],
    failureMessage: "",
    extensions: {},
  } satisfies ContractQualityGate;
}

function contractCollectionLabel(collection: ContractCollection) {
  return CONTRACT_TABS.find((tab) => tab.id === collection)?.label ?? "合同条目";
}

function contractEntityTitle(item: ContractEntity) {
  if ("title" in item) return item.title || item.id;
  if ("label" in item) return item.label || item.id;
  return item.name || item.id;
}

function contractEntityCaption(item: ContractEntity) {
  if ("statement" in item) return `${item.strength} · ${item.kind}`;
  if ("checks" in item) return `${item.required ? "必需" : "可选"} · ${item.checks.length} 项检查`;
  if ("patterns" in item) return item.patterns?.join(" · ") || "未设置匹配模式";
  if ("name" in item) return `${item.kind}${item.required ? " · 必需" : ""}`;
  return item.platforms?.join(" / ") || "未指定平台";
}

function moveArrayItem<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function uniqueSectionTitle(sections: Section[], preferred: string) {
  const titles = sections.map((section) => section.title.trim().toLowerCase());
  if (!titles.includes(preferred.toLowerCase())) return preferred;
  let suffix = 2;
  while (titles.includes(`${preferred} ${suffix}`.toLowerCase())) suffix += 1;
  return `${preferred} ${suffix}`;
}
