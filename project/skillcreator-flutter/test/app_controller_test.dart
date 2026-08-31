import 'package:flutter_test/flutter_test.dart';
import 'package:skillcreator_flutter/app_controller.dart';
import 'package:skillcreator_flutter/models/skill_models.dart';
import 'package:skillcreator_flutter/services/skill_api_client.dart';

class _CapturingSkillApiClient extends SkillApiClient {
  Map<String, dynamic>? updatedDraft;

  @override
  Future<Map<String, dynamic>> updateSkill(
    String id,
    Map<String, dynamic> draft,
  ) async {
    updatedDraft = Map<String, dynamic>.from(draft);
    return <String, dynamic>{'ok': true};
  }
}

void main() {
  test('controller saves only canonical SkillDraft fields', () async {
    const source = '''---
name: sample
description: sample skill
---

## Rules

1. Preserve the requested semantics.
''';
    const extra = '# Reference\n\nKeep this file.\n';
    const files = <SkillFile>[
      SkillFile(path: 'SKILL.md', content: source, isEntry: true),
      SkillFile(path: 'references/rules.md', content: extra),
    ];
    final api = _CapturingSkillApiClient();
    final controller = AppController(api: api)
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
      ..files = files
      ..activeFilePath = 'SKILL.md'
      ..activeSource = source;
    addTearDown(controller.dispose);

    await controller.flushSave();

    final draft = api.updatedDraft;
    expect(draft, isNotNull);
    expect(draft!.keys.toSet(), {
      'name',
      'description',
      'sourceMarkdown',
      'files',
      'deletedFiles',
    });
    expect(draft['sourceMarkdown'], source);
    expect((draft['files'] as List).single['path'], 'references/rules.md');
    for (final legacyField in [
      'aliases',
      'content',
      'topRules',
      'rules',
      'commandTools',
    ]) {
      expect(draft.containsKey(legacyField), isFalse);
    }
  });
}
