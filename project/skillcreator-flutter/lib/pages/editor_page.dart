import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../models/skill_models.dart';
import '../services/skill_markdown.dart';
import '../theme/app_ui_tokens.dart';

class EditorPage extends StatefulWidget {
  const EditorPage({super.key, required this.controller});
  final AppController controller;

  @override
  State<EditorPage> createState() => _EditorPageState();
}

class _EditorPageState extends State<EditorPage> {
  final sourceController = TextEditingController();
  final nameController = TextEditingController();
  final descriptionController = TextEditingController();
  bool sourceMode = false;
  String _lastFile = '';
  String _lastSource = '';
  String _lastSkillId = '';

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_sync);
    _sync();
  }

  @override
  void didUpdateWidget(covariant EditorPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      oldWidget.controller.removeListener(_sync);
      widget.controller.addListener(_sync);
      _sync();
    }
  }

  void _sync() {
    if (!mounted) return;
    final c = widget.controller;
    if (_lastFile != c.activeFilePath ||
        (_lastSource != c.activeSource &&
            sourceController.text != c.activeSource)) {
      sourceController.value = TextEditingValue(
        text: c.activeSource,
        selection: TextSelection.collapsed(offset: c.activeSource.length),
      );
      _lastFile = c.activeFilePath;
      _lastSource = c.activeSource;
    }
    final skillId = c.selected?.id ?? '';
    if (_lastSkillId != skillId) {
      final entry = c.files.where((f) => f.isEntry).firstOrNull;
      final identity = SkillMarkdown.identity(entry?.content ?? c.activeSource);
      nameController.text = identity.name.isEmpty
          ? c.selected?.name ?? ''
          : identity.name;
      descriptionController.text = identity.description.isEmpty
          ? c.selected?.description ?? ''
          : identity.description;
      _lastSkillId = skillId;
    }
    setState(() {});
  }

  @override
  void dispose() {
    widget.controller.removeListener(_sync);
    sourceController.dispose();
    nameController.dispose();
    descriptionController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.controller;
    if (c.selected == null) {
      return _EmptyEditor(controller: c);
    }
    final editor = Column(
      children: [
        _EditorHeader(
          controller: c,
          sourceMode: sourceMode,
          onModeChanged: (value) => setState(() => sourceMode = value),
        ),
        Expanded(
          child: sourceMode || c.activeFilePath.toLowerCase() != 'skill.md'
              ? _SourceEditor(
                  controller: c,
                  textController: sourceController,
                  onEdited: (value) {
                    _lastSource = value;
                    c.updateActiveSource(value);
                  },
                )
              : _RulesEditor(controller: c),
        ),
      ],
    );
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth < 920) {
          return Column(
            children: [
              _CompactPickerBar(controller: c),
              Expanded(child: editor),
            ],
          );
        }
        return Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(width: 226, child: _SkillRail(controller: c)),
            VerticalDivider(
              color: Theme.of(context).colorScheme.outlineVariant,
            ),
            SizedBox(width: 210, child: _FileRail(controller: c)),
            VerticalDivider(
              color: Theme.of(context).colorScheme.outlineVariant,
            ),
            Expanded(child: editor),
          ],
        );
      },
    );
  }
}

class _CompactPickerBar extends StatelessWidget {
  const _CompactPickerBar({required this.controller});
  final AppController controller;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(10, 8, 10, 4),
      child: Row(
        children: [
          Expanded(
            child: DropdownButtonFormField<String>(
              initialValue: controller.selected?.id,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Skill'),
              items: controller.skills
                  .map(
                    (skill) => DropdownMenuItem(
                      value: skill.id,
                      child: Text(skill.name, overflow: TextOverflow.ellipsis),
                    ),
                  )
                  .toList(growable: false),
              onChanged: (id) => id == null || id == controller.selected?.id
                  ? null
                  : controller.selectSkill(id),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: DropdownButtonFormField<String>(
              initialValue: controller.activeFilePath,
              isExpanded: true,
              decoration: const InputDecoration(labelText: '文件'),
              items: controller.files
                  .map(
                    (file) => DropdownMenuItem(
                      value: file.path,
                      child: Text(file.path, overflow: TextOverflow.ellipsis),
                    ),
                  )
                  .toList(growable: false),
              onChanged: (path) =>
                  path == null ? null : controller.setActiveFile(path),
            ),
          ),
          IconButton(
            tooltip: '新增 Markdown',
            onPressed: () => _showAddFileDialog(context, controller),
            icon: const Icon(Icons.note_add_outlined),
          ),
        ],
      ),
    );
  }
}

class _EmptyEditor extends StatelessWidget {
  const _EmptyEditor({required this.controller});
  final AppController controller;
  @override
  Widget build(BuildContext context) => Center(
    child: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 440),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.extension_off_rounded, size: 42),
              const SizedBox(height: 14),
              Text(
                '还没有 Skill 工程',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 8),
              const Text(
                '创建一个 Skill，或从技能库导入后开始编辑。',
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 18),
              FilledButton.icon(
                onPressed: () => _showCreateDialog(context, controller),
                icon: const Icon(Icons.add_rounded),
                label: const Text('创建 Skill'),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

class _SkillRail extends StatelessWidget {
  const _SkillRail({required this.controller});
  final AppController controller;
  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: Theme.of(context).colorScheme.surfaceContainerLowest,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 8, 8),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    'Skill 工程',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                ),
                IconButton(
                  tooltip: '新建 Skill',
                  onPressed: () => _showCreateDialog(context, controller),
                  icon: const Icon(Icons.add_rounded),
                ),
              ],
            ),
          ),
          Expanded(
            child: ListView.builder(
              itemCount: controller.skills.length,
              itemBuilder: (context, index) {
                final skill = controller.skills[index];
                final selected = skill.id == controller.selected?.id;
                return ListTile(
                  dense: true,
                  selected: selected,
                  leading: Icon(
                    selected
                        ? Icons.extension_rounded
                        : Icons.extension_outlined,
                    size: 20,
                  ),
                  title: Text(
                    skill.name.isEmpty ? '未命名' : skill.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  subtitle: skill.description.isEmpty
                      ? null
                      : Text(
                          skill.description,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                  onTap: selected
                      ? null
                      : () => controller.selectSkill(skill.id),
                );
              },
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(8),
            child: OutlinedButton.icon(
              onPressed: controller.busy
                  ? null
                  : () => _confirmDelete(context, controller),
              icon: const Icon(Icons.delete_outline_rounded),
              label: const Text('删除当前'),
            ),
          ),
        ],
      ),
    );
  }
}

class _FileRail extends StatelessWidget {
  const _FileRail({required this.controller});
  final AppController controller;
  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(10, 12, 6, 8),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  '文件',
                  style: Theme.of(context).textTheme.titleSmall,
                ),
              ),
              IconButton(
                tooltip: '新增 Markdown',
                onPressed: () => _showAddFileDialog(context, controller),
                icon: const Icon(Icons.note_add_outlined),
              ),
            ],
          ),
        ),
        Expanded(
          child: ListView.builder(
            itemCount: controller.files.length,
            itemBuilder: (context, index) {
              final file = controller.files[index];
              return ListTile(
                key: ValueKey(file.path),
                dense: true,
                selected: controller.activeFilePath == file.path,
                leading: Icon(
                  file.isEntry
                      ? Icons.home_work_outlined
                      : Icons.description_outlined,
                  size: 19,
                ),
                title: Text(
                  file.path,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                subtitle: Text(
                  file.isEntry ? '入口索引' : '${file.content.length} chars',
                  maxLines: 1,
                ),
                trailing: file.isEntry
                    ? null
                    : IconButton(
                        tooltip: '移除文件',
                        visualDensity: VisualDensity.compact,
                        onPressed: () => controller.removeSkillFile(file.path),
                        icon: const Icon(Icons.close_rounded, size: 17),
                      ),
                onTap: () => controller.setActiveFile(file.path),
              );
            },
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              OutlinedButton(
                onPressed: controller.syncIndex,
                child: const Text('同步 Skill Map'),
              ),
              const SizedBox(height: 6),
              OutlinedButton(
                onPressed: controller.minimizeEntry,
                child: const Text('入口最小化'),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _EditorHeader extends StatelessWidget {
  const _EditorHeader({
    required this.controller,
    required this.sourceMode,
    required this.onModeChanged,
  });
  final AppController controller;
  final bool sourceMode;
  final ValueChanged<bool> onModeChanged;
  @override
  Widget build(BuildContext context) {
    final selected = controller.selected!;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppUiTokens.pagePadding,
        14,
        AppUiTokens.pagePadding,
        10,
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  selected.name,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                Text(
                  '${controller.activeFilePath}${controller.saveStatus.isEmpty ? '' : ' · ${controller.saveStatus}'}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
          if (controller.activeFilePath.toLowerCase() == 'skill.md')
            SegmentedButton<bool>(
              segments: const [
                ButtonSegment(
                  value: false,
                  icon: Icon(Icons.account_tree_outlined),
                  label: Text('拼图'),
                ),
                ButtonSegment(
                  value: true,
                  icon: Icon(Icons.code_rounded),
                  label: Text('源码'),
                ),
              ],
              selected: {sourceMode},
              showSelectedIcon: false,
              onSelectionChanged: (values) => onModeChanged(values.first),
            ),
          const SizedBox(width: 8),
          IconButton(
            tooltip: '详细设计',
            onPressed: () => controller.setPage(AppPage.advanced),
            icon: const Icon(Icons.tune_outlined),
          ),
          IconButton(
            tooltip: 'AI 修改',
            onPressed: () => controller.setPage(AppPage.ai),
            icon: const Icon(Icons.auto_awesome_outlined),
          ),
          IconButton(
            tooltip: '规则分布图',
            onPressed: () => controller.setPage(AppPage.graph),
            icon: const Icon(Icons.hub_outlined),
          ),
        ],
      ),
    );
  }
}

class _SourceEditor extends StatelessWidget {
  const _SourceEditor({
    required this.controller,
    required this.textController,
    required this.onEdited,
  });
  final AppController controller;
  final TextEditingController textController;
  final ValueChanged<String> onEdited;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppUiTokens.pagePadding,
        0,
        AppUiTokens.pagePadding,
        AppUiTokens.pagePadding,
      ),
      child: TextField(
        controller: textController,
        expands: true,
        maxLines: null,
        minLines: null,
        textAlignVertical: TextAlignVertical.top,
        keyboardType: TextInputType.multiline,
        style: const TextStyle(
          fontFamily: 'Consolas',
          fontFamilyFallback: ['Microsoft YaHei'],
          fontSize: 13,
          height: 1.45,
        ),
        decoration: InputDecoration(
          hintText: controller.activeFilePath,
          alignLabelWithHint: true,
        ),
        onChanged: onEdited,
      ),
    );
  }
}

class _RulesEditor extends StatefulWidget {
  const _RulesEditor({required this.controller});
  final AppController controller;
  @override
  State<_RulesEditor> createState() => _RulesEditorState();
}

class _RulesEditorState extends State<_RulesEditor> {
  late TextEditingController name;
  late TextEditingController description;
  late TextEditingController rulesBody;
  String sourceSignature = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant _RulesEditor oldWidget) {
    super.didUpdateWidget(oldWidget);
    final signature =
        '${widget.controller.selected?.id}:${widget.controller.activeSource.hashCode}';
    if (signature != sourceSignature &&
        !widget.controller.saveStatus.contains('待保存')) {
      _load();
    }
  }

  void _load() {
    final source = widget.controller.activeSource;
    final identity = SkillMarkdown.identity(source);
    if (sourceSignature.isNotEmpty) {
      name.dispose();
      description.dispose();
      rulesBody.dispose();
    }
    name = TextEditingController(
      text: identity.name.isEmpty
          ? widget.controller.selected?.name ?? ''
          : identity.name,
    );
    description = TextEditingController(
      text: identity.description.isEmpty
          ? widget.controller.selected?.description ?? ''
          : identity.description,
    );
    rulesBody = TextEditingController(
      text: SkillMarkdown.rulesSectionBody(source),
    );
    sourceSignature = '${widget.controller.selected?.id}:${source.hashCode}';
  }

  void _commitRules(String value) {
    final source = SkillMarkdown.replaceRulesSection(
      widget.controller.activeSource,
      value,
    );
    sourceSignature = '${widget.controller.selected?.id}:${source.hashCode}';
    widget.controller.updateActiveSource(source);
  }

  @override
  void dispose() {
    name.dispose();
    description.dispose();
    rulesBody.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppUiTokens.pagePadding,
        0,
        AppUiTokens.pagePadding,
        40,
      ),
      children: [
        Text('属性', style: Theme.of(context).textTheme.labelLarge),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: name,
                decoration: const InputDecoration(labelText: '名称'),
                onSubmitted: (_) => widget.controller.updateIdentity(
                  name: name.text,
                  description: description.text,
                ),
                onTapOutside: (_) => widget.controller.updateIdentity(
                  name: name.text,
                  description: description.text,
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              flex: 2,
              child: TextField(
                controller: description,
                decoration: const InputDecoration(labelText: '描述'),
                onSubmitted: (_) => widget.controller.updateIdentity(
                  name: name.text,
                  description: description.text,
                ),
                onTapOutside: (_) => widget.controller.updateIdentity(
                  name: name.text,
                  description: description.text,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 22),
        Text('Rules 章节', style: Theme.of(context).textTheme.labelLarge),
        const SizedBox(height: 6),
        Text(
          '直接编辑规则的自由语义文本；不要求条件、因果或固定句式。只有规则本身明确需要时才写条件、步骤、验证或约束。',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: 10),
        TextField(
          controller: rulesBody,
          minLines: 12,
          maxLines: null,
          keyboardType: TextInputType.multiline,
          decoration: const InputDecoration(
            hintText:
                '1. Preserve the exact requirement.\n2. Verify the requested outcome when verification is required.',
            alignLabelWithHint: true,
          ),
          onChanged: _commitRules,
        ),
      ],
    );
  }
}

Future<void> _showCreateDialog(
  BuildContext context,
  AppController controller,
) async {
  final text = TextEditingController();
  final name = await showDialog<String>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('创建 Skill'),
      content: TextField(
        controller: text,
        autofocus: true,
        decoration: const InputDecoration(labelText: 'skill 名称'),
        onSubmitted: (value) => Navigator.pop(context, value),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('取消'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, text.text),
          child: const Text('创建'),
        ),
      ],
    ),
  );
  text.dispose();
  if (name != null && name.trim().isNotEmpty) {
    await controller.createSkill(name);
  }
}

Future<void> _showAddFileDialog(
  BuildContext context,
  AppController controller,
) async {
  final text = TextEditingController(text: 'rules/');
  String? error;
  await showDialog<void>(
    context: context,
    builder: (context) => StatefulBuilder(
      builder: (context, setState) => AlertDialog(
        title: const Text('新增 Skill 文件'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: text,
              autofocus: true,
              decoration: const InputDecoration(
                labelText: '相对路径',
                hintText: 'references/rules.md / assets/helper.ps1',
              ),
            ),
            if (error != null) ...[
              const SizedBox(height: 8),
              Text(
                error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ],
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () {
              final nextError = controller.addSkillFile(text.text);
              if (nextError == null) {
                Navigator.pop(context);
              } else {
                setState(() => error = nextError);
              }
            },
            child: const Text('添加'),
          ),
        ],
      ),
    ),
  );
  text.dispose();
}

Future<void> _confirmDelete(
  BuildContext context,
  AppController controller,
) async {
  if (controller.selected == null) return;
  final ok = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('删除 Skill？'),
      content: Text('将删除 ${controller.selected!.name} 及其工程文件。'),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text('取消'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, true),
          child: const Text('删除'),
        ),
      ],
    ),
  );
  if (ok == true) await controller.deleteSelected();
}
