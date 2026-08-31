import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:skillcreator_flutter/services/skill_api_client.dart';

void main() {
  test('ping requires canonical service and data directory', () async {
    final expected = await Directory.systemTemp.createTemp(
      'skillcreator-health-',
    );

    Future<bool> ping(Map<String, Object?> payload) async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      final handled = server.first.then((request) async {
        request.response.headers.contentType = ContentType.json;
        request.response.write(jsonEncode(payload));
        await request.response.close();
      });
      try {
        final client = SkillApiClient(
          port: server.port,
          expectedDataDir: expected.path,
        );
        final result = await client.ping();
        await handled;
        return result;
      } finally {
        await server.close(force: true);
      }
    }

    try {
      expect(
        await ping({
          'ok': true,
          'service': 'skillcreator-api',
          'dataDir': expected.path,
        }),
        isTrue,
      );
      expect(
        await ping({
          'ok': true,
          'service': 'skill-agentmd-creator-api',
          'dataDir': expected.path,
        }),
        isFalse,
      );
      expect(
        await ping({
          'ok': true,
          'service': 'skillcreator-api',
          'dataDir': '${expected.path}-legacy',
        }),
        isFalse,
      );
    } finally {
      await expected.delete(recursive: true);
    }
  });

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
