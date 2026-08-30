# SkillCreator 入口索引

## 工程入口

- Flutter Windows 客户端：`project/skillcreator-flutter/`
- Flutter 应用入口：`project/skillcreator-flutter/lib/main.dart`
- Flutter 状态与多文件 Skill 控制器：`project/skillcreator-flutter/lib/app_controller.dart`
- Flutter 编辑器：`project/skillcreator-flutter/lib/pages/editor_page.dart`
- Flutter 详细设计（bundle / 章节 / 固定编号规则 / 源码）：`project/skillcreator-flutter/lib/pages/advanced_studio_page.dart`
- Flutter 规则图：`project/skillcreator-flutter/lib/pages/rule_graph_page.dart`
- Flutter AI / 技能库 / 设置：`project/skillcreator-flutter/lib/pages/studio_pages.dart`
- Flutter Skill/API 客户端：`project/skillcreator-flutter/lib/services/`
- Windows 自绘标题栏与原生窗口壳：`project/skillcreator-flutter/windows/runner/`
- Flutter Design 初始化回执：`project/skillcreator-flutter/.flutter-app-design-init.json`
- 独立 Rust HTTP/JSON 后台：`project/skillcreator-rust-server/`
- Rust API 入口：`project/skillcreator-rust-server/src/main.rs`
- Skill bundle / Codex 调用 / 路径安全：`project/skillcreator-rust-server/src/skill_store.rs`
- 外部模型无窗口 CLI：`command/Invoke-SkillCreator.ps1`
- 本机 Codex Skill：`C:\Users\Administrator\.codex\skills\skillcreator-cli\`

## Skill 规范与能力

- 根 `SKILL.md` 只负责 frontmatter、必须遵守的顶部规则和分区索引；详细规则进入独立 Markdown 分区。
- 一次性工程规则放 `references/initialization.md`，常规执行不重复加载初始化分区。
- Skill bundle 可包含安全 UTF-8 文本源码、模板和脚本，例如 `assets/*.dart`、`assets/*.rs`、`scripts/*.ps1`；Markdown 路由仍只指向 `.md`。
- CLI 支持 `rule-check`、`rule-find`、`rule-add`、`rule-update`；CLI 创建的规则使用稳定 Rule ID 和固定分区编号。
- 新增规则默认执行全 bundle 查重、低价值/小概率规则审查和默认行为冗余审查；修改规则默认检查弱化/回退风险。
- AI 设计请求携带完整 `currentFiles`，响应使用 `files[] + deletedFiles[]`；stale 校验基于整个 bundle hash。
- 多文件保存使用显式删除、提案覆盖、未提及文件保留的事务语义。

## 构建与运行

- 统一 Windows 入口：`command/run.ps1`
- Debug：`command/run.ps1 -BuildOnly -Configuration Debug`
- Release：`command/run.ps1 -BuildOnly -Configuration Release`
- Flutter/Rust 构建缓存、Pub cache、runtime-home、TEMP：优先 `H:\vibecoding\sdk\`
- Flutter SDK / Rust toolchain / MSVC：`D:\vibecoding\sdk\`
- Windows SDK 构建镜像：`H:\vibecoding\sdk\windows-sdk-10.0.26100.0`
- Debug CLI backend：`release/skillcreator-rust-server/windows/debug/skill_api_server.exe`
- Release CLI backend：`release/skillcreator-rust-server/windows/release/skill_api_server.exe`
- CLI 回归：`command/test-skillcreator-cli.ps1`

## 发布入口

- Windows portable 发布脚本：`command/Publish-SkillCreator.ps1`
- Windows portable 产物：`release/skillcreator-flutter/windows/release/`
- GitHub Windows prerelease CI：`.github/workflows/private-release.yml`
- 静态发布页：`site/`
- 站点构建器：`command/Build-SkillCreatorSite.mjs`
- 站点验证器：`command/Verify-SkillCreatorSite.mjs`
- Cloudflare 构建/部署：`command/Deploy-SkillCreatorSite.ps1`
- 公开发布页 CI：`.github/workflows/pages.yml`
- 版本说明：`RELEASE_NOTES.md`

## 已移除技术入口

- `frontend/` React/Vite GUI 已删除。
- `src-tauri/` Tauri runtime/backend 已删除。
- 旧 `SkillAgentTool.sln`、`src/SkillAgentTool/` WinUI/.NET 原型和 `src/SkillAgentBridgeCpp/` C++ bridge 已删除。
- 根 `package.json`、`package-lock.json`、`tsconfig.json`、`vite.config.ts` 已删除。
- 桌面 GUI 唯一受支持实现为 Flutter；后台唯一受支持实现为独立 Rust server。不存在 Tauri、WinUI/C++ 兼容壳或旧 GUI fallback。

新增、迁移或删除上述关键入口、工程或发布目录时，同步更新本索引。
