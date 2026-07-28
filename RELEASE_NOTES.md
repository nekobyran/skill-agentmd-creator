# SkillCreator v1.0.0

首个公开预览版本，面向需要创建、维护和审阅 Codex Skill 文档工作流的本地用户。

## 主要能力

- 使用结构化编辑器维护 Skill 身份、顶部规则、条件路线和命令工具。
- 无损保留未知 Markdown 章节、自定义 frontmatter、嵌套内容与代码块。
- 提供 Flutter App Design 与 workflow-task 领域预设。
- 通过本机 Codex 生成 AI 修改提案，并在写入前审阅修改前、修改后与差异。
- 默认把 Skill 数据保存在本机应用数据目录，不依赖远程业务服务。

## 发布资产

- `SkillCreator-v1.0.0-Windows-x64-Setup.exe`：Windows x64 安装包。
- `SkillCreator-v1.0.0-Windows-x64-Portable.exe`：免安装主程序。
- `SkillCreator-v1.0.0-SHA256.txt`：发布资产 SHA-256 校验值。
- `SkillCreator-v1.0.0-manifest.json`：版本、文件大小与哈希清单。

## 系统要求

- Windows 10 或 Windows 11，x64。
- Microsoft Edge WebView2 Runtime。安装包会在缺失时使用 Tauri 的 WebView2 引导安装模式。

## 已知边界

- 当前版本仅发布 Windows x64。
- 浏览器预览模式需要同时运行本地 Rust API；GitHub Pages 发布页仅用于产品介绍和版本入口。
- 源码与 Release 已公开，项目采用 Apache License 2.0；允许商用和再分发，但必须保留许可证、版权及 NOTICE 归属声明。
