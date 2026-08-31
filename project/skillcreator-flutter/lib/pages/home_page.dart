import 'package:flutter/material.dart';

import '../app_controller.dart';
import '../models/skill_models.dart';
import '../shared/app_windows_shell.dart';
import '../theme/app_ui_tokens.dart';
import 'advanced_studio_page.dart';
import 'editor_page.dart';
import 'rule_graph_page.dart';
import 'studio_pages.dart';

class HomePage extends StatelessWidget {
  const HomePage({super.key, required this.controller});
  final AppController controller;

  static const _destinations = <_Destination>[
    _Destination(
      AppPage.editor,
      '编辑',
      Icons.view_quilt_outlined,
      Icons.view_quilt_rounded,
    ),
    _Destination(
      AppPage.advanced,
      '详细',
      Icons.tune_outlined,
      Icons.tune_rounded,
    ),
    _Destination(AppPage.graph, '规则图', Icons.hub_outlined, Icons.hub_rounded),
    _Destination(
      AppPage.ai,
      'AI',
      Icons.auto_awesome_outlined,
      Icons.auto_awesome_rounded,
    ),
    _Destination(
      AppPage.library,
      '技能库',
      Icons.inventory_2_outlined,
      Icons.inventory_2_rounded,
    ),
    _Destination(
      AppPage.settings,
      '设置',
      Icons.settings_outlined,
      Icons.settings_rounded,
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) {
        final selectedIndex = _destinations
            .indexWhere((d) => d.page == controller.page)
            .clamp(0, _destinations.length - 1);
        return AppWindowsShell(
          title: controller.selected == null
              ? 'SkillCreator'
              : 'SkillCreator — ${controller.selected!.name}',
          onRootEscape: controller.page == AppPage.editor
              ? null
              : () => controller.setPage(AppPage.editor),
          child: LayoutBuilder(
            builder: (context, constraints) {
              final narrow = constraints.maxWidth < 860;
              final content = Stack(
                children: [
                  Positioned.fill(child: _pageFor(controller.page)),
                  if (controller.backendState == BackendState.connecting)
                    const Positioned(
                      top: 8,
                      right: 12,
                      child: _StatusPill(
                        icon: Icons.sync_rounded,
                        text: '正在连接 Rust 后台',
                      ),
                    ),
                  if (controller.backendState == BackendState.disconnected)
                    Positioned(
                      top: 8,
                      right: 12,
                      child: _StatusPill(
                        icon: Icons.cloud_off_outlined,
                        text: 'Rust 后台未连接',
                        error: true,
                        onTap: controller.retryBackend,
                      ),
                    ),
                  if (controller.errorMessage != null &&
                      controller.errorMessage!.trim().isNotEmpty)
                    Positioned(
                      left: 12,
                      right: 12,
                      bottom: narrow ? 76 : 12,
                      child: _ErrorBanner(message: controller.errorMessage!),
                    ),
                ],
              );
              if (narrow) {
                return Column(
                  children: [
                    Expanded(child: content),
                    NavigationBar(
                      selectedIndex: selectedIndex,
                      onDestinationSelected: (index) =>
                          controller.setPage(_destinations[index].page),
                      destinations: _destinations
                          .map(
                            (d) => NavigationDestination(
                              icon: Icon(d.icon),
                              selectedIcon: Icon(d.selectedIcon),
                              label: d.label,
                            ),
                          )
                          .toList(growable: false),
                    ),
                  ],
                );
              }
              final extended = constraints.maxWidth >= 1320;
              return Row(
                children: [
                  NavigationRail(
                    extended: extended,
                    minWidth: AppUiTokens.navigationWidth,
                    minExtendedWidth: AppUiTokens.navigationExtendedWidth,
                    selectedIndex: selectedIndex,
                    labelType: extended
                        ? NavigationRailLabelType.none
                        : NavigationRailLabelType.all,
                    onDestinationSelected: (index) =>
                        controller.setPage(_destinations[index].page),
                    leading: Padding(
                      padding: const EdgeInsets.only(top: 8, bottom: 12),
                      child: Tooltip(
                        message: 'SkillCreator',
                        child: CircleAvatar(
                          radius: 20,
                          backgroundColor: Theme.of(
                            context,
                          ).colorScheme.primaryContainer,
                          foregroundColor: Theme.of(
                            context,
                          ).colorScheme.onPrimaryContainer,
                          child: const Icon(Icons.extension_rounded),
                        ),
                      ),
                    ),
                    trailing: Expanded(
                      child: Align(
                        alignment: Alignment.bottomCenter,
                        child: Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: Tooltip(
                            message: _backendStatusText,
                            child: Icon(
                              controller.backendState == BackendState.connected
                                  ? Icons.cloud_done_outlined
                                  : Icons.cloud_off_outlined,
                              size: 18,
                              color:
                                  controller.backendState ==
                                      BackendState.connected
                                  ? Theme.of(context).colorScheme.primary
                                  : Theme.of(context).colorScheme.error,
                            ),
                          ),
                        ),
                      ),
                    ),
                    destinations: _destinations
                        .map(
                          (d) => NavigationRailDestination(
                            icon: Icon(d.icon),
                            selectedIcon: Icon(d.selectedIcon),
                            label: Text(d.label),
                          ),
                        )
                        .toList(growable: false),
                  ),
                  VerticalDivider(
                    width: 1,
                    thickness: 1,
                    color: Theme.of(context).colorScheme.outlineVariant,
                  ),
                  Expanded(child: content),
                ],
              );
            },
          ),
        );
      },
    );
  }

  String get _backendStatusText => switch (controller.backendState) {
    BackendState.connected => 'Rust 后台已连接',
    BackendState.connecting => '正在连接 Rust 后台',
    BackendState.disconnected => 'Rust 后台未连接',
  };

  Widget _pageFor(AppPage page) => switch (page) {
    AppPage.editor => EditorPage(controller: controller),
    AppPage.advanced => AdvancedStudioPage(controller: controller),
    AppPage.graph => RuleGraphPage(controller: controller),
    AppPage.ai => AiStudioPage(controller: controller),
    AppPage.library => SkillLibraryPage(controller: controller),
    AppPage.settings => SettingsPage(controller: controller),
  };
}

class _Destination {
  const _Destination(this.page, this.label, this.icon, this.selectedIcon);
  final AppPage page;
  final String label;
  final IconData icon;
  final IconData selectedIcon;
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({
    required this.icon,
    required this.text,
    this.error = false,
    this.onTap,
  });
  final IconData icon;
  final String text;
  final bool error;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final child = DecoratedBox(
      decoration: BoxDecoration(
        color: error ? scheme.errorContainer : scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              size: 15,
              color: error ? scheme.onErrorContainer : scheme.onSurfaceVariant,
            ),
            const SizedBox(width: 6),
            Text(text, style: Theme.of(context).textTheme.labelSmall),
          ],
        ),
      ),
    );
    return onTap == null
        ? child
        : InkWell(
            borderRadius: BorderRadius.circular(999),
            onTap: onTap,
            child: child,
          );
  }
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message});
  final String message;
  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      color: scheme.errorContainer,
      borderRadius: BorderRadius.circular(10),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        child: Row(
          children: [
            Icon(
              Icons.error_outline_rounded,
              color: scheme.onErrorContainer,
              size: 18,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                message,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: scheme.onErrorContainer),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
