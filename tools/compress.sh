#!/usr/bin/env bash
# Usage: ./tools/compress.sh "recording.mov"
# Two-pass H.264, <=1920x1080, AAC if present, strictly below 95,000,000 bytes.
set -euo pipefail

fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
[[ $# -eq 1 ]] || fail 'Usage: ./tools/compress.sh "/path/to/recording.mov"'
for dependency in ffmpeg ffprobe; do
  if ! command -v "$dependency" >/dev/null 2>&1; then
    fail "$dependency is required. Install FFmpeg (macOS: brew install ffmpeg; Ubuntu: sudo apt install ffmpeg), then rerun this command."
  fi
done

input=$1
[[ -f "$input" && -r "$input" ]] || fail "Cannot read input: $input"
case "$input" in
  *.[mM][oO][vV]|*.[mM][pP]4) ;;
  *) fail 'Input must be a .mov or .mp4 file.' ;;
esac
# Resolve to an absolute path so leading hyphens and spaces remain ordinary filenames.
input_dir=$(cd -- "$(dirname -- "$input")" && pwd -P)
input="$input_dir/$(basename -- "$input")"
output="${input%.*}-compressed.mp4"
[[ ! -e "$output" && ! -L "$output" ]] || fail "Output already exists: $output (rename it first)."

video=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_type -of default=noprint_wrappers=1:nokey=1 "$input")
[[ "$video" == video ]] || fail 'Input has no readable video stream.'
duration=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$input")
awk -v d="$duration" 'BEGIN { exit !(d ~ /^[0-9]+([.][0-9]+)?$/ && d > 0) }' || fail 'Cannot determine a positive video duration.'
audio=$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_type -of default=noprint_wrappers=1:nokey=1 "$input")

limit_bytes=95000000
target_bytes=90000000 # Reserve five decimal MB for muxing and bitrate variation.
audio_bps=0
if [[ "$audio" == audio ]]; then audio_bps=128000; fi
# Bound video bitrate for short clips while budgeting by the complete input duration.
video_bps=$(awk -v d="$duration" -v target="$target_bytes" -v audio="$audio_bps" 'BEGIN { b=int(target*8/d-audio); if(b>12000000)b=12000000; print b }')
[[ "$video_bps" -ge 16000 ]] || fail 'This recording is too long to fit below 95 MB at the minimum video bitrate with the selected audio quality.'

scratch=$(mktemp -d "$input_dir/.compress.XXXXXX")
cleanup() { rm -rf -- "$scratch"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
encoded="$scratch/encoded.mp4"
filter="scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,fps=30"

for attempt in 1 2 3 4; do
  printf 'Compressing (attempt %s): H.264, max 1080p, video %s kb/s…\n' "$attempt" "$((video_bps / 1000))"
  common=(-hide_banner -loglevel error -nostdin -y -i "$input" -map 0:v:0
    -vf "$filter" -c:v libx264 -preset medium -b:v "$video_bps" -pix_fmt yuv420p
    -passlogfile "$scratch/pass" -sn -dn -map_metadata -1 -map_chapters -1)
  # Analyse every frame, then encode the complete video; no file-size truncation.
  ffmpeg "${common[@]}" -pass 1 -an -f null /dev/null
  ffmpeg "${common[@]}" -pass 2 -map '0:a:0?' -c:a aac -b:a 128k -ac 2 \
    -movflags +faststart "$encoded"

  size=$(wc -c < "$encoded" | tr -d '[:space:]')
  if [[ "$size" -gt 0 && "$size" -lt "$limit_bytes" ]]; then
    # A hard link publishes atomically without clobbering a file created mid-encode.
    ln "$encoded" "$output" || fail "Could not create output without overwriting: $output"
    printf 'Saved: %s\n' "$output"
    awk -v bytes="$size" 'BEGIN { printf "Final size: %.2f MB (%d bytes; under 95 MB)\n", bytes/1000000, bytes }'
    exit 0
  fi
  [[ "$size" -gt 0 ]] || fail 'FFmpeg produced an empty output.'
  video_bps=$(awk -v bitrate="$video_bps" -v target="$target_bytes" -v actual="$size" 'BEGIN { print int(bitrate*target/actual*0.85) }')
  [[ "$video_bps" -ge 16000 ]] || fail 'Cannot fit the complete recording under 95 MB at a usable bitrate.'
done
fail 'Could not reach the size cap after four encodes; no oversized output was published.'
