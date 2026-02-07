---
name: csharp-avalonia
version: 1.0.0
description: Cross-platform desktop/mobile development with C# and Avalonia UI
author: Code Buddy
tags: csharp, avalonia, xaml, cross-platform, desktop, mobile, dotnet
env:
  DOTNET_CLI_TELEMETRY_OPTOUT: "1"
---

# C# + Avalonia UI Cross-Platform Development

Guidelines for building cross-platform applications with .NET and Avalonia UI targeting Windows, macOS, Linux, iOS, Android, and WebAssembly.

## Project Setup

### Prerequisites
- .NET SDK 8.0+ (`dotnet --version`)
- Avalonia templates: `dotnet new install Avalonia.Templates`

### Scaffolding
```bash
# Create solution with MVVM pattern (recommended)
dotnet new avalonia.mvvm -o MyApp
cd MyApp

# Or with full cross-platform targets
dotnet new avalonia.xplat -o MyApp

# Solution structure for large apps
dotnet new sln -o MyApp
cd MyApp
dotnet new avalonia.mvvm -o MyApp.Desktop
dotnet new classlib -o MyApp.Core        # Shared business logic
dotnet new classlib -o MyApp.Services    # Platform services
dotnet sln add MyApp.Desktop MyApp.Core MyApp.Services
```

### Recommended Solution Structure
```
MyApp.sln
src/
  MyApp.Core/                  # Shared logic (no UI dependency)
    Models/
    Services/
    Interfaces/
    ViewModels/                # ViewModels live here (shared)
  MyApp.UI/                    # Avalonia UI project
    Assets/                    # Fonts, images, icons
    Controls/                  # Custom reusable controls
    Converters/                # Value converters
    Styles/                    # Global styles and themes
    Views/                     # AXAML views
    App.axaml                  # Application root
    App.axaml.cs
    ViewLocator.cs
  MyApp.Desktop/               # Desktop entry point
    Program.cs
  MyApp.Android/               # Android entry point (optional)
  MyApp.iOS/                   # iOS entry point (optional)
  MyApp.Browser/               # WebAssembly entry point (optional)
tests/
  MyApp.Core.Tests/
  MyApp.UI.Tests/
```

## MVVM Pattern (CommunityToolkit.Mvvm)

Always use MVVM with `CommunityToolkit.Mvvm` (source generators):

```bash
dotnet add package CommunityToolkit.Mvvm
```

### ViewModel Pattern
```csharp
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

public partial class MainViewModel : ViewModelBase
{
    [ObservableProperty]
    private string _name = string.Empty;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(SubmitCommand))]
    private bool _isValid;

    [RelayCommand(CanExecute = nameof(IsValid))]
    private async Task SubmitAsync()
    {
        // Business logic here
    }
}
```

### ViewModelBase
```csharp
using CommunityToolkit.Mvvm.ComponentModel;

public abstract class ViewModelBase : ObservableObject { }
```

### View Binding (AXAML)
```xml
<Window xmlns="https://github.com/avaloniaui"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        xmlns:vm="using:MyApp.ViewModels"
        x:DataType="vm:MainViewModel">

    <Design.DataContext>
        <vm:MainViewModel />
    </Design.DataContext>

    <StackPanel Margin="20" Spacing="10">
        <TextBox Text="{Binding Name}" Watermark="Enter name..." />
        <Button Content="Submit" Command="{Binding SubmitCommand}" />
    </StackPanel>
</Window>
```

## AXAML Best Practices

### Always use compiled bindings
```xml
<!-- Always set x:DataType for compile-time checked bindings -->
<UserControl x:DataType="vm:MyViewModel">
    <TextBlock Text="{Binding Title}" />
</UserControl>
```

### Styles and Themes
```xml
<!-- App.axaml — Global styles -->
<Application.Styles>
    <FluentTheme />
    <StyleInclude Source="/Styles/Global.axaml" />
</Application.Styles>

<!-- Styles/Global.axaml -->
<Styles xmlns="https://github.com/avaloniaui">
    <Style Selector="Button.primary">
        <Setter Property="Background" Value="{DynamicResource AccentBrush}" />
        <Setter Property="Foreground" Value="White" />
        <Setter Property="CornerRadius" Value="4" />
    </Style>
</Styles>
```

### Responsive Layouts
```xml
<!-- Use Grid and panels, avoid fixed sizes -->
<Grid RowDefinitions="Auto,*,Auto" ColumnDefinitions="*,2*">
    <TextBlock Grid.Row="0" Text="Header" />
    <ScrollViewer Grid.Row="1" Grid.ColumnSpan="2">
        <ItemsControl ItemsSource="{Binding Items}" />
    </ScrollViewer>
</Grid>

<!-- Adaptive layout with classes -->
<Panel Classes.narrow="{Binding IsNarrow}">
    <Panel.Styles>
        <Style Selector="Panel.narrow > StackPanel">
            <Setter Property="Orientation" Value="Vertical" />
        </Style>
    </Panel.Styles>
    <StackPanel Orientation="Horizontal">
        <!-- content -->
    </StackPanel>
</Panel>
```

## Navigation

Use a router/navigator pattern:

```csharp
public partial class MainViewModel : ViewModelBase
{
    [ObservableProperty]
    private ViewModelBase _currentPage;

    public MainViewModel()
    {
        _currentPage = new HomeViewModel();
    }

    [RelayCommand]
    private void NavigateTo(string page) => CurrentPage = page switch
    {
        "home" => new HomeViewModel(),
        "settings" => new SettingsViewModel(),
        _ => CurrentPage,
    };
}
```

```xml
<DockPanel>
    <StackPanel DockPanel.Dock="Left" Width="200">
        <Button Content="Home" Command="{Binding NavigateToCommand}" CommandParameter="home" />
        <Button Content="Settings" Command="{Binding NavigateToCommand}" CommandParameter="settings" />
    </StackPanel>
    <ContentControl Content="{Binding CurrentPage}" />
</DockPanel>
```

## Dependency Injection

Use `Microsoft.Extensions.DependencyInjection`:

```csharp
// App.axaml.cs
public partial class App : Application
{
    public static IServiceProvider Services { get; private set; } = null!;

    public override void OnFrameworkInitializationCompleted()
    {
        var services = new ServiceCollection();
        services.AddSingleton<IDataService, DataService>();
        services.AddSingleton<INavigationService, NavigationService>();
        services.AddTransient<MainViewModel>();
        Services = services.BuildServiceProvider();

        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            desktop.MainWindow = new MainWindow
            {
                DataContext = Services.GetRequiredService<MainViewModel>()
            };
        }
        base.OnFrameworkInitializationCompleted();
    }
}
```

## Platform-Specific Code

Use interfaces + platform implementations:

```csharp
// In MyApp.Core
public interface IPlatformService
{
    string GetPlatformName();
    Task<string?> PickFileAsync();
}

// In MyApp.Desktop
public class DesktopPlatformService : IPlatformService
{
    public string GetPlatformName() => RuntimeInformation.IsOSPlatform(OSPlatform.Windows)
        ? "Windows" : RuntimeInformation.IsOSPlatform(OSPlatform.OSX)
        ? "macOS" : "Linux";

    public async Task<string?> PickFileAsync()
    {
        var topLevel = TopLevel.GetTopLevel(/* ... */);
        var files = await topLevel!.StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
        {
            Title = "Open file",
            AllowMultiple = false,
        });
        return files.FirstOrDefault()?.Path.LocalPath;
    }
}
```

## Useful NuGet Packages

| Package | Purpose |
|---------|---------|
| `CommunityToolkit.Mvvm` | MVVM source generators (ObservableProperty, RelayCommand) |
| `Avalonia.Xaml.Behaviors` | Behaviors and interactions |
| `Avalonia.Controls.DataGrid` | DataGrid control |
| `FluentAvalonia` | Fluent Design system controls |
| `Material.Avalonia` | Material Design theme |
| `Semi.Avalonia` | Semi Design theme |
| `Avalonia.Svg.Skia` | SVG rendering |
| `AsyncImageLoader.Avalonia` | Async image loading with cache |
| `HotAvalonia` | XAML hot reload during development |
| `Dock.Avalonia` | Docking layout (like VS Code panels) |

## Testing

```bash
dotnet add package Moq
dotnet add package FluentAssertions
dotnet add package xunit
dotnet add package Avalonia.Headless.XUnit  # UI tests without display
```

### ViewModel Tests
```csharp
public class MainViewModelTests
{
    [Fact]
    public void Name_WhenSet_RaisesPropertyChanged()
    {
        var vm = new MainViewModel();
        var raised = false;
        vm.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(MainViewModel.Name)) raised = true;
        };
        vm.Name = "test";
        raised.Should().BeTrue();
    }
}
```

### Headless UI Tests
```csharp
[AvaloniaFact]
public void Button_ShouldBeDisabled_WhenFormInvalid()
{
    var window = new MainWindow { DataContext = new MainViewModel() };
    window.Show();
    var button = window.FindControl<Button>("SubmitButton");
    button!.IsEnabled.Should().BeFalse();
}
```

## Build & Publish

```bash
# Debug run
dotnet run --project src/MyApp.Desktop

# Publish self-contained for each platform
dotnet publish src/MyApp.Desktop -c Release -r win-x64 --self-contained
dotnet publish src/MyApp.Desktop -c Release -r osx-arm64 --self-contained
dotnet publish src/MyApp.Desktop -c Release -r linux-x64 --self-contained

# Single-file executable
dotnet publish src/MyApp.Desktop -c Release -r win-x64 --self-contained -p:PublishSingleFile=true -p:PublishTrimmed=true

# AOT compilation (faster startup, smaller size)
dotnet publish src/MyApp.Desktop -c Release -r win-x64 -p:PublishAot=true
```

## Common Patterns

### Dialog Service
```csharp
public interface IDialogService
{
    Task<string?> ShowInputDialogAsync(string title, string message);
    Task ShowMessageAsync(string title, string message);
    Task<bool> ShowConfirmAsync(string title, string message);
}
```

### Settings / Preferences
```csharp
// Use a JSON file in AppData
public class SettingsService
{
    private static readonly string Path = System.IO.Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "MyApp", "settings.json");

    public AppSettings Load() => File.Exists(Path)
        ? JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(Path))!
        : new AppSettings();

    public void Save(AppSettings settings)
    {
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(Path)!);
        File.WriteAllText(Path, JsonSerializer.Serialize(settings, new JsonSerializerOptions { WriteIndented = true }));
    }
}
```

### Async Data Loading
```csharp
public partial class DataViewModel : ViewModelBase
{
    [ObservableProperty]
    private bool _isLoading;

    [ObservableProperty]
    private ObservableCollection<Item> _items = [];

    [RelayCommand]
    private async Task LoadDataAsync()
    {
        IsLoading = true;
        try
        {
            var data = await _dataService.GetItemsAsync();
            Items = new ObservableCollection<Item>(data);
        }
        finally
        {
            IsLoading = false;
        }
    }
}
```
