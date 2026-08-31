import 'package:flutter_test/flutter_test.dart';
import 'package:skillcreator_flutter/app_controller.dart';
import 'package:skillcreator_flutter/main.dart';
import 'package:skillcreator_flutter/models/skill_models.dart';

void main() {
  testWidgets('SkillCreator shell renders without backend bootstrap', (
    tester,
  ) async {
    await tester.pumpWidget(const SkillCreatorApp(autoBootstrap: false));
    await tester.pump();

    expect(find.text('还没有 Skill 工程'), findsOneWidget);
    expect(find.text('编辑'), findsOneWidget);
    expect(find.text('详细'), findsOneWidget);
    expect(find.text('技能库'), findsOneWidget);
    expect(find.text('设置'), findsOneWidget);
  });

  testWidgets('advanced studio edits the current canonical bundle', (
    tester,
  ) async {
    const source = '''---
name: sample
description: sample skill
---

## Top Rules

1. Keep the root compact.

## Skill Map

- `references/rules.md` — LOAD when rules are needed.
''';
    const ruleSource = '''# Rules

## Rules

1. Validate input before execution.
2. Verify the result.
''';
    const files = <SkillFile>[
      SkillFile(path: 'SKILL.md', content: source, isEntry: true),
      SkillFile(path: 'references/rules.md', content: ruleSource),
    ];
    final controller = AppController()
      ..selected = const SkillContent(
        id: 'sample',
        name: 'sample',
        description: 'sample skill',
        filePath: 'sample/SKILL.md',
        content: source,
        entryFile: 'SKILL.md',
        indexMode: true,
        files: files,
      )
      ..skills = const [
        SkillSummary(
          id: 'sample',
          name: 'sample',
          description: 'sample skill',
          filePath: 'sample/SKILL.md',
          updatedAt: 0,
        ),
      ]
      ..files = files
      ..activeFilePath = 'SKILL.md'
      ..activeSource = source;
    addTearDown(controller.dispose);

    await tester.pumpWidget(
      SkillCreatorApp(controller: controller, autoBootstrap: false),
    );
    await tester.pump();
    await tester.tap(find.text('详细'));
    await tester.pumpAndSettle();

    expect(find.text('详细设计'), findsOneWidget);
    expect(find.text('文件包'), findsOneWidget);
    expect(find.text('根索引一致性'), findsOneWidget);

    await tester.tap(find.text('章节'));
    await tester.pumpAndSettle();
    expect(find.text('Top Rules'), findsWidgets);
    expect(find.text('Skill Map'), findsWidgets);

    controller.setActiveFile('references/rules.md');
    await tester.pump();
    await tester.tap(find.text('编号规则'));
    await tester.pumpAndSettle();
    expect(find.text('Validate input before execution.'), findsWidgets);
    expect(find.text('Verify the result.'), findsWidgets);
  });
}
