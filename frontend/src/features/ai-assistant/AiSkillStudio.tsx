import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  conversationStorageKey,
  createAiId,
  isAbortError,
  loadConversation,
  normalizeDesignResponse,
  parseDiffLines,
  safeDomId,
  saveConversation,
  sourceHash,
} from "./helpers";
import type {
  AiConversationMessage,
  AiRequestStatus,
  AiSkillProposal,
  AiSkillStudioProps,
  AiStudioMode,
} from "./model";

type ProposalPreview = "diff" | "before" | "after";

type ConversationState = {
  key: string;
  messages: AiConversationMessage[];
};

const QUICK_PROMPTS: Record<AiStudioMode, Array<{ label: string; prompt: string }>> = {
  create: [
    {
      label: "从使用场景创建",
      prompt: "根据我描述的真实使用场景创建一个完整 Skill。先检查触发条件、工作流程、资源和验证是否齐全，再给出待审阅提案。",
    },
    {
      label: "创建 Flutter UI Skill",
      prompt: "创建一个 Flutter UI Skill，覆盖组件选择、状态矩阵、动效、无障碍、Windows/Android 适配和验证证据。",
    },
    {
      label: "创建任务流 Skill",
      prompt: "创建一个任务流 Skill，覆盖任务入口、scope、冲突、协作、子任务、验证、Final Audit 和完成归档。",
    },
  ],
  modify: [
    {
      label: "补齐遗漏能力",
      prompt: "审查当前 Skill 的能力覆盖、边界状态和验证闭环，补齐高价值遗漏，但不要增加重复说明。",
    },
    {
      label: "优化流程属性",
      prompt: "优化当前 Skill 的流程：补齐前置条件、输入输出、成功/失败分支、证据、回退和阻塞条件，并给出待审阅提案。",
    },
    {
      label: "压缩并保留约束",
      prompt: "在不削弱触发条件、强制约束和验证要求的前提下精简当前 Skill，减少重复内容。",
    },
  ],
};

export default function AiSkillStudio({
  selectedSkill,
  currentSource,
  backendStatus,
  modelStatus,
  onCallDesign,
  onApplyProposal,
  onClose,
  initialMode,
  className,
}: AiSkillStudioProps) {
  const titleId = useId();
  const composerId = useId();
  const connectionId = useId();
  const initialStudioMode = initialMode === "modify" && !selectedSkill
    ? "create"
    : initialMode ?? (selectedSkill ? "modify" : "create");
  const [mode, setMode] = useState<AiStudioMode>(initialStudioMode);
  const storageKey = useMemo(
    () => conversationStorageKey(mode, selectedSkill?.id),
    [mode, selectedSkill?.id],
  );
  const [conversation, setConversation] = useState<ConversationState>(() => ({
    key: storageKey,
    messages: loadConversation(storageKey),
  }));
  const [draft, setDraft] = useState("");
  const [requestStatus, setRequestStatus] = useState<AiRequestStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const requestRef = useRef<{ id: number; controller: AbortController; messageId: string } | null>(null);
  const requestSequenceRef = useRef(0);

  const messages = conversation.key === storageKey ? conversation.messages : [];
  const isBusy = requestStatus === "sending" || requestStatus === "applying";
  const modelConnected = Boolean(modelStatus?.connected);
  const canCallAi = backendStatus === "connected" && modelConnected;
  const targetName = mode === "modify"
    ? selectedSkill?.name || "未选择 Skill"
    : "新 Skill 草稿";
  const connectionText = backendStatus !== "connected"
    ? backendStatus === "connecting" ? "后台连接中" : "后台未连接"
    : !modelStatus ? "正在读取模型状态"
    : modelConnected ? `模型 ${modelStatus.model} 已连接` : modelStatus.message || "AI 模型未连接";

  useEffect(() => {
    if (conversation.key !== storageKey) {
      setConversation({ key: storageKey, messages: loadConversation(storageKey) });
    }
  }, [conversation.key, storageKey]);

  useEffect(() => {
    if (conversation.key === storageKey) {
      saveConversation(storageKey, conversation.messages);
    }
  }, [conversation, storageKey]);

  useEffect(() => {
    if (!selectedSkill && mode === "modify") {
      stopActiveRequest("目标 Skill 已取消，生成已停止。");
      setMode("create");
    }
  }, [mode, selectedSkill]);

  useEffect(() => () => requestRef.current?.controller.abort(), []);

  function setMessages(
    nextValue: AiConversationMessage[] | ((current: AiConversationMessage[]) => AiConversationMessage[]),
  ) {
    setConversation((current) => {
      const currentMessages = current.key === storageKey
        ? current.messages
        : loadConversation(storageKey);
      const nextMessages = typeof nextValue === "function" ? nextValue(currentMessages) : nextValue;
      return { key: storageKey, messages: nextMessages };
    });
  }

  function updateMessage(
    id: string,
    updater: (message: AiConversationMessage) => AiConversationMessage,
  ) {
    setMessages((current) => current.map((message) => message.id === id ? updater(message) : message));
  }

  function chooseMode(nextMode: AiStudioMode) {
    if (nextMode === mode || (nextMode === "modify" && !selectedSkill)) return;
    stopActiveRequest("已切换工作模式，上一项生成已停止。");
    setMode(nextMode);
    setDraft("");
    setErrorMessage("");
    setAnnouncement(nextMode === "create" ? "已切换到创建模式" : "已切换到修改模式");
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }

  function useQuickPrompt(prompt: string) {
    setDraft(prompt);
    setAnnouncement("快捷提示已填入输入框，确认后发送。");
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function handleModeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextMode = event.key === "ArrowLeft" || event.key === "Home"
      ? "create"
      : selectedSkill ? "modify" : "create";
    chooseMode(nextMode);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-mode="${nextMode}"]`)?.focus();
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt || isBusy) return;
    if (mode === "modify" && !selectedSkill) {
      setErrorMessage("修改模式需要先选择一个 Skill。");
      return;
    }
    if (!canCallAi) {
      setErrorMessage(connectionText);
      return;
    }

    const requestSource = mode === "modify" ? currentSource : "";
    const userMessage: AiConversationMessage = {
      id: createAiId("message"),
      role: "user",
      content: prompt,
      createdAt: new Date().toISOString(),
      status: "complete",
    };
    const assistantMessage: AiConversationMessage = {
      id: createAiId("message"),
      role: "assistant",
      content: "正在生成 Skill 提案…",
      createdAt: new Date().toISOString(),
      status: "sending",
    };
    const requestConversation = [...messages, userMessage]
      .filter((message) => message.status === "complete")
      .slice(-20)
      .map(({ role, content }) => ({ role, content }));

    setMessages((current) => [...current, userMessage, assistantMessage]);
    setDraft("");
    setErrorMessage("");
    setRequestStatus("sending");
    setAnnouncement("AI 正在生成提案");

    const controller = new AbortController();
    const requestId = ++requestSequenceRef.current;
    requestRef.current = { id: requestId, controller, messageId: assistantMessage.id };

    try {
      const response = await onCallDesign({
        mode,
        prompt,
        targetSkill: mode === "modify" ? selectedSkill : null,
        currentSource: requestSource,
        baseSourceHash: sourceHash(requestSource),
        model: modelStatus?.model,
        reasoningEffort: modelStatus?.reasoningEffort,
        conversation: requestConversation,
      }, { signal: controller.signal });
      if (requestRef.current?.id !== requestId || controller.signal.aborted) return;

      const normalized = normalizeDesignResponse(response, {
        mode,
        currentSource: requestSource,
        targetSkillId: mode === "modify" ? selectedSkill?.id : undefined,
        targetFilePath: mode === "modify" ? selectedSkill?.filePath : undefined,
      });
      updateMessage(assistantMessage.id, (message) => ({
        ...message,
        content: normalized.message,
        proposal: normalized.proposal,
        status: "complete",
      }));
      setAnnouncement(normalized.proposal ? "AI 提案已生成，等待审阅" : "AI 回复已完成");
      setRequestStatus("idle");
    } catch (error) {
      if (requestRef.current?.id !== requestId) return;
      if (isAbortError(error) || controller.signal.aborted) {
        updateMessage(assistantMessage.id, (message) => ({
          ...message,
          content: "生成已停止，未产生任何磁盘修改。",
          status: "cancelled",
        }));
        setAnnouncement("生成已停止");
        setRequestStatus("idle");
      } else {
        const detail = error instanceof Error ? error.message : String(error);
        updateMessage(assistantMessage.id, (message) => ({
          ...message,
          content: `生成失败：${detail}`,
          status: "error",
        }));
        setErrorMessage(detail);
        setAnnouncement("AI 生成失败");
        setRequestStatus("error");
      }
    } finally {
      if (requestRef.current?.id === requestId) requestRef.current = null;
      window.setTimeout(() => composerRef.current?.focus(), 0);
    }
  }

  function stopActiveRequest(message = "生成已停止，未产生任何磁盘修改。") {
    const active = requestRef.current;
    if (!active) return;
    requestRef.current = null;
    active.controller.abort();
    updateMessage(active.messageId, (current) => ({
      ...current,
      content: message,
      status: "cancelled",
    }));
    setRequestStatus("idle");
    setAnnouncement("生成已停止");
  }

  async function applyProposal(proposal: AiSkillProposal) {
    if (isBusy || proposal.status === "applied" || proposal.status === "discarded") return;
    const stale = proposal.mode === "modify" && proposal.baseSourceHash !== sourceHash(currentSource);
    if (stale) {
      const detail = "当前 Skill 已在提案生成后发生变化，请重新生成提案。";
      updateProposal(proposal.id, { status: "error", errorMessage: detail });
      setErrorMessage(detail);
      setAnnouncement("提案已过期，未应用");
      return;
    }

    setRequestStatus("applying");
    setErrorMessage("");
    updateProposal(proposal.id, { status: "applying", errorMessage: undefined });
    setAnnouncement("正在应用提案");
    try {
      await onApplyProposal(proposal);
      updateProposal(proposal.id, { status: "applied", errorMessage: undefined });
      setRequestStatus("idle");
      setAnnouncement("提案已应用");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      updateProposal(proposal.id, { status: "error", errorMessage: detail });
      setErrorMessage(detail);
      setRequestStatus("error");
      setAnnouncement("提案应用失败");
    }
  }

  function discardProposal(proposal: AiSkillProposal) {
    if (proposal.status === "applying" || proposal.status === "applied") return;
    updateProposal(proposal.id, { status: "discarded", errorMessage: undefined });
    setAnnouncement("提案已放弃，磁盘内容未改变");
  }

  function updateProposal(id: string, patch: Partial<AiSkillProposal>) {
    setMessages((current) => current.map((message) => message.proposal?.id === id
      ? { ...message, proposal: { ...message.proposal, ...patch } }
      : message));
  }

  function clearConversation() {
    if (isBusy) return;
    setMessages([]);
    setErrorMessage("");
    setAnnouncement("当前 AI 对话已清空");
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }

  return (
    <section
      className={["ai-studio", className].filter(Boolean).join(" ")}
      aria-labelledby={titleId}
      aria-busy={isBusy}
    >
      <header className="ai-studio__header">
        <div className="ai-studio__heading">
          <span className="ai-studio__eyebrow">AI Skill 工作台</span>
          <h2 id={titleId}>{targetName}</h2>
        </div>
        <div className="ai-studio__header-actions">
          <button type="button" onClick={clearConversation} disabled={isBusy || messages.length === 0}>
            清空对话
          </button>
          <button type="button" onClick={onClose} aria-label="关闭 AI Skill 工作台">
            关闭
          </button>
        </div>
      </header>

      <div className="ai-studio__toolbar">
        <div
          className="ai-studio__mode-switch"
          role="radiogroup"
          aria-label="AI 工作模式"
          onKeyDown={handleModeKeyDown}
        >
          <button
            type="button"
            role="radio"
            data-mode="create"
            aria-checked={mode === "create"}
            className={mode === "create" ? "is-selected" : ""}
            onClick={() => chooseMode("create")}
          >
            创建 Skill
          </button>
          <button
            type="button"
            role="radio"
            data-mode="modify"
            aria-checked={mode === "modify"}
            className={mode === "modify" ? "is-selected" : ""}
            disabled={!selectedSkill}
            aria-describedby={!selectedSkill ? connectionId : undefined}
            onClick={() => chooseMode("modify")}
          >
            修改当前 Skill
          </button>
        </div>
        <div
          id={connectionId}
          className={`ai-studio__connection is-${backendStatus}`}
          role="status"
          aria-live="polite"
        >
          {connectionText}
          {modelStatus?.reasoningEffort ? ` · ${modelStatus.reasoningEffort}` : ""}
          {modelStatus?.fastMode ? " · Fast" : ""}
        </div>
      </div>

      <div className="ai-studio__body">
        <div className="ai-studio__conversation" role="region" aria-label="AI 对话">
          {messages.length === 0 ? (
            <div className="ai-studio__empty">
              <strong>{mode === "create" ? "描述要创建的 Skill" : "描述要修改的内容"}</strong>
              <span>AI 只会先生成可审阅提案；点击“应用提案”前不会修改文件。</span>
            </div>
          ) : (
            <ol
              className="ai-studio__messages"
              role="log"
              aria-live="polite"
              aria-relevant="additions text"
              aria-busy={requestStatus === "sending"}
            >
              {messages.map((message) => (
                <li className={`ai-message ai-message--${message.role}`} key={message.id}>
                  <article aria-label={message.role === "user" ? "你的消息" : "AI 回复"}>
                    <header className="ai-message__meta">
                      <strong>{message.role === "user" ? "你" : "AI"}</strong>
                      <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
                    </header>
                    <div className="ai-message__content">
                      {message.content.split("\n").map((line, index) => (
                        <p key={`${message.id}-line-${index}`}>{line || "\u00a0"}</p>
                      ))}
                    </div>
                    {message.status === "sending" ? <span role="status">生成中</span> : null}
                    {message.status === "cancelled" ? <span role="status">已停止</span> : null}
                    {message.status === "error" ? <span role="alert">生成失败</span> : null}
                    {message.proposal ? (
                      <ProposalReview
                        proposal={message.proposal}
                        currentSource={currentSource}
                        disabled={isBusy}
                        onApply={applyProposal}
                        onDiscard={discardProposal}
                      />
                    ) : null}
                  </article>
                </li>
              ))}
            </ol>
          )}
        </div>

        <aside className="ai-studio__shortcuts" aria-label="快捷提示">
          <strong>快捷提示</strong>
          <div className="ai-studio__shortcut-list">
            {QUICK_PROMPTS[mode].map((item) => (
              <button
                type="button"
                key={item.label}
                title={item.prompt}
                disabled={isBusy}
                onClick={() => useQuickPrompt(item.prompt)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </aside>
      </div>

      <form className="ai-studio__composer" onSubmit={sendMessage} aria-busy={requestStatus === "sending"}>
        <label htmlFor={composerId}>给 AI 的要求</label>
        <textarea
          id={composerId}
          ref={composerRef}
          value={draft}
          rows={4}
          disabled={isBusy}
          aria-describedby={connectionId}
          placeholder={mode === "create"
            ? "说明使用场景、触发方式、流程、工具和验证要求"
            : "说明要修改的章节、目标和必须保留的约束"}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleComposerKeyDown}
        />
        <div className="ai-studio__composer-actions">
          <span>Enter 发送，Shift+Enter 换行</span>
          {requestStatus === "sending" ? (
            <button type="button" onClick={() => stopActiveRequest()}>
              停止生成
            </button>
          ) : (
            <button type="submit" disabled={!draft.trim() || !canCallAi || isBusy}>
              生成提案
            </button>
          )}
        </div>
      </form>

      {errorMessage ? <div className="ai-studio__error" role="alert">{errorMessage}</div> : null}
      <div className="ai-studio__announcement" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </section>
  );
}

function ProposalReview({
  proposal,
  currentSource,
  disabled,
  onApply,
  onDiscard,
}: {
  proposal: AiSkillProposal;
  currentSource: string;
  disabled: boolean;
  onApply: (proposal: AiSkillProposal) => Promise<void>;
  onDiscard: (proposal: AiSkillProposal) => void;
}) {
  const [preview, setPreview] = useState<ProposalPreview>("diff");
  const panelId = `proposal-preview-${safeDomId(proposal.id)}`;
  const activeTabId = `${panelId}-${preview}-tab`;
  const stale = proposal.mode === "modify" && proposal.baseSourceHash !== sourceHash(currentSource);
  const unchanged = proposal.before === proposal.after;
  const actionAvailable = proposal.status === "pending" || proposal.status === "error";
  const proposalStatus = proposal.status === "pending" ? "等待审阅"
    : proposal.status === "applying" ? "应用中"
    : proposal.status === "applied" ? "已应用"
    : proposal.status === "discarded" ? "已放弃"
    : "应用失败";
  const previewText = preview === "before"
    ? proposal.before || "（新建提案，无原始内容）"
    : preview === "after"
      ? proposal.after || "（提案内容为空）"
      : proposal.diff || "（无差异）";

  function handlePreviewKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: ProposalPreview) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const previews: ProposalPreview[] = ["diff", "before", "after"];
    const currentIndex = previews.indexOf(current);
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? previews.length - 1
      : event.key === "ArrowLeft" ? (currentIndex - 1 + previews.length) % previews.length
      : (currentIndex + 1) % previews.length;
    const next = previews[nextIndex];
    setPreview(next);
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`[data-preview="${next}"]`)
      ?.focus();
  }

  return (
    <section className={`ai-proposal is-${proposal.status}`} aria-label={`变更提案：${proposal.title}`} aria-busy={proposal.status === "applying"}>
      <header className="ai-proposal__header">
        <div>
          <span>待审阅提案</span>
          <h3>{proposal.title}</h3>
        </div>
        <strong role="status">{proposalStatus}</strong>
      </header>

      {proposal.summary ? <p className="ai-proposal__summary">{proposal.summary}</p> : null}
      <dl className="ai-proposal__facts">
        <div><dt>目标</dt><dd>{proposal.filePath || "SKILL.md"}</dd></div>
        <div><dt>模式</dt><dd>{proposal.mode === "create" ? "创建" : "修改"}</dd></div>
        {proposal.changedFiles?.length ? (
          <div><dt>文件</dt><dd>{proposal.changedFiles.join("、")}</dd></div>
        ) : null}
      </dl>

      {proposal.warnings?.length ? (
        <div className="ai-proposal__warnings" role="note" aria-label="提案警告">
          <strong>应用前检查</strong>
          <ul>{proposal.warnings.map((warning, index) => <li key={`${proposal.id}-warning-${index}`}>{warning}</li>)}</ul>
        </div>
      ) : null}
      {stale && actionAvailable ? (
        <div className="ai-proposal__stale" role="alert">
          当前 Skill 已在提案生成后发生变化，请重新生成提案。
        </div>
      ) : null}
      {unchanged ? <div className="ai-proposal__unchanged" role="status">提案没有产生内容变化。</div> : null}
      {proposal.errorMessage ? <div className="ai-proposal__error" role="alert">{proposal.errorMessage}</div> : null}

      <div className="ai-proposal__preview-tabs" role="tablist" aria-label="提案预览方式">
        {(["diff", "before", "after"] as const).map((kind) => (
          <button
            type="button"
            role="tab"
            key={kind}
            id={`${panelId}-${kind}-tab`}
            data-preview={kind}
            aria-selected={preview === kind}
            aria-controls={panelId}
            className={preview === kind ? "is-selected" : ""}
            onClick={() => setPreview(kind)}
            onKeyDown={(event) => handlePreviewKeyDown(event, kind)}
          >
            {kind === "diff" ? "差异" : kind === "before" ? "修改前" : "修改后"}
          </button>
        ))}
      </div>
      <pre
        id={panelId}
        className={`ai-proposal__preview is-${preview}`}
        role="tabpanel"
        aria-labelledby={activeTabId}
        tabIndex={0}
      >
        {preview === "diff"
          ? parseDiffLines(previewText).map((line, index) => (
              <code className={`diff-line diff-line--${line.kind}`} key={`${proposal.id}-diff-${index}`}>
                {line.text}{"\n"}
              </code>
            ))
          : <code>{previewText}</code>}
      </pre>

      <div className="ai-proposal__actions">
        <button
          type="button"
          disabled={disabled || proposal.status === "applying" || proposal.status === "applied" || proposal.status === "discarded"}
          onClick={() => onDiscard(proposal)}
        >
          放弃提案
        </button>
        <button
          type="button"
          disabled={disabled || !actionAvailable || stale || unchanged}
          onClick={() => void onApply(proposal)}
        >
          {proposal.status === "applying" ? "应用中" : proposal.status === "applied" ? "已应用" : "应用提案"}
        </button>
      </div>
      <p className="ai-proposal__safety-note">只有“应用提案”会调用写入回调；预览与放弃不会修改磁盘。</p>
    </section>
  );
}

function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(date);
}
