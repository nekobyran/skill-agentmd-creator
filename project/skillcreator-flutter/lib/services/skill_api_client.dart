import 'dart:async';
import 'dart:convert';
import 'dart:io';

import '../models/skill_models.dart';

class SkillApiException implements Exception {
  SkillApiException(this.message, {this.statusCode});
  final String message;
  final int? statusCode;
  @override
  String toString() => message;
}

class SkillApiClient {
  SkillApiClient({this.host = '127.0.0.1', this.port = 1421});
  final String host;
  final int port;

  Uri _uri(String path) =>
      Uri(scheme: 'http', host: host, port: port, path: '/api$path');

  Future<dynamic> _request(
    String method,
    String path, {
    Object? body,
    Duration timeout = const Duration(seconds: 90),
  }) async {
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 3);
    try {
      final request = await client.openUrl(method, _uri(path)).timeout(timeout);
      request.headers.set(HttpHeaders.acceptHeader, 'application/json');
      if (body != null) {
        request.headers.contentType = ContentType.json;
        request.write(jsonEncode(body));
      }
      final response = await request.close().timeout(timeout);
      final text = await utf8.decoder.bind(response).join();
      dynamic data;
      if (text.trim().isNotEmpty) data = jsonDecode(text);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        final message = data is Map ? data['error']?.toString() : null;
        throw SkillApiException(
          message ?? '本地 API 请求失败：${response.statusCode}',
          statusCode: response.statusCode,
        );
      }
      return data;
    } on TimeoutException {
      throw SkillApiException('本地 API 请求超时');
    } on SocketException catch (error) {
      throw SkillApiException('无法连接本地 SkillCreator 后台：${error.message}');
    } finally {
      client.close(force: true);
    }
  }

  Future<bool> ping() async {
    final data = await _request(
      'GET',
      '/health',
      timeout: const Duration(seconds: 3),
    );
    return data is Map && data['ok'] == true;
  }

  Future<void> ensureManifest() async => _request('POST', '/ensure_manifest');

  Future<List<SkillSummary>> listSkills() async {
    final data = await _request('GET', '/skills') as List<dynamic>? ?? const [];
    return data
        .whereType<Map>()
        .map((e) => SkillSummary.fromJson(Map<String, dynamic>.from(e)))
        .toList();
  }

  Future<SkillContent> readSkill(String id) async {
    final data = await _request('GET', '/skills/${Uri.encodeComponent(id)}');
    return SkillContent.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<Map<String, dynamic>> createSkill(Map<String, dynamic> draft) async {
    final data = await _request('POST', '/skills', body: {'draft': draft});
    return Map<String, dynamic>.from(data as Map);
  }

  Future<Map<String, dynamic>> updateSkill(
    String id,
    Map<String, dynamic> draft,
  ) async {
    final data = await _request(
      'PUT',
      '/skills/${Uri.encodeComponent(id)}',
      body: {'draft': draft},
    );
    return Map<String, dynamic>.from(data as Map);
  }

  Future<void> deleteSkill(String id) async =>
      _request('DELETE', '/skills/${Uri.encodeComponent(id)}');

  Future<CodexModelStatus> modelStatus() async {
    final data = await _request('GET', '/codex_status');
    return CodexModelStatus.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<CodexModelStatus> setModel({
    required String model,
    required String reasoningEffort,
    required bool fastMode,
  }) async {
    final data = await _request(
      'PUT',
      '/codex_model',
      body: {
        'model': model,
        'reasoningEffort': reasoningEffort,
        'fastMode': fastMode,
      },
    );
    return CodexModelStatus.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<String> translateRule(String text) async {
    final data = await _request(
      'POST',
      '/translate_rule',
      body: {'text': text},
    );
    final map = Map<String, dynamic>.from(data as Map);
    return map['translatedText'] as String? ?? text;
  }

    Future<Map<String, dynamic>> designSkill({
    required String mode,
    required String prompt,
    required String currentSource,
    required List<Map<String, dynamic>> currentFiles,
    required List<Map<String, String>> history,
  }) async {
    final data = await _request(
      'POST',
      '/design_skill',
      body: {
        'mode': mode,
        'prompt': prompt,
        'currentSource': currentSource,
        'currentFiles': currentFiles,
        'history': history,
        'normative': true,
        'includeChineseSample': false,
      },
      timeout: const Duration(minutes: 5),
    );
    return Map<String, dynamic>.from(data as Map);
  }


  Future<CodexSkillCatalog> catalog() async {
    final data = await _request(
      'GET',
      '/codex_skills',
      timeout: const Duration(seconds: 120),
    );
    return CodexSkillCatalog.fromJson(Map<String, dynamic>.from(data as Map));
  }

  Future<Map<String, dynamic>> importCatalog(List<String> ids) async {
    final data = await _request(
      'POST',
      '/codex_skills/import',
      body: {'ids': ids},
      timeout: const Duration(minutes: 3),
    );
    return Map<String, dynamic>.from(data as Map);
  }
}

class BackendProcessManager {
  BackendProcessManager(this.api);
  final SkillApiClient api;
  Process? _ownedProcess;

  Future<void> ensureRunning() async {
    try {
      if (await api.ping()) return;
    } catch (_) {}
    final executable = _resolveBackendExecutable();
    if (!File(executable).existsSync()) {
      throw SkillApiException('未找到独立 Rust 后台：$executable');
    }
    _ownedProcess = await Process.start(
      executable,
      const [],
      mode: ProcessStartMode.detachedWithStdio,
    );
    final deadline = DateTime.now().add(const Duration(seconds: 8));
    Object? lastError;
    while (DateTime.now().isBefore(deadline)) {
      await Future<void>.delayed(const Duration(milliseconds: 180));
      try {
        if (await api.ping()) return;
      } catch (error) {
        lastError = error;
      }
    }
    throw SkillApiException('Rust 后台启动后未就绪：${lastError ?? '未知错误'}');
  }

  String _resolveBackendExecutable() {
    final envOverride = Platform.environment['SKILLCREATOR_BACKEND'];
        if (envOverride != null && envOverride.trim().isNotEmpty) {
      return envOverride;
    }
    final appDir = File(Platform.resolvedExecutable).parent.path;
    final sidecar = '$appDir${Platform.pathSeparator}skill_api_server.exe';
    if (File(sidecar).existsSync()) return sidecar;
    final cwd = Directory.current.path;
    final dev =
        '$cwd${Platform.pathSeparator}..${Platform.pathSeparator}skillcreator-rust-server${Platform.pathSeparator}target${Platform.pathSeparator}debug${Platform.pathSeparator}skill_api_server.exe';
    return File(dev).absolute.path;
  }

  void dispose() {
    _ownedProcess?.kill();
    _ownedProcess = null;
  }
}
