class PuzzleRule {
  PuzzleRule({
    List<String>? properties,
    this.matchMode = 'ALL',
    List<String>? conditions,
    this.cause = '',
    this.verb = 'MUST',
    this.result = '',
  }) : properties = properties ?? <String>[],
       conditions = conditions ?? <String>[];
  List<String> properties;
  String matchMode;
  List<String> conditions;
  String cause;
  String verb;
  String result;

  PuzzleRule copy() => PuzzleRule(
    properties: List.of(properties),
    matchMode: matchMode,
    conditions: List.of(conditions),
    cause: cause,
    verb: verb,
    result: result,
  );
}

class MarkdownIdentity {
  const MarkdownIdentity(this.name, this.description);
  final String name;
  final String description;
}

class MarkdownSectionSlice {
  const MarkdownSectionSlice({
    required this.title,
    required this.headingStart,
    required this.bodyStart,
    required this.end,
    required this.body,
  });

  final String title;
  final int headingStart;
  final int bodyStart;
  final int end;
  final String body;
}

class NumberedRuleSlice {
  const NumberedRuleSlice({
    required this.sectionIndex,
    required this.sectionTitle,
    required this.number,
    required this.text,
    required this.indent,
    required this.lineStart,
    required this.lineEnd,
  });

  final int sectionIndex;
  final String sectionTitle;
  final int number;
  final String text;
  final String indent;
  final int lineStart;
  final int lineEnd;
}

class _SourceLine {
  const _SourceLine({
    required this.text,
    required this.start,
    required this.contentEnd,
    required this.end,
  });

  final String text;
  final int start;
  final int contentEnd;
  final int end;
}

class _SectionHeading {
  const _SectionHeading({
    required this.title,
    required this.start,
    required this.bodyStart,
  });

  final String title;
  final int start;
  final int bodyStart;
}

class SkillMarkdown {
  static final RegExp _rulePattern = RegExp(
    r'^[-*]\s+\[([^\]]*)\]\s+(ALL|ANY)\((.*?)\)(?:\s+BECAUSE\s+(.+?))?\s*=>\s*(MUST|USE|EMIT|RETURN|VERIFY|SKIP|AVOID)\s+(.+)$',
    caseSensitive: false,
  );

  static MarkdownIdentity identity(String source) {
    if (!source.startsWith('---')) return const MarkdownIdentity('', '');
    final end = source.indexOf('\n---', 3);
    if (end < 0) return const MarkdownIdentity('', '');
    final block = source.substring(3, end);
    String name = '';
    String description = '';
    for (final line in block.split(RegExp(r'\r?\n'))) {
      final colon = line.indexOf(':');
      if (colon <= 0) continue;
      final key = line.substring(0, colon).trim().toLowerCase();
      final value = _unquote(line.substring(colon + 1).trim());
      if (key == 'name') name = value;
      if (key == 'description') description = value;
    }
    return MarkdownIdentity(name, description);
  }

  static String updateIdentity(
    String source, {
    required String name,
    required String description,
  }) {
    final safeName = name.trim().isEmpty ? 'untitled-skill' : name.trim();
    final frontmatter =
        '---\nname: ${_yamlScalar(safeName)}\ndescription: ${_yamlScalar(description.trim())}\n---';
    if (source.startsWith('---')) {
      final end = source.indexOf('\n---', 3);
      if (end >= 0) return '$frontmatter${source.substring(end + 4)}';
    }
    return '$frontmatter\n\n${source.trimLeft()}';
  }

  static List<PuzzleRule> parseRules(String source) {
    final section =
        sectionBody(source, 'Rules') ?? sectionBody(source, '规则') ?? '';
    final rules = <PuzzleRule>[];
    for (final raw in section.split(RegExp(r'\r?\n'))) {
      final line = raw.trim();
      if (line.isEmpty) continue;
      final match = _rulePattern.firstMatch(line);
      if (match != null) {
        rules.add(
          PuzzleRule(
            properties: _splitEscaped(match.group(1) ?? '', ','),
            matchMode: (match.group(2) ?? 'ALL').toUpperCase(),
            conditions: _splitEscaped(
              match.group(3) ?? '',
              (match.group(2) ?? 'ALL').toUpperCase() == 'ANY' ? '||' : '&&',
            ),
            cause: _unescapeLogic(match.group(4) ?? ''),
            verb: (match.group(5) ?? 'MUST').toUpperCase(),
            result: _unescapeLogic(match.group(6) ?? ''),
          ),
        );
        continue;
      }
      final chinese = RegExp(
        r'^[-*]\s*(?:如果|若)\s*(.+?)(?:，|,)?\s*(?:那么|则)\s*(.+)$',
      ).firstMatch(line);
      if (chinese != null) {
        rules.add(
          PuzzleRule(
            conditions: [chinese.group(1)!.trim()],
            result: chinese.group(2)!.trim(),
          ),
        );
      }
    }
    return rules;
  }

  static String serializeRules(String source, List<PuzzleRule> rules) {
    final lines = rules
        .where(
          (rule) =>
              rule.result.trim().isNotEmpty ||
              rule.conditions.any((e) => e.trim().isNotEmpty),
        )
        .map((rule) {
          final mode = rule.matchMode.toUpperCase() == 'ANY' ? 'ANY' : 'ALL';
          final joiner = mode == 'ANY' ? ' || ' : ' && ';
          final properties = rule.properties
              .map((e) => _escapeLogic(e.trim()))
              .where((e) => e.isNotEmpty)
              .join(', ');
          final conditions = rule.conditions
              .map((e) => _escapeLogic(e.trim()))
              .where((e) => e.isNotEmpty)
              .join(joiner);
          final cause = rule.cause.trim().isEmpty
              ? ''
              : ' BECAUSE ${_escapeLogic(rule.cause.trim())}';
          final verb =
              const {
                'MUST',
                'USE',
                'EMIT',
                'RETURN',
                'VERIFY',
                'SKIP',
                'AVOID',
              }.contains(rule.verb.toUpperCase())
              ? rule.verb.toUpperCase()
              : 'MUST';
          return '- [$properties] $mode($conditions)$cause => $verb ${_escapeLogic(rule.result.trim())}';
        })
        .toList();
    return replaceSection(
      source,
      'Rules',
      lines.join('\n'),
      aliases: const ['规则'],
    );
  }

  static String? sectionBody(String source, String title) {
    final lines = source.replaceAll('\r\n', '\n').split('\n');
    final heading = RegExp(
      '^##\\s+${RegExp.escape(title)}\\s*\$',
      caseSensitive: false,
    );
    int? start;
    for (var i = 0; i < lines.length; i++) {
      if (heading.hasMatch(lines[i].trim())) {
        start = i + 1;
        break;
      }
    }
    if (start == null) return null;
    var end = lines.length;
    for (var i = start; i < lines.length; i++) {
      if (RegExp(r'^##\s+').hasMatch(lines[i])) {
        end = i;
        break;
      }
    }
    return lines.sublist(start, end).join('\n').trim();
  }

  static String replaceSection(
    String source,
    String title,
    String body, {
    List<String> aliases = const [],
  }) {
    final normalized = source.replaceAll('\r\n', '\n');
    final lines = normalized.split('\n');
    final titles = {
      title.toLowerCase(),
      ...aliases.map((e) => e.toLowerCase()),
    };
    int? start;
    var end = lines.length;
    for (var i = 0; i < lines.length; i++) {
      final match = RegExp(r'^##\s+(.+?)\s*$').firstMatch(lines[i]);
      if (match == null) continue;
      if (start == null &&
          titles.contains(match.group(1)!.trim().toLowerCase())) {
        start = i;
        continue;
      }
      if (start != null) {
        end = i;
        break;
      }
    }
    final block = [
      '## $title',
      if (body.trim().isNotEmpty) '',
      body.trimRight(),
    ];
    if (start == null) {
      final prefix = normalized.trimRight();
      return '${prefix.isEmpty ? '' : '$prefix\n\n'}${block.join('\n')}\n';
    }
    final next = <String>[
      ...lines.sublist(0, start),
      ...block,
      ...lines.sublist(end),
    ];
    return '${next.join('\n').replaceAll(RegExp(r'\n{4,}'), '\n\n\n').trimRight()}\n';
  }

  static List<MarkdownSectionSlice> sections(String source) {
    final headings = <_SectionHeading>[];
    var inFence = false;
    var fenceCharacter = '';
    var fenceLength = 0;
    for (final line in _sourceLines(source)) {
      final fence = RegExp(r'^\s*(`{3,}|~{3,})').firstMatch(line.text);
      if (fence != null) {
        final marker = fence.group(1)!;
        if (!inFence) {
          inFence = true;
          fenceCharacter = marker[0];
          fenceLength = marker.length;
        } else if (marker[0] == fenceCharacter &&
            marker.length >= fenceLength) {
          inFence = false;
          fenceCharacter = '';
          fenceLength = 0;
        }
        continue;
      }
      if (inFence) continue;
      final heading = RegExp(r'^##[ \t]+(.+?)[ \t]*$').firstMatch(line.text);
      if (heading == null) continue;
      headings.add(
        _SectionHeading(
          title: heading.group(1)!.trim(),
          start: line.start,
          bodyStart: line.end,
        ),
      );
    }
    return List<MarkdownSectionSlice>.generate(headings.length, (index) {
      final heading = headings[index];
      final end = index + 1 < headings.length
          ? headings[index + 1].start
          : source.length;
      return MarkdownSectionSlice(
        title: heading.title,
        headingStart: heading.start,
        bodyStart: heading.bodyStart,
        end: end,
        body: source.substring(heading.bodyStart, end),
      );
    }, growable: false);
  }

  static String replaceSectionAt(
    String source,
    int index, {
    required String title,
    required String body,
  }) {
    final current = sections(source);
    if (index < 0 || index >= current.length) {
      throw RangeError.index(index, current, 'index');
    }
    final section = current[index];
    final newline = _newlineFor(source);
    final cleanTitle = title.trim();
    if (cleanTitle.isEmpty ||
        cleanTitle.contains('\n') ||
        cleanTitle.contains('\r')) {
      throw ArgumentError.value(title, 'title', '章节标题不能为空或包含换行。');
    }
    final cleanBody = _normalizeNewlines(body, newline).trim();
    final block = cleanBody.isEmpty
        ? '## $cleanTitle$newline$newline'
        : '## $cleanTitle$newline$newline$cleanBody$newline$newline';
    return '${source.substring(0, section.headingStart)}$block${source.substring(section.end)}';
  }

  static String addSection(
    String source, {
    required String title,
    String body = '',
  }) {
    final newline = _newlineFor(source);
    final cleanTitle = title.trim();
    if (cleanTitle.isEmpty ||
        cleanTitle.contains('\n') ||
        cleanTitle.contains('\r')) {
      throw ArgumentError.value(title, 'title', '章节标题不能为空或包含换行。');
    }
    final cleanBody = _normalizeNewlines(body, newline).trim();
    final prefix = source.trimRight();
    final block = cleanBody.isEmpty
        ? '## $cleanTitle$newline$newline'
        : '## $cleanTitle$newline$newline$cleanBody$newline$newline';
    return '${prefix.isEmpty ? '' : '$prefix$newline$newline'}$block';
  }

  static String removeSectionAt(String source, int index) {
    final current = sections(source);
    if (index < 0 || index >= current.length) {
      throw RangeError.index(index, current, 'index');
    }
    final section = current[index];
    return '${source.substring(0, section.headingStart)}${source.substring(section.end)}';
  }

  static String moveSection(String source, int index, int delta) {
    final current = sections(source);
    if (index < 0 || index >= current.length) {
      throw RangeError.index(index, current, 'index');
    }
    final target = index + delta;
    if (target < 0 || target >= current.length || target == index) {
      return source;
    }
    final prefix = source.substring(0, current.first.headingStart);
    final chunks = current
        .map((section) => source.substring(section.headingStart, section.end))
        .toList();
    final moved = chunks.removeAt(index);
    chunks.insert(target, moved);
    return '$prefix${chunks.join()}';
  }

  static List<NumberedRuleSlice> numberedRules(String source) {
    final output = <NumberedRuleSlice>[];
    final currentSections = sections(source);
    for (
      var sectionIndex = 0;
      sectionIndex < currentSections.length;
      sectionIndex++
    ) {
      final section = currentSections[sectionIndex];
      var inFence = false;
      var fenceCharacter = '';
      var fenceLength = 0;
      for (final line in _sourceLines(section.body)) {
        final fence = RegExp(r'^\s*(`{3,}|~{3,})').firstMatch(line.text);
        if (fence != null) {
          final marker = fence.group(1)!;
          if (!inFence) {
            inFence = true;
            fenceCharacter = marker[0];
            fenceLength = marker.length;
          } else if (marker[0] == fenceCharacter &&
              marker.length >= fenceLength) {
            inFence = false;
            fenceCharacter = '';
            fenceLength = 0;
          }
          continue;
        }
        if (inFence) continue;
        final match = RegExp(
          r'^([ \t]*)(\d+)\.[ \t]+(.+?)\s*$',
        ).firstMatch(line.text);
        if (match == null) continue;
        output.add(
          NumberedRuleSlice(
            sectionIndex: sectionIndex,
            sectionTitle: section.title,
            number: int.parse(match.group(2)!),
            text: match.group(3)!.trimRight(),
            indent: match.group(1)!,
            lineStart: section.bodyStart + line.start,
            lineEnd: section.bodyStart + line.contentEnd,
          ),
        );
      }
    }
    return output;
  }

  static String updateNumberedRule(
    String source,
    NumberedRuleSlice rule,
    String text,
  ) {
    if (rule.lineStart < 0 ||
        rule.lineEnd > source.length ||
        rule.lineStart > rule.lineEnd) {
      throw RangeError('规则范围无效。');
    }
    final clean = text.trim();
    if (clean.isEmpty || clean.contains('\n') || clean.contains('\r')) {
      throw ArgumentError.value(text, 'text', '规则内容不能为空或包含换行。');
    }
    final replacement = '${rule.indent}${rule.number}. $clean';
    return '${source.substring(0, rule.lineStart)}$replacement${source.substring(rule.lineEnd)}';
  }

  static String addNumberedRule(String source, int sectionIndex, String text) {
    final current = sections(source);
    if (sectionIndex < 0 || sectionIndex >= current.length) {
      throw RangeError.index(sectionIndex, current, 'sectionIndex');
    }
    final clean = text.trim();
    if (clean.isEmpty || clean.contains('\n') || clean.contains('\r')) {
      throw ArgumentError.value(text, 'text', '规则内容不能为空或包含换行。');
    }
    final section = current[sectionIndex];
    final existing = numberedRules(
      source,
    ).where((rule) => rule.sectionIndex == sectionIndex).toList();
    final nextNumber = existing.isEmpty
        ? 1
        : existing.map((rule) => rule.number).reduce((a, b) => a > b ? a : b) +
              1;
    final body = section.body.trimRight();
    final newline = _newlineFor(source);
    final nextBody =
        '${body.isEmpty ? '' : '$body$newline'}$nextNumber. $clean';
    return replaceSectionAt(
      source,
      sectionIndex,
      title: section.title,
      body: nextBody,
    );
  }

  static List<String> indexedFiles(String source) {
    final body = sectionBody(source, 'Skill Map') ?? '';
    final paths = <String>[];
    final pattern = RegExp(r'`([^`]+\.md)`', caseSensitive: false);
    for (final match in pattern.allMatches(body)) {
      final path = normalizeMarkdownPath(match.group(1) ?? '');
      if (path != null &&
          path.toLowerCase() != 'skill.md' &&
          !paths.any((e) => e.toLowerCase() == path.toLowerCase())) {
        paths.add(path);
      }
    }
    return paths;
  }

  static String syncSkillMap(String source, Iterable<String> filePaths) {
    final existing = sectionBody(source, 'Skill Map') ?? '';
    final existingLines = existing.split('\n');
    final lines = <String>[];
    for (final rawPath in filePaths) {
      final path = normalizeMarkdownPath(rawPath);
      if (path == null || path.toLowerCase() == 'skill.md') continue;
      final existingLine = existingLines.firstWhere(
        (line) => RegExp(
          '`?${RegExp.escape(path)}`?',
          caseSensitive: false,
        ).hasMatch(line),
        orElse: () => '',
      );
      lines.add(
        existingLine.trim().isNotEmpty
            ? existingLine.trim()
            : '- `$path` — LOAD when the request needs this topic; RESULT apply this block and skip unrelated files.',
      );
    }
    for (final line in existingLines) {
      if (line.trim().isEmpty) continue;
      if (!RegExp(r'`[^`]+\.md`', caseSensitive: false).hasMatch(line) &&
          !lines.contains(line.trim())) {
        lines.add(line.trim());
      }
    }
    return replaceSection(source, 'Skill Map', lines.join('\n'));
  }

  static String minimizeEntry(String source, Iterable<String> filePaths) {
    var next = syncSkillMap(source, filePaths);
    final identityData = identity(next);
    final map = sectionBody(next, 'Skill Map') ?? '';
    final loadingRule =
        sectionBody(next, 'Loading Rule') ??
        'LOAD only the indexed file(s) required by the current request. RESULT keep SKILL.md as the compact routing index.';
    return '${updateIdentity('', name: identityData.name, description: identityData.description).trimRight()}\n\n## Skill Map\n\n$map\n\n## Loading Rule\n\n$loadingRule\n';
  }

  static String? normalizeSkillFilePath(String input) {
    var path = input.trim().replaceAll('\\', '/');
    while (path.startsWith('./')) {
      path = path.substring(2);
    }
    if (path.isEmpty ||
        path.length > 512 ||
        path.startsWith('/') ||
        path.contains(':')) {
      return null;
    }
    final parts = path.split('/');
    if (parts.any(
      (p) =>
          p.isEmpty ||
          p == '.' ||
          p == '..' ||
          p.toLowerCase() == '.git' ||
          p.toLowerCase() == '.svn',
    )) {
      return null;
    }
    return path;
  }

  static String? normalizeMarkdownPath(String input) {
    final path = normalizeSkillFilePath(input);
    if (path == null || !path.toLowerCase().endsWith('.md')) {
      return null;
    }
    return path;
  }

  static String sourceHash(String source) {
    var hash = 0x811c9dc5;
    for (final codeUnit in source.codeUnits) {
      hash ^= codeUnit;
      hash = (hash * 0x01000193) & 0xffffffff;
    }
    return 'fnv1a-${hash.toRadixString(16).padLeft(8, '0')}';
  }

  static String unifiedDiff(
    String before,
    String after, {
    String filePath = 'SKILL.md',
  }) {
    final left = before.replaceAll('\r\n', '\n').split('\n');
    final right = after.replaceAll('\r\n', '\n').split('\n');
    var prefix = 0;
    while (prefix < left.length &&
        prefix < right.length &&
        left[prefix] == right[prefix]) {
      prefix++;
    }
    var suffix = 0;
    while (suffix < left.length - prefix &&
        suffix < right.length - prefix &&
        left[left.length - 1 - suffix] == right[right.length - 1 - suffix]) {
      suffix++;
    }
    final out = <String>[
      '--- before/$filePath',
      '+++ after/$filePath',
      '@@ -1,${left.length} +1,${right.length} @@',
    ];
    out.addAll(left.take(prefix).map((e) => ' $e'));
    out.addAll(left.sublist(prefix, left.length - suffix).map((e) => '-$e'));
    out.addAll(right.sublist(prefix, right.length - suffix).map((e) => '+$e'));
    if (suffix > 0) {
      out.addAll(left.sublist(left.length - suffix).map((e) => ' $e'));
    }
    return out.join('\n');
  }

  static List<_SourceLine> _sourceLines(String source) {
    final output = <_SourceLine>[];
    var start = 0;
    while (start < source.length) {
      final newlineIndex = source.indexOf('\n', start);
      final end = newlineIndex < 0 ? source.length : newlineIndex + 1;
      var contentEnd = newlineIndex < 0 ? source.length : newlineIndex;
      if (contentEnd > start && source.codeUnitAt(contentEnd - 1) == 13) {
        contentEnd--;
      }
      output.add(
        _SourceLine(
          text: source.substring(start, contentEnd),
          start: start,
          contentEnd: contentEnd,
          end: end,
        ),
      );
      start = end;
    }
    if (source.isEmpty) {
      return const <_SourceLine>[];
    }
    return output;
  }

  static String _newlineFor(String source) =>
      source.contains('\r\n') ? '\r\n' : '\n';

  static String _normalizeNewlines(String value, String newline) => value
      .replaceAll('\r\n', '\n')
      .replaceAll('\r', '\n')
      .replaceAll('\n', newline);

  static List<String> _splitEscaped(String input, String delimiter) {
    final values = <String>[];
    final current = StringBuffer();
    var escaped = false;
    var i = 0;
    while (i < input.length) {
      final ch = input[i];
      if (escaped) {
        current.write(ch);
        escaped = false;
        i++;
        continue;
      }
      if (ch == '\\') {
        escaped = true;
        current.write(ch);
        i++;
        continue;
      }
      if (input.startsWith(delimiter, i)) {
        values.add(_unescapeLogic(current.toString().trim()));
        current.clear();
        i += delimiter.length;
        continue;
      }
      current.write(ch);
      i++;
    }
    if (current.isNotEmpty || input.isNotEmpty) {
      values.add(_unescapeLogic(current.toString().trim()));
    }
    return values.where((e) => e.isNotEmpty).toList();
  }

  static String _escapeLogic(String value) => value
      .replaceAll('\\', '\\\\')
      .replaceAll('&&', '\\&&')
      .replaceAll('||', '\\||');
  static String _unescapeLogic(String value) => value
      .replaceAll('\\&&', '&&')
      .replaceAll('\\||', '||')
      .replaceAll('\\\\', '\\');
  static String _yamlScalar(String value) =>
      value.isEmpty || RegExp(r'[:#\[\]{}\n\r]|^[-?]|^\s|\s$').hasMatch(value)
      ? '"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"'
      : value;
  static String _unquote(String value) =>
      value.length >= 2 &&
          ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'")))
      ? value.substring(1, value.length - 1)
      : value;
}
