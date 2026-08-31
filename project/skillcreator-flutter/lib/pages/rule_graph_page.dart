import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../models/skill_models.dart';
import '../services/skill_markdown.dart';
import '../theme/app_ui_tokens.dart';

class RuleGraphPage extends StatefulWidget {
  const RuleGraphPage({super.key, required this.controller});
  final AppController controller;
  @override
  State<RuleGraphPage> createState() => _RuleGraphPageState();
}

class _RuleGraphPageState extends State<RuleGraphPage> {
  final TransformationController transform = TransformationController();
  String? selectedNodeId;

  @override
  void dispose() {
    transform.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final graph = _GraphLayout.fromController(widget.controller);
    final selected = graph.nodes
        .where((n) => n.id == selectedNodeId)
        .firstOrNull;
    return Padding(
      padding: const EdgeInsets.all(AppUiTokens.pagePadding),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '规则分布图',
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                    Text(
                      widget.controller.selected?.name ?? '未选择 Skill',
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                  ],
                ),
              ),
              IconButton(
                tooltip: '缩小',
                onPressed: () => _scale(0.85),
                icon: const Icon(Icons.remove_rounded),
              ),
              IconButton(
                tooltip: '重置视图',
                onPressed: () => transform.value = Matrix4.identity(),
                icon: const Icon(Icons.fit_screen_rounded),
              ),
              IconButton(
                tooltip: '放大',
                onPressed: () => _scale(1.15),
                icon: const Icon(Icons.add_rounded),
              ),
              const SizedBox(width: 8),
              FilledButton.tonalIcon(
                onPressed: () => widget.controller.setPage(AppPage.editor),
                icon: const Icon(Icons.edit_outlined),
                label: const Text('返回编辑'),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Expanded(
            child: Row(
              children: [
                Expanded(
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: Theme.of(
                        context,
                      ).colorScheme.surfaceContainerLowest,
                      borderRadius: BorderRadius.circular(AppUiTokens.radius),
                      border: Border.all(
                        color: Theme.of(context).colorScheme.outlineVariant,
                      ),
                    ),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(AppUiTokens.radius),
                      child: InteractiveViewer(
                        transformationController: transform,
                        minScale: 0.35,
                        maxScale: 2.0,
                        constrained: false,
                        boundaryMargin: const EdgeInsets.all(220),
                        child: SizedBox(
                          width: graph.width,
                          height: graph.height,
                          child: Stack(
                            children: [
                              Positioned.fill(
                                child: CustomPaint(
                                  painter: _EdgePainter(
                                    graph.edges,
                                    graph.nodeById,
                                    Theme.of(context).colorScheme,
                                  ),
                                ),
                              ),
                              for (final node in graph.nodes)
                                Positioned(
                                  left: node.rect.left,
                                  top: node.rect.top,
                                  width: node.rect.width,
                                  height: node.rect.height,
                                  child: _GraphNodeCard(
                                    node: node,
                                    selected: selectedNodeId == node.id,
                                    onTap: () => setState(
                                      () => selectedNodeId = node.id,
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 14),
                SizedBox(
                  width: 260,
                  child: _Inspector(node: selected, graph: graph),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _scale(double factor) {
    final current = transform.value.getMaxScaleOnAxis();
    final target = (current * factor).clamp(0.35, 2.0);
    transform.value = Matrix4.identity()
      ..scaleByDouble(target, target, target, 1.0);
  }
}

class _GraphNodeCard extends StatelessWidget {
  const _GraphNodeCard({
    required this.node,
    required this.selected,
    required this.onTap,
  });
  final _GraphNode node;
  final bool selected;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final fill = switch (node.kind) {
      _NodeKind.skill => scheme.primaryContainer,
      _NodeKind.file => scheme.secondaryContainer,
      _NodeKind.rule => scheme.surfaceContainerHigh,
      _NodeKind.condition => scheme.tertiaryContainer,
      _NodeKind.cause => scheme.surfaceContainerHighest,
      _NodeKind.result => scheme.errorContainer,
    };
    return Semantics(
      button: true,
      label: '${node.eyebrow} ${node.title}',
      child: Material(
        color: fill,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10),
          side: BorderSide(
            color: selected ? scheme.primary : scheme.outlineVariant,
            width: selected ? 2 : 1,
          ),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(10),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(10),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  node.eyebrow,
                  style: Theme.of(context).textTheme.labelSmall,
                  maxLines: 1,
                ),
                const SizedBox(height: 2),
                Text(
                  node.title,
                  style: Theme.of(context).textTheme.labelLarge,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (node.detail.isNotEmpty)
                  Text(
                    node.detail,
                    style: Theme.of(context).textTheme.bodySmall,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Inspector extends StatelessWidget {
  const _Inspector({required this.node, required this.graph});
  final _GraphNode? node;
  final _GraphLayout graph;
  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: node == null
            ? Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('图谱检查器', style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 10),
                  Text('${graph.nodes.length} 个节点 · ${graph.edges.length} 条关系'),
                  const SizedBox(height: 16),
                  const Text('选择节点查看属性、条件、因果或结果。图谱覆盖所有 Markdown 文件中的拼图规则。'),
                ],
              )
            : Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    node!.eyebrow,
                    style: Theme.of(context).textTheme.labelMedium,
                  ),
                  const SizedBox(height: 6),
                  Text(
                    node!.title,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 12),
                  SelectableText(node!.detail.isEmpty ? '无附加信息' : node!.detail),
                  const Spacer(),
                  Text(
                    'ID\n${node!.id}',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
      ),
    );
  }
}

enum _NodeKind { skill, file, rule, condition, cause, result }

class _GraphNode {
  const _GraphNode({
    required this.id,
    required this.kind,
    required this.title,
    required this.detail,
    required this.eyebrow,
    required this.rect,
  });
  final String id;
  final _NodeKind kind;
  final String title;
  final String detail;
  final String eyebrow;
  final Rect rect;
}

class _GraphEdge {
  const _GraphEdge(this.source, this.target, this.label);
  final String source;
  final String target;
  final String label;
}

class _GraphLayout {
  _GraphLayout(this.nodes, this.edges, this.width, this.height)
    : nodeById = {for (final node in nodes) node.id: node};
  final List<_GraphNode> nodes;
  final List<_GraphEdge> edges;
  final double width;
  final double height;
  final Map<String, _GraphNode> nodeById;

  factory _GraphLayout.fromController(AppController controller) {
    const nodeW = 210.0;
    const nodeH = 72.0;
    const gapY = 24.0;
    const pad = 40.0;
    final nodes = <_GraphNode>[];
    final edges = <_GraphEdge>[];
    final root = _GraphNode(
      id: 'skill-root',
      kind: _NodeKind.skill,
      title: controller.selected?.name ?? '未命名技能',
      detail: '${controller.files.length} 个 Markdown 文件',
      eyebrow: '技能',
      rect: const Rect.fromLTWH(pad, pad, 220, nodeH),
    );
    nodes.add(root);
    var y = pad;
    var maxX = 980.0;
    for (var fileIndex = 0; fileIndex < controller.files.length; fileIndex++) {
      final file = controller.files[fileIndex];
      final rules = SkillMarkdown.parseRules(file.content);
      final blockRows = math.max(
        1,
        rules.fold<int>(
          0,
          (sum, rule) =>
              sum +
              (rule.freeText.trim().isNotEmpty
                  ? 1
                  : math.max(1, rule.conditions.length)),
        ),
      );
      final fileStartY = y;
      final fileNodeId = 'file-$fileIndex';
      final fileNode = _GraphNode(
        id: fileNodeId,
        kind: _NodeKind.file,
        title: file.path,
        detail: rules.isEmpty ? '无规则' : '${rules.length} 条规则',
        eyebrow: file.isEntry ? '入口文件' : '规则文件',
        rect: Rect.fromLTWH(300, fileStartY, nodeW, nodeH),
      );
      nodes.add(fileNode);
      edges.add(_GraphEdge(root.id, fileNode.id, '包含'));
      if (rules.isEmpty) {
        y += nodeH + gapY;
        continue;
      }
      for (var ruleIndex = 0; ruleIndex < rules.length; ruleIndex++) {
        final rule = rules[ruleIndex];
        final freeText = rule.freeText.trim();
        if (freeText.isNotEmpty) {
          final ruleId = 'rule-$fileIndex-$ruleIndex';
          nodes.add(
            _GraphNode(
              id: ruleId,
              kind: _NodeKind.rule,
              title: freeText,
              detail: '自由语义',
              eyebrow: '规则',
              rect: Rect.fromLTWH(560, y, nodeW, nodeH),
            ),
          );
          edges.add(_GraphEdge(fileNodeId, ruleId, '规则 ${ruleIndex + 1}'));
          y += nodeH + gapY;
          maxX = math.max(maxX, 560 + nodeW + pad);
          continue;
        }

        final conditionIds = <String>[];
        for (
          var conditionIndex = 0;
          conditionIndex < rule.conditions.length;
          conditionIndex++
        ) {
          final condition = rule.conditions[conditionIndex];
          final id = 'condition-$fileIndex-$ruleIndex-$conditionIndex';
          nodes.add(
            _GraphNode(
              id: id,
              kind: _NodeKind.condition,
              title: condition,
              detail:
                  '${rule.matchMode} · ${rule.properties.isEmpty ? '无属性' : rule.properties.join(', ')}',
              eyebrow: conditionIndex == 0
                  ? '如果'
                  : (rule.matchMode == 'ANY' ? '或者' : '并且'),
              rect: Rect.fromLTWH(560, y, nodeW, nodeH),
            ),
          );
          conditionIds.add(id);
          edges.add(
            _GraphEdge(
              fileNodeId,
              id,
              conditionIndex == 0 ? '规则 ${ruleIndex + 1}' : rule.matchMode,
            ),
          );
          y += nodeH + gapY;
        }

        var source = conditionIds.isEmpty ? fileNodeId : conditionIds.last;
        final rowY = conditionIds.isEmpty ? y : y - nodeH - gapY;
        if (rule.cause.isNotEmpty) {
          final causeId = 'cause-$fileIndex-$ruleIndex';
          final causeX = conditionIds.isEmpty ? 560.0 : 820.0;
          nodes.add(
            _GraphNode(
              id: causeId,
              kind: _NodeKind.cause,
              title: rule.cause,
              detail: 'BECAUSE',
              eyebrow: '因为',
              rect: Rect.fromLTWH(causeX, rowY, nodeW, nodeH),
            ),
          );
          edges.add(_GraphEdge(source, causeId, '因为'));
          source = causeId;
          maxX = math.max(maxX, causeX + nodeW + pad);
        }

        final resultId = 'result-$fileIndex-$ruleIndex';
        final resultX = rule.cause.isNotEmpty
            ? (conditionIds.isEmpty ? 820.0 : 1080.0)
            : (conditionIds.isEmpty ? 560.0 : 820.0);
        nodes.add(
          _GraphNode(
            id: resultId,
            kind: conditionIds.isEmpty && rule.cause.isEmpty
                ? _NodeKind.rule
                : _NodeKind.result,
            title: rule.result.isEmpty ? '未填写结果' : rule.result,
            detail: rule.verb,
            eyebrow: conditionIds.isEmpty && rule.cause.isEmpty ? '规则' : '结果',
            rect: Rect.fromLTWH(resultX, rowY, nodeW, nodeH),
          ),
        );
        edges.add(
          _GraphEdge(
            source,
            resultId,
            conditionIds.isEmpty && rule.cause.isEmpty
                ? '规则 ${ruleIndex + 1}'
                : '=> ${rule.verb}',
          ),
        );
        if (conditionIds.isEmpty) {
          y += nodeH + gapY;
        }
        maxX = math.max(maxX, resultX + nodeW + pad);
      }
      y = math.max(y, fileStartY + blockRows * (nodeH + gapY));
      y += 18;
    }
    if (nodes.length > 1) {
      final centers = nodes
          .where((n) => n.kind == _NodeKind.file)
          .map((n) => n.rect.center.dy)
          .toList();
      if (centers.isNotEmpty) {
        nodes[0] = _GraphNode(
          id: root.id,
          kind: root.kind,
          title: root.title,
          detail: root.detail,
          eyebrow: root.eyebrow,
          rect: Rect.fromLTWH(
            root.rect.left,
            centers.reduce((a, b) => a + b) / centers.length - nodeH / 2,
            root.rect.width,
            nodeH,
          ),
        );
      }
    }
    return _GraphLayout(nodes, edges, maxX, math.max(560, y + pad));
  }
}

class _EdgePainter extends CustomPainter {
  _EdgePainter(this.edges, this.nodes, this.scheme);
  final List<_GraphEdge> edges;
  final Map<String, _GraphNode> nodes;
  final ColorScheme scheme;
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = scheme.outline
      ..strokeWidth = 1.25
      ..style = PaintingStyle.stroke;
    final label = TextPainter(textDirection: TextDirection.ltr, maxLines: 1);
    for (final edge in edges) {
      final source = nodes[edge.source];
      final target = nodes[edge.target];
      if (source == null || target == null) continue;
      final a = Offset(source.rect.right, source.rect.center.dy);
      final b = Offset(target.rect.left, target.rect.center.dy);
      final mid = (a.dx + b.dx) / 2;
      final path = Path()
        ..moveTo(a.dx, a.dy)
        ..cubicTo(mid, a.dy, mid, b.dy, b.dx, b.dy);
      canvas.drawPath(path, paint);
      label.text = TextSpan(
        text: edge.label,
        style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 10),
      );
      label.layout(maxWidth: 120);
      final pos = Offset(
        mid - label.width / 2,
        (a.dy + b.dy) / 2 - label.height / 2,
      );
      canvas.drawRect(
        Rect.fromLTWH(
          pos.dx - 3,
          pos.dy - 1,
          label.width + 6,
          label.height + 2,
        ),
        Paint()..color = scheme.surface,
      );
      label.paint(canvas, pos);
    }
  }

  @override
  bool shouldRepaint(covariant _EdgePainter oldDelegate) =>
      oldDelegate.edges != edges || oldDelegate.scheme != scheme;
}
