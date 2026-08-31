import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../models/skill_models.dart';
import '../services/skill_markdown.dart';
import '../theme/app_ui_tokens.dart';

class AdvancedStudioPage extends StatefulWidget {
  const AdvancedStudioPage({super.key, required this.controller});

  final AppController controller;

  @override
  State<AdvancedStudioPage> createState() => _AdvancedStudioPageState();
}

class _AdvancedStudioPageState extends State<AdvancedStudioPage> {
  final TextEditingController _sourceController = TextEditingController();
  final TextEditingController _sectionTitleController = TextEditingController();
  final TextEditingController _sectionBodyController = TextEditingController();
  final TextEditingController _ruleController = TextEditingController();

  int _tab = 0;
  int _sectionIndex = 0;
  int _ruleIndex = 0;
  bool _translating = false;

  @override
  void initState() {
    super.initState();
    _reloadFromActiveFile();
  }

  @override
  void dispose() {
    _sourceController.dispose();
    _sectionTitleController.dispose();
    _sectionBodyController.dispose();
    _ruleController.dispose();
    super.dispose();
  }

  bool get _isMarkdown =>
      widget.controller.activeFilePath.toLowerCase().endsWith('.md');

  List<MarkdownSectionSlice> get _sections => _isMarkdown
      ? SkillMarkdown.sections(widget.controller.activeSource)
      : const [];

  List<NumberedRuleSlice> get _rules => _isMarkdown
      ? SkillMarkdown.numberedRules(widget.controller.activeSource)
      : const [];

  void _reloadFromActiveFile() {
    _sourceController.text = widget.controller.activeSource;
    final sections = _sections;
    _sectionIndex = sections.isEmpty
        ? 0
        : _sectionIndex.clamp(0, sections.length - 1);
    _loadSectionControllers();
    final rules = _rules;
    _ruleIndex = rules.isEmpty ? 0 : _ruleIndex.clamp(0, rules.length - 1);
    _loadRuleController();
  }

  void _loadSectionControllers() {
    final sections = _sections;
    if (sections.isEmpty) {
      _sectionTitleController.clear();
      _sectionBodyController.clear();
      return;
    }
    final section = sections[_sectionIndex.clamp(0, sections.length - 1)];
    _sectionTitleController.text = section.title;
    _sectionBodyController.text = section.body.trim();
  }

  void _loadRuleController() {
    final rules = _rules;
    if (rules.isEmpty) {
      _ruleController.clear();
      return;
    }
    _ruleController.text = rules[_ruleIndex.clamp(0, rules.length - 1)].text;
  }

  void _replaceSource(String source) {
    widget.controller.updateActiveSource(source);
    _sourceController.value = TextEditingValue(
      text: source,
      selection: TextSelection.collapsed(offset: source.length),
    );
    _reloadFromActiveFile();
    setState(() {});
  }

  void _selectFile(String path) {
    widget.controller.setActiveFile(path);
    setState(() {
      _sectionIndex = 0;
      _ruleIndex = 0;
      _reloadFromActiveFile();
    });
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    if (controller.selected == null) {
      return Center(
        child: Text(
          '请先创建或导入一个 Skill。',
          style: Theme.of(context).textTheme.titleMedium,
        ),
      );
    }

    return Column(
      children: [
        _Header(
          controller: controller,
          onAddFile: () => _showAddFileDialog(context),
        ),
        const Divider(height: 1),
        Expanded(
          child: LayoutBuilder(
            builder: (context, constraints) {
              final compact = constraints.maxWidth < 980;
              if (compact) {
                return Column(
                  children: [
                    _CompactFilePicker(
                      controller: controller,
                      onSelected: _selectFile,
                    ),
                    Expanded(child: _workspace(compact: true)),
                  ],
                );
              }
              return Row(
                children: [
                  SizedBox(
                    width: 250,
                    child: _FileRail(
                      controller: controller,
                      onSelected: _selectFile,
                      onAddFile: () => _showAddFileDialog(context),
                    ),
                  ),
                  VerticalDivider(
                    width: 1,
                    color: Theme.of(context).colorScheme.outlineVariant,
                  ),
                  Expanded(child: _workspace(compact: false)),
                ],
              );
            },
          ),
        ),
      ],
    );
  }

  Widget _workspace({required bool compact}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            AppUiTokens.pagePadding,
            12,
            AppUiTokens.pagePadding,
            8,
          ),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: SegmentedButton<int>(
              segments: const [
                ButtonSegment(
                  value: 0,
                  icon: Icon(Icons.account_tree_outlined),
                  label: Text('文件包'),
                ),
                ButtonSegment(
                  value: 1,
                  icon: Icon(Icons.view_agenda_outlined),
                  label: Text('章节'),
                ),
                ButtonSegment(
                  value: 2,
                  icon: Icon(Icons.rule_folder_outlined),
                  label: Text('编号规则'),
                ),
                ButtonSegment(
                  value: 3,
                  icon: Icon(Icons.code_rounded),
                  label: Text('完整源码'),
                ),
              ],
              selected: {_tab},
              showSelectedIcon: false,
              onSelectionChanged: (value) => _setTab(value.first),
            ),
          ),
        ),
        Expanded(
          child: switch (_tab) {
            0 => _BundleView(controller: widget.controller),
            1 => _buildSectionEditor(compact),
            2 => _buildRuleEditor(compact),
            _ => _buildSourceEditor(),
          },
        ),
      ],
    );
  }

  void _setTab(int value) {
    setState(() {
      _tab = value;
      if (_tab == 1) {
        final sections = _sections;
        _sectionIndex = sections.isEmpty
            ? 0
            : _sectionIndex.clamp(0, sections.length - 1);
        _loadSectionControllers();
      } else if (_tab == 2) {
        final rules = _rules;
        _ruleIndex = rules.isEmpty ? 0 : _ruleIndex.clamp(0, rules.length - 1);
        _loadRuleController();
      }
    });
  }

  Widget _buildSectionEditor(bool compact) {
    if (!_isMarkdown) {
      return const _UnsupportedView(
        icon: Icons.view_agenda_outlined,
        title: '章节编辑仅适用于 Markdown',
        detail: '当前文件仍可在“完整源码”中编辑。',
      );
    }
    final sections = _sections;
    if (sections.isEmpty) {
      return _EmptySections(onAdd: () => _showAddSectionDialog(context));
    }

    final navigator = _SectionNavigator(
      sections: sections,
      selectedIndex: _sectionIndex.clamp(0, sections.length - 1),
      onSelected: (index) {
        setState(() {
          _sectionIndex = index;
          _loadSectionControllers();
        });
      },
      onAdd: () => _showAddSectionDialog(context),
      onMove: _moveSection,
      onDelete: _deleteSection,
    );
    final editor = _SectionForm(
      titleController: _sectionTitleController,
      bodyController: _sectionBodyController,
      onApply: _applySection,
    );
    if (compact) {
      return Column(
        children: [
          SizedBox(height: 176, child: navigator),
          const Divider(height: 1),
          Expanded(child: editor),
        ],
      );
    }
    return Row(
      children: [
        SizedBox(width: 270, child: navigator),
        const VerticalDivider(width: 1),
        Expanded(child: editor),
      ],
    );
  }

  Widget _buildRuleEditor(bool compact) {
    if (!_isMarkdown) {
      return const _UnsupportedView(
        icon: Icons.rule_folder_outlined,
        title: '编号规则仅适用于 Markdown',
        detail: '文本源文件仍可在“完整源码”中编辑。',
      );
    }
    final rules = _rules;
    final sections = _sections;
    if (rules.isEmpty) {
      return _EmptyRules(
        canAdd: sections.isNotEmpty,
        onAdd: () => _showAddRuleDialog(context),
      );
    }

    final selected = _ruleIndex.clamp(0, rules.length - 1);
    final navigator = _RuleNavigator(
      rules: rules,
      selectedIndex: selected,
      onSelected: (index) {
        setState(() {
          _ruleIndex = index;
          _loadRuleController();
        });
      },
      onAdd: () => _showAddRuleDialog(context),
    );
    final editor = _RuleForm(
      rule: rules[selected],
      controller: _ruleController,
      translating: _translating,
      onApply: _applyRule,
      onTranslate: _translateRule,
    );
    if (compact) {
      return Column(
        children: [
          SizedBox(height: 190, child: navigator),
          const Divider(height: 1),
          Expanded(child: editor),
        ],
      );
    }
    return Row(
      children: [
        SizedBox(width: 300, child: navigator),
        const VerticalDivider(width: 1),
        Expanded(child: editor),
      ],
    );
  }

  Widget _buildSourceEditor() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppUiTokens.pagePadding,
        0,
        AppUiTokens.pagePadding,
        AppUiTokens.pagePadding,
      ),
      child: TextField(
        controller: _sourceController,
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
          labelText: widget.controller.activeFilePath,
          alignLabelWithHint: true,
        ),
        onChanged: widget.controller.updateActiveSource,
      ),
    );
  }

  void _applySection() {
    final sections = _sections;
    if (sections.isEmpty) return;
    try {
      final next = SkillMarkdown.replaceSectionAt(
        widget.controller.activeSource,
        _sectionIndex.clamp(0, sections.length - 1),
        title: _sectionTitleController.text,
        body: _sectionBodyController.text,
      );
      _replaceSource(next);
      _showMessage('章节已更新');
    } on ArgumentError catch (error) {
      _showMessage(error.message?.toString() ?? error.toString(), error: true);
    }
  }

  void _moveSection(int delta) {
    final sections = _sections;
    if (sections.isEmpty) return;
    final current = _sectionIndex.clamp(0, sections.length - 1);
    final target = current + delta;
    if (target < 0 || target >= sections.length) return;
    final next = SkillMarkdown.moveSection(
      widget.controller.activeSource,
      current,
      delta,
    );
    _sectionIndex = target;
    _replaceSource(next);
  }

  Future<void> _deleteSection() async {
    final sections = _sections;
    if (sections.isEmpty) return;
    final current = _sectionIndex.clamp(0, sections.length - 1);
    final title = sections[current].title;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('删除章节？'),
        content: Text(
          '将从 ${widget.controller.activeFilePath} 删除“$title”及其全部正文。',
        ),
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
    if (confirmed != true || !mounted) return;
    final next = SkillMarkdown.removeSectionAt(
      widget.controller.activeSource,
      current,
    );
    _sectionIndex = current > 0 ? current - 1 : 0;
    _replaceSource(next);
  }

  void _applyRule() {
    final rules = _rules;
    if (rules.isEmpty) return;
    try {
      final selected = _ruleIndex.clamp(0, rules.length - 1);
      final next = SkillMarkdown.updateNumberedRule(
        widget.controller.activeSource,
        rules[selected],
        _ruleController.text,
      );
      _ruleIndex = selected;
      _replaceSource(next);
      _showMessage('规则 ${rules[selected].number} 已更新，编号保持不变');
    } on ArgumentError catch (error) {
      _showMessage(error.message?.toString() ?? error.toString(), error: true);
    }
  }

  Future<void> _translateRule() async {
    final rules = _rules;
    if (rules.isEmpty || _translating) return;
    final selected = _ruleIndex.clamp(0, rules.length - 1);
    final rule = rules[selected];
    setState(() => _translating = true);
    try {
      final translated = await widget.controller.api.translateRule(
        _ruleController.text.trim(),
      );
      if (!mounted) return;
      final next = SkillMarkdown.updateNumberedRule(
        widget.controller.activeSource,
        rule,
        translated,
      );
      _ruleIndex = selected;
      _replaceSource(next);
      _showMessage('规则 ${rule.number} 已翻译并保持原编号');
    } catch (error) {
      if (mounted) _showMessage(error.toString(), error: true);
    } finally {
      if (mounted) setState(() => _translating = false);
    }
  }

  Future<void> _showAddFileDialog(BuildContext context) async {
    final text = TextEditingController(text: 'references/rules.md');
    final path = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('新增 Skill 文件'),
        content: SizedBox(
          width: 460,
          child: TextField(
            controller: text,
            autofocus: true,
            decoration: const InputDecoration(
              labelText: '相对路径',
              helperText: '支持 references、assets、scripts 与安全的 UTF-8 文本源码。',
            ),
            onSubmitted: (value) => Navigator.pop(context, value),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, text.text),
            child: const Text('添加'),
          ),
        ],
      ),
    );
    text.dispose();
    if (path == null || !mounted) return;
    final error = widget.controller.addSkillFile(path);
    if (error != null) {
      _showMessage(error, error: true);
      return;
    }
    setState(() {
      _sectionIndex = 0;
      _ruleIndex = 0;
      _reloadFromActiveFile();
    });
  }

  Future<void> _showAddSectionDialog(BuildContext context) async {
    final title = TextEditingController(text: 'New Section');
    final value = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('新增章节'),
        content: TextField(
          controller: title,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'H2 章节标题'),
          onSubmitted: (value) => Navigator.pop(context, value),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, title.text),
            child: const Text('添加'),
          ),
        ],
      ),
    );
    title.dispose();
    if (value == null || !mounted) return;
    try {
      final next = SkillMarkdown.addSection(
        widget.controller.activeSource,
        title: value,
      );
      _sectionIndex = SkillMarkdown.sections(next).length - 1;
      _replaceSource(next);
    } on ArgumentError catch (error) {
      _showMessage(error.message?.toString() ?? error.toString(), error: true);
    }
  }

  Future<void> _showAddRuleDialog(BuildContext context) async {
    final sections = _sections;
    if (sections.isEmpty) {
      _showMessage('请先创建一个 Markdown H2 章节。', error: true);
      return;
    }
    var sectionIndex = _sectionIndex.clamp(0, sections.length - 1);
    final text = TextEditingController();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('新增编号规则'),
          content: SizedBox(
            width: 520,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<int>(
                  initialValue: sectionIndex,
                  decoration: const InputDecoration(labelText: '目标章节'),
                  items: List.generate(
                    sections.length,
                    (index) => DropdownMenuItem(
                      value: index,
                      child: Text(sections[index].title),
                    ),
                  ),
                  onChanged: (value) {
                    if (value != null) {
                      setDialogState(() => sectionIndex = value);
                    }
                  },
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: text,
                  autofocus: true,
                  decoration: const InputDecoration(
                    labelText: '规则正文',
                    helperText: '编号自动使用该章节现有最大编号 + 1。',
                  ),
                  onSubmitted: (_) => Navigator.pop(context, true),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('添加'),
            ),
          ],
        ),
      ),
    );
    final ruleText = text.text;
    text.dispose();
    if (accepted != true || !mounted) return;
    try {
      final beforeCount = _rules.length;
      final next = SkillMarkdown.addNumberedRule(
        widget.controller.activeSource,
        sectionIndex,
        ruleText,
      );
      _ruleIndex = beforeCount;
      _replaceSource(next);
    } on ArgumentError catch (error) {
      _showMessage(error.message?.toString() ?? error.toString(), error: true);
    }
  }

  void _showMessage(String message, {bool error = false}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), behavior: SnackBarBehavior.floating),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.controller, required this.onAddFile});

  final AppController controller;
  final VoidCallback onAddFile;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppUiTokens.pagePadding,
        14,
        AppUiTokens.pagePadding,
        12,
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('详细设计', style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 2),
                Text(
                  '${controller.selected!.name} · ${controller.activeFilePath}${controller.saveStatus.isEmpty ? '' : ' · ${controller.saveStatus}'}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: '新增文件',
            onPressed: onAddFile,
            icon: const Icon(Icons.note_add_outlined),
          ),
          IconButton(
            tooltip: 'AI 修改',
            onPressed: () => controller.setPage(AppPage.ai),
            icon: const Icon(Icons.auto_awesome_outlined),
          ),
          FilledButton.tonalIcon(
            onPressed: () => controller.setPage(AppPage.editor),
            icon: const Icon(Icons.arrow_back_rounded),
            label: const Text('返回编辑'),
          ),
        ],
      ),
    );
  }
}

class _CompactFilePicker extends StatelessWidget {
  const _CompactFilePicker({
    required this.controller,
    required this.onSelected,
  });

  final AppController controller;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 0),
      child: DropdownButtonFormField<String>(
        initialValue: controller.activeFilePath,
        isExpanded: true,
        decoration: const InputDecoration(labelText: '当前文件'),
        items: controller.files
            .map(
              (file) => DropdownMenuItem(
                value: file.path,
                child: Text(file.path, overflow: TextOverflow.ellipsis),
              ),
            )
            .toList(growable: false),
        onChanged: (value) => value == null ? null : onSelected(value),
      ),
    );
  }
}

class _FileRail extends StatelessWidget {
  const _FileRail({
    required this.controller,
    required this.onSelected,
    required this.onAddFile,
  });

  final AppController controller;
  final ValueChanged<String> onSelected;
  final VoidCallback onAddFile;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: Theme.of(context).colorScheme.surfaceContainerLowest,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 6, 8),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    'Bundle 文件',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                ),
                IconButton(
                  tooltip: '新增文件',
                  onPressed: onAddFile,
                  icon: const Icon(Icons.add_rounded),
                ),
              ],
            ),
          ),
          Expanded(
            child: ListView.builder(
              itemCount: controller.files.length,
              itemBuilder: (context, index) {
                final file = controller.files[index];
                final selected = file.path == controller.activeFilePath;
                return ListTile(
                  dense: true,
                  selected: selected,
                  leading: Icon(
                    file.isEntry
                        ? Icons.home_work_outlined
                        : file.path.toLowerCase().endsWith('.md')
                        ? Icons.description_outlined
                        : Icons.code_rounded,
                    size: 19,
                  ),
                  title: Text(
                    file.path,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  subtitle: Text('${file.content.length} chars'),
                  onTap: selected ? null : () => onSelected(file.path),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _BundleView extends StatelessWidget {
  const _BundleView({required this.controller});

  final AppController controller;

  @override
  Widget build(BuildContext context) {
    final files = controller.files;
    final entry = files.where((file) => file.isEntry).firstOrNull;
    final indexed = entry == null
        ? const <String>{}
        : SkillMarkdown.indexedFiles(
            entry.content,
          ).map((path) => path.toLowerCase()).toSet();
    final markdownFiles = files
        .where(
          (file) => !file.isEntry && file.path.toLowerCase().endsWith('.md'),
        )
        .toList();
    final missingIndex = markdownFiles
        .where((file) => !indexed.contains(file.path.toLowerCase()))
        .map((file) => file.path)
        .toList();
    final actualPaths = files.map((file) => file.path.toLowerCase()).toSet();
    final staleIndex = indexed
        .where((path) => !actualPaths.contains(path))
        .toList();
    final references = files
        .where((file) => file.path.startsWith('references/'))
        .length;
    final assets = files
        .where((file) => file.path.startsWith('assets/'))
        .length;
    final scripts = files
        .where((file) => file.path.startsWith('scripts/'))
        .length;

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppUiTokens.pagePadding,
        4,
        AppUiTokens.pagePadding,
        32,
      ),
      children: [
        Wrap(
          spacing: 10,
          runSpacing: 10,
          children: [
            _MetricCard(label: '总文件', value: '${files.length}'),
            _MetricCard(
              label: 'Markdown',
              value: '${files.where((f) => f.path.endsWith('.md')).length}',
            ),
            _MetricCard(label: 'references', value: '$references'),
            _MetricCard(label: 'assets', value: '$assets'),
            _MetricCard(label: 'scripts', value: '$scripts'),
          ],
        ),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('根索引一致性', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                if (entry == null)
                  const Text('当前 bundle 缺少 SKILL.md 入口。')
                else if (missingIndex.isEmpty && staleIndex.isEmpty)
                  const Text('Skill Map 与当前 Markdown 分区一致。')
                else ...[
                  if (missingIndex.isNotEmpty)
                    Text('未索引：${missingIndex.join('、')}'),
                  if (staleIndex.isNotEmpty)
                    Text('失效索引：${staleIndex.join('、')}'),
                ],
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    FilledButton.tonal(
                      onPressed: controller.syncIndex,
                      child: const Text('同步 Skill Map'),
                    ),
                    OutlinedButton(
                      onPressed: controller.minimizeEntry,
                      child: const Text('入口最小化'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('当前规范', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                const Text(
                  'SKILL.md 作为紧凑入口索引；持续执行规则放独立 Markdown 分区；仅首次工程执行的要求放 references/initialization.md；可复用源码、模板与脚本直接作为 bundle 文件保存。',
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 132,
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(value, style: Theme.of(context).textTheme.headlineSmall),
              Text(label, style: Theme.of(context).textTheme.bodySmall),
            ],
          ),
        ),
      ),
    );
  }
}

class _SectionNavigator extends StatelessWidget {
  const _SectionNavigator({
    required this.sections,
    required this.selectedIndex,
    required this.onSelected,
    required this.onAdd,
    required this.onMove,
    required this.onDelete,
  });

  final List<MarkdownSectionSlice> sections;
  final int selectedIndex;
  final ValueChanged<int> onSelected;
  final VoidCallback onAdd;
  final ValueChanged<int> onMove;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(10, 8, 6, 4),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  'H2 章节',
                  style: Theme.of(context).textTheme.titleSmall,
                ),
              ),
              IconButton(
                tooltip: '新增章节',
                onPressed: onAdd,
                icon: const Icon(Icons.add_rounded),
              ),
            ],
          ),
        ),
        Expanded(
          child: ListView.builder(
            itemCount: sections.length,
            itemBuilder: (context, index) => ListTile(
              dense: true,
              selected: index == selectedIndex,
              leading: CircleAvatar(
                radius: 12,
                child: Text(
                  '${index + 1}',
                  style: const TextStyle(fontSize: 11),
                ),
              ),
              title: Text(
                sections[index].title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              onTap: () => onSelected(index),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(8),
          child: Row(
            children: [
              IconButton(
                tooltip: '上移章节',
                onPressed: selectedIndex <= 0 ? null : () => onMove(-1),
                icon: const Icon(Icons.arrow_upward_rounded),
              ),
              IconButton(
                tooltip: '下移章节',
                onPressed: selectedIndex >= sections.length - 1
                    ? null
                    : () => onMove(1),
                icon: const Icon(Icons.arrow_downward_rounded),
              ),
              const Spacer(),
              IconButton(
                tooltip: '删除章节',
                onPressed: onDelete,
                icon: const Icon(Icons.delete_outline_rounded),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _SectionForm extends StatelessWidget {
  const _SectionForm({
    required this.titleController,
    required this.bodyController,
    required this.onApply,
  });

  final TextEditingController titleController;
  final TextEditingController bodyController;
  final VoidCallback onApply;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppUiTokens.pagePadding,
        4,
        AppUiTokens.pagePadding,
        AppUiTokens.pagePadding,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: titleController,
            decoration: const InputDecoration(labelText: '章节标题'),
          ),
          const SizedBox(height: 10),
          Expanded(
            child: TextField(
              controller: bodyController,
              expands: true,
              maxLines: null,
              minLines: null,
              textAlignVertical: TextAlignVertical.top,
              style: const TextStyle(
                fontFamily: 'Consolas',
                fontFamilyFallback: ['Microsoft YaHei'],
                fontSize: 13,
                height: 1.45,
              ),
              decoration: const InputDecoration(
                labelText: '章节正文',
                alignLabelWithHint: true,
              ),
            ),
          ),
          const SizedBox(height: 10),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton.icon(
              onPressed: onApply,
              icon: const Icon(Icons.check_rounded),
              label: const Text('应用章节'),
            ),
          ),
        ],
      ),
    );
  }
}

class _RuleNavigator extends StatelessWidget {
  const _RuleNavigator({
    required this.rules,
    required this.selectedIndex,
    required this.onSelected,
    required this.onAdd,
  });

  final List<NumberedRuleSlice> rules;
  final int selectedIndex;
  final ValueChanged<int> onSelected;
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(10, 8, 6, 4),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  '固定编号规则',
                  style: Theme.of(context).textTheme.titleSmall,
                ),
              ),
              IconButton(
                tooltip: '新增编号规则',
                onPressed: onAdd,
                icon: const Icon(Icons.add_rounded),
              ),
            ],
          ),
        ),
        Expanded(
          child: ListView.builder(
            itemCount: rules.length,
            itemBuilder: (context, index) {
              final rule = rules[index];
              return ListTile(
                dense: true,
                selected: index == selectedIndex,
                leading: CircleAvatar(
                  radius: 13,
                  child: Text(
                    '${rule.number}',
                    style: const TextStyle(fontSize: 11),
                  ),
                ),
                title: Text(
                  rule.text,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                subtitle: Text(rule.sectionTitle),
                onTap: () => onSelected(index),
              );
            },
          ),
        ),
      ],
    );
  }
}

class _RuleForm extends StatelessWidget {
  const _RuleForm({
    required this.rule,
    required this.controller,
    required this.translating,
    required this.onApply,
    required this.onTranslate,
  });

  final NumberedRuleSlice rule;
  final TextEditingController controller;
  final bool translating;
  final VoidCallback onApply;
  final VoidCallback onTranslate;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppUiTokens.pagePadding,
        8,
        AppUiTokens.pagePadding,
        24,
      ),
      children: [
        Row(
          children: [
            Chip(label: Text('规则 ${rule.number}')),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                rule.sectionTitle,
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        TextField(
          controller: controller,
          maxLines: 1,
          decoration: const InputDecoration(
            labelText: '规则正文',
            helperText: '编号由 SkillCreator 固定保留；修改正文不会重新编号。',
            alignLabelWithHint: true,
          ),
        ),
        const SizedBox(height: 14),
        Wrap(
          alignment: WrapAlignment.end,
          spacing: 8,
          runSpacing: 8,
          children: [
            OutlinedButton.icon(
              onPressed: translating ? null : onTranslate,
              icon: translating
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.translate_rounded),
              label: Text(translating ? '翻译中' : '翻译为规范英文'),
            ),
            FilledButton.icon(
              onPressed: onApply,
              icon: const Icon(Icons.check_rounded),
              label: const Text('应用规则'),
            ),
          ],
        ),
      ],
    );
  }
}

class _EmptySections extends StatelessWidget {
  const _EmptySections({required this.onAdd});

  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) => Center(
    child: FilledButton.tonalIcon(
      onPressed: onAdd,
      icon: const Icon(Icons.add_rounded),
      label: const Text('创建第一个 H2 章节'),
    ),
  );
}

class _EmptyRules extends StatelessWidget {
  const _EmptyRules({required this.canAdd, required this.onAdd});

  final bool canAdd;
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) => Center(
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.rule_folder_outlined, size: 42),
        const SizedBox(height: 10),
        const Text('当前文件没有编号规则'),
        const SizedBox(height: 12),
        FilledButton.tonalIcon(
          onPressed: canAdd ? onAdd : null,
          icon: const Icon(Icons.add_rounded),
          label: const Text('新增规则'),
        ),
      ],
    ),
  );
}

class _UnsupportedView extends StatelessWidget {
  const _UnsupportedView({
    required this.icon,
    required this.title,
    required this.detail,
  });

  final IconData icon;
  final String title;
  final String detail;

  @override
  Widget build(BuildContext context) => Center(
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 42),
        const SizedBox(height: 10),
        Text(title, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 4),
        Text(detail, style: Theme.of(context).textTheme.bodySmall),
      ],
    ),
  );
}
