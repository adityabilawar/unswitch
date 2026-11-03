#!/bin/zsh
set -euo pipefail

SOURCE_DIR="${0:A:h}"
OUT_DIR="${SOURCE_DIR:h}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
STUDIO_URL="file://${SOURCE_DIR}/studio.html"
render() {
  local asset="$1"
  local size="$2"
  local output="$3"
  local render_profile
  local chrome_pid
  local attempts=0
  render_profile="$(mktemp -d)"
  "$CHROME" --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
    --run-all-compositor-stages-before-draw --virtual-time-budget=1000 \
    --force-device-scale-factor=1 --user-data-dir="$render_profile" --window-size="$size" \
    --screenshot="$output.tmp.png" "${STUDIO_URL}?asset=${asset}" >/dev/null 2>&1 &
  chrome_pid=$!
  while [[ ! -s "$output.tmp.png" && $attempts -lt 120 ]]; do
    sleep 0.1
    attempts=$((attempts + 1))
  done
  kill "$chrome_pid" >/dev/null 2>&1 || true
  wait "$chrome_pid" >/dev/null 2>&1 || true
  if [[ ! -s "$output.tmp.png" ]]; then
    echo "Chrome did not render ${asset}" >&2
    exit 1
  fi
  ffmpeg -loglevel error -y -i "$output.tmp.png" -pix_fmt rgb24 "$output"
  rm "$output.tmp.png"
  rm -rf "$render_profile"
}

mkdir -p "$OUT_DIR/video-frames"
render icon 512,512 "$OUT_DIR/store-icon-512.png"
ffmpeg -loglevel error -y -i "$OUT_DIR/store-icon-512.png" -vf scale=128:128:flags=lanczos -pix_fmt rgb24 "$OUT_DIR/store-icon-128.png"
render small 440,280 "$OUT_DIR/small-promo-tile-440x280.png"
render marquee 1400,560 "$OUT_DIR/marquee-promo-tile-1400x560.png"

for n in 1 2 3 4 5; do
  render "screen${n}" 1280,800 "$OUT_DIR/screenshot-${n}-1280x800.png"
  render "screen${n}" 1920,1080 "$OUT_DIR/video-frames/frame-${n}.png"
done

render marquee 1280,720 "$OUT_DIR/video-thumbnail-1280x720.png"

ffmpeg -loglevel error -y \
  -loop 1 -t 3 -i "$OUT_DIR/video-frames/frame-1.png" \
  -loop 1 -t 3 -i "$OUT_DIR/video-frames/frame-2.png" \
  -loop 1 -t 3 -i "$OUT_DIR/video-frames/frame-3.png" \
  -loop 1 -t 3 -i "$OUT_DIR/video-frames/frame-4.png" \
  -loop 1 -t 3 -i "$OUT_DIR/video-frames/frame-5.png" \
  -filter_complex "[0:v]scale=1920:1080,setsar=1,fps=30,fade=t=out:st=2.8:d=0.2,setpts=PTS-STARTPTS[v0];[1:v]scale=1920:1080,setsar=1,fps=30,fade=t=in:st=0:d=0.2,fade=t=out:st=2.8:d=0.2,setpts=PTS-STARTPTS[v1];[2:v]scale=1920:1080,setsar=1,fps=30,fade=t=in:st=0:d=0.2,fade=t=out:st=2.8:d=0.2,setpts=PTS-STARTPTS[v2];[3:v]scale=1920:1080,setsar=1,fps=30,fade=t=in:st=0:d=0.2,fade=t=out:st=2.8:d=0.2,setpts=PTS-STARTPTS[v3];[4:v]scale=1920:1080,setsar=1,fps=30,fade=t=in:st=0:d=0.2,setpts=PTS-STARTPTS[v4];[v0][v1][v2][v3][v4]concat=n=5:v=1:a=0[v]" \
  -map "[v]" -an -t 15 -r 30 -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -movflags +faststart "$OUT_DIR/tab-lock-promo-15s-1080p.mp4"

cat > "$OUT_DIR/VIDEO_UPLOAD.md" <<'EOF'
# Tab Lock global promo video

Upload `tab-lock-promo-15s-1080p.mp4` to YouTube, then paste the resulting public or unlisted YouTube URL into the Chrome Web Store **Global promo video** field.

Suggested title: **Tab Lock – One tab. One focus.**

Suggested description: **Tab Lock helps you stay with the task using deliberate tab protection, allowed-tab groups, an optional Pomodoro cycle, and a short breathing pause—all stored locally in Chrome.**

Suggested accessibility caption / voiceover:

> Lock the tab. Keep the intention. Allow the references you need, focus in structured sessions, take real breaks, and interrupt distraction before it takes over. Tab Lock. One tab. One focus.

The supplied video is intentionally silent so it works globally without language-dependent audio. Add the caption above in YouTube Studio if desired.
EOF

echo "Rendered assets to $OUT_DIR"
