# SkillCreator

SkillCreator 是一个 Flutter Windows 桌面工具，用于创建、编辑和审查 Codex Skill 目录包；Rust sidecar 提供本地存储、Codex 调用、兼容性分析与无界面 CLI API。

> 当前版本：`v1.0.0`，Windows x64。

## 架构

- 桌面客户端：Flutter / Material 3。
- Windows 壳：Flutter Windows runner + 原生 Win32 自绘标题栏、Snap、DPI、系统菜单与窗口命中。
- 后台：独立 Rust `skill_api_server.exe`，默认监听 `http://127.0.0.1:1421/api`。
- CLI：`command/Invoke-SkillCreator.ps1`，与 Flutter GUI 共享同一 Rust API/Skill bundle 契约。
- Skill 存储：目录 bundle。根 `SKILL.md` 是紧凑索引；详细规则、初始化规则、验证和可复用源码可拆到独立文件。
- 发布：完整 Flutter runner + Rust sidecar 打包为 Windows x64 portable ZIP。

仓库已不再使用 React、Vite 或 Tauri 作为桌面运行时。

## Skill 结构原则

规范 Skill 默认采用分文件结构：

```text
skill-name/
├── SKILL.md
├── references/
│   ├── initialization.md
│   ├── rules.md
│   └── validation.md
├── assets/
│   └── reusable-helper.ps1
└── scripts/
    └── verify.ps1
```

- 根 `SKILL.md` 只保留 frontmatter、必须始终遵守的顶部规则和分区索引。
- 仅首次工程执行、bootstrap 或迁移需要的规则放入 `references/initialization.md`。
- Skill 可内置安全 UTF-8 文本源码、脚本、模板和配置，例如 `.md`、`.ps1`、`.dart`、`.rs`、`.json`、`.yaml`。
- AI `design-*` 返回完整 `markdown + files[] + deletedFiles[]` bundle；修改模式保留未提及文件，只删除显式删除项。
- GUI 的 AI 提案 diff 覆盖根文件和所有变更子文件，并通过整个 bundle hash 防止提案覆盖提案生成后的新改动。
- Flutter“详细设计”直接面向当前 canonical bundle：检查 Skill Map 一致性、无损定位 H2 章节、增删/改名/排序章节，并编辑固定编号规则；规则翻译复用同一 Rust API，不再依赖旧 React/Tauri 管理块。

## 规则治理

CLI 创建的规则使用稳定 Rule ID 与文件内固定编号。新增规则只追加下一个编号，修改规则保持原 ID/编号。

新增或修改前会检查：

- 完整 Skill bundle 中是否已有语义重复或高度重叠规则。
- 是否只是默认行为或一般质量要求，无需 Skill 再规范。
- 是否仅针对孤立、小概率事件追加 `禁止/不得/...` 规则。
- 修改是否弱化既有 MUST、条件、禁止范围、唯一性、验证或证据要求。

默认审查失败会拒绝写入；只有调用方明确使用 `-Force` 才能越过审查。

## 快速运行

```powershell
cd "D:\vibecoding\project\skill creator"
.\command\run.ps1
```

运行脚本使用 D/H 盘 `vibecoding\sdk` 下的 Flutter、Rust、MSVC、CMake/Ninja、Pub/Cargo cache 和临时目录，不在 C 盘建立编译环境。默认执行：

1. Flutter `pub get`、`analyze`、`test`。
2. 独立 Rust API 构建。
3. Flutter Windows CMake/Ninja 构建。
4. 将 Rust sidecar 固化到 Flutter runner，并同步 CLI 后台产物。

常用参数：

```powershell
# 只构建 Debug
.\command\run.ps1 -BuildOnly

# Release 构建
.\command\run.ps1 -BuildOnly -Configuration Release

# 使用已验证产物直接启动
.\command\run.ps1 -SkipBuild

# 窄窗口启动
.\command\run.ps1 -Sidebar
```

`command/start-hidden.vbs` 可用于隐藏终端启动；Flutter 客户端会在需要时自动启动同目录的 Rust sidecar。

## 无窗口 CLI

```powershell
# 运行状态、目录与兼容性
pwsh -NoProfile -File .\command\Invoke-SkillCreator.ps1 -Action health
pwsh -NoProfile -File .\command\Invoke-SkillCreator.ps1 -Action audit -ReportPath .\output\codex-skill-compatibility.json
pwsh -NoProfile -File .\command\Invoke-SkillCreator.ps1 -Action catalog
pwsh -NoProfile -File .\command\Invoke-SkillCreator.ps1 -Action load

# Skill bundle
pwsh -NoProfile -File .\command\Invoke-SkillCreator.ps1 -Action list
pwsh -NoProfile -File .\command\Invoke-SkillCreator.ps1 -Action read -SkillId <skill-id>
pwsh -NoProfile -File .\command\Invoke-SkillCreator.ps1 -Action files -SkillId <skill-id>
pwsh -NoProfile -File .\command\Invoke-SkillCreator.ps1 -Action create -SourcePath <skill-directory-or-SKILL.md>
pwsh -NoProfile -File .\command\Invoke-SkillCreator.ps1 -Action update -SkillId <skill-id> -SourcePath <skill-directory-or-SKILL.md>

# AI 设计
pwsh -NoProfile -File .\command\Invoke-SkillCreator.ps1 -Action design-create -Prompt "<requirements>"
pwsh -NoProfile -File .\command\Invoke-SkillCreator.ps1 -Action design-update -SkillId <skill-id> -Prompt "<requirements>"
pwsh -NoProfile -File .\command\Invoke-SkillCreator.ps1 -Action design-source-update -SourcePath <skill-directory-or-SKILL.md> -Prompt "<requirements>"

# 规则审查、定位、新增和修改
pwsh -NoProfile -File .\command\Invoke-SkillCreator.ps1 -Action rule-check -SkillId <skill-id> -RuleText "<candidate>"
pwsh -NoProfile -File .\command\Invoke-SkillCreator.ps1 -Action rule-find -SkillId <skill-id>
pwsh -NoProfile -File .\command\Invoke-SkillCreator.ps1 -Action rule-add -SkillId <skill-id> -TargetFile references/rules.md -RuleText "<rule>"
pwsh -NoProfile -File .\command\Invoke-SkillCreator.ps1 -Action rule-update -SkillId <skill-id> -RuleId <stable-rule-id> -RuleText "<replacement>"
```

CLI 契约回归：

```powershell
pwsh -NoProfile -File .\command\test-skillcreator-cli.ps1
```

## 工程目录

- Flutter：`project/skillcreator-flutter/`
- Rust sidecar：`project/skillcreator-rust-server/`
- CLI：`command/Invoke-SkillCreator.ps1`
- 本地运行/构建：`command/run.ps1`
- Windows 发布：`command/Publish-SkillCreator.ps1`
- 静态官网：`site/`
- 官网构建/部署：`command/Build-SkillCreatorSite.mjs`、`command/Deploy-SkillCreatorSite.ps1`

`src/` 下的旧 WinUI/C++ 实现仅作为历史参考，不是当前启动入口。

## 发布

本地构建并生成完整 Windows x64 portable ZIP、SHA-256 和 manifest：

```powershell
.\command\Publish-SkillCreator.ps1 -Version 1.0.0
```

发布物位于：

```text
release/skillcreator-flutter/windows/release/
├── SkillCreator-v1.0.0-Windows-x64/
├── SkillCreator-v1.0.0-Windows-x64-Portable.zip
├── SkillCreator-v1.0.0-SHA256.txt
└── SkillCreator-v1.0.0-manifest.json
```

GitHub Actions 在 `windows-latest` 独立执行 Flutter analyze/test/build 与 Rust fmt/clippy/test/build，再将 Rust sidecar 注入 Flutter runner 并发布 ZIP。生产发布页为 `https://skillcreator.nkbr.cc`。

## 验证门禁

桌面/API 改动至少要求：

- `dart format`、`flutter analyze`、`flutter test`。
- Windows Flutter runner 构建与启动 smoke。
- `cargo fmt --check`、`cargo clippy -D warnings`、`cargo test`。
- CLI contract test。
- 发布链改动还需 Release bundle/ZIP/manifest 验证。

## 开源协议

项目采用 [Apache License 2.0](LICENSE)。第三方依赖遵循各自许可证。
