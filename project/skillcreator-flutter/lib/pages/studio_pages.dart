import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../models/skill_models.dart';
import '../theme/app_ui_tokens.dart';

class AiStudioPage extends StatefulWidget {
  const AiStudioPage({super.key, required this.controller});
  final AppController controller;
  @override
  State<AiStudioPage> createState() => _AiStudioPageState();
}

class _AiStudioPageState extends State<AiStudioPage> {
  final prompt = TextEditingController();
  String mode = 'modify';
  AiProposal? proposal;

  @override
  void dispose() {
    prompt.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (mode == 'modify' && widget.controller.selected == null) mode = 'create';
    final history = widget.controller.conversation(mode);
    return Padding(
      padding: const EdgeInsets.all(AppUiTokens.pagePadding),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'AI Skill Studio',
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                    Text(
                      '先生成提案，再人工审阅并应用；AI 不直接写入 Skill。',
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                  ],
                ),
              ),
              SegmentedButton<String>(
                segments: [
                  const ButtonSegment(
                    value: 'create',
                    icon: Icon(Icons.add_circle_outline),
                    label: Text('创建'),
                  ),
                  ButtonSegment(
                    value: 'modify',
                    enabled: widget.controller.selected != null,
                    icon: const Icon(Icons.edit_note_outlined),
                    label: const Text('修改'),
                  ),
                ],
                selected: {mode},
                showSelectedIcon: false,
                onSelectionChanged: (value) => setState(() {
                  mode = value.first;
                  proposal = null;
                }),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Expanded(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(
                  flex: 5,
                  child: Card(
                    child: Column(
                      children: [
                        Expanded(
                          child: history.isEmpty
                              ? Center(
                                  child: Padding(
                                    padding: const EdgeInsets.all(24),
                                    child: Column(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        const Icon(
                                          Icons.auto_awesome_outlined,
                                          size: 42,
                                        ),
                                        const SizedBox(height: 12),
                                        Text(
                                          mode == 'create'
                                              ? '描述你要创建的 Skill'
                                              : '描述你想修改的规则或结构',
                                        ),
                                        const SizedBox(height: 14),
                                        Wrap(
                                          spacing: 8,
                                          runSpacing: 8,
                                          children:
                                              (mode == 'create'
                                                      ? const [
                                                          '创建一个代码审查 Skill',
                                                          '把需求拆成属性、条件与结果',
                                                          '生成多文件索引式 Skill',
                                                        ]
                                                      : const [
                                                          '把规则改成结果化词汇',
                                                          '减少入口文件上下文',
                                                          '检查条件冲突并修正',
                                                        ])
                                                  .map(
                                                    (text) => ActionChip(
                                                      label: Text(text),
                                                      onPressed: () =>
                                                          prompt.text = text,
                                                    ),
                                                  )
                                                  .toList(),
                                        ),
                                      ],
                                    ),
                                  ),
                                )
                              : ListView.builder(
                                  padding: const EdgeInsets.all(16),
                                  itemCount: history.length,
                                  itemBuilder: (context, index) {
                                    final message = history[index];
                                    final user = message['role'] == 'user';
                                    return Align(
                                      alignment: user
                                          ? Alignment.centerRight
                                          : Alignment.centerLeft,
                                      child: Container(
                                        constraints: const BoxConstraints(
                                          maxWidth: 620,
                                        ),
                                        margin: const EdgeInsets.only(
                                          bottom: 10,
                                        ),
                                        padding: const EdgeInsets.all(12),
                                        decoration: BoxDecoration(
                                          color: user
                                              ? Theme.of(
                                                  context,
                                                ).colorScheme.primaryContainer
                                              : Theme.of(context)
                                                    .colorScheme
                                                    .surfaceContainerHighest,
                                          borderRadius: BorderRadius.circular(
                                            12,
                                          ),
                                        ),
                                        child: SelectableText(
                                          message['content'] ?? '',
                                        ),
                                      ),
                                    );
                                  },
                                ),
                        ),
                        Padding(
                          padding: const EdgeInsets.all(12),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Expanded(
                                child: TextField(
                                  controller: prompt,
                                  minLines: 1,
                                  maxLines: 6,
                                  decoration: InputDecoration(
                                    hintText: mode == 'create'
                                        ? '描述目标 Skill…'
                                        : '描述对当前 Skill 的修改…',
                                  ),
                                  onSubmitted: (_) =>
                                      widget.controller.aiBusy ? null : _send(),
                                ),
                              ),
                              const SizedBox(width: 8),
                              if (widget.controller.aiBusy)
                                FilledButton.tonalIcon(
                                  onPressed: widget.controller.cancelAi,
                                  icon: const Icon(Icons.stop_circle_outlined),
                                  label: const Text('停止'),
                                )
                              else
                                FilledButton.icon(
                                  onPressed: _send,
                                  icon: const Icon(Icons.send_rounded),
                                  label: const Text('生成'),
                                ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  flex: 4,
                  child: _ProposalPane(
                    controller: widget.controller,
                    proposal: proposal,
                    onChanged: () => setState(() {}),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _send() async {
    if (prompt.text.trim().isEmpty) return;
    final text = prompt.text;
    prompt.clear();
    final next = await widget.controller.requestAiDesign(
      mode: mode,
      prompt: text,
    );
    if (!mounted) return;
    setState(() => proposal = next);
  }
}

class _ProposalPane extends StatelessWidget {
  const _ProposalPane({
    required this.controller,
    required this.proposal,
    required this.onChanged,
  });
  final AppController controller;
  final AiProposal? proposal;
  final VoidCallback onChanged;
  @override
  Widget build(BuildContext context) {
    final value = proposal;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: value == null
            ? const Center(
                child: Text(
                  'AI 提案会显示在这里。\n应用前可检查完整 diff。',
                  textAlign: TextAlign.center,
                ),
              )
            : Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    value.title,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 5),
                  Text(value.summary),
                  if (value.changedFiles.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Text(
                      '变更文件：${value.changedFiles.join(', ')}',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                  if (value.warnings.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    for (final warning in value.warnings)
                      Text(
                        '⚠ $warning',
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                        ),
                      ),
                  ],
                  const SizedBox(height: 12),
                  Expanded(
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: Theme.of(
                          context,
                        ).colorScheme.surfaceContainerLowest,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: SingleChildScrollView(
                        padding: const EdgeInsets.all(12),
                        child: SelectableText(
                          value.diff,
                          style: const TextStyle(
                            fontFamily: 'Consolas',
                            fontFamilyFallback: ['Microsoft YaHei'],
                            fontSize: 12,
                            height: 1.35,
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          onPressed: value.applied || value.discarded
                              ? null
                              : () {
                                  value.discarded = true;
                                  onChanged();
                                },
                          child: const Text('丢弃'),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: FilledButton(
                          onPressed: value.applied || value.discarded
                              ? null
                              : () async {
                                  final error = await controller.applyProposal(
                                    value,
                                  );
                                                                    if (!context.mounted) return;
                                  if (error != null) {
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      SnackBar(content: Text(error)),
                                    );
                                  }
                                  onChanged();
                                },
                          child: Text(value.applied ? '已应用' : '应用提案'),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
      ),
    );
  }
}

class SkillLibraryPage extends StatefulWidget {
  const SkillLibraryPage({super.key, required this.controller});
  final AppController controller;
  @override
  State<SkillLibraryPage> createState() => _SkillLibraryPageState();
}

class _SkillLibraryPageState extends State<SkillLibraryPage> {
  final query = TextEditingController();
  final selected = <String>{};
  String filter = 'all';

  @override
  void initState() {
    super.initState();
    if (widget.controller.codexCatalog == null) widget.controller.loadCatalog();
  }

  @override
  void dispose() {
    query.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final catalog = widget.controller.codexCatalog;
    final needle = query.text.trim().toLowerCase();
    final entries = (catalog?.entries ?? const <CodexSkillEntry>[]).where((
      entry,
    ) {
      final matchText =
          needle.isEmpty ||
          '${entry.name} ${entry.description} ${entry.relativePath} ${entry.source}'
              .toLowerCase()
              .contains(needle);
      final matchFilter = switch (filter) {
        'local' => entry.source.toLowerCase().contains('local'),
        'plugin' => entry.source.toLowerCase().contains('plugin'),
        'pending' => !entry.imported,
        _ => true,
      };
      return matchText && matchFilter;
    }).toList();
    return Padding(
      padding: const EdgeInsets.all(AppUiTokens.pagePadding),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '技能库',
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                    Text(
                      '扫描 Codex 本地与插件 Skill，完整导入目录和多文件。',
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                  ],
                ),
              ),
              IconButton(
                tooltip: '重新扫描',
                onPressed: widget.controller.libraryBusy
                    ? null
                    : widget.controller.loadCatalog,
                icon: const Icon(Icons.refresh_rounded),
              ),
              const SizedBox(width: 8),
              FilledButton.icon(
                onPressed: selected.isEmpty || widget.controller.libraryBusy
                    ? null
                    : () => _import(selected.toList()),
                icon: const Icon(Icons.download_rounded),
                label: Text('导入 ${selected.length}'),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: query,
                  decoration: const InputDecoration(
                    prefixIcon: Icon(Icons.search_rounded),
                    hintText: '搜索名称、说明、路径或来源',
                  ),
                  onChanged: (_) => setState(() {}),
                ),
              ),
              const SizedBox(width: 10),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'all', label: Text('全部')),
                  ButtonSegment(value: 'local', label: Text('本地')),
                  ButtonSegment(value: 'plugin', label: Text('插件')),
                  ButtonSegment(value: 'pending', label: Text('待导入')),
                ],
                selected: {filter},
                showSelectedIcon: false,
                onSelectionChanged: (value) =>
                    setState(() => filter = value.first),
              ),
            ],
          ),
          if (catalog?.warnings.isNotEmpty ?? false) ...[
            const SizedBox(height: 10),
            Align(
              alignment: Alignment.centerLeft,
              child: Text(
                catalog!.warnings.join(' · '),
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          ],
          const SizedBox(height: 10),
          Expanded(
            child: widget.controller.libraryBusy && catalog == null
                ? const Center(child: CircularProgressIndicator())
                : ListView.separated(
                    itemCount: entries.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 8),
                    itemBuilder: (context, index) {
                      final entry = entries[index];
                      return Card(
                        child: CheckboxListTile(
                          value: selected.contains(entry.id),
                          onChanged: entry.loadable
                              ? (value) => setState(() {
                                  if (value == true) {
                                    selected.add(entry.id);
                                  } else {
                                    selected.remove(entry.id);
                                  }
                                })
                              : null,
                          title: Row(
                            children: [
                              Expanded(child: Text(entry.name)),
                              if (entry.imported)
                                const Chip(label: Text('已导入')),
                            ],
                          ),
                          subtitle: Padding(
                            padding: const EdgeInsets.only(top: 5),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                if (entry.description.isNotEmpty)
                                  Text(
                                    entry.description,
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                const SizedBox(height: 4),
                                Text(
                                  '${entry.source} · ${entry.fileCount} files · ${entry.byteSize} bytes',
                                  style: Theme.of(context).textTheme.bodySmall,
                                ),
                                if (entry.formatGaps.isNotEmpty)
                                  Text(
                                    '格式提示：${entry.formatGaps.join('；')}',
                                    style: TextStyle(
                                      color: Theme.of(
                                        context,
                                      ).colorScheme.tertiary,
                                    ),
                                  ),
                              ],
                            ),
                          ),
                          controlAffinity: ListTileControlAffinity.leading,
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }

  Future<void> _import(List<String> ids) async {
    final result = await widget.controller.importCatalog(ids);
    if (!mounted || result == null) return;
    setState(selected.clear);
    final errors = (result['errors'] as List?)?.length ?? 0;
    final imported = (result['imported'] as List?)?.length ?? 0;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          '已导入 $imported 个 Skill${errors > 0 ? '，$errors 个失败' : ''}',
        ),
      ),
    );
  }
}

class SettingsPage extends StatelessWidget {
  const SettingsPage({super.key, required this.controller});
  final AppController controller;

  @override
  Widget build(BuildContext context) {
    final status = controller.modelStatus;
    final selectedModel = status?.availableModels
        .where((e) => e.slug == status.model)
        .firstOrNull;
    return ListView(
      padding: const EdgeInsets.all(AppUiTokens.pagePadding),
      children: [
        Text('设置', style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('本地后台', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 10),
                _SettingRow(
                  title: 'Rust API',
                  detail: switch (controller.backendState) {
                    BackendState.connected => '127.0.0.1:1421 已连接',
                    BackendState.connecting => '正在连接',
                    BackendState.disconnected => '未连接',
                  },
                  trailing: FilledButton.tonal(
                    onPressed:
                        controller.backendState == BackendState.connecting
                        ? null
                        : controller.retryBackend,
                    child: const Text('重连'),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Codex 模型',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                    ),
                    IconButton(
                      tooltip: '刷新模型状态',
                      onPressed: controller.refreshModelStatus,
                      icon: const Icon(Icons.refresh_rounded),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                if (status == null)
                  const Text('尚未读取 Codex 模型状态。')
                else ...[
                  _SettingRow(
                    title: '连接状态',
                    detail: status.message,
                    trailing: Chip(
                      label: Text(status.connected ? '已连接' : '未连接'),
                    ),
                  ),
                  const SizedBox(height: 10),
                  _SettingRow(
                    title: '模型',
                    detail: '用于规则翻译与 AI Skill 设计',
                    trailing: DropdownButton<String>(
                      value:
                          status.availableModels.any(
                            (e) => e.slug == status.model,
                          )
                          ? status.model
                          : null,
                      items: status.availableModels
                          .map(
                            (model) => DropdownMenuItem(
                              value: model.slug,
                              child: Text(model.displayName),
                            ),
                          )
                          .toList(),
                      onChanged: controller.busy
                          ? null
                          : (value) => value == null
                                ? null
                                : controller.changeModel(model: value),
                    ),
                  ),
                  const SizedBox(height: 10),
                  _SettingRow(
                    title: '思考程度',
                    detail: '控制 Skill 设计前的推理深度',
                    trailing: SegmentedButton<String>(
                      segments:
                          (selectedModel?.reasoningLevels.isNotEmpty ?? false
                                  ? selectedModel!.reasoningLevels
                                  : const ['low', 'medium', 'high'])
                              .map(
                                (effort) => ButtonSegment(
                                  value: effort,
                                  label: Text(effort),
                                ),
                              )
                              .toList(),
                      selected: {status.reasoningEffort},
                      showSelectedIcon: false,
                      onSelectionChanged: controller.busy
                          ? null
                          : (values) =>
                                controller.changeModel(effort: values.first),
                    ),
                  ),
                  const SizedBox(height: 10),
                  _SettingRow(
                    title: 'Fast',
                    detail: selectedModel?.supportsFast == true
                        ? '提高响应速度并增加用量'
                        : '当前模型不支持 Fast',
                    trailing: Switch(
                      value: status.fastMode,
                      onChanged:
                          controller.busy || selectedModel?.supportsFast != true
                          ? null
                          : (value) => controller.changeModel(fast: value),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _SettingRow extends StatelessWidget {
  const _SettingRow({
    required this.title,
    required this.detail,
    required this.trailing,
  });
  final String title;
  final String detail;
  final Widget trailing;
  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: Theme.of(context).textTheme.labelLarge),
            const SizedBox(height: 2),
            Text(detail, style: Theme.of(context).textTheme.bodySmall),
          ],
        ),
      ),
      const SizedBox(width: 16),
      trailing,
    ],
  );
}
