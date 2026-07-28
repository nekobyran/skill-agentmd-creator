using Microsoft.UI.Xaml;
using SkillAgentTool.Services;

namespace SkillAgentTool;

public partial class App : Application
{
    private Window? _window;

    public App()
    {
        InitializeComponent();
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        SkillFileService.EnsureAiEntryFile();
        _window = new MainWindow();
        _window.Activate();
    }
}
