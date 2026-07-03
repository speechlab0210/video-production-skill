"""gpt-image-2 slide generation (hand-drawn teaching style).

Reads slides_prompts.json from the project directory. Two accepted formats:

  1. Array of full prompt strings (one per slide):
     ["<full prompt slide 1>", "<full prompt slide 2>", ...]

  2. Object with a shared style block prepended to every slide prompt:
     { "style": "<shared style text>", "slides": ["<slide 1>", "<slide 2>", ...] }

Usage:
  python slides_gen.py                 # generate all slides
  python slides_gen.py 3 7            # regenerate only slides 3 and 7 (1-based)
  python slides_gen.py --dir my-proj  # project directory (default: cwd)

Output: slides_raw/slide_NN.png (1536x1024). Pad to 1920x1080 afterwards with
`node pad_and_burn.js pad`.

Needs OPENAI_API_KEY (env var, or .env in the project directory).
Tips (learned the hard way):
  - Run at most 4-5 of these in parallel; don't run Whisper at the same time.
  - Visually inspect EVERY output; regenerate single slides on typos/garbled text.
  - moderation_block (HTTP 400): rephrase to neutral objects/abstract imagery and
    drop human figures; same prompt sometimes passes on a plain retry.
"""
import os, sys, base64, json, time, pathlib
from urllib import request

args = [a for a in sys.argv[1:]]
proj = "."
if "--dir" in args:
    i = args.index("--dir"); proj = args[i+1]; args = args[:i] + args[i+2:]
PROJ = pathlib.Path(proj).resolve()

def load_key():
    if os.environ.get("OPENAI_API_KEY"):
        return os.environ["OPENAI_API_KEY"]
    envf = PROJ / ".env"
    if envf.exists():
        for line in envf.read_text(encoding="utf-8").splitlines():
            if line.startswith("OPENAI_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("ERROR: OPENAI_API_KEY not set (env var or .env in project dir)")

API_KEY = load_key()
OUT = PROJ / "slides_raw"; OUT.mkdir(exist_ok=True)

spec = json.loads((PROJ / "slides_prompts.json").read_text(encoding="utf-8"))
if isinstance(spec, dict):
    style = spec.get("style", "")
    prompts = [style + "\n" + s for s in spec["slides"]]
else:
    prompts = list(spec)

def gen(i):  # i is 1-based
    out = OUT / f"slide_{i:02d}.png"; t0 = time.time()
    print(f"[{i}] gen...", flush=True)
    body = json.dumps({"model": "gpt-image-2", "prompt": prompts[i-1],
                       "size": "1536x1024", "quality": "high", "n": 1}).encode()
    req = request.Request("https://api.openai.com/v1/images/generations", data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {API_KEY}"})
    try:
        with request.urlopen(req, timeout=300) as r:
            data = json.loads(r.read())
        out.write_bytes(base64.b64decode(data["data"][0]["b64_json"]))
        print(f"[{i}] -> {out} ({out.stat().st_size//1024}KB) {time.time()-t0:.0f}s", flush=True)
    except request.HTTPError as e:
        print(f"[{i}] FAIL {e.code}: {e.read().decode('utf-8','replace')[:300]}", flush=True)
    except Exception as e:
        print(f"[{i}] FAIL {e}", flush=True)

if __name__ == "__main__":
    ids = [int(x) for x in args] or list(range(1, len(prompts) + 1))
    for i in ids:
        gen(i)
