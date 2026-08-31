import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

import 'models/skill_models.dart';
import 'services/skill_api_client.dart';
import 'services/skill_markdown.dart';

class AppController extends ChangeNotifier {
  AppController({SkillApiClient? api}) : api = api ?? SkillApiClient() {
    backend = BackendProcessManager(this.api);
  }

  final SkillApiClient api;
  late final BackendProcessManager backend;
  final List<String> deletedFiles = [];
  final Map<String, List<Map<String, String>>> conversations = {};

  BackendState backendState = BackendState.connecting;
  AppPage page = AppPage.editor;
  List<SkillSummary> skills = const [];
  SkillContent? selected;
  List<SkillFile> files = const [];
  String activeFilePath = 'SKILL.md';
  String activeSource = '';
  String saveStatus = '';
  String? errorMessage;
  CodexModelStatus? modelStatus;
  CodexSkillCatalog? codexCatalog;
  bool busy = false;
  bool libraryBusy = false;
  bool aiBusy = false;
  int _aiEpoch = 0;
  Timer? _saveTimer;

  Future<void> bootstrap() async {
    backendState = BackendState.connecting;
    errorMessage = null;
    notifyListeners();
    try {
      await backend.ensureRunning();
      await api.ensureManifest();
      backendState = BackendState.connected;
      await _loadLocalState();
      await refreshSkills();
      try {
        modelStatus = await api.modelStatus();
      } catch (_) {}
    } catch (error) {
      backendState = BackendState.disconnected;
      errorMessage = error.toString();
    }
    notifyListeners();
  }

  Future<void> retryBackend() => bootstrap();

  Future<void> refreshSkills({String? selectId}) async {
    final list = await api.listSkills();
    skills = list;
    final target = selectId ?? selected?.id;
    if (target != null && list.any((e) => e.id == target)) {
      await selectSkill(target, flush: false);
    } else if (selected == null && list.isNotEmpty) {
      await selectSkill(list.first.id, flush: false);
    } else if (list.isEmpty) {
      selected = null;
      files = const [];
      activeSource = '';
    }
    notifyListeners();
  }

  Future<void> selectSkill(String id, {bool flush = true}) async {
    if (flush) await flushSave();
    final content = await api.readSkill(id);
    selected = content;
    files = content.files.isEmpty
        ? [SkillFile(path: 'SKILL.md', content: content.content, isEntry: true)]
        : List<SkillFile>.from(content.files);
    final entry = files.firstWhere((f) => f.isEntry, orElse: () => files.first);
    activeFilePath = entry.path;
    activeSource = entry.content;
    deletedFiles.clear();
    saveStatus = '';
    errorMessage = null;
    notifyListeners();
  }

  void setPage(AppPage next) {
    page = next;
    notifyListeners();
  }

  void setActiveFile(String path) {
    final file = files.where((f) => f.path == path).firstOrNull;
    if (file == null) return;
    activeFilePath = path;
    activeSource = file.content;
    notifyListeners();
  }

  void updateActiveSource(String source, {bool scheduleSave = true}) {
    activeSource = source;
    final index = files.indexWhere((f) => f.path == activeFilePath);
    if (index >= 0) {
      final next = List<SkillFile>.from(files);
      next[index] = next[index].copyWith(content: source);
      files = next;
    }
    if (scheduleSave) _scheduleSave();
    notifyListeners();
  }

  void updateIdentity({required String name, required String description}) {
    final entryIndex = _entryIndex;
    if (entryIndex < 0) return;
    final next = List<SkillFile>.from(files);
    final source = SkillMarkdown.updateIdentity(
      next[entryIndex].content,
      name: name,
      description: description,
    );
    next[entryIndex] = next[entryIndex].copyWith(content: source);
    files = next;
    if (activeFilePath == next[entryIndex].path) activeSource = source;
    _scheduleSave();
    notifyListeners();
  }

    String? addSkillFile(String rawPath) {
    final path = SkillMarkdown.normalizeSkillFilePath(rawPath);
    if (path == null || path.toLowerCase() == 'skill.md') {
      return '请输入安全的 UTF-8 相对文件路径，且不能是 SKILL.md。';
    }
    if (files.any((f) => f.path.toLowerCase() == path.toLowerCase())) {
      return '文件已存在：$path';
    }
    final isMarkdown = path.toLowerCase().endsWith('.md');
    var next = List<SkillFile>.from(files)
      ..add(
        SkillFile(
          path: path,
          content: isMarkdown
              ? '# ${path.split('/').last.replaceAll(RegExp(r'\.md$', caseSensitive: false), '')}\n'
              : '',
        ),
      );
    final entryIndex = next.indexWhere((f) => f.isEntry);
    if (entryIndex >= 0) {
      next[entryIndex] = next[entryIndex].copyWith(
        content: SkillMarkdown.syncSkillMap(
          next[entryIndex].content,
          next
              .where((f) => !f.isEntry && f.path.toLowerCase().endsWith('.md'))
              .map((f) => f.path),
        ),
      );
    }
    files = next;
    activeFilePath = path;
    activeSource = next.last.content;
    deletedFiles.removeWhere((e) => e.toLowerCase() == path.toLowerCase());
    _scheduleSave();
    notifyListeners();
    return null;
  }

  void removeSkillFile(String path) {
    final file = files.where((f) => f.path == path).firstOrNull;
    if (file == null || file.isEntry) return;
    final next = files.where((f) => f.path != path).toList();
    deletedFiles.add(path);
    final entryIndex = next.indexWhere((f) => f.isEntry);
    if (entryIndex >= 0) {
      next[entryIndex] = next[entryIndex].copyWith(
        content: SkillMarkdown.syncSkillMap(
          next[entryIndex].content,
          next
              .where((f) => !f.isEntry && f.path.toLowerCase().endsWith('.md'))
              .map((f) => f.path),
        ),
      );
    }
    files = next;
    final entry = files.firstWhere((f) => f.isEntry, orElse: () => files.first);
    activeFilePath = entry.path;
    activeSource = entry.content;
    _scheduleSave();
    notifyListeners();
  }


  void syncIndex() {
    final entryIndex = _entryIndex;
    if (entryIndex < 0) return;
    final next = List<SkillFile>.from(files);
    next[entryIndex] = next[entryIndex].copyWith(
      content: SkillMarkdown.syncSkillMap(
        next[entryIndex].content,
                next
            .where((f) => !f.isEntry && f.path.toLowerCase().endsWith('.md'))
            .map((f) => f.path),
      ),
    );
    files = next;
        if (activeFilePath == next[entryIndex].path) {
      activeSource = next[entryIndex].content;
    }
    _scheduleSave();
    notifyListeners();
  }

  void minimizeEntry() {
    final entryIndex = _entryIndex;
    if (entryIndex < 0) return;
    final next = List<SkillFile>.from(files);
    next[entryIndex] = next[entryIndex].copyWith(
      content: SkillMarkdown.minimizeEntry(
        next[entryIndex].content,
                next
            .where((f) => !f.isEntry && f.path.toLowerCase().endsWith('.md'))
            .map((f) => f.path),
      ),
    );
    files = next;
        if (activeFilePath == next[entryIndex].path) {
      activeSource = next[entryIndex].content;
    }
    _scheduleSave();
    notifyListeners();
  }

  Future<void> createSkill(String name) async {
    final clean = name.trim();
    if (clean.isEmpty) return;
    busy = true;
    notifyListeners();
    try {
      final source = SkillMarkdown.updateIdentity(
        '',
        name: clean,
        description: '',
      );
      await api.createSkill(_draft(source, const [], const []));
      final list = await api.listSkills();
      skills = list;
      final created = list.firstWhere(
        (e) => e.name == clean,
        orElse: () => list.last,
      );
      await selectSkill(created.id, flush: false);
    } catch (error) {
      errorMessage = error.toString();
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> deleteSelected() async {
    final current = selected;
    if (current == null) return;
    busy = true;
    notifyListeners();
    try {
      _saveTimer?.cancel();
      await api.deleteSkill(current.id);
      selected = null;
      files = const [];
      activeSource = '';
      await refreshSkills();
    } catch (error) {
      errorMessage = error.toString();
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  void _scheduleSave() {
    if (selected == null) return;
    saveStatus = '待保存';
    _saveTimer?.cancel();
    _saveTimer = Timer(const Duration(milliseconds: 650), () => flushSave());
  }

  Future<void> flushSave() async {
    _saveTimer?.cancel();
    final current = selected;
    if (current == null || files.isEmpty) return;
    final entry = files.firstWhere((f) => f.isEntry, orElse: () => files.first);
    saveStatus = '保存中';
    notifyListeners();
    try {
      final extras = files
          .where((f) => !f.isEntry)
          .map((e) => e.toDraftJson())
          .toList();
      await api.updateSkill(
        current.id,
        _draft(entry.content, extras, List.of(deletedFiles)),
      );
      deletedFiles.clear();
      saveStatus = '已保存';
      errorMessage = null;
    } catch (error) {
      saveStatus = '保存失败';
      errorMessage = error.toString();
    }
    notifyListeners();
  }

  Map<String, dynamic> _draft(
    String source,
    List<Map<String, dynamic>> extraFiles,
    List<String> deleted,
  ) {
    final identity = SkillMarkdown.identity(source);
    return {
      'name': identity.name.isEmpty
          ? (selected?.name ?? 'untitled-skill')
          : identity.name,
      'description': identity.description,
      'sourceMarkdown': source,
      'files': extraFiles,
      'deletedFiles': deleted,
    };
  }

  Future<void> refreshModelStatus() async {
    try {
      modelStatus = await api.modelStatus();
      notifyListeners();
    } catch (error) {
      errorMessage = error.toString();
      notifyListeners();
    }
  }

  Future<void> changeModel({String? model, String? effort, bool? fast}) async {
    final current = modelStatus;
    if (current == null) return;
    busy = true;
    notifyListeners();
    try {
      modelStatus = await api.setModel(
        model: model ?? current.model,
        reasoningEffort: effort ?? current.reasoningEffort,
        fastMode: fast ?? current.fastMode,
      );
    } catch (error) {
      errorMessage = error.toString();
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> loadCatalog() async {
    libraryBusy = true;
    notifyListeners();
    try {
      codexCatalog = await api.catalog();
      errorMessage = null;
    } catch (error) {
      errorMessage = error.toString();
    } finally {
      libraryBusy = false;
      notifyListeners();
    }
  }

  Future<Map<String, dynamic>?> importCatalog(List<String> ids) async {
    if (ids.isEmpty) return null;
    libraryBusy = true;
    notifyListeners();
    try {
      final result = await api.importCatalog(ids);
      codexCatalog = await api.catalog();
      await refreshSkills();
      return result;
    } catch (error) {
      errorMessage = error.toString();
      return null;
    } finally {
      libraryBusy = false;
      notifyListeners();
    }
  }

  String conversationKey(String mode) =>
      '$mode:${mode == 'modify' ? selected?.id ?? 'no-skill' : 'new-skill'}';
  List<Map<String, String>> conversation(String mode) =>
      conversations[conversationKey(mode)] ?? const [];

    bool _isLocalizationSamplePath(String path) =>
      path.replaceAll('\\', '/').toLowerCase() == 'references/skill.zh-cn.md';

  String _bundleHash(Iterable<SkillFile> bundle) {
    final sorted = bundle.toList()
      ..sort(
        (left, right) => left.path.toLowerCase().compareTo(right.path.toLowerCase()),
      );
    final material = StringBuffer();
    for (final file in sorted) {
      material
        ..write(file.path.replaceAll('\\', '/').toLowerCase())
        ..write('\u0000')
        ..write(file.content)
        ..write('\u0001');
    }
    return SkillMarkdown.sourceHash(material.toString());
  }

  List<SkillFile> _decodeProposalFiles(Object? raw) {
    if (raw == null) return const [];
    if (raw is! List) throw SkillApiException('AI 提案 files 必须是数组。');
    final output = <SkillFile>[];
    final seen = <String>{};
    for (final item in raw) {
      if (item is! Map) throw SkillApiException('AI 提案包含无效文件记录。');
      final map = Map<String, dynamic>.from(item);
      final path = SkillMarkdown.normalizeSkillFilePath(map['path']?.toString() ?? '');
      if (path == null || path.toLowerCase() == 'skill.md') {
        throw SkillApiException('AI 提案包含非法文件路径：${map['path'] ?? ''}');
      }
      if (_isLocalizationSamplePath(path)) continue;
      if (!seen.add(path.toLowerCase())) {
        throw SkillApiException('AI 提案文件路径重复：$path');
      }
      output.add(SkillFile(path: path, content: map['content']?.toString() ?? ''));
    }
    return output;
  }

  List<String> _decodeDeletedPaths(Object? raw) {
    if (raw == null) return const [];
    if (raw is! List) throw SkillApiException('AI 提案 deletedFiles 必须是数组。');
    final output = <String>[];
    final seen = <String>{};
    for (final item in raw) {
      final path = SkillMarkdown.normalizeSkillFilePath(item?.toString() ?? '');
      if (path == null || path.toLowerCase() == 'skill.md') {
        throw SkillApiException('AI 提案包含非法删除路径：${item ?? ''}');
      }
      if (_isLocalizationSamplePath(path)) continue;
      if (seen.add(path.toLowerCase())) output.add(path);
    }
    return output;
  }

  ({String diff, List<String> changedFiles}) _proposalDiff({
    required String rootBefore,
    required String rootAfter,
    required List<SkillFile> currentFiles,
    required List<SkillFile> proposedFiles,
    required List<String> deletedPaths,
  }) {
    final diffs = <String>[];
    final changed = <String>[];
    if (rootBefore != rootAfter) {
      changed.add('SKILL.md');
      diffs.add(SkillMarkdown.unifiedDiff(rootBefore, rootAfter));
    }
    final current = <String, SkillFile>{
      for (final file in currentFiles) file.path.toLowerCase(): file,
    };
    final proposed = <String, SkillFile>{
      for (final file in proposedFiles) file.path.toLowerCase(): file,
    };
    final deleted = deletedPaths.map((path) => path.toLowerCase()).toSet();
    final names = <String>{...current.keys, ...proposed.keys, ...deleted}.toList()..sort();
    for (final key in names) {
      final before = current[key]?.content ?? '';
      final after = deleted.contains(key) ? '' : proposed[key]?.content ?? before;
      if (before == after) continue;
      final path = proposed[key]?.path ?? current[key]?.path ?? key;
      changed.add(path);
      diffs.add(SkillMarkdown.unifiedDiff(before, after, filePath: path));
    }
    return (
      diff: diffs.isEmpty ? '没有文件变更。' : diffs.join('\n\n'),
      changedFiles: changed,
    );
  }

  Future<AiProposal?> requestAiDesign({
    required String mode,
    required String prompt,
  }) async {
    final clean = prompt.trim();
    if (clean.isEmpty) return null;
    final source = mode == 'modify' ? _entrySource : '';
    final currentFiles = mode == 'modify'
        ? files
              .where((file) => !file.isEntry && !_isLocalizationSamplePath(file.path))
              .toList(growable: false)
        : const <SkillFile>[];
    final baseBundleHash = mode == 'modify' ? _bundleHash(files) : _bundleHash(const []);
    final key = conversationKey(mode);
    final history = List<Map<String, String>>.from(
      conversations[key] ?? const [],
    );
    history.add({'role': 'user', 'content': clean});
    conversations[key] = history.takeLast(80);
    await _saveLocalState();
    final epoch = ++_aiEpoch;
    aiBusy = true;
    notifyListeners();
    try {
      final response = await api.designSkill(
        mode: mode,
        prompt: clean,
        currentSource: source,
        currentFiles: currentFiles.map((file) => file.toDraftJson()).toList(),
        history: history,
      );
      if (epoch != _aiEpoch) return null;
      final message = response['assistantMessage']?.toString() ?? '已生成提案。';
      final after = response['markdown']?.toString() ?? source;
      final proposedFiles = _decodeProposalFiles(response['files']);
      final deletedPaths = _decodeDeletedPaths(response['deletedFiles']);
      final proposedKeys = proposedFiles.map((file) => file.path.toLowerCase()).toSet();
      final overlap = deletedPaths.where((path) => proposedKeys.contains(path.toLowerCase()));
      if (overlap.isNotEmpty) {
        throw SkillApiException('AI 提案不能同时写入和删除：${overlap.first}');
      }
      final diff = _proposalDiff(
        rootBefore: source,
        rootAfter: after,
        currentFiles: currentFiles,
        proposedFiles: proposedFiles,
        deletedPaths: deletedPaths,
      );
      history.add({'role': 'assistant', 'content': message});
      conversations[key] = history.takeLast(80);
      await _saveLocalState();
      return AiProposal(
        mode: mode,
        title: mode == 'create' ? '创建 Skill' : '修改 Skill',
        summary: message,
        before: source,
        after: after,
        diff: diff.diff,
        filePath: 'SKILL.md',
        baseBundleHash: baseBundleHash,
        targetSkillId: mode == 'modify' ? selected?.id : null,
        proposedFiles: proposedFiles,
        deletedFiles: deletedPaths,
        changedFiles: diff.changedFiles,
      );
    } catch (error) {
      if (epoch == _aiEpoch) errorMessage = error.toString();
      return null;
    } finally {
      if (epoch == _aiEpoch) aiBusy = false;
      notifyListeners();
    }
  }

  void cancelAi() {
    _aiEpoch++;
    aiBusy = false;
    notifyListeners();
  }

  Future<String?> applyProposal(AiProposal proposal) async {
    if (proposal.discarded || proposal.applied) return null;
    if (proposal.mode == 'modify') {
      final currentSkill = selected;
      if (currentSkill?.id != proposal.targetSkillId) {
        return '目标 Skill 已切换，请重新生成提案。';
      }
      if (_bundleHash(files) != proposal.baseBundleHash) {
        return 'Skill 文件包在提案生成后已变化，请重新生成以避免覆盖新改动。';
      }
      final entryIndex = _entryIndex;
      if (entryIndex < 0 || currentSkill == null) return '当前 Skill 缺少入口文件。';

      final currentExtras = files.where((file) => !file.isEntry).toList();
      final extras = <String, SkillFile>{
        for (final file in currentExtras) file.path.toLowerCase(): file,
      };
      final order = currentExtras.map((file) => file.path.toLowerCase()).toList();
      for (final file in proposal.proposedFiles) {
        final key = file.path.toLowerCase();
        if (!extras.containsKey(key)) order.add(key);
        extras[key] = file;
      }
      for (final path in proposal.deletedFiles) {
        final key = path.toLowerCase();
        extras.remove(key);
        order.remove(key);
      }
      final nextEntry = files[entryIndex].copyWith(content: proposal.after);
            final nextExtras = <SkillFile>[
        for (final key in order) ?extras[key],
      ];
      final nextFiles = <SkillFile>[nextEntry, ...nextExtras];
      final nextKeys = nextExtras.map((file) => file.path.toLowerCase()).toSet();
      final removed = <String>{...proposal.deletedFiles};
      for (final file in currentExtras) {
        if (!nextKeys.contains(file.path.toLowerCase())) removed.add(file.path);
      }

      _saveTimer?.cancel();
      saveStatus = '保存中';
      notifyListeners();
      try {
        await api.updateSkill(
          currentSkill.id,
          _draft(
            proposal.after,
            nextExtras.map((file) => file.toDraftJson()).toList(),
            removed.toList(),
          ),
        );
      } catch (error) {
        saveStatus = '保存失败';
        errorMessage = error.toString();
        notifyListeners();
        return errorMessage;
      }

      files = nextFiles;
      deletedFiles.clear();
      final active = nextFiles.where((file) => file.path == activeFilePath).firstOrNull;
      if (active == null) {
        activeFilePath = nextEntry.path;
        activeSource = nextEntry.content;
      } else {
        activeSource = active.content;
      }
      saveStatus = '已保存';
      errorMessage = null;
      proposal.applied = true;
      notifyListeners();
      return null;
    }

    final identity = SkillMarkdown.identity(proposal.after);
    try {
      await api.createSkill(
        _draft(
          proposal.after,
          proposal.proposedFiles.map((file) => file.toDraftJson()).toList(),
          const [],
        ),
      );
    } catch (error) {
      errorMessage = error.toString();
      notifyListeners();
      return errorMessage;
    }
    proposal.applied = true;
    await refreshSkills();
    if (identity.name.isNotEmpty) {
      final match = skills.where((e) => e.name == identity.name).firstOrNull;
      if (match != null) await selectSkill(match.id, flush: false);
    }
    page = AppPage.editor;
    notifyListeners();
    return null;
  }


  int get _entryIndex => files.indexWhere((f) => f.isEntry);
  String get _entrySource {
    final index = _entryIndex;
    return index >= 0 ? files[index].content : activeSource;
  }

  Future<void> _loadLocalState() async {
    try {
      final file = _stateFile;
      if (!await file.exists()) return;
      final decoded =
          jsonDecode(await file.readAsString()) as Map<String, dynamic>;
      final raw = decoded['conversations'];
      if (raw is Map) {
        for (final entry in raw.entries) {
          final values = entry.value;
          if (values is List) {
            conversations[entry.key.toString()] = values
                .whereType<Map>()
                .map(
                  (e) => {
                    'role': e['role']?.toString() ?? '',
                    'content': e['content']?.toString() ?? '',
                  },
                )
                .where((e) => e['role']!.isNotEmpty && e['content']!.isNotEmpty)
                .toList();
          }
        }
      }
    } catch (_) {}
  }

  Future<void> _saveLocalState() async {
    try {
      final file = _stateFile;
      await file.parent.create(recursive: true);
      await file.writeAsString(jsonEncode({'conversations': conversations}));
    } catch (_) {}
  }

  File get _stateFile => File(
    '${api.expectedDataDir}${Platform.pathSeparator}flutter-ui-state.json',
  );

  @override
  void dispose() {
    _saveTimer?.cancel();
    backend.dispose();
    super.dispose();
  }
}

extension IterableFirstOrNull<T> on Iterable<T> {
  T? get firstOrNull {
    final iterator = this.iterator;
    return iterator.moveNext() ? iterator.current : null;
  }
}

extension TakeLast<T> on List<T> {
  List<T> takeLast(int count) =>
      length <= count ? List<T>.from(this) : sublist(length - count);
}
