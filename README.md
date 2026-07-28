# SkillCreator

一个轻量 Tauri 2 桌面工具，用于结构化创建标准 Codex Skill 包并维护 AI 入口 manifest。

> 当前发布：`v1.0.0` 公开预览，Windows x64。源码与 Release 均可从公开 GitHub 仓库访问。

## 当前方案

- 桌面壳：Tauri 2 / Rust
- 前端：React 19 + Vite + Tailwind CSS 4
- UI：参考 Floral Notepaper 的纸张色系与 bamboo 主按钮，主界面为三栏结构：左侧 skill 列表、中间规则类型和规则列表、右侧选中项编辑菜单。左侧列表右下角 `+` 会弹出名称确认框并创建新的 `skill-name/SKILL.md`，当前选中的 skill 会在列表中高亮。
- 编辑：中间栏可选择“顶部规则”“局部规则”或“纯命令工具”，类型入口为横向紧凑分段条，并在下方显示当前类型的列表；中间栏右下角 `+` 用于向当前类型添加条目。列表项支持长按拖动排序，超过每页数量时在列表底部显示分页。选中后右侧栏只显示这一条的编辑菜单。顶部规则包含规则名、是否写入规则名、内容别名、分类和英文实际内容；局部规则包含规则名、分类、触发条件、限制条件、路线和触发结果。触发条件和限制条件都包含别名和英文实际内容。纯命令工具包含工具名、别名、命令和用途说明。别名和分类只用于看懂和组织，不写入 skill；英文实际内容、局部规则输出和纯命令工具输出写入 skill。
- 详细设计：提供章节、Skill Contract、Workflow Blueprint 与完整源码四种视图。未知章节、嵌套 Markdown、代码块和自定义结构按原文保留；Contract/Workflow 的扩展属性写入带版本的托管元数据，同时保留可直接阅读的 Markdown 摘要。
- 领域预设：内置 Flutter App Design 与 workflow-task 两套覆盖模板。Flutter 预设保留当前技能全文与 57 条约束；workflow-task 预设覆盖 19 个动作、33 个参数，以及 task scope、冲突、协作、证据和审查属性。
- AI 工作台：复用本机 Codex 登录与模型设置，通过聊天创建或修改 Skill。AI 只生成内存提案，支持修改前/修改后/差异审阅、内容哈希过期检查、明确应用或放弃；确认前不会写入磁盘。
- 预览：右上角展开技能本体时，预览面板从右侧出现并压缩编辑区，左侧列表和编辑区自动缩放适配。
- 写入位置：应用数据目录下的 `skills/`

## Skill 输出规则

- 创建结果是标准 Skill 目录：`skill-name/SKILL.md`。
- 新建的基础 `SKILL.md` frontmatter 默认写 `name` 和 `description`；详细设计与 AI 修改会无损保留已有自定义 frontmatter。
- `name` 会规范化为小写英文、数字和连字符，例如 `Plan Mode` 会变成 `plan-mode`。
- `aliases` 支持多语言别名，例如中文、日文、英文或其他语言名称；别名写入正文，不写入 frontmatter。
- `content` 写英文正文，并输出到 `## Content`。
- 顶部规则逐条输入，输出时自动编号。
- 条件规则按 `如果 <触发条件> 那么 <触发结果>` 输出。
- 限制条件输出为 `如果 <触发条件>，限制 <限制条件> 那么 <触发结果>`。
- 多个触发条件或限制条件自动用 `并且` 连接。
- 同一条件可添加多条路线，输出为 `如果 <判断条件>，路线 <路线> 那么 <触发结果>`。
- 触发结果支持 `要求` 和 `流程`；流程步骤自动用 `→` 连接。
- 局部规则支持分类；分类用于编辑器组织，不写入生成文本。
- 每条顶部规则、局部规则和纯命令工具都支持命名；局部规则名默认用于编辑器理解，不改变 `如果/那么` 输出文本。
- 纯命令工具输出到 `## 纯命令工具`，用于给 AI 留命令调用入口，不在编辑器内执行命令。

## 快速运行

```powershell
cd "D:\vibecoding\project\skill creator"
.\command\run.ps1
```

脚本会安装前端依赖、构建 React/Tailwind、构建 Tauri Rust 壳和本地 Rust API 后台，然后启动：

- Rust API 后台：`http://127.0.0.1:1421/api/health`
- Vite 前端：`http://127.0.0.1:1420/`
- Tauri 桌面窗口

构建脚本固定使用 `D:\vibecoding\sdk\nodejs`、`D:\vibecoding\sdk\rust` 与 `D:\vibecoding\sdk\npm-cache`，临时目录固定在当前项目的 `.tmp/`，不会在 C 盘创建编译环境。

Codex 侧边浏览器直接打开 `http://127.0.0.1:1420/` 时，会通过 `127.0.0.1:1421` 连接后台并支持读取、创建、自动保存 skill。

默认启动完整窗口；如需侧边窗口启动（固定 360px 宽的边栏样式），加参数 `-Sidebar`：

```powershell
.\command\run.ps1 -Sidebar
```

侧边窗口启动时默认会先做一次后台连通性检测，未连接到 Tauri 后台命令会提示重试。

不显示后台终端启动：

```text
command\start-hidden.vbs
```

侧边窗口后台隐藏启动可加参数：

```text
command\start-hidden.vbs sidebar
```

只构建不启动：

```powershell
.\command\run.ps1 -BuildOnly
```

已有产物通过验证后，可跳过重复构建直接启动：

```powershell
.\command\run.ps1 -SkipBuild
```

Skill 文档、异常元数据和两套预设的运行时检查：

```powershell
.\command\test-skill-document.ps1
```

## 发布

- 生产发布页：`https://skillcreator.nkbr.cc`
- 静态站源码：`site/`，Cloudflare Workers Static Assets 负责生产托管；GitHub workflow 负责公开仓库验证、Windows 预发布和短期构建产物归档。
- 版本说明：`RELEASE_NOTES.md`
- 公开仓库：`https://github.com/nekobyran/skill-agentmd-creator`
- v1.0.0 Release：`https://github.com/nekobyran/skill-agentmd-creator/releases/tag/v1.0.0`

本地验证并生成 Windows x64 NSIS 安装包、便携主程序、SHA-256 和 manifest：

```powershell
.\command\Publish-SkillCreator.ps1 -Version 1.0.0
```

生成并验证静态发布产物，执行 Cloudflare 预演或正式部署：

```powershell
.\command\Deploy-SkillCreatorSite.ps1 -Action Build
.\command\Deploy-SkillCreatorSite.ps1 -Action DryRun
.\command\Deploy-SkillCreatorSite.ps1 -Action Deploy
```

`Publish-SkillCreator.ps1` 优先把 Rust/NSIS 临时构建目录放到空间充足的 `H:\vibecoding\sdk\build-cache`，复制发布资产后按参数清理。`Deploy-SkillCreatorSite.ps1` 从真实 Windows manifest 生成公开版本元数据，但不会把 EXE、签名材料或凭据放进静态页面。推送 `v*` tag 后，GitHub Actions 会在 Windows runner 独立重建并创建 prerelease；发布前会再次确认仓库 visibility 为 `PUBLIC`。

## 开源协议

项目采用 [Apache License 2.0](LICENSE) 开源，允许个人和商业使用、修改及再分发。分发源码或二进制版本时，必须保留版权声明、`LICENSE` 与 `NOTICE` 中的归属声明，并在修改过的文件中清楚标注变更；本协议不要求公开衍生作品源码。第三方依赖仍遵循各自许可证。

## AI 入口

应用启动后会生成：

- `agent-entry.json`
- `skill-name/SKILL.md`

入口 JSON 内包含写入目录、标准 Skill 文件名和建议调用参数结构。旧 `.agentmd` 文件仅作为历史内容读取，不再作为新建格式。

## 历史实现

旧的 WinUI/C# + C++ 实现仍保留在 `src/` 目录中作为历史参考；当前支持的启动入口是 Tauri。
