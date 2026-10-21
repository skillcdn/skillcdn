#!/usr/bin/env bash
# Fetches the model files of the base profile (deploy/README.md, "The inference server and the
# model profiles") into deploy/models, or into the directory given, and checks each against the
# digest its publisher states. For an installation without internet, run it where there is one
# and copy the directory over; `sha256sum -c` with the digests below checks the copy.
set -euo pipefail

dir=${1:-$(dirname "$0")/models}
mkdir -p "$dir"

fetch() {
  local url=$1 file=$2 sha=$3
  if [ -f "$dir/$file" ] && echo "$sha  $dir/$file" | sha256sum -c --status; then
    echo "have $file"
    return
  fi
  echo "fetching $file"
  curl -fL --retry 3 -o "$dir/$file.part" "$url"
  if ! echo "$sha  $dir/$file.part" | sha256sum -c --status; then
    echo "$file: the digest does not match; the file was removed" >&2
    rm -f "$dir/$file.part"
    exit 1
  fi
  mv "$dir/$file.part" "$dir/$file"
}

fetch https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF/resolve/main/Qwen3-Embedding-0.6B-Q8_0.gguf \
  Qwen3-Embedding-0.6B-Q8_0.gguf 06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439
fetch https://huggingface.co/ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF/resolve/main/qwen3-reranker-0.6b-q8_0.gguf \
  qwen3-reranker-0.6b-q8_0.gguf 22c9979ce4fbcdc5acdc310c6641c32797eff1aa980b8f7a2db8a8ea23429a48

echo "the model files are in $dir"
