#!/usr/bin/env python3
"""
Local sherpa-onnx keyword spotting helper for UCA Echo.

This sidecar keeps Node free of native ML imports. It accepts a browser audio
recording, converts it to 16 kHz mono WAV, runs the sherpa-onnx KWS CLI, and
prints one JSON object.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


DEFAULT_MODEL_NAME = "sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20"
DEFAULT_KEYWORDS = [
    "林西",
    "林夕",
    "林熙",
    "林希",
    "林溪",
    "琳溪",
    "灵溪",
    "灵犀",
    "凌西",
    "临溪",
]


def emit(payload: dict) -> int:
    print(json.dumps(payload, ensure_ascii=True), flush=True)
    return 0


def project_root() -> Path:
    return Path(__file__).resolve().parents[1]


def find_executable(name: str) -> str | None:
    found = shutil.which(name)
    if found:
        return found

    scripts_dir = Path(sys.executable).resolve().parent
    candidates = [
        scripts_dir / name,
        scripts_dir / f"{name}.exe",
        project_root() / ".venv" / "Scripts" / f"{name}.exe",
        project_root() / ".venv" / "bin" / name,
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return None


def resolve_model_dir(value: str | None) -> Path:
    if value:
        return Path(value).expanduser().resolve()
    env_path = os.environ.get("UCA_SHERPA_KWS_MODEL_DIR", "").strip()
    if env_path:
        return Path(env_path).expanduser().resolve()
    return project_root() / "models" / DEFAULT_MODEL_NAME


def first_match(model_dir: Path, pattern: str) -> Path | None:
    matches = sorted(glob.glob(str(model_dir / pattern)))
    return Path(matches[0]) if matches else None


def find_model_files(model_dir: Path) -> dict[str, Path] | None:
    tokens = model_dir / "tokens.txt"
    if not tokens.exists():
        return None

    # Prefer lower latency chunk-8 fp32 for the first integration. The zh-en
    # model's decoder is fp32-only, so using mixed int8 paths is intentionally
    # left for a later tuning pass.
    for chunk in ("chunk-8-left-64", "chunk-16-left-64"):
        encoder = first_match(model_dir, f"encoder-*{chunk}.onnx")
        decoder = first_match(model_dir, f"decoder-*{chunk}.onnx")
        joiner = first_match(model_dir, f"joiner-*{chunk}.onnx")
        if encoder and decoder and joiner:
            return {
                "encoder": encoder,
                "decoder": decoder,
                "joiner": joiner,
                "tokens": tokens,
            }
    return None


def parse_keywords(value: str | None) -> list[str]:
    raw = value or os.environ.get("UCA_SHERPA_KWS_KEYWORDS", "")
    if not raw.strip():
        return DEFAULT_KEYWORDS
    return [item.strip() for item in raw.replace("，", ",").split(",") if item.strip()]


def build_keywords_file(model_dir: Path, tokens: Path, keywords: list[str], output_dir: Path) -> Path:
    configured = os.environ.get("UCA_SHERPA_KWS_KEYWORDS_FILE", "").strip()
    if configured:
        candidate = Path(configured).expanduser().resolve()
        if candidate.exists():
            return candidate

    cli = find_executable("sherpa-onnx-cli")
    if not cli:
        raise RuntimeError("sherpa-onnx-cli not found. Install with: python -m pip install sherpa-onnx")

    raw_path = output_dir / "keywords_raw.txt"
    keyword_path = output_dir / "keywords.txt"
    score = os.environ.get("UCA_SHERPA_KWS_KEYWORDS_SCORE", "1.5")
    threshold = os.environ.get("UCA_SHERPA_KWS_KEYWORDS_THRESHOLD", "0.25")
    raw_path.write_text(
        "\n".join(f"{keyword} :{score} #{threshold} @{keyword}" for keyword in keywords) + "\n",
        encoding="utf-8",
    )

    lexicon = model_dir / "en.phone"
    command = [
        cli,
        "text2token",
        "--tokens",
        str(tokens),
        "--tokens-type",
        "phone+ppinyin" if lexicon.exists() else "ppinyin",
    ]
    if lexicon.exists():
        command.extend(["--lexicon", str(lexicon)])
    command.extend([str(raw_path), str(keyword_path)])

    completed = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=20,
    )
    if completed.returncode != 0:
        raise RuntimeError((completed.stderr or completed.stdout or "keyword tokenization failed").strip())
    return keyword_path


def convert_to_wav(input_path: Path, output_path: Path) -> float:
    try:
        import av
    except ModuleNotFoundError as exc:
        raise RuntimeError("Python package av is missing; install faster-whisper or av") from exc

    sample_rate = 16000
    samples_written = 0
    with av.open(str(input_path)) as container, wave.open(str(output_path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        audio_streams = [stream for stream in container.streams if stream.type == "audio"]
        if not audio_streams:
            raise RuntimeError("input audio has no audio stream")
        resampler = av.audio.resampler.AudioResampler(format="s16", layout="mono", rate=sample_rate)
        for frame in container.decode(audio=0):
            frames = resampler.resample(frame)
            if frames is None:
                continue
            if not isinstance(frames, list):
                frames = [frames]
            for resampled in frames:
                array = resampled.to_ndarray()
                data = array.reshape(-1).tobytes()
                samples_written += len(data) // 2
                wav.writeframes(data)
        try:
            frames = resampler.resample(None) or []
            if not isinstance(frames, list):
                frames = [frames]
            for resampled in frames:
                array = resampled.to_ndarray()
                data = array.reshape(-1).tobytes()
                samples_written += len(data) // 2
                wav.writeframes(data)
        except Exception:
            pass
    return samples_written / sample_rate


def parse_spotter_output(stdout: str) -> list[dict]:
    events: list[dict] = []
    for line in stdout.splitlines():
        text = line.strip()
        if not (text.startswith("{") and text.endswith("}")):
            continue
        try:
            payload = json.loads(text)
        except Exception:
            continue
        if isinstance(payload, dict):
            events.append(payload)
    return events


def run_kws(audio_path: Path, model_dir: Path, keywords: list[str]) -> dict:
    try:
        import numpy as np
        import sherpa_onnx
    except ModuleNotFoundError:
        return {
            "ok": False,
            "reason": "sherpa_onnx_missing",
            "message": "Python package sherpa-onnx is not installed. Run: python -m pip install sherpa-onnx",
        }
    except Exception as exc:
        return {
            "ok": False,
            "reason": "sherpa_onnx_import_failed",
            "message": str(exc),
        }
    if not model_dir.exists():
        return {
            "ok": False,
            "reason": "kws_model_missing",
            "message": f"KWS model directory not found: {model_dir}",
        }
    files = find_model_files(model_dir)
    if not files:
        return {
            "ok": False,
            "reason": "kws_model_incomplete",
            "message": f"KWS model files are incomplete in: {model_dir}",
        }

    with tempfile.TemporaryDirectory(prefix="uca-sherpa-kws-") as tmp_name:
        tmp_dir = Path(tmp_name)
        wav_path = tmp_dir / "echo-window.wav"
        seconds = convert_to_wav(audio_path, wav_path)
        if seconds < 0.15:
            return {
                "ok": True,
                "matched": False,
                "reason": "audio_too_short",
                "audio_seconds": seconds,
            }
        keywords_file = build_keywords_file(model_dir, files["tokens"], keywords, tmp_dir)

        with wave.open(str(wav_path), "rb") as wav:
            sample_rate = wav.getframerate()
            pcm = wav.readframes(wav.getnframes())
        samples = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0

        spotter = sherpa_onnx.KeywordSpotter(
            tokens=str(files["tokens"]),
            encoder=str(files["encoder"]),
            decoder=str(files["decoder"]),
            joiner=str(files["joiner"]),
            keywords_file=str(keywords_file),
            num_threads=int(os.environ.get("UCA_SHERPA_KWS_NUM_THREADS", "2")),
            sample_rate=16000,
            feature_dim=80,
            max_active_paths=int(os.environ.get("UCA_SHERPA_KWS_MAX_ACTIVE_PATHS", "4")),
            keywords_score=float(os.environ.get("UCA_SHERPA_KWS_KEYWORDS_SCORE", "1.5")),
            keywords_threshold=float(os.environ.get("UCA_SHERPA_KWS_KEYWORDS_THRESHOLD", "0.25")),
            num_trailing_blanks=int(os.environ.get("UCA_SHERPA_KWS_NUM_TRAILING_BLANKS", "1")),
            provider=os.environ.get("UCA_SHERPA_KWS_PROVIDER", "cpu"),
        )
        stream = spotter.create_stream()
        stream.accept_waveform(sample_rate, samples)
        stream.input_finished()

        events = []
        while spotter.is_ready(stream):
            spotter.decode_stream(stream)
            keyword = spotter.get_result(stream)
            if keyword:
                events.append({
                    "keyword": keyword,
                    "tokens": spotter.tokens(stream),
                    "timestamps": spotter.timestamps(stream),
                })
                spotter.reset_stream(stream)
                break
        first = events[0] if events else None
        return {
            "ok": True,
            "matched": bool(first),
            "keyword": first.get("keyword", "") if first else "",
            "events": events[:5],
            "audio_seconds": seconds,
            "provider": {
                "id": "local-sherpa-onnx-kws",
                "kind": "local",
                "name": "Local sherpa-onnx KWS",
                "modelDir": str(model_dir),
            },
        }


def main() -> int:
    parser = argparse.ArgumentParser(description="Detect the Echo wake word with sherpa-onnx KWS.")
    parser.add_argument("audio_path", nargs="?", help="Path to a browser-recorded audio file.")
    parser.add_argument("--model-dir", default="")
    parser.add_argument("--keywords", default="")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    model_dir = resolve_model_dir(args.model_dir)
    keywords = parse_keywords(args.keywords)
    if args.check:
        try:
            import sherpa_onnx  # noqa: F401
            spotter = True
        except Exception:
            spotter = False
        cli = find_executable("sherpa-onnx-cli")
        files = find_model_files(model_dir) if model_dir.exists() else None
        return emit({
            "ok": bool(spotter and cli and files),
            "spotter": bool(spotter),
            "cli": bool(cli),
            "modelDir": str(model_dir),
            "modelReady": bool(files),
            "keywords": keywords,
            "reason": None if (spotter and cli and files) else "not_configured",
        })

    if not args.audio_path:
        return emit({"ok": False, "reason": "missing_audio_path"})
    try:
        return emit(run_kws(Path(args.audio_path).resolve(), model_dir, keywords))
    except Exception as exc:
        return emit({
            "ok": False,
            "reason": "kws_exception",
            "message": str(exc),
        })


if __name__ == "__main__":
    sys.exit(main())
