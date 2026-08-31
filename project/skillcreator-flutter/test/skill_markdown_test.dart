import 'package:flutter_test/flutter_test.dart';
import 'package:skillcreator_flutter/services/skill_markdown.dart';

void main() {
  test('skill file paths accept reusable UTF-8 source files safely', () {
    expect(
      SkillMarkdown.normalizeSkillFilePath(r'assets\helper.ps1'),
      'assets/helper.ps1',
    );
    expect(
      SkillMarkdown.normalizeSkillFilePath('lib/sample.dart'),
      'lib/sample.dart',
    );
    expect(SkillMarkdown.normalizeSkillFilePath('../escape.md'), isNull);
    expect(SkillMarkdown.normalizeSkillFilePath('.git/config'), isNull);
    expect(SkillMarkdown.normalizeSkillFilePath('C:/escape.md'), isNull);
  });

  test('markdown routing paths stay markdown-only', () {
    expect(
      SkillMarkdown.normalizeMarkdownPath('references/rules.md'),
      'references/rules.md',
    );
    expect(SkillMarkdown.normalizeMarkdownPath('assets/helper.ps1'), isNull);
  });

  test(
    'rules section editor preserves free semantics and unrelated sections',
    () {
      const source = '''---
name: sample
description: sample
---

## Rules

1. Preserve the exact requirement.
2. Verify only when the requirement asks for evidence.

```markdown
## Not A Section
Keep this fenced content.
```

## Validation

Keep validation unchanged.
''';

      final body = SkillMarkdown.rulesSectionBody(source);
      expect(body, contains('1. Preserve the exact requirement.'));
      expect(body, contains('## Not A Section'));

      final next = SkillMarkdown.replaceRulesSection(
        source,
        '1. Preserve free semantics.\n2. Add conditions only when required.',
      );

      expect(next, contains('## Rules\n\n1. Preserve free semantics.'));
      expect(next, contains('2. Add conditions only when required.'));
      expect(next, contains('## Validation\n\nKeep validation unchanged.'));
      expect(next, isNot(contains('ALL(')));
      expect(next, isNot(contains('=> MUST')));
    },
  );

  test('rule parser distinguishes free semantic and explicit conditions', () {
    const source = '''## Rules

1. Preserve the direct requirement.
- 如果 input is missing，那么 request it explicitly

```text
3. This fenced example is not a rule.
```
''';

    final rules = SkillMarkdown.parseRules(source);
    expect(rules, hasLength(2));

    expect(rules[0].freeText, 'Preserve the direct requirement.');
    expect(rules[0].conditions, isEmpty);
    expect(rules[1].freeText, isEmpty);
    expect(rules[1].conditions, ['input is missing']);
    expect(rules[1].result, 'request it explicitly');
  });

  test('section editor ignores headings inside fenced code blocks', () {
    const source = '''---
name: sample
description: sample
---

## Rules

1. Keep this rule.

```markdown
## Not A Section
1. Not a rule.
```

## Validation

Verify it.
''';

    final sections = SkillMarkdown.sections(source);
    expect(sections.map((section) => section.title), ['Rules', 'Validation']);
    final rules = SkillMarkdown.numberedRules(source);
    expect(rules, hasLength(1));
    expect(rules.single.number, 1);
    expect(rules.single.text, 'Keep this rule.');
  });

  test('section edits preserve unknown prefix and unrelated sections', () {
    const source = '''---
name: sample
description: sample
custom: keep-me
---

Intro text.

## Rules

1. Old rule.

## Unknown Extension

opaque: true
''';

    final next = SkillMarkdown.replaceSectionAt(
      source,
      0,
      title: 'Rules',
      body: '1. New rule.',
    );

    expect(next, contains('custom: keep-me'));
    expect(next, contains('Intro text.'));
    expect(next, contains('## Unknown Extension\n\nopaque: true'));
    expect(next, contains('## Rules\n\n1. New rule.'));
  });

  test('numbered rule update keeps its fixed number', () {
    const source = '''## Rules

1. First rule.
2. Second rule.
''';
    final rule = SkillMarkdown.numberedRules(source)[1];
    final next = SkillMarkdown.updateNumberedRule(
      source,
      rule,
      'Updated rule.',
    );
    expect(next, contains('1. First rule.'));
    expect(next, contains('2. Updated rule.'));
    expect(next, isNot(contains('3. Updated rule.')));
  });

  test('adding a numbered rule appends the next fixed number', () {
    const source = '''## Rules

1. First rule.
3. Existing stable number.
''';
    final next = SkillMarkdown.addNumberedRule(source, 0, 'New rule.');
    expect(next, contains('4. New rule.'));
  });

  test(
    'number allocation is isolated by section index even for duplicate titles',
    () {
      const source = '''## Rules

7. First section rule.

## Rules

2. Second section rule.
''';
      final next = SkillMarkdown.addNumberedRule(
        source,
        1,
        'Second section addition.',
      );
      expect(next, contains('7. First section rule.'));
      expect(next, contains('2. Second section rule.'));
      expect(next, contains('3. Second section addition.'));
      expect(next, isNot(contains('8. Second section addition.')));
    },
  );

  test('moving sections preserves each complete section payload', () {
    const source = '''prefix

## One

first

## Two

second
''';
    final next = SkillMarkdown.moveSection(source, 1, -1);
    expect(next, startsWith('prefix\n\n## Two\n\nsecond\n## One'));
    expect(next, contains('first'));
  });
}
