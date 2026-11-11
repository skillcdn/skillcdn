#!/usr/bin/env bash
# Makes the bundle an installation without internet is made from (deploy/README.md, "An
# installation without internet"): run where there is internet, it puts the images, these files
# and, when asked, the model files of the search by meaning into one directory, with the digest
# of every file. Carry the directory over, and run its install.sh with --offline.
#
# Usage: bundle.sh [options] [directory]
#
#   --image REF       the server image to take along; unless said, the image of the release
#                     this checkout is of. An image this host built (skillcdn:local) is taken
#                     as it is, with --no-pull
#   --platform P      the platform of the installation, linux/amd64 or linux/arm64; unless
#                     said, this machine's
#   --models "P..."   the model files of these profiles of get-models.sh (base, quality,
#                     quality-4bit, cpu-reranker, kure), and the image of the inference server
#   --gpu             the inference server's image for NVIDIA GPUs instead
#   --no-pull         take the images this host has, and fetch none
#
# The directory is ./skillcdn-bundle unless named. Nothing of an installation's own goes into a
# bundle: no settings, no secret, no pack.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
registry_image=ghcr.io/skillcdn/skillcdn
database_image=pgvector/pgvector:pg18

image=""
platform=""
models=""
gpu=false
pull=true
out=""

fail() {
  echo "bundle: $*" >&2
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --image) [ $# -ge 2 ] || fail "--image takes an image reference"; image=$2; shift 2 ;;
    --platform) [ $# -ge 2 ] || fail "--platform takes a platform"; platform=$2; shift 2 ;;
    --models) [ $# -ge 2 ] || fail "--models takes the profiles, in one argument"; models=$2; shift 2 ;;
    --gpu) gpu=true; shift ;;
    --no-pull) pull=false; shift ;;
    -h | --help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) fail "unknown option: $1 (see --help)" ;;
    *) [ -z "$out" ] || fail "one directory, not two: $1"; out=$1; shift ;;
  esac
done

command -v docker >/dev/null 2>&1 || fail "docker is not installed"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is not installed"
[ -f "$here/../packages/cli/package.json" ] || fail "run this from the repository: the release is read from it"

release=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$here/../packages/cli/package.json" | head -n 1)
[ -n "$release" ] || fail "the release of this checkout could not be read"
image=${image:-$registry_image:$release}
out=${out:-skillcdn-bundle}
[ ! -e "$out" ] || fail "$out is there already; name another directory, or remove it"

inference_image=""
if [ -n "$models" ] || $gpu; then
  if $gpu; then
    inference_image=ghcr.io/ggml-org/llama.cpp:server-cuda
  else
    inference_image=ghcr.io/ggml-org/llama.cpp:server
  fi
fi

mkdir -p "$out/images" "$out/models"
out=$(cd "$out" && pwd)

# These files, as the installation runs them. The settings file is the installation's own.
for file in compose.yaml compose.packs.yaml compose.meaning.yaml compose.rerank.yaml compose.gpu.yaml install.sh get-models.sh README.md; do
  cp "$here/$file" "$out/$file"
done
cp "$here/../.env.example" "$out/.env.example"
cp "$here/../LICENSE.md" "$here/../THIRD-PARTY-NOTICES.md" "$here/../TRADEMARKS.md" "$out/"
chmod +x "$out/install.sh" "$out/get-models.sh"

images="$image $database_image $inference_image"
for ref in $images; do
  if $pull; then
    echo "pulling $ref"
    docker pull ${platform:+--platform "$platform"} "$ref" >/dev/null
  else
    docker image inspect "$ref" >/dev/null 2>&1 || fail "this host has no image $ref, and --no-pull fetches none"
  fi
done

echo "saving the images"
# shellcheck disable=SC2086
docker save $images | gzip >"$out/images/images.tar.gz"

# What was taken along, by the digest a registry knows it under where it has one.
{
  echo "version=$release"
  echo "image=$image"
  for ref in $images; do
    echo "# $ref $(docker image inspect --format '{{.Id}} {{join .RepoDigests " "}}' "$ref")"
  done
} >"$out/VERSION"

if [ -n "$models" ]; then
  # shellcheck disable=SC2086
  "$here/get-models.sh" "$out/models" $models
fi

echo "writing the digests"
(cd "$out" && find . -type f ! -name SHA256SUMS | LC_ALL=C sort | while IFS= read -r file; do sha256sum "$file"; done >SHA256SUMS)

echo
echo "The bundle is in $out ($(du -sh "$out" | cut -f1))."
echo "Carry the directory to the installation and run: ./install.sh --offline [--packs DIR]${models:+ --meaning}"
