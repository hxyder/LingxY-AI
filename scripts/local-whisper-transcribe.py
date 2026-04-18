#!/usr/bin/env python3
"""
Local Whisper transcription helper for UCA.

This script is intentionally a tiny JSON-in/JSON-out sidecar so the Node
runtime does not import ML packages or load models during startup.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def emit(payload: dict) -> int:
    # Keep stdout ASCII-only so Windows console code pages cannot mojibake
    # non-English transcripts before Node parses the JSON.
    print(json.dumps(payload, ensure_ascii=True), flush=True)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Transcribe audio locally with faster-whisper.")
    parser.add_argument("audio_path", help="Path to an audio file readable by PyAV/FFmpeg.")
    parser.add_argument("--language", default="auto", help="Language hint like en/zh, or auto.")
    parser.add_argument("--model", default=os.environ.get("UCA_LOCAL_WHISPER_MODEL", "base"))
    # Default to CPU so machines without CUDA DLLs still work reliably. Users
    # with a configured NVIDIA stack can opt in with UCA_LOCAL_WHISPER_DEVICE=cuda.
    parser.add_argument("--device", default=os.environ.get("UCA_LOCAL_WHISPER_DEVICE", "cpu"))
    parser.add_argument("--compute-type", default=os.environ.get("UCA_LOCAL_WHISPER_COMPUTE_TYPE", "int8"))
    parser.add_argument("--beam-size", type=int, default=int(os.environ.get("UCA_LOCAL_WHISPER_BEAM_SIZE", "1")))
    parser.add_argument("--stream", action="store_true",
                        help="Emit one JSON line per segment as decoding progresses, plus a final 'done' summary.")
    args = parser.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ModuleNotFoundError:
        return emit({
            "ok": False,
            "reason": "local_transcriber_missing",
            "message": "Python package faster-whisper is not installed. Run: python -m pip install faster-whisper"
        })
    except Exception as exc:
        return emit({
            "ok": False,
            "reason": "local_transcriber_import_failed",
            "message": str(exc)
        })

    try:
        started = time.perf_counter()
        model = WhisperModel(
            args.model,
            device=args.device,
            compute_type=args.compute_type
        )
        language = None if args.language in ("", "auto", "detect") else args.language
        segments, info = model.transcribe(
            args.audio_path,
            language=language,
            beam_size=args.beam_size,
            vad_filter=True
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
            # In --stream mode we flush each segment as it is decoded so the
            # Node side can forward it to the frontend as an SSE frame. The
            # generator from faster-whisper is lazy, so the consumer sees the
            # first text 1-2 seconds in instead of waiting for the whole file.
            if args.stream:
                print(json.dumps({"type": "segment", **rendered}, ensure_ascii=True), flush=True)
        transcript = "\n".join(item["text"] for item in rendered_segments).strip()
        payload = {
            "ok": True,
            "transcript": transcript,
            "language": getattr(info, "language", None),
            "language_probability": getattr(info, "language_probability", None),
            "duration": getattr(info, "duration", None),
            "model": args.model,
            "device": args.device,
            "compute_type": args.compute_type,
            "elapsed_seconds": round(time.perf_counter() - started, 3),
            "segments": rendered_segments
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


if __name__ == "__main__":
    sys.exit(main())
