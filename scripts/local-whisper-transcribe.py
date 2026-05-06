#!/usr/bin/env python3
"""
Local Whisper transcription helper for UCA.

Two modes:
  - One-shot CLI (legacy fallback path used by audio-routes when the
    daemon is disabled or unavailable).
  - --server stdin/stdout JSONL loop, used by whisper-daemon.mjs to
    amortise faster-whisper's 1-3 s cold start across many requests.

In --server mode stdout MUST contain only protocol JSONL — every
single line is exactly one JSON object the Node side can parse.
All warnings, log lines, traceback excerpts go to stderr.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
try:
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


def emit(payload: dict) -> int:
    # Keep stdout ASCII-only so Windows console code pages cannot mojibake
    # non-English transcripts before Node parses the JSON.
    print(json.dumps(payload, ensure_ascii=True), flush=True)
    return 0


def _log(msg: str) -> None:
    try:
        print(msg, file=sys.stderr, flush=True)
    except Exception:
        pass


def _import_faster_whisper():
    try:
        from faster_whisper import WhisperModel
        return WhisperModel, None
    except ModuleNotFoundError:
        return None, {
            "ok": False,
            "reason": "local_transcriber_missing",
            "message": "Python package faster-whisper is not installed. Run: python -m pip install faster-whisper"
        }
    except Exception as exc:
        return None, {
            "ok": False,
            "reason": "local_transcriber_import_failed",
            "message": str(exc)
        }


def _run_transcription(model, audio_path, language, beam_size, no_vad, stream):
    segments, info = model.transcribe(
        audio_path,
        language=None if language in ("", "auto", "detect") else language,
        beam_size=beam_size,
        vad_filter=not no_vad
    )
    rendered_segments = []
    for segment in segments:
        text = (segment.text or "").strip()
        if not text:
            continue
        rendered = {
            "start": float(segment.start),
            "end": float(segment.end),
            "text": text
        }
        rendered_segments.append(rendered)
        if stream:
            print(json.dumps({"type": "segment", **rendered}, ensure_ascii=True), flush=True)
    transcript = "\n".join(item["text"] for item in rendered_segments).strip()
    return {
        "transcript": transcript,
        "language": getattr(info, "language", None),
        "language_probability": getattr(info, "language_probability", None),
        "duration": getattr(info, "duration", None),
        "segments": rendered_segments
    }


def _run_oneshot(args) -> int:
    WhisperModel, import_error = _import_faster_whisper()
    if import_error is not None:
        return emit(import_error)
    try:
        started = time.perf_counter()
        model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
        result = _run_transcription(
            model, args.audio_path, args.language, args.beam_size, args.no_vad, args.stream
        )
        payload = {
            "ok": True,
            **result,
            "model": args.model,
            "device": args.device,
            "compute_type": args.compute_type,
            "elapsed_seconds": round(time.perf_counter() - started, 3)
        }
        if args.stream:
            print(json.dumps({"type": "done", **payload}, ensure_ascii=True), flush=True)
            return 0
        return emit(payload)
    except Exception as exc:
        return emit({
            "ok": False,
            "reason": "local_transcription_failed",
            "message": str(exc),
            "model": args.model,
            "device": args.device,
            "compute_type": args.compute_type
        })


def _run_server(args) -> int:
    """JSONL request loop. One model load amortised across many requests.

    Request shape:
      {"id": "...", "audio_path": "...", "language": "auto",
       "beam_size": 1, "no_vad": false}
    Response shape (success):
      {"id": "...", "ok": true, "transcript": "...", ...,
       "elapsed_seconds": 0.42}
    Response shape (failure):
      {"id": "...", "ok": false, "reason": "...", "message": "..."}
    """
    WhisperModel, import_error = _import_faster_whisper()
    if import_error is not None:
        # Daemon cannot start at all without the package — emit one
        # protocol-level error and exit so the Node side falls back.
        return emit({"id": None, **import_error})

    model = None
    model_signature = None

    def _ensure_model(model_name, device, compute_type):
        nonlocal model, model_signature
        signature = (model_name, device, compute_type)
        if model is not None and signature == model_signature:
            return model
        if model is not None:
            _log(f"whisper daemon: model signature changed; reloading ({model_signature} -> {signature})")
            del model
            model = None
        load_started = time.perf_counter()
        loaded = WhisperModel(model_name, device=device, compute_type=compute_type)
        elapsed = round(time.perf_counter() - load_started, 3)
        _log(f"whisper daemon: loaded model={model_name} device={device} compute_type={compute_type} in {elapsed}s")
        model = loaded
        model_signature = signature
        return model

    _log("whisper daemon: ready")
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as exc:
            _log(f"whisper daemon: bad json {exc}")
            continue
        request_id = request.get("id")
        try:
            request_model = request.get("model") or args.model
            request_device = request.get("device") or args.device
            request_compute_type = request.get("compute_type") or args.compute_type
            request_language = request.get("language") or "auto"
            request_beam_size = int(request.get("beam_size") or args.beam_size)
            request_no_vad = bool(request.get("no_vad", False))
            audio_path = request.get("audio_path")
            if not audio_path:
                emit({"id": request_id, "ok": False, "reason": "audio_path_required"})
                continue
            active = _ensure_model(request_model, request_device, request_compute_type)
            started = time.perf_counter()
            result = _run_transcription(active, audio_path, request_language, request_beam_size,
                                        request_no_vad, stream=False)
            emit({
                "id": request_id,
                "ok": True,
                **result,
                "model": request_model,
                "device": request_device,
                "compute_type": request_compute_type,
                "elapsed_seconds": round(time.perf_counter() - started, 3)
            })
        except Exception as exc:
            _log(f"whisper daemon: transcription failed: {exc}\n{traceback.format_exc()}")
            try:
                emit({
                    "id": request_id,
                    "ok": False,
                    "reason": "local_transcription_failed",
                    "message": str(exc)
                })
            except Exception:
                _log("whisper daemon: failed to emit error response")
    _log("whisper daemon: stdin closed, exiting")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Transcribe audio locally with faster-whisper.")
    parser.add_argument("audio_path", nargs="?",
                        help="Path to an audio file readable by PyAV/FFmpeg (omit when --server).")
    parser.add_argument("--language", default="auto", help="Language hint like en/zh, or auto.")
    parser.add_argument("--model", default=os.environ.get("UCA_LOCAL_WHISPER_MODEL", "base"))
    # Default to CPU so machines without CUDA DLLs still work reliably. Users
    # with a configured NVIDIA stack can opt in with UCA_LOCAL_WHISPER_DEVICE=cuda.
    parser.add_argument("--device", default=os.environ.get("UCA_LOCAL_WHISPER_DEVICE", "cpu"))
    parser.add_argument("--compute-type", default=os.environ.get("UCA_LOCAL_WHISPER_COMPUTE_TYPE", "int8"))
    parser.add_argument("--beam-size", type=int, default=int(os.environ.get("UCA_LOCAL_WHISPER_BEAM_SIZE", "1")))
    parser.add_argument("--stream", action="store_true",
                        help="Emit one JSON line per segment as decoding progresses, plus a final 'done' summary.")
    parser.add_argument("--no-vad", action="store_true",
                        help="Disable Silero VAD pre-filter. Use for very short / quiet clips where VAD is "
                             "too aggressive (e.g. Echo wake-word enrollment).")
    parser.add_argument("--server", action="store_true",
                        help="Run a stdin/stdout JSONL request loop. Used by whisper-daemon.mjs to "
                             "amortise model load across many transcriptions.")
    args = parser.parse_args()

    if args.server:
        return _run_server(args)

    if not args.audio_path:
        return emit({
            "ok": False,
            "reason": "audio_path_required",
            "message": "audio_path positional argument is required when --server is not set."
        })
    return _run_oneshot(args)


if __name__ == "__main__":
    sys.exit(main())
