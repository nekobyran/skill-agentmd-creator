using System.Collections.ObjectModel;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using SkillAgentTool.Models;
using SkillAgentTool.Services;

namespace SkillAgentTool;

public sealed partial class MainWindow : Window
{
    private readonly ObservableCollection<string> _skillItems = new();
    private bool _inited;

    public MainWindow()
    {
        InitializeComponent();
        SkillList.ItemsSource = _skillItems;
        Activated += OnActivated;
    }

    private void OnActivated(object sender, WindowActivatedEventArgs args)
    {
        if (_inited)
        {
            return;
        }

        _inited = true;
        SkillFileService.EnsureAiEntryFile();
        RefreshSkillList();
        AiEntryText.Text = $"AI入口文件：{SkillFileService.AiEntryFilePath}";
        StatusText.Text = "已就绪，点击右下角【添加】创建新 Skill";
    }

    private void RefreshSkillList()
    {
        var items = SkillFileService.ListSkills();
        _skillItems.Clear();
        foreach (var item in items)
        {
            _skillItems.Add($"{item.Name}  ({item.LastWriteTime:yyyy-MM-dd HH:mm:ss})");
        }

        if (_skillItems.Count == 0)
        {
            _skillItems.Add("当前无已有 skill，点击右下角开始创建");
        }
    }

    private async void AddButton_Click(object sender, RoutedEventArgs e)
    {
        var draft = await ShowCreateSkillDialog();
        if (draft is null)
        {
            return;
        }

        try
        {
            var result = SkillFileService.CreateSkill(draft);
            var method = result.UsedNative ? "C++ Native Bridge" : $"Fallback({result.WriterHint})";
            StatusText.Text = $"已创建：{Path.GetFileName(result.FilePath)}（{method}）";
            RefreshSkillList();
        }
        catch (Exception ex)
        {
            await ShowMessage("创建失败", ex.Message);
            StatusText.Text = "创建失败，请检查路径权限后重试";
        }
    }

    private async Task<SkillDraft?> ShowCreateSkillDialog()
    {
        var nameBox = new TextBox { PlaceholderText = "Skill 名称", Margin = new Thickness(0, 8, 0, 0) };
        var descBox = new TextBox
        {
            PlaceholderText = "Skill 描述",
            Margin = new Thickness(0, 8, 0, 0),
            TextWrapping = TextWrapping.Wrap,
            AcceptsReturn = true,
            Height = 70
        };
        var triggerBox = new TextBox { PlaceholderText = "触发命令词（如：create_skill）", Margin = new Thickness(0, 8, 0, 0) };
        var cmdBox = new TextBox { PlaceholderText = "建议指令（如：create_skill --name xxx）", Margin = new Thickness(0, 8, 0, 0) };

        var panel = new StackPanel
        {
            Width = 420,
            Spacing = 10
        };

        panel.Children.Add(new TextBlock { Text = "skill 名称" });
        panel.Children.Add(nameBox);
        panel.Children.Add(new TextBlock { Text = "描述" });
        panel.Children.Add(descBox);
        panel.Children.Add(new TextBlock { Text = "触发词" });
        panel.Children.Add(triggerBox);
        panel.Children.Add(new TextBlock { Text = "建议指令" });
        panel.Children.Add(cmdBox);

        var dialog = new ContentDialog
        {
            Title = "新建 skill",
            Content = panel,
            PrimaryButtonText = "创建",
            SecondaryButtonText = "取消",
            XamlRoot = this.Content.XamlRoot
        };

        var result = await dialog.ShowAsync();
        if (result != ContentDialogResult.Primary)
        {
            return null;
        }

        if (string.IsNullOrWhiteSpace(nameBox.Text))
        {
            await ShowMessage("校验失败", "技能名不能为空");
            return null;
        }

        return new SkillDraft(
            nameBox.Text.Trim(),
            string.IsNullOrWhiteSpace(descBox.Text) ? "未填写" : descBox.Text.Trim(),
            string.IsNullOrWhiteSpace(triggerBox.Text) ? "skill" : triggerBox.Text.Trim(),
            string.IsNullOrWhiteSpace(cmdBox.Text) ? "skill.run" : cmdBox.Text.Trim()
        );
    }

    private async Task ShowMessage(string title, string message)
    {
        var dialog = new ContentDialog
        {
            Title = title,
            Content = message,
            CloseButtonText = "确定",
            XamlRoot = this.Content.XamlRoot
        };
        await dialog.ShowAsync();
    }
}
