#include <flutter/dart_project.h>
#include <flutter/flutter_view_controller.h>
#include <windows.h>

#include <algorithm>
#include <string>
#include <vector>

#include "flutter_window.h"
#include "utils.h"
#include "windows_shell_contract.h"

namespace {

bool HasArgument(const std::vector<std::string>& arguments,
                 const std::string& expected) {
  return std::find(arguments.begin(), arguments.end(), expected) !=
         arguments.end();
}

void CenterAndClampWindow(HWND window, bool compact) {
  if (!window) return;

  HMONITOR monitor = MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST);
  MONITORINFO info{};
  info.cbSize = sizeof(info);
  if (!GetMonitorInfo(monitor, &info)) return;

  UINT dpi = GetDpiForWindow(window);
  if (dpi == 0) dpi = 96;
  const int desired_width = skillcreator::window_contract::ScaleDp(
      compact ? skillcreator::window_contract::kCompactWidthDp
              : skillcreator::window_contract::kDefaultWidthDp,
      dpi);
  const int desired_height = skillcreator::window_contract::ScaleDp(
      compact ? skillcreator::window_contract::kCompactHeightDp
              : skillcreator::window_contract::kDefaultHeightDp,
      dpi);
  const int work_width = info.rcWork.right - info.rcWork.left;
  const int work_height = info.rcWork.bottom - info.rcWork.top;
  const int width = std::min(desired_width, work_width);
  const int height = std::min(desired_height, work_height);
  const int x = info.rcWork.left + (work_width - width) / 2;
  const int y = info.rcWork.top + (work_height - height) / 2;

  SetWindowPos(window, nullptr, x, y, width, height,
               SWP_NOZORDER | SWP_NOACTIVATE);
}

}  // namespace

int APIENTRY wWinMain(_In_ HINSTANCE instance, _In_opt_ HINSTANCE prev,
                      _In_ wchar_t* command_line, _In_ int show_command) {
  if (!::AttachConsole(ATTACH_PARENT_PROCESS) && ::IsDebuggerPresent()) {
    CreateAndAttachConsole();
  }

  ::CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

  flutter::DartProject project(L"data");
  std::vector<std::string> command_line_arguments = GetCommandLineArguments();
  const bool compact = HasArgument(command_line_arguments, "--sidebar");
  project.set_dart_entrypoint_arguments(std::move(command_line_arguments));

  FlutterWindow window(project);
  Win32Window::Point origin(0, 0);
  Win32Window::Size size(
      compact ? skillcreator::window_contract::kCompactWidthDp
              : skillcreator::window_contract::kDefaultWidthDp,
      compact ? skillcreator::window_contract::kCompactHeightDp
              : skillcreator::window_contract::kDefaultHeightDp);
  if (!window.Create(L"SkillCreator", origin, size)) {
    ::CoUninitialize();
    return EXIT_FAILURE;
  }
        window.SetQuitOnClose(true);
  CenterAndClampWindow(window.GetHandle(), compact);
  window.Show();



  ::MSG msg;
  while (::GetMessage(&msg, nullptr, 0, 0)) {
    ::TranslateMessage(&msg);
    ::DispatchMessage(&msg);
  }

  ::CoUninitialize();
  return EXIT_SUCCESS;
}
