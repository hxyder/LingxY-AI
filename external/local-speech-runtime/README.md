# Optional Local Speech Runtime

This directory is intentionally small in source control. Release builds copy it
to Electron `resources/local-speech`, so maintainers can stage an optional local
speech bundle before running `npm run dist`.

Expected optional layout:

```text
external/local-speech-runtime/
  python/
    python.exe                 # Windows embeddable Python, or bin/python on Unix
  models/
    whisper/base/              # faster-whisper compatible model directory
    sherpa-kws/
      sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20/
```

Large Python runtimes, wheels, and model files stay untracked. The default
installer remains scripts-only for local speech and can still use cloud speech
providers or a user-provided `UCA_PYTHON_PATH`.
