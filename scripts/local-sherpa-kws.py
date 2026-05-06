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
ORIGINAL_KWS_ENV = {
    key: os.environ.get(key)
    for key in (
        "UCA_SHERPA_KWS_KEYWORDS_SCORE",
        "UCA_SHERPA_KWS_KEYWORDS_THRESHOLD",
        "UCA_SHERPA_KWS_MAX_ACTIVE_PATHS",
    )
}
# Keywords the spotter is primed for. Kept broad because users won't hit
# every character exactly; the sherpa KWS internally converts each entry
# to its pinyin tokens (via phone+ppinyin), so duplicated pronunciations
# just give the spotter more parallel paths to match against — they do
# not meaningfully inflate runtime. The entries below cover the four
# most common STT renderings of "lin xi" ± nasalization ("ling"), plus
# a handful of traditional-character variants.
DEFAULT_KEYWORDS = [
    # canonical
    "林西", "林夕", "林熙", "林希", "林溪",
    # common STT confusions
    "林氏", "林喜", "林犀", "林席", "林系",
    "林戏", "林昔", "林洗", "林奇", "林琦", "林琪",
    # lin-like prefix with xi-like suffix
    "琳溪", "琳西", "琳熙", "琳希",
    "灵溪", "灵犀", "灵熙", "灵希",
    "凌西", "凌溪", "凌希",
    "临溪", "临西",
    # "ling xi" (many STTs prefer the nasal)
    "领袖", "令溪", "令西",
    # english transliteration so en-phone lexicon catches foreign-accent attempts
    "lin xi", "ling xi", "linxi", "lingxi",
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


def load_user_keywords() -> list[str]:
    # Legacy escape hatch only. Enrollment no longer appends Whisper guesses
    # to the keyword list by default: short "linxi" clips are often heard as
    # unrelated text such as "林医师", and feeding those guesses back into KWS
    # makes wake behavior harder to reason about.
    if os.environ.get("UCA_SHERPA_KWS_USE_USER_KEYWORDS", "").strip().lower() not in ("1", "true", "yes"):
        return []
    path = project_root() / "models" / "user-keywords" / "keywords.txt"
    if not path.exists():
        return []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except Exception:
        return []
    return [line.strip() for line in lines if line.strip() and not line.startswith("#")]


def parse_keywords(value: str | None) -> list[str]:
    raw = value or os.environ.get("UCA_SHERPA_KWS_KEYWORDS", "")
    user_keywords = load_user_keywords()
    if not raw.strip():
        # Merge user-enrolled keywords with the defaults, deduplicating while
        # preserving order (user entries first — they're the most important
        # acoustic hint for this particular speaker).
        seen: set[str] = set()
        merged: list[str] = []
        for keyword in user_keywords + DEFAULT_KEYWORDS:
            if keyword and keyword not in seen:
                seen.add(keyword)
                merged.append(keyword)
        return merged
    explicit = [item.strip() for item in raw.replace("，", ",").split(",") if item.strip()]
    # If an explicit override was provided, still append user-enrolled
    # entries — users shouldn't lose their personal wake tuning when an ops
    # override is in place.
    seen = set(explicit)
    for keyword in user_keywords:
        if keyword not in seen:
            seen.add(keyword)
            explicit.append(keyword)
    return explicit


def apply_kws_profile(personalized: bool) -> None:
    for key, value in ORIGINAL_KWS_ENV.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
    if personalized:
        os.environ["UCA_SHERPA_KWS_KEYWORDS_SCORE"] = os.environ.get("UCA_SHERPA_KWS_KEYWORDS_SCORE_PERSONALIZED", "2.0")
        os.environ["UCA_SHERPA_KWS_KEYWORDS_THRESHOLD"] = os.environ.get("UCA_SHERPA_KWS_KEYWORDS_THRESHOLD_PERSONALIZED", "0.08")
        os.environ["UCA_SHERPA_KWS_MAX_ACTIVE_PATHS"] = os.environ.get("UCA_SHERPA_KWS_MAX_ACTIVE_PATHS_PERSONALIZED", "8")


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
    # Looser defaults than sherpa-onnx's stock 0.25/1.5 — the cost of a
    # false-positive Echo wake is tiny (the user can just say something
    # unrelated to dismiss), but false-negatives are infuriating. Can be
    # raised back via env if noise makes spurious triggers annoying.
    score = os.environ.get("UCA_SHERPA_KWS_KEYWORDS_SCORE", "2.0")
    threshold = os.environ.get("UCA_SHERPA_KWS_KEYWORDS_THRESHOLD", "0.15")
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


def read_wav_samples(wav_path: Path):
    import numpy as np
    with wave.open(str(wav_path), "rb") as wav:
        sample_rate = wav.getframerate()
        pcm = wav.readframes(wav.getnframes())
    samples = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
    return sample_rate, samples


def trim_silence(samples, sample_rate: int):
    import numpy as np
    if samples.size == 0:
        return samples
    frame = max(1, int(sample_rate * 0.025))
    hop = max(1, int(sample_rate * 0.010))
    if samples.size < frame:
        return samples
    rms = []
    for start in range(0, samples.size - frame + 1, hop):
        chunk = samples[start:start + frame]
        rms.append(float(np.sqrt(np.mean(chunk * chunk) + 1e-9)))
    values = np.asarray(rms, dtype=np.float32)
    threshold = max(0.008, float(np.percentile(values, 80)) * 0.35)
    active = np.where(values >= threshold)[0]
    if active.size == 0:
        return samples
    pad = int(sample_rate * 0.18)
    start = max(0, int(active[0] * hop) - pad)
    end = min(samples.size, int(active[-1] * hop + frame) + pad)
    return samples[start:end]


def spectral_features(samples, sample_rate: int):
    import numpy as np
    samples = trim_silence(samples, sample_rate)
    frame = int(sample_rate * 0.030)
    hop = int(sample_rate * 0.015)
    fft_size = 512
    if samples.size < frame:
        samples = np.pad(samples, (0, max(0, frame - samples.size)))
    window = np.hanning(frame).astype(np.float32)
    bands = np.array_split(np.arange(2, fft_size // 2 + 1), 24)
    rows = []
    for start in range(0, max(1, samples.size - frame + 1), hop):
        chunk = samples[start:start + frame]
        if chunk.size < frame:
            chunk = np.pad(chunk, (0, frame - chunk.size))
        spectrum = np.abs(np.fft.rfft(chunk * window, n=fft_size)).astype(np.float32)
        row = [float(np.log1p(np.mean(spectrum[band]))) for band in bands]
        rows.append(row)
    feats = np.asarray(rows, dtype=np.float32)
    if feats.ndim != 2 or feats.shape[0] == 0:
        return feats
    mean = feats.mean(axis=0, keepdims=True)
    std = feats.std(axis=0, keepdims=True) + 1e-5
    return (feats - mean) / std


def dtw_distance(a, b) -> float:
    import numpy as np
    if a.size == 0 or b.size == 0:
        return float("inf")
    # Keep the comparison cheap for rolling windows; 180 frames is ~2.7s at
    # the 15ms hop used above.
    max_frames = 180
    if a.shape[0] > max_frames:
        idx = np.linspace(0, a.shape[0] - 1, max_frames).astype(np.int32)
        a = a[idx]
    if b.shape[0] > max_frames:
        idx = np.linspace(0, b.shape[0] - 1, max_frames).astype(np.int32)
        b = b[idx]
    n, m = a.shape[0], b.shape[0]
    prev = np.full(m + 1, np.inf, dtype=np.float32)
    curr = np.full(m + 1, np.inf, dtype=np.float32)
    prev[0] = 0.0
    for i in range(1, n + 1):
        curr[0] = np.inf
        for j in range(1, m + 1):
            cost = float(np.mean(np.abs(a[i - 1] - b[j - 1])))
            curr[j] = cost + min(prev[j], curr[j - 1], prev[j - 1])
        prev, curr = curr, prev
    return float(prev[m] / max(n, m))


def load_template_paths() -> list[Path]:
    directory = project_root() / "models" / "user-keywords"
    if not directory.exists():
        return []
    paths = sorted(directory.glob("sample-*.webm")) + sorted(directory.glob("sample-*.wav"))
    return [path for path in paths if path.is_file()]


def run_template_fallback(input_samples, sample_rate: int, tmp_dir: Path) -> dict:
    threshold = float(os.environ.get("UCA_SHERPA_KWS_TEMPLATE_THRESHOLD", "0.82"))
    input_features = spectral_features(input_samples, sample_rate)
    best = {
        "matched": False,
        "score": None,
        "distance": None,
        "threshold": threshold,
        "template": "",
        "templatesChecked": 0,
    }
    for index, template_path in enumerate(load_template_paths(), start=1):
        try:
            wav_path = tmp_dir / f"template-{index}.wav"
            convert_to_wav(template_path, wav_path)
            tpl_rate, tpl_samples = read_wav_samples(wav_path)
            distance = dtw_distance(input_features, spectral_features(tpl_samples, tpl_rate))
        except Exception:
            continue
        score = 1.0 / (1.0 + distance)
        best["templatesChecked"] += 1
        if best["score"] is None or score > best["score"]:
            best.update({
                "score": round(score, 4),
                "distance": round(distance, 4),
                "template": template_path.name,
            })
    best["matched"] = best["score"] is not None and best["score"] >= threshold
    return best


def run_kws(audio_path: Path, model_dir: Path, keywords: list[str], template_fallback: bool = False) -> dict:
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

        sample_rate, samples = read_wav_samples(wav_path)

        spotter = sherpa_onnx.KeywordSpotter(
            tokens=str(files["tokens"]),
            encoder=str(files["encoder"]),
            decoder=str(files["decoder"]),
            joiner=str(files["joiner"]),
            keywords_file=str(keywords_file),
            num_threads=int(os.environ.get("UCA_SHERPA_KWS_NUM_THREADS", "2")),
            sample_rate=16000,
            feature_dim=80,
            max_active_paths=int(os.environ.get("UCA_SHERPA_KWS_MAX_ACTIVE_PATHS", "6")),
            keywords_score=float(os.environ.get("UCA_SHERPA_KWS_KEYWORDS_SCORE", "2.0")),
            keywords_threshold=float(os.environ.get("UCA_SHERPA_KWS_KEYWORDS_THRESHOLD", "0.15")),
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
        template = None
        if not first and template_fallback:
            template = run_template_fallback(samples, sample_rate, tmp_dir)
            if template.get("matched"):
                first = {
                    "keyword": "linxi-template",
                    "engine": "local-template-fallback",
                    "score": template.get("score"),
                    "template": template.get("template"),
                }
                events.append(first)
        return {
            "ok": True,
            "matched": bool(first),
            "keyword": first.get("keyword", "") if first else "",
            "events": events[:5],
            "template": template,
            "audio_seconds": seconds,
            "provider": {
                "id": "local-sherpa-onnx-kws",
                "kind": "local",
                "name": "Local sherpa-onnx KWS",
                "modelDir": str(model_dir),
            },
        }


def run_server(default_model_dir: Path, default_keywords: list[str]) -> int:
    for line in sys.stdin:
        text = line.strip()
        if not text:
            continue
        request_id = None
        try:
            payload = json.loads(text)
            request_id = payload.get("id")
            apply_kws_profile(bool(payload.get("personalized")))
            request_keywords = payload.get("keywords")
            explicit_keywords = [str(item).strip() for item in request_keywords if str(item).strip()] if isinstance(request_keywords, list) else []
            keywords = explicit_keywords or default_keywords
            model_dir = resolve_model_dir(payload.get("model_dir") or str(default_model_dir))
            result = run_kws(
                Path(str(payload.get("audio_path") or "")).resolve(),
                model_dir,
                keywords,
                template_fallback=bool(payload.get("template_fallback")),
            )
        except Exception as exc:
            result = {
                "ok": False,
                "reason": "kws_exception",
                "message": str(exc),
            }
        if request_id is not None:
            result["id"] = request_id
        print(json.dumps(result, ensure_ascii=True), flush=True)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Detect the Echo wake word with sherpa-onnx KWS.")
    parser.add_argument("audio_path", nargs="?", help="Path to a browser-recorded audio file.")
    parser.add_argument("--model-dir", default="")
    parser.add_argument("--keywords", default="")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--server", action="store_true", help="Run a persistent JSONL KWS sidecar on stdin/stdout.")
    parser.add_argument(
        "--personalized",
        action="store_true",
        help="Use the enrollment-tuned threshold profile after saved samples pass KWS self-check."
    )
    parser.add_argument(
        "--template-fallback",
        action="store_true",
        help="After sherpa no-match, compare the audio against saved user wake samples."
    )
    args = parser.parse_args()

    # Personalized mode overrides env so the spotter is looser. The backend
    # enables this only after enough saved enrollment samples are usable.
    apply_kws_profile(args.personalized)

    model_dir = resolve_model_dir(args.model_dir)
    keywords = parse_keywords(args.keywords)
    if args.server:
        return run_server(model_dir, keywords)
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
        return emit(run_kws(
            Path(args.audio_path).resolve(),
            model_dir,
            keywords,
            template_fallback=args.template_fallback,
        ))
    except Exception as exc:
        return emit({
            "ok": False,
            "reason": "kws_exception",
            "message": str(exc),
        })


if __name__ == "__main__":
    sys.exit(main())
