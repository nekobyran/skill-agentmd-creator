enum AppPage { editor, advanced, graph, ai, library, settings }

enum BackendState { connecting, connected, disconnected }

class SkillSummary {
  const SkillSummary({
    required this.id,
    required this.name,
    required this.description,
    required this.filePath,
    required this.updatedAt,
  });
  final String id;
  final String name;
  final String description;
  final String filePath;
  final int updatedAt;
  factory SkillSummary.fromJson(Map<String, dynamic> json) => SkillSummary(
    id: json['id'] as String? ?? '',
    name: json['name'] as String? ?? '',
    description: json['description'] as String? ?? '',
    filePath: json['filePath'] as String? ?? '',
    updatedAt: (json['updatedAt'] as num?)?.toInt() ?? 0,
  );
}

class SkillFile {
  const SkillFile({
    required this.path,
    required this.content,
    this.byteSize = 0,
    this.isEntry = false,
  });
  final String path;
  final String content;
  final int byteSize;
  final bool isEntry;
  factory SkillFile.fromJson(Map<String, dynamic> json) => SkillFile(
    path: json['path'] as String? ?? '',
    content: json['content'] as String? ?? '',
    byteSize: (json['byteSize'] as num?)?.toInt() ?? 0,
    isEntry: json['isEntry'] as bool? ?? false,
  );
  SkillFile copyWith({
    String? path,
    String? content,
    int? byteSize,
    bool? isEntry,
  }) => SkillFile(
    path: path ?? this.path,
    content: content ?? this.content,
    byteSize: byteSize ?? this.byteSize,
    isEntry: isEntry ?? this.isEntry,
  );
  Map<String, dynamic> toDraftJson() => {'path': path, 'content': content};
}

class SkillContent {
  const SkillContent({
    required this.id,
    required this.name,
    required this.description,
    required this.filePath,
    required this.content,
    required this.entryFile,
    required this.indexMode,
    required this.files,
  });
  final String id;
  final String name;
  final String description;
  final String filePath;
  final String content;
  final String entryFile;
  final bool indexMode;
  final List<SkillFile> files;
  factory SkillContent.fromJson(Map<String, dynamic> json) => SkillContent(
    id: json['id'] as String? ?? '',
    name: json['name'] as String? ?? '',
    description: json['description'] as String? ?? '',
    filePath: json['filePath'] as String? ?? '',
    content: json['content'] as String? ?? '',
    entryFile: json['entryFile'] as String? ?? 'SKILL.md',
    indexMode: json['indexMode'] as bool? ?? false,
    files: ((json['files'] as List?) ?? const [])
        .whereType<Map>()
        .map((e) => SkillFile.fromJson(Map<String, dynamic>.from(e)))
        .toList(growable: false),
  );
}

class CodexModelOption {
  const CodexModelOption({
    required this.slug,
    required this.displayName,
    required this.reasoningLevels,
    required this.supportsFast,
  });
  final String slug;
  final String displayName;
  final List<String> reasoningLevels;
  final bool supportsFast;
  factory CodexModelOption.fromJson(Map<String, dynamic> json) =>
      CodexModelOption(
        slug: json['slug'] as String? ?? '',
        displayName: json['displayName'] as String? ?? '',
        reasoningLevels: ((json['reasoningLevels'] as List?) ?? const [])
            .whereType<String>()
            .toList(),
        supportsFast: json['supportsFast'] as bool? ?? false,
      );
}

class CodexModelStatus {
  const CodexModelStatus({
    required this.connected,
    required this.message,
    required this.model,
    required this.reasoningEffort,
    required this.fastMode,
    required this.availableModels,
  });
  final bool connected;
  final String message;
  final String model;
  final String reasoningEffort;
  final bool fastMode;
  final List<CodexModelOption> availableModels;
  factory CodexModelStatus.fromJson(Map<String, dynamic> json) =>
      CodexModelStatus(
        connected: json['connected'] as bool? ?? false,
        message: json['message'] as String? ?? '',
        model: json['model'] as String? ?? '',
        reasoningEffort: json['reasoningEffort'] as String? ?? 'medium',
        fastMode: json['fastMode'] as bool? ?? false,
        availableModels: ((json['availableModels'] as List?) ?? const [])
            .whereType<Map>()
            .map((e) => CodexModelOption.fromJson(Map<String, dynamic>.from(e)))
            .toList(growable: false),
      );
}

class CodexSkillEntry {
  const CodexSkillEntry({
    required this.id,
    required this.name,
    required this.description,
    required this.source,
    required this.relativePath,
    required this.sourcePath,
    required this.fileCount,
    required this.byteSize,
    required this.imported,
    required this.importedId,
    required this.editorChain,
    required this.formatGaps,
    required this.normalizedRuleCount,
    required this.legacyRuleCount,
    required this.loadable,
  });
  final String id;
  final String name;
  final String description;
  final String source;
  final String relativePath;
  final String sourcePath;
  final int fileCount;
  final int byteSize;
  final bool imported;
  final String? importedId;
  final String editorChain;
  final List<String> formatGaps;
  final int normalizedRuleCount;
  final int legacyRuleCount;
  final bool loadable;
  factory CodexSkillEntry.fromJson(Map<String, dynamic> json) =>
      CodexSkillEntry(
        id: json['id'] as String? ?? '',
        name: json['name'] as String? ?? '',
        description: json['description'] as String? ?? '',
        source: json['source'] as String? ?? '',
        relativePath: json['relativePath'] as String? ?? '',
        sourcePath: json['sourcePath'] as String? ?? '',
        fileCount: (json['fileCount'] as num?)?.toInt() ?? 0,
        byteSize: (json['byteSize'] as num?)?.toInt() ?? 0,
        imported: json['imported'] as bool? ?? false,
        importedId: json['importedId'] as String?,
        editorChain: json['editorChain'] as String? ?? '',
        formatGaps: ((json['formatGaps'] as List?) ?? const [])
            .whereType<String>()
            .toList(),
        normalizedRuleCount:
            (json['normalizedRuleCount'] as num?)?.toInt() ?? 0,
        legacyRuleCount: (json['legacyRuleCount'] as num?)?.toInt() ?? 0,
        loadable: json['loadable'] as bool? ?? false,
      );
}

class CodexSkillCatalog {
  const CodexSkillCatalog({
    required this.entries,
    required this.roots,
    required this.warnings,
  });
  final List<CodexSkillEntry> entries;
  final List<String> roots;
  final List<String> warnings;
  factory CodexSkillCatalog.fromJson(Map<String, dynamic> json) =>
      CodexSkillCatalog(
        entries: ((json['entries'] as List?) ?? const [])
            .whereType<Map>()
            .map((e) => CodexSkillEntry.fromJson(Map<String, dynamic>.from(e)))
            .toList(growable: false),
        roots: ((json['roots'] as List?) ?? const [])
            .whereType<String>()
            .toList(),
        warnings: ((json['warnings'] as List?) ?? const [])
            .whereType<String>()
            .toList(),
      );
}

class AiProposal {
  AiProposal({
    required this.mode,
    required this.title,
    required this.summary,
    required this.before,
    required this.after,
    required this.diff,
    required this.filePath,
    required this.baseBundleHash,
    this.targetSkillId,
    this.proposedFiles = const [],
    this.deletedFiles = const [],
    this.warnings = const [],
    this.changedFiles = const [],
    this.discarded = false,
    this.applied = false,
  });
  final String mode;
  final String title;
  final String summary;
  final String before;
  final String after;
  final String diff;
  final String filePath;
  final String baseBundleHash;
  final String? targetSkillId;
  final List<SkillFile> proposedFiles;
  final List<String> deletedFiles;
  final List<String> warnings;
  final List<String> changedFiles;
  bool discarded;
  bool applied;
}
