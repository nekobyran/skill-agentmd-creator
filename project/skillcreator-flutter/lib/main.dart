import 'package:flutter/material.dart';

import 'app_controller.dart';
import 'pages/home_page.dart';
import 'theme/app_ui_tokens.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const SkillCreatorApp());
}

class SkillCreatorApp extends StatefulWidget {
  const SkillCreatorApp({
    super.key,
    this.controller,
    this.autoBootstrap = true,
  });
  final AppController? controller;
  final bool autoBootstrap;

  @override
  State<SkillCreatorApp> createState() => _SkillCreatorAppState();
}

class _SkillCreatorAppState extends State<SkillCreatorApp> {
  late final AppController controller = widget.controller ?? AppController();
  late final bool ownsController = widget.controller == null;

  @override
  void initState() {
    super.initState();
    if (widget.autoBootstrap) controller.bootstrap();
  }

  @override
  void dispose() {
    if (ownsController) controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'SkillCreator',
      debugShowCheckedModeBanner: false,
      theme: AppUiTokens.theme(Brightness.light),
      darkTheme: AppUiTokens.theme(Brightness.dark),
      themeMode: ThemeMode.system,
      home: Scaffold(body: HomePage(controller: controller)),
    );
  }
}
