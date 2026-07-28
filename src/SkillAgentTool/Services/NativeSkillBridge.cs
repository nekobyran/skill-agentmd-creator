using System.Runtime.InteropServices;

namespace SkillAgentTool.Services;

internal static class NativeSkillBridge
{
    private const string DllName = "NativeSkillBridge.dll";

    [DllImport(DllName, CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Unicode)]
    public static extern int WriteTextFileW(string path, string content);

    public static bool TryWrite(string path, string content, out string error)
    {
        try
        {
            var result = WriteTextFileW(path, content);
            if (result == 0)
            {
                error = string.Empty;
                return true;
            }

            error = $"native_bridge_failed_code_{result}";
            return false;
        }
        catch (DllNotFoundException)
        {
            error = "native_bridge_not_found";
            return false;
        }
        catch (BadImageFormatException)
        {
            error = "native_bridge_bad_image";
            return false;
        }
        catch (Exception ex)
        {
            error = ex.Message;
            return false;
        }
    }
}
