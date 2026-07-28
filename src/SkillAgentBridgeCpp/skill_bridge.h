#pragma once

#ifdef SKILLBRIDGE_EXPORTS
#define SKILLBRIDGE_API __declspec(dllexport)
#else
#define SKILLBRIDGE_API __declspec(dllimport)
#endif

extern "C"
{
    SKILLBRIDGE_API int __stdcall WriteTextFileW(const wchar_t* path, const wchar_t* content);
}
