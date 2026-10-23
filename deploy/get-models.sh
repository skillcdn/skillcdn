#!/usr/bin/env bash
# Fetches the model files of a profile (deploy/README.md, "The inference server and the model
# profiles") into deploy/models, or into the directory given, and checks each against the digest
# of the file as published, pinned here. Usage: get-models.sh [directory] [profile...]
#
#   base          Qwen3-Embedding-0.6B and Qwen3-Reranker-0.6B in eight bits: the default
#   quality       Qwen3-Reranker-4B in eight bits, run beside the base embedder (ADR-0067)
#   quality-4bit  the same reranker in four bits, for a GPU the embedder shares
#   cpu-reranker  bge-reranker-v2-m3 in eight bits, the reranker for CPUs alone
#   kure          KURE-v1 in eight bits, the alternative embedder: a community conversion of the
#                 official weights (nlpai-lab/KURE-v1), which a current llama.cpp converts as well
#
# For an installation without internet, run it where there is one and copy the directory over;
# `sha256sum -c` with the digests below checks the copy.
set -euo pipefail

known="base quality quality-4bit cpu-reranker kure"
dir=$(dirname "$0")/models
if [ $# -gt 0 ] && [[ " $known " != *" $1 "* ]]; then
  dir=$1
  shift
fi
if [ $# -eq 0 ]; then
  profiles=(base)
else
  profiles=("$@")
fi
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

for profile in "${profiles[@]}"; do
  case $profile in
    base)
      fetch https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF/resolve/main/Qwen3-Embedding-0.6B-Q8_0.gguf \
        Qwen3-Embedding-0.6B-Q8_0.gguf 06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439
      fetch https://huggingface.co/ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF/resolve/main/qwen3-reranker-0.6b-q8_0.gguf \
        qwen3-reranker-0.6b-q8_0.gguf 22c9979ce4fbcdc5acdc310c6641c32797eff1aa980b8f7a2db8a8ea23429a48
      ;;
    quality)
      fetch https://huggingface.co/giladgd/Qwen3-Reranker-4B-GGUF/resolve/main/Qwen3-Reranker-4B.Q8_0.gguf \
        Qwen3-Reranker-4B.Q8_0.gguf d060a1bfb805debcd6c2258c70ba21c56ee1ea837bc23b0bc49e09d13115987c
      ;;
    quality-4bit)
      fetch https://huggingface.co/giladgd/Qwen3-Reranker-4B-GGUF/resolve/main/Qwen3-Reranker-4B.Q4_K_M.gguf \
        Qwen3-Reranker-4B.Q4_K_M.gguf 941f7d1d1524251c026a797b803ac9575545c5d7aa19b26e0e49661d7720af49
      ;;
    cpu-reranker)
      fetch https://huggingface.co/gpustack/bge-reranker-v2-m3-GGUF/resolve/main/bge-reranker-v2-m3-Q8_0.gguf \
        bge-reranker-v2-m3-Q8_0.gguf a43c7c9b11a4c1517e5bf95151960e1621d1b72f7a493364b01e386cf1aaa1d3
      ;;
    kure)
      fetch https://huggingface.co/Bingsu/KURE-v1-Q8_0-GGUF/resolve/main/kure-v1-q8_0.gguf \
        kure-v1-q8_0.gguf 9157aeb8fccd81c3600daa2642f9e0a6fba613fa78467556b5425f32a57bf938
      ;;
    *)
      echo "unknown profile $profile; one of: $known" >&2
      exit 64
      ;;
  esac
done

echo "the model files are in $dir"
