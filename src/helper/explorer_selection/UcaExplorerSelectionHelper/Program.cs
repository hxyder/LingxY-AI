using System.IO.Pipes;
using System.Text;
using System.Text.Json;

static string? GetValue(string[] args, string name, string? fallback = null)
{
    var index = Array.IndexOf(args, name);
    return index >= 0 && index + 1 < args.Length ? args[index + 1] : fallback;
}

static string[] GetMany(string[] args, string name)
{
    var index = Array.IndexOf(args, name);
    if (index < 0)
    {
        return Array.Empty<string>();
    }

    var results = new List<string>();
    for (var i = index + 1; i < args.Length && !args[i].StartsWith("--", StringComparison.Ordinal); i += 1)
    {
        results.Add(args[i]);
    }
    return results.ToArray();
}

var files = GetMany(args, "--files");
if (files.Length == 0)
{
    throw new InvalidOperationException("At least one file is required.");
}

var command = GetValue(args, "--command", "分析这些文件并生成详细报告")!;
var source = GetValue(args, "--source", "hotkey")!;
var captureMode = GetValue(args, "--capture-mode", "hotkey")!;
var pipeName = GetValue(args, "--pipe-name", @"\\.\pipe\uca-helper-explorer-selection")!;
var hwnd = GetValue(args, "--hwnd");

var payload = new
{
    schema_version = "1.0",
    source = source,
    capture_mode = captureMode,
    hwnd = hwnd,
    user_command = command,
    file_paths = files,
    captured_at = DateTime.UtcNow.ToString("O")
};

using var client = new NamedPipeClientStream(".", pipeName.Replace(@"\\.\pipe\", ""), PipeDirection.InOut, PipeOptions.Asynchronous);
await client.ConnectAsync(5000);
using var writer = new StreamWriter(client, new UTF8Encoding(false), leaveOpen: true) { AutoFlush = true };
using var reader = new StreamReader(client, Encoding.UTF8, leaveOpen: true);
var json = JsonSerializer.Serialize(payload);
await writer.WriteLineAsync(json);
var response = await reader.ReadLineAsync();
Console.WriteLine(response);
