import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme/app_ui_tokens.dart';

class AppWindowsShell extends StatelessWidget {
  const AppWindowsShell({
    super.key,
    required this.title,
    required this.child,
    this.titleIcon = Icons.extension_rounded,
    this.onRootEscape,
    this.transientCloseHandler,
  });

  final String title;
  final IconData titleIcon;
  final Widget child;
  final VoidCallback? onRootEscape;
  final bool Function()? transientCloseHandler;

  @override
  Widget build(BuildContext context) {
    return AppEscapeDispatcher(
      transientCloseHandler: transientCloseHandler,
      onRootEscape: onRootEscape,
      child: Column(
        children: [
          WindowChrome(title: title, titleIcon: titleIcon),
          Expanded(child: child),
        ],
      ),
    );
  }
}

class AppEscapeDispatcher extends StatelessWidget {
  const AppEscapeDispatcher({
    super.key,
    required this.child,
    this.transientCloseHandler,
    this.onRootEscape,
  });
  final Widget child;
  final bool Function()? transientCloseHandler;
  final VoidCallback? onRootEscape;

  @override
  Widget build(BuildContext context) {
    return Focus(
      autofocus: true,
      onKeyEvent: (node, event) {
                if (event is! KeyDownEvent ||
            event.logicalKey != LogicalKeyboardKey.escape) {
          return KeyEventResult.ignored;
        }
        if (transientCloseHandler?.call() ?? false) {
          return KeyEventResult.handled;
        }
        final navigator = Navigator.maybeOf(context);
        if (navigator != null && navigator.canPop()) {
          navigator.pop();
          return KeyEventResult.handled;
        }
        onRootEscape?.call();
        return KeyEventResult.handled;
      },
      child: child,
    );
  }
}

class WindowChrome extends StatelessWidget {
  const WindowChrome({super.key, required this.title, required this.titleIcon});
  static const MethodChannel _channel = MethodChannel('skillcreator/window');
  final String title;
  final IconData titleIcon;

  Future<void> _invoke(String method) async {
    try {
      await _channel.invokeMethod<void>(method);
    } on PlatformException {
      // Window actions are optional on non-Windows test hosts.
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Semantics(
      container: true,
      label: '应用窗口标题栏',
      child: SizedBox(
        height: AppUiTokens.titleBarHeight,
        child: ColoredBox(
          color: scheme.surface,
          child: Row(
            children: [
              const SizedBox(width: 10),
              Icon(titleIcon, size: 16, color: scheme.primary),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelMedium,
                ),
              ),
              _CaptionButton(
                tooltip: '最小化',
                icon: Icons.remove_rounded,
                onPressed: () => _invoke('minimize'),
              ),
              _CaptionButton(
                tooltip: '最大化/还原',
                icon: Icons.crop_square_rounded,
                onPressed: () => _invoke('toggleMaximize'),
              ),
              _CaptionButton(
                tooltip: '关闭',
                icon: Icons.close_rounded,
                destructive: true,
                onPressed: () => _invoke('close'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CaptionButton extends StatefulWidget {
  const _CaptionButton({
    required this.tooltip,
    required this.icon,
    required this.onPressed,
    this.destructive = false,
  });
  final String tooltip;
  final IconData icon;
  final VoidCallback onPressed;
  final bool destructive;

  @override
  State<_CaptionButton> createState() => _CaptionButtonState();
}

class _CaptionButtonState extends State<_CaptionButton> {
  bool hovered = false;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final background = !hovered
        ? Colors.transparent
        : widget.destructive
        ? scheme.error
        : scheme.surfaceContainerHighest;
    final foreground = hovered && widget.destructive
        ? scheme.onError
        : scheme.onSurface;
    return Tooltip(
      message: widget.tooltip,
      child: MouseRegion(
        onEnter: (_) => setState(() => hovered = true),
        onExit: (_) => setState(() => hovered = false),
        child: Semantics(
          button: true,
          label: widget.tooltip,
          child: InkWell(
            onTap: widget.onPressed,
            child: SizedBox(
              width: AppUiTokens.captionButtonWidth,
              height: AppUiTokens.titleBarHeight,
              child: ColoredBox(
                color: background,
                child: Icon(widget.icon, size: 16, color: foreground),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
