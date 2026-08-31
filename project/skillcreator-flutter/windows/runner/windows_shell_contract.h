#ifndef RUNNER_WINDOWS_SHELL_CONTRACT_H_
#define RUNNER_WINDOWS_SHELL_CONTRACT_H_

#include <windows.h>

namespace skillcreator::window_contract {

constexpr int kDefaultWidthDp = 1301;
constexpr int kDefaultHeightDp = 855;
constexpr int kCompactWidthDp = 720;
constexpr int kCompactHeightDp = 760;
constexpr int kMinimumWidthDp = 720;
constexpr int kMinimumHeightDp = 560;
constexpr int kTitleBarHeightDp = 32;
constexpr int kCaptionButtonWidthDp = 46;
constexpr int kResizeBorderDp = 8;
constexpr int kSystemMenuWidthDp = 34;

#ifndef DWMWA_WINDOW_CORNER_PREFERENCE
#define DWMWA_WINDOW_CORNER_PREFERENCE 33
#endif

#ifndef DWMWCP_DEFAULT
enum DWM_WINDOW_CORNER_PREFERENCE {
  DWMWCP_DEFAULT = 0,
  DWMWCP_DONOTROUND = 1,
  DWMWCP_ROUND = 2,
  DWMWCP_ROUNDSMALL = 3,
};
#endif

inline int ScaleDp(int value, UINT dpi) {
  return MulDiv(value, static_cast<int>(dpi), 96);
}

}  // namespace skillcreator::window_contract

#endif  // RUNNER_WINDOWS_SHELL_CONTRACT_H_
