import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:skillcreator_flutter/services/skill_api_client.dart';

void main() {
  test('design request sends complete bundle and normative contract', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    Map<String, dynamic>? captured;
    final handled = server.first.then((request) async {
      captured = Map<String, dynamic>.from(
        jsonDecode(await utf8.decoder.bind(request).join()) as Map,
      );
      request.response.headers.contentType = ContentType.json;
      request.response.write(
        jsonEncode({
          'assistantMessage': 'ok',
          'markdown': '---\nname: demo\ndescription: Use when testing.\n---\n',
          'files': <Object>[],
          'deletedFiles': <Object>[],
          'model': 'test-model',
        }),
      );
      await request.response.close();
    });

    try {
      final client = SkillApiClient(port: server.port);
      final result = await client.designSkill(
        mode: 'modify',
        prompt: 'Update the rules.',
        currentSource: 'root',
        currentFiles: [
          {'path': 'references/rules.md', 'content': '1. Existing rule.'},
          {'path': 'assets/helper.ps1', 'content': 'Write-Output ok'},
        ],
        history: const [],
      );
      await handled;

      expect(result['assistantMessage'], 'ok');
      expect(captured?['normative'], isTrue);
      expect(captured?['includeChineseSample'], isFalse);
      expect(captured?['currentSource'], 'root');
      expect(captured?['currentFiles'], hasLength(2));
      expect(captured?['currentFiles'][1]['path'], 'assets/helper.ps1');
    } finally {
      await server.close(force: true);
    }
  });
}
