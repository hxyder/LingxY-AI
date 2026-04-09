using System.IO.Pipes;
using System.Diagnostics;
using System.Text;
using System.Text.Json;

var jsonOptions = new JsonSerializerOptions
{
    WriteIndented = false
};

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
var electronExe = GetValue(args, "--electron-exe");
var electronCli = GetValue(args, "--electron-cli");
var appDir = GetValue(args, "--app-dir");
var serviceUrl = GetValue(args, "--service-url");
var handoffDir = GetValue(args, "--handoff-dir", Path.Combine(
    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
    "UCA",
    "handoffs",
    "explorer"))!;
var batchWindowMs = int.TryParse(GetValue(args, "--batch-window-ms", "700"), out var parsedBatchWindowMs)
    ? parsedBatchWindowMs
    : 700;
var launchMode = GetValue(args, "--launch-mode", "pipe_submit")!;

if (launchMode == "overlay_prompt")
{
    if (string.IsNullOrWhiteSpace(electronExe) || string.IsNullOrWhiteSpace(appDir))
    {
        throw new InvalidOperationException("overlay_prompt mode requires --electron-exe and --app-dir.");
    }
    if (!File.Exists(electronExe))
    {
        throw new FileNotFoundException("Electron executable not found.", electronExe);
    }
    if (!string.IsNullOrWhiteSpace(electronCli) && !File.Exists(electronCli))
    {
        throw new FileNotFoundException("Electron CLI entry not found.", electronCli);
    }
    if (!Directory.Exists(appDir))
    {
        throw new DirectoryNotFoundException($"App directory not found: {appDir}");
    }

    Directory.CreateDirectory(handoffDir);
    var batchFilePath = Path.Combine(handoffDir, "explorer-selection-batch.json");
    var invocationId = Guid.NewGuid().ToString("N");

    using var mutex = new Mutex(false, @"Local\UCA.ExplorerSelection.Batch");
    var ownsMutex = false;
    if (!mutex.WaitOne(TimeSpan.FromSeconds(5)))
    {
        throw new TimeoutException("Could not acquire Explorer selection batch mutex.");
    }
    ownsMutex = true;

    ExplorerSelectionBatchState batchState;
    if (File.Exists(batchFilePath))
    {
        batchState = JsonSerializer.Deserialize<ExplorerSelectionBatchState>(File.ReadAllText(batchFilePath, Encoding.UTF8))
            ?? new ExplorerSelectionBatchState();
    }
    else
    {
        batchState = new ExplorerSelectionBatchState();
    }

    if (string.IsNullOrWhiteSpace(batchState.OwnerId))
    {
        batchState.OwnerId = invocationId;
    }

    batchState.Source = source;
    batchState.CaptureMode = captureMode;
    batchState.Hwnd = hwnd;
    batchState.CapturedAt = DateTime.UtcNow.ToString("O");
    batchState.ExpiresAt = DateTime.UtcNow.AddMilliseconds(batchWindowMs).ToString("O");
    batchState.FilePaths = batchState.FilePaths
        .Concat(files)
        .Where(path => !string.IsNullOrWhiteSpace(path))
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .ToArray();

    var serializedBatch = JsonSerializer.Serialize(batchState, jsonOptions);
    File.WriteAllText(batchFilePath, serializedBatch, new UTF8Encoding(false));
    mutex.ReleaseMutex();
    ownsMutex = false;

    await WaitForBatchWindowAsync(batchFilePath);

    if (!mutex.WaitOne(TimeSpan.FromSeconds(5)))
    {
        throw new TimeoutException("Could not re-acquire Explorer selection batch mutex.");
    }
    ownsMutex = true;

    try
    {
        if (!File.Exists(batchFilePath))
        {
            Console.WriteLine("{\"ok\":true,\"mode\":\"overlay_prompt\",\"status\":\"already_processed\"}");
            return;
        }

        var latestBatch = JsonSerializer.Deserialize<ExplorerSelectionBatchState>(File.ReadAllText(batchFilePath, Encoding.UTF8))
            ?? new ExplorerSelectionBatchState();

        if (!string.Equals(latestBatch.OwnerId, invocationId, StringComparison.Ordinal))
        {
            Console.WriteLine("{\"ok\":true,\"mode\":\"overlay_prompt\",\"status\":\"batched\"}");
            return;
        }

        var handoffPath = Path.Combine(handoffDir, $"prompt-handoff-{Guid.NewGuid():N}.json");
        var handoffPayload = new
        {
            schema_version = "1.0",
            source_app = "explorer.exe",
            source = latestBatch.Source ?? source,
            capture_mode = latestBatch.CaptureMode ?? captureMode,
            hwnd = latestBatch.Hwnd ?? hwnd,
            file_paths = latestBatch.FilePaths ?? files,
            captured_at = latestBatch.CapturedAt ?? DateTime.UtcNow.ToString("O")
        };
        var handoffJson = JsonSerializer.Serialize(handoffPayload, jsonOptions);
        File.WriteAllText(handoffPath, handoffJson, new UTF8Encoding(false));
        File.Delete(batchFilePath);

        var startInfo = new ProcessStartInfo
        {
            FileName = electronExe,
            WorkingDirectory = appDir,
            UseShellExecute = false
        };
        if (!string.IsNullOrWhiteSpace(electronCli))
        {
            startInfo.ArgumentList.Add(electronCli);
        }
        startInfo.ArgumentList.Add(appDir);
        startInfo.ArgumentList.Add("--uca-open-overlay");
        startInfo.ArgumentList.Add("--uca-handoff-file");
        startInfo.ArgumentList.Add(handoffPath);
        if (startInfo.Environment.ContainsKey("ELECTRON_RUN_AS_NODE"))
        {
            startInfo.Environment.Remove("ELECTRON_RUN_AS_NODE");
        }
        if (!string.IsNullOrWhiteSpace(serviceUrl))
        {
            startInfo.ArgumentList.Add("--uca-service-url");
            startInfo.ArgumentList.Add(serviceUrl);
        }
        if (startInfo.Environment.ContainsKey("ELECTRON_RUN_AS_NODE"))
        {
            startInfo.Environment.Remove("ELECTRON_RUN_AS_NODE");
        }

        Process.Start(startInfo);
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            ok = true,
            mode = "overlay_prompt",
            handoff_path = handoffPath,
            file_count = handoffPayload.file_paths.Length
        }, jsonOptions));
        return;
    }
    finally
    {
        if (ownsMutex)
        {
            mutex.ReleaseMutex();
        }
    }
}

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
var json = JsonSerializer.Serialize(payload, jsonOptions);
await writer.WriteLineAsync(json);
var response = await reader.ReadLineAsync();
Console.WriteLine(response);

async Task WaitForBatchWindowAsync(string batchFilePath)
{
    while (true)
    {
        if (!File.Exists(batchFilePath))
        {
            return;
        }

        var state = JsonSerializer.Deserialize<ExplorerSelectionBatchState>(await File.ReadAllTextAsync(batchFilePath, Encoding.UTF8), jsonOptions)
            ?? new ExplorerSelectionBatchState();

        if (!DateTime.TryParse(state.ExpiresAt, out var expiresAt))
        {
            return;
        }

        var waitMs = (int)Math.Ceiling((expiresAt - DateTime.UtcNow).TotalMilliseconds);
        if (waitMs <= 0)
        {
          return;
        }

        await Task.Delay(Math.Min(waitMs, 250));
    }
}

sealed class ExplorerSelectionBatchState
{
    public string? OwnerId { get; set; }
    public string? Source { get; set; }
    public string? CaptureMode { get; set; }
    public string? Hwnd { get; set; }
    public string? CapturedAt { get; set; }
    public string? ExpiresAt { get; set; }
    public string[] FilePaths { get; set; } = Array.Empty<string>();
}
