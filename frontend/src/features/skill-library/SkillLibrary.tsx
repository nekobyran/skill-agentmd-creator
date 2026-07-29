import { useMemo, useState } from "react";
import type {
  CodexSkillCatalog,
  CodexSkillImportResult,
} from "./model";
import "./SkillLibrary.css";

interface SkillLibraryProps {
  catalog: CodexSkillCatalog | null;
  busy: boolean;
  error: string;
  onRefresh: () => Promise<void>;
  onImport: (ids: string[]) => Promise<CodexSkillImportResult>;
  onOpenImported: (id: string) => void;
  onClose: () => void;
}

type SourceFilter = "all" | "local" | "plugin" | "pending";

export function SkillLibrary({
  catalog,
  busy,
  error,
  onRefresh,
  onImport,
  onOpenImported,
  onClose,
}: SkillLibraryProps) {
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastResult, setLastResult] = useState<CodexSkillImportResult | null>(null);

  const entries = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return (catalog?.entries ?? []).filter((entry) => {
      const sourceMatches = sourceFilter === "all"
        || (sourceFilter === "local" && entry.source === "本地技能")
        || (sourceFilter === "plugin" && entry.source !== "本地技能")
        || (sourceFilter === "pending" && !entry.imported);
      if (!sourceMatches) return false;
      if (!normalizedQuery) return true;
      return [
        entry.name,
        entry.description,
        entry.source,
        entry.relativePath,
      ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [catalog, query, sourceFilter]);

  const pendingCount = catalog?.entries.filter((entry) => !entry.imported).length ?? 0;
  const selectedPending = [...selectedIds].filter((id) =>
    catalog?.entries.some((entry) => entry.id === id && !entry.imported)
  );

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function importSkills(ids: string[]) {
    const result = await onImport(ids);
    setLastResult(result);
    setSelectedIds(new Set());
  }

  return (
    <section className="skill-library-page" aria-busy={busy}>
      <header className="skill-library-head">
        <div>
          <strong>Codex 技能库</strong>
          <span>
            {catalog
              ? `${catalog.entries.length} 个技能 · ${pendingCount} 个待导入`
              : "扫描本机 Codex 与插件技能"}
          </span>
        </div>
        <div className="skill-library-head__actions">
          <button className="ghost-button" type="button" disabled={busy} onClick={() => void onRefresh()}>
            重新扫描
          </button>
          <button className="ghost-button" type="button" onClick={onClose}>
            返回编辑
          </button>
        </div>
      </header>

      <div className="skill-library-toolbar">
        <label className="skill-library-search">
          <span>搜索技能</span>
          <input
            type="search"
            value={query}
            placeholder="名称、描述、来源或路径"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="skill-library-filters" role="group" aria-label="技能来源筛选">
          {([
            ["all", "全部"],
            ["local", "本地"],
            ["plugin", "插件"],
            ["pending", "待导入"],
          ] as const).map(([value, label]) => (
            <button
              className={sourceFilter === value ? "is-active" : ""}
              type="button"
              aria-pressed={sourceFilter === value}
              key={value}
              onClick={() => setSourceFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="skill-library-import-actions">
          <button
            className="ghost-button"
            type="button"
            disabled={busy || selectedPending.length === 0}
            onClick={() => void importSkills(selectedPending)}
          >
            导入选中（{selectedPending.length}）
          </button>
          <button
            className="bamboo-button"
            type="button"
            disabled={busy || pendingCount === 0}
            onClick={() => void importSkills([])}
          >
            {busy ? "正在载入…" : `载入全部（${pendingCount}）`}
          </button>
        </div>
      </div>

      {error ? (
        <div className="skill-library-message is-error" role="alert">
          <strong>技能库载入失败</strong>
          <span>{error}</span>
          <button type="button" onClick={() => void onRefresh()}>重试</button>
        </div>
      ) : null}

      {lastResult ? (
        <div className={`skill-library-message ${lastResult.errors.length ? "is-warn" : "is-success"}`} role="status">
          <strong>上次导入结果</strong>
          <span>
            新增 {lastResult.imported.length} · 已存在 {lastResult.skipped.length}
            {lastResult.errors.length ? ` · 失败 ${lastResult.errors.length}` : ""}
          </span>
        </div>
      ) : null}

      {catalog?.warnings.length ? (
        <details className="skill-library-warnings">
          <summary>{catalog.warnings.length} 条扫描提示</summary>
          <ul>{catalog.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </details>
      ) : null}

      <div className="skill-library-list" role="list">
        {!catalog && busy ? (
          <div className="skill-library-empty">正在扫描 Codex 技能目录…</div>
        ) : entries.length === 0 ? (
          <div className="skill-library-empty">
            {catalog?.entries.length ? "没有符合筛选条件的技能" : "未发现可载入的 Codex 技能"}
          </div>
        ) : entries.map((entry) => (
          <article className={`skill-library-row ${entry.imported ? "is-imported" : ""}`} role="listitem" key={entry.id}>
            <label className="skill-library-check">
              <input
                type="checkbox"
                checked={entry.imported || selectedIds.has(entry.id)}
                disabled={busy || entry.imported}
                onChange={() => toggleSelected(entry.id)}
              />
              <span aria-hidden="true" />
            </label>
            <div className="skill-library-copy">
              <div>
                <strong>{entry.name}</strong>
                <span className="skill-library-source">{entry.source}</span>
                {entry.imported ? <span className="skill-library-state">已载入</span> : null}
              </div>
              <p>{entry.description || "该技能未提供 description"}</p>
              <small title={entry.sourcePath}>
                {entry.relativePath} · {entry.fileCount} 个文件 · {formatBytes(entry.byteSize)}
              </small>
            </div>
            {entry.imported && entry.importedId ? (
              <button
                className="ghost-button skill-library-open"
                type="button"
                onClick={() => onOpenImported(entry.importedId!)}
              >
                打开副本
              </button>
            ) : (
              <button
                className="ghost-button skill-library-open"
                type="button"
                disabled={busy}
                onClick={() => void importSkills([entry.id])}
              >
                导入
              </button>
            )}
          </article>
        ))}
      </div>

      <footer className="skill-library-foot">
        <span>导入会复制完整技能目录；再次扫描不会覆盖已编辑副本。</span>
        <span>{catalog ? `扫描时间 ${formatTime(catalog.scannedAt)}` : ""}</span>
      </footer>
    </section>
  );
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}

function formatTime(value: number) {
  if (!value) return "未知";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value * 1000));
}
