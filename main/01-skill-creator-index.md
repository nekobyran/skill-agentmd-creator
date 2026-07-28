# Skill Creator 入口索引

## 应用入口

- React 主界面：`frontend/src/App.tsx`
- 全局视觉样式：`frontend/src/styles.css`
- Tauri 命令入口：`src-tauri/src/main.rs`
- 本地 HTTP 后台：`src-tauri/src/bin/skill_api_server.rs`
- Skill 存储与 Codex 调用：`src-tauri/src/skill_store.rs`

## 技能设计模块

- 完整 Markdown、frontmatter、Contract、Workflow 领域模型：`frontend/src/features/skill-document/`
- Flutter App Design 与 workflow-task 预设：`frontend/src/features/skill-document/presets/`
- 详细设计逐属性编辑器：`frontend/src/features/skill-editor/`
- AI 创建/修改聊天工作台：`frontend/src/features/ai-assistant/`

## 构建与运行

- 统一入口：`command/run.ps1`
- Skill 文档领域测试：`command/test-skill-document.ps1`
- Windows release / GitHub Release：`command/Publish-SkillCreator.ps1`
- Node 与 Rust SDK：`D:\vibecoding\sdk\nodejs`、`D:\vibecoding\sdk\rust`
- 前端产物：`dist/`
- Rust 临时构建目录：`src-tauri/target/`（验证完成后清理）

## 发布入口

- 线上静态发布页：`https://skillcreator.nkbr.cc`
- 静态站源码：`site/`
- 站点构建器：`command/Build-SkillCreatorSite.mjs`
- 站点验证器：`command/Verify-SkillCreatorSite.mjs`
- Cloudflare 构建/预演/部署：`command/Deploy-SkillCreatorSite.ps1`
- Cloudflare Static Assets 配置：`wrangler.skillcreator.jsonc`
- 公开发布页 CI：`.github/workflows/pages.yml`
- 公开 Windows prerelease CI：`.github/workflows/private-release.yml`
- 版本说明：`RELEASE_NOTES.md`
- 开源协议：`LICENSE`（Apache-2.0）与 `NOTICE`
- 本地 Windows 发布资产：`release/skillcreator_windows/release/`（生成物，不入库）
- 本地静态部署产物：`release/skillcreator_site_Web/release/`（生成物，不入库）
- 视觉与协议证据：`verification/skillcreator-release-site/`

新增或迁移上述入口、模块或产物目录时，同步更新本索引。

## 文件边界记录

- `frontend/src/App.tsx` 是接手前已超过 3,600 行的旧编辑器单体。本次新增的详细设计、AI 工作台和文档领域逻辑均已落到独立 feature；后续拆分点是把旧“顶部规则 / 本地规则 / 命令工具”面板迁出 App，避免在本次高风险存储改造中顺带重写既有编辑器。
- `src-tauri/src/skill_store.rs` 的生产代码仍低于 2,000 行；文件总行数超过阈值来自同文件内的 Rust 单元测试。后续若测试继续增长，优先迁到独立测试模块。
