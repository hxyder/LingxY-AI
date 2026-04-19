# Echo Voice Engine Upgrade

## Goal

Echo should stop depending on browser `SpeechRecognition` for always-on wake
detection. Web Speech is convenient, but it is a dictation API: it emits noisy
text, varies by Chromium/Windows/network state, and often turns the wake word
`linxi` into unrelated Chinese or Traditional characters. That makes wake
detection unreliable and causes confusing standby UI.

The target architecture is split by job:

- **Wake word / always-on listening:** sherpa-onnx KWS, local-only.
- **Endpointing / silence detection:** VAD, preferably sherpa-onnx or Silero VAD.
- **Short command final transcript:** Whisper / faster-whisper.
- **Recording notes:** Whisper / faster-whisper for final transcription.

## Why Not Use Whisper For Everything

Whisper is an ASR model, not a keyword spotter. It is excellent for final
transcripts, especially for longer notes, but it is too heavy for a permanent
mic loop. Using Whisper continuously means repeated chunk recording, decoding,
text normalization, and fuzzy matching. That wastes CPU and still fails when the
decoded text is a plausible but wrong homophone.

KWS is the right primitive for standby Echo: small model, low latency, and the
output is only "wake word matched" or "not matched".

## Recommended Runtime Flow

```text
Echo standby
  browser captures mic audio
  -> local sherpa-onnx KWS
  -> if "linxi" matched: start Echo session
  -> if not matched: stay silent

Echo short command
  record command audio after wake
  -> VAD waits for the user to finish
  -> Whisper / faster-whisper produces final transcript
  -> execute command
  -> return to Echo standby

Recording note
  record mic + system audio
  -> optional streaming preview
  -> Whisper / faster-whisper final transcript
  -> AI note generation
```

## Licensing Notes

sherpa-onnx code is Apache-2.0. That is generally friendly for commercial use.
However, model licensing must be checked per selected model. The first target
model is:

- `sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20`
- Approximate extracted size: 38 MB
- Supports Chinese and English keyword spotting
- The model documentation explicitly says to check the license of the selected
  model before distribution.

References:

- sherpa-onnx repository: https://github.com/k2-fsa/sherpa-onnx
- sherpa-onnx KWS docs: https://k2-fsa.github.io/sherpa/onnx/kws/index.html
- zh-en KWS model docs: https://k2-fsa.github.io/sherpa/onnx/kws/pretrained_models/index.html

Whisper code and model weights are MIT. The existing UCA local transcription
path already uses `faster-whisper`, so recording notes can keep using the
current `/note/transcribe` endpoint.

## Implementation Plan

1. Keep current Web Speech Echo path as fallback only.
2. Add `/echo/kws/status` to report whether local KWS is configured.
3. Add `/echo/kws` to accept a short audio blob and return `{ matched, keyword }`.
4. Add `scripts/local-sherpa-kws.py` as a Python sidecar:
   - Uses the sherpa-onnx CLI when available.
   - Converts browser `webm/opus` recordings to 16 kHz mono WAV via PyAV.
   - Generates a temporary keyword token file for `林西/灵溪/林夕/...`.
5. Update dock standby Echo:
   - Try local sherpa KWS first.
   - If local KWS is unavailable, fall back to Web Speech.
   - Never show standby non-wake transcripts.
6. Later upgrade:
   - Replace per-window KWS checks with a persistent sherpa process.
   - Add VAD-driven endpointing for command capture.
   - Optionally add sherpa streaming ASR preview while Whisper remains final.

## Local Setup

Install Python dependencies in the project virtual environment:

```powershell
.\.venv\Scripts\python.exe -m pip install sherpa-onnx sentencepiece pypinyin
```

Download and extract the KWS model under:

```text
models/sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20
```

Or point UCA at another model folder:

```powershell
$env:UCA_SHERPA_KWS_MODEL_DIR = "D:\models\sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20"
```

Optional tuning:

```powershell
$env:UCA_SHERPA_KWS_KEYWORDS = "林西,灵溪,林夕,林熙,琳溪,凌西"
$env:UCA_SHERPA_KWS_POLL_MS = "1200"
$env:UCA_SHERPA_KWS_WINDOW_CHUNKS = "4"
```

## Acceptance Criteria

- Echo standby remains visually quiet for all non-wake speech.
- Saying `linxi` wakes Echo without showing the overlay.
- `Ctrl+Shift+V` still directly starts Echo command capture.
- `Ctrl+Shift+N` still directly starts recording notes.
- If sherpa is missing, Web Speech fallback still works.
- Recording note completion does not re-enter recording state after `Ctrl+Enter`.
