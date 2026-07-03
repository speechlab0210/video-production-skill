"""gpt-image-2 cover / thumbnail generation.

Usage:
  python cover_gen.py "<full cover prompt>"        # prompt on the command line
  python cover_gen.py                              # reads cover_prompt.txt in cwd
  python cover_gen.py --dir my-proj [prompt]       # project directory

Output: cover_raw.png (1536x1024). Then pad — do NOT crop — to 1280x720:

  ffmpeg -y -i cover_raw.png -vf "scale=1080:720,pad=1280:720:100:0:color=white" thumbnail.png

(cropping 3:2 -> 16:9 cuts off the top of your title; white side bars are invisible
on a white cover). Keep the final file <=2MB for YouTube.

Prompt hygiene (same as slides): wrap exact display text in 「」, say 「所有中文字必須
完全正確」, forbid numbers you didn't ask for, and visually inspect the result.
Needs OPENAI_API_KEY (env var, or .env in the project directory).
"""
import os, sys, base64, json, time, pathlib
from urllib import request

args = list(sys.argv[1:])
proj = "."
if "--dir" in args:
    i = args.index("--dir"); proj = args[i+1]; args = args[:i] + args[i+2:]
PROJ = pathlib.Path(proj).resolve()

if args:
    PROMPT = args[0]
else:
    pf = PROJ / "cover_prompt.txt"
    if not pf.exists():
        sys.exit("ERROR: pass the prompt as an argument or create cover_prompt.txt")
    PROMPT = pf.read_text(encoding="utf-8")

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

def gen():
    out = PROJ / "cover_raw.png"; t0 = time.time()
    print("gen cover...", flush=True)
    body = json.dumps({"model": "gpt-image-2", "prompt": PROMPT,
                       "size": "1536x1024", "quality": "high", "n": 1}).encode()
    req = request.Request("https://api.openai.com/v1/images/generations", data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {API_KEY}"})
    with request.urlopen(req, timeout=300) as r:
        data = json.loads(r.read())
    out.write_bytes(base64.b64decode(data["data"][0]["b64_json"]))
    print(f"-> {out} ({out.stat().st_size//1024}KB) {time.time()-t0:.0f}s", flush=True)

if __name__ == "__main__":
    gen()
