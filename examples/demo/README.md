# Minimal demo project

A 3-slide "什麼是語音辨識" micro-video, showing the file formats the pipeline expects.

```
demo/
├── narration.json        ← 3 narration entries (one per slide)
├── slides_prompts.json   ← 3 gpt-image-2 prompts + shared style block (Path A)
└── (config.json)         ← copy from ../../references/config-example.json and fill in
```

To actually produce it (from this directory, keys set):

```bash
cp ../../references/config-example.json config.json   # then set tts.voiceId
python ../../scripts/slides_gen.py                    # → slides_raw/slide_01..03.png
# eyeball every PNG, regenerate any with wrong characters
node ../../scripts/pad_and_burn.js pad                # → slides/slide_01..03.png
node ../../scripts/tts_with_asr.js                    # → audio/slide_01..03.mp3 (ASR-gated)
node ../../scripts/assemble.js                        # → video.mp4
node ../../scripts/gen_subtitles.js                   # → subtitles_aligned.srt
node ../../scripts/pad_and_burn.js burn               # → video_sub.mp4
```

Remember the alignment law: narration entries == slide count (here: 3 == 3).
