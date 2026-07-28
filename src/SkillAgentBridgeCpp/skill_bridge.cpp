#include <windows.h>
#include <string>
#include <vector>
#include <cstdint>
#include "skill_bridge.h"

static int WriteTextFileUtf8(const std::wstring& path, const std::wstring& content)
{
    if (path.empty() || content.empty())
    {
        return ERROR_INVALID_PARAMETER;
    }

    int utf8Len = WideCharToMultiByte(CP_UTF8, 0, content.c_str(), -1, nullptr, 0, nullptr, nullptr);
    if (utf8Len <= 0)
    {
        return GetLastError();
    }

    std::string utf8(utf8Len, '\0');
    int used = WideCharToMultiByte(CP_UTF8, 0, content.c_str(), -1, &utf8[0], utf8Len, nullptr, nullptr);
    if (used == 0)
    {
        return GetLastError();
    }

    HANDLE fileHandle = CreateFileW(
        path.c_str(),
        GENERIC_WRITE,
        0,
        nullptr,
        CREATE_ALWAYS,
        FILE_ATTRIBUTE_NORMAL,
        nullptr);
    if (fileHandle == INVALID_HANDLE_VALUE)
    {
        return GetLastError();
    }

    DWORD written = 0;
    const unsigned char bom[] = { 0xEF, 0xBB, 0xBF };
    if (!WriteFile(fileHandle, bom, sizeof(bom), &written, nullptr) || written != sizeof(bom))
    {
        DWORD err = GetLastError();
        CloseHandle(fileHandle);
        return err == ERROR_SUCCESS ? ERROR_WRITE_FAULT : err;
    }

    if (!WriteFile(fileHandle, utf8.data(), static_cast<DWORD>(used - 1), &written, nullptr))
    {
        DWORD err = GetLastError();
        CloseHandle(fileHandle);
        return err;
    }

    CloseHandle(fileHandle);

    return used - 1 > 0 && written == static_cast<DWORD>(used - 1) ? 0 : ERROR_WRITE_FAULT;
}

extern "C" int __stdcall WriteTextFileW(const wchar_t* path, const wchar_t* content)
{
    if (path == nullptr || content == nullptr)
    {
        return ERROR_INVALID_PARAMETER;
    }

    return WriteTextFileUtf8(path, content);
}
