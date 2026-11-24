#!/usr/bin/env python3
"""Pre-generate neural pronunciation for every word (and preview sentence).

Requires: pip install edge-tts

  python tools/build-audio.py --data data/words.approx.json --out audio
  python tools/build-audio.py --data data/words.full.json --out audio --force

Output layout (served statically, relative to index.html):
  audio/<LEVEL>/<word>.mp3          word pronunciation
  audio/sent/<LEVEL>/<word>.mp3     example sentence (when sentHtml exists)

Existing files are skipped unless --force is given, so the command is resumable.
"""
import argparse
import asyncio
import html
import json
import random
import re
import sys
import time
from pathlib import Path

try:
    import edge_tts
except ImportError:
    sys.exit("edge-tts is not installed. Run: pip install edge-tts")


def plain(s: str) -> str:
    s = re.sub(r"<br\s*/?>", " ", s or "", flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s)
    return re.sub(r"\s+", " ", s).strip()


RESERVED_NAMES = {"con", "prn", "aux", "nul",
                  *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}


def file_stem(word: str) -> str:
    """Windows cannot create con.mp3/aux.mp3; suffix reserved device names."""
    return word + "_" if word.lower() in RESERVED_NAMES else word


async def synth(text: str, path: Path, voice: str, rate: str, sem: asyncio.Semaphore, stats: dict, force: bool):
    async with sem:
        if path.exists() and not force and path.stat().st_size > 1000:
            stats["skip"] += 1
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        for attempt in range(4):
            try:
                await edge_tts.Communicate(text, voice, rate=rate).save(str(path))
                if path.stat().st_size < 1000:
                    raise RuntimeError("empty audio")
                stats["ok"] += 1
                return
            except Exception as e:  # network hiccups, throttling
                if attempt == 3:
                    stats["fail"].append([text, str(e)])
                    return
                await asyncio.sleep(1.5 * (attempt + 1) + random.random())


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/words.approx.json")
    ap.add_argument("--out", default="audio")
    ap.add_argument("--voice", default="en-US-AriaNeural")
    ap.add_argument("--rate", default="-5%")
    ap.add_argument("--concurrency", type=int, default=6)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--words-only", action="store_true")
    args = ap.parse_args()

    words = json.loads(Path(args.data).read_text(encoding="utf-8"))
    if args.limit:
        words = words[: args.limit]
    out = Path(args.out)
    sem = asyncio.Semaphore(max(1, args.concurrency))
    stats = {"ok": 0, "skip": 0, "fail": []}
    started = time.time()
    total = 0

    async def report():
        done = stats["ok"] + stats["skip"] + len(stats["fail"])
        pct = (done / total * 100) if total else 0
        print(
            f"[{pct:5.1f}%] {done}/{total} ok={stats['ok']} skip={stats['skip']} "
            f"fail={len(stats['fail'])} {time.time()-started:.0f}s",
            flush=True,
        )

    jobs = []
    for w in words:
        word = str(w.get("word", "")).strip().lower()
        grade = str(w.get("grade", "")).strip() or "AA"
        if not word:
            continue
        stem = file_stem(word)
        total += 1
        jobs.append(synth(word, out / grade / f"{stem}.mp3", args.voice, args.rate, sem, stats, args.force))
        if not args.words_only:
            sent = plain(w.get("sentHtml", ""))
            if sent and sent.lower() != word:
                total += 1
                jobs.append(synth(sent, out / "sent" / grade / f"{stem}.mp3", args.voice, args.rate, sem, stats, args.force))

    tasks = [asyncio.create_task(j) for j in jobs]
    for i, t in enumerate(asyncio.as_completed(tasks), 1):
        await t
        if i % 100 == 0 or i == len(tasks):
            await report()

    await report()
    manifest = {
        "voice": args.voice,
        "rate": args.rate,
        "files": stats["ok"] + stats["skip"],
        "failed": stats["fail"],
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": args.data,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    if stats["fail"]:
        print(f"failed: {len(stats['fail'])} (see {out / 'manifest.json'})", flush=True)
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
