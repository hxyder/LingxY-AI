using System.Diagnostics;
using System.Text;
using System.Text.Json;

var runtimeBaseUrl = Environment.GetEnvironmentVariable("UCA_RUNTIME_BASE_URL") ?? "http://127.0.0.1:4310";
using var http = new HttpClient { BaseAddress = new Uri(runtimeBaseUrl) };
using var stdin = Console.OpenStandardInput();
using var stdout = Console.OpenStandardOutput();

var header = new byte[4];
var read = await stdin.ReadAsync(header, 0, 4);
if (read != 4)
{
    return;
}

var length = BitConverter.ToInt32(header, 0);
var body = new byte[length];
var offset = 0;
while (offset < length)
{
    offset += await stdin.ReadAsync(body, offset, length - offset);
}

var requestJson = Encoding.UTF8.GetString(body);
using var requestDocument = JsonDocument.Parse(requestJson);
var root = requestDocument.RootElement;
var action = root.GetProperty("action").GetString() ?? string.Empty;
var requestId = root.GetProperty("requestId").GetString();

object response;
switch (action)
{
    case "ping":
        response = new
        {
            protocolVersion = "1.0",
            requestId,
            ok = true,
            payload = new
            {
                host = "com.uca.host",
                runtimeBaseUrl
            }
        };
        break;
    case "get_recent_tasks":
        {
            var taskResponse = await http.GetStringAsync("/tasks");
            using var taskDocument = JsonDocument.Parse(taskResponse);
            response = new
            {
                protocolVersion = "1.0",
                requestId,
                ok = true,
                payload = new
                {
                    tasks = taskDocument.RootElement.GetProperty("tasks")
                }
            };
        }
        break;
    case "submit_capture":
        {
            var payload = root.GetProperty("payload").GetRawText();
            using var content = new StringContent(payload, Encoding.UTF8, "application/json");
            var submitResponse = await http.PostAsync("/task", content);
            var submitBody = await submitResponse.Content.ReadAsStringAsync();
            using var submitDocument = JsonDocument.Parse(submitBody);
            var task = submitDocument.RootElement.GetProperty("task");
            response = new
            {
                protocolVersion = "1.0",
                requestId,
                ok = submitResponse.IsSuccessStatusCode,
                payload = new
                {
                    taskId = task.GetProperty("task_id").GetString(),
                    status = task.GetProperty("status").GetString(),
                    sourceType = task.GetProperty("context_packet").GetProperty("source_type").GetString()
                }
            };
        }
        break;
    case "open_runtime_tasks":
        Process.Start(new ProcessStartInfo
        {
            FileName = $"{runtimeBaseUrl}/tasks",
            UseShellExecute = true
        });
        response = new
        {
            protocolVersion = "1.0",
            requestId,
            ok = true,
            payload = new
            {
                opened = $"{runtimeBaseUrl}/tasks"
            }
        };
        break;
    default:
        response = new
        {
            protocolVersion = "1.0",
            requestId,
            ok = false,
            error = new
            {
                code = "unsupported_action",
                message = $"Unsupported action: {action}"
            }
        };
        break;
}

var responseBytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(response));
var responseHeader = BitConverter.GetBytes(responseBytes.Length);
await stdout.WriteAsync(responseHeader, 0, responseHeader.Length);
await stdout.WriteAsync(responseBytes, 0, responseBytes.Length);
await stdout.FlushAsync();
