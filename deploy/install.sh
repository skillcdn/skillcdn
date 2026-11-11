#!/usr/bin/env bash
# Installs the self-hosting bundle on this host (deploy/README.md, "Installing with the script"):
# checks what it needs, writes the settings file with secrets of its own making when there is
# none, and brings the compose bundle up. Run again, it keeps every setting that is there and
# brings the bundle up on what it is told; nothing it writes is ever printed.
#
# Usage: install.sh [options]
#
#   --image REF    the server image; unless said, the image of the release these files are of
#   --build        build the image from this checkout instead, as skillcdn:local
#   --url ORIGIN   the origin people and agents use, such as https://skills.example.com
#   --port PORT    the port of this host the server listens on, on 127.0.0.1 (11188 unless said)
#   --packs DIR    serve the packs of this directory at /local/<owner>/<name>
#   --meaning      the search by meaning: the embedding server beside the bundle
#   --rerank       the reranker as well; implies --meaning
#   --gpu          both on an NVIDIA GPU; implies --rerank
#   --offline      reach nothing outside this host: load the images kept beside this script,
#                  check every file against the bundle's digests, and never pull
#   --no-start     write the settings and stop
#
# It reads no secret from its arguments and takes none: the database password, the admin token
# and the key of the usage statistics are made here, written to .env beside this script with
# the owner alone allowed to read it, and stay there.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
registry_image=ghcr.io/skillcdn/skillcdn

image=""
build=false
url=""
port=""
packs=""
meaning=false
rerank=false
gpu=false
offline=false
start=true

fail() {
  echo "install: $*" >&2
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --image) [ $# -ge 2 ] || fail "--image takes an image reference"; image=$2; shift 2 ;;
    --build) build=true; shift ;;
    --url) [ $# -ge 2 ] || fail "--url takes an origin"; url=$2; shift 2 ;;
    --port) [ $# -ge 2 ] || fail "--port takes a port"; port=$2; shift 2 ;;
    --packs) [ $# -ge 2 ] || fail "--packs takes a directory"; packs=$2; shift 2 ;;
    --meaning) meaning=true; shift ;;
    --rerank) meaning=true; rerank=true; shift ;;
    --gpu) meaning=true; rerank=true; gpu=true; shift ;;
    --offline) offline=true; shift ;;
    --no-start) start=false; shift ;;
    -h | --help) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fail "unknown option: $1 (see --help)" ;;
  esac
done

case "$url" in
  "" | http://* | https://*) ;;
  *) fail "--url is an origin with its scheme, such as https://skills.example.com" ;;
esac
case "$port" in
  "") ;;
  *[!0-9]*) fail "--port is a number" ;;
esac
if $build && [ -n "$image" ]; then
  fail "--build and --image name two different images"
fi
if $build && $offline; then
  fail "--build fetches what the image is built from; an offline installation takes its image from the bundle"
fi

command -v docker >/dev/null 2>&1 || fail "docker is not installed"
docker compose version >/dev/null 2>&1 || fail "the compose plugin of docker is not installed (docker compose version)"
docker info >/dev/null 2>&1 || fail "the docker daemon does not answer; start it, or run this as a user who may use it"

# A value made of 32 random bytes, in hex: long enough for every secret the server reads.
secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

env_file=$here/.env

# The value of a setting in the file, or nothing.
setting() {
  [ -f "$env_file" ] || return 0
  sed -n "s/^$1=//p" "$env_file" | tail -n 1
}

# Writes a setting, in place of the line that set it before.
set_setting() {
  local key=$1 value=$2 rest
  rest=$(mktemp)
  if [ -f "$env_file" ]; then
    grep -v "^$key=" "$env_file" >"$rest" || true
  fi
  printf '%s=%s\n' "$key" "$value" >>"$rest"
  cat "$rest" >"$env_file"
  rm -f "$rest"
}

# The release these files are of: named by the bundle, else read from the checkout.
release=""
if [ -f "$here/VERSION" ]; then
  release=$(sed -n 's/^version=//p' "$here/VERSION")
  [ -n "$image" ] || image=$(sed -n 's/^image=//p' "$here/VERSION")
elif [ -f "$here/../packages/cli/package.json" ]; then
  release=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$here/../packages/cli/package.json" | head -n 1)
fi

if $offline; then
  if [ -f "$here/SHA256SUMS" ]; then
    echo "checking the files of the bundle against its digests"
    (cd "$here" && sha256sum -c --quiet SHA256SUMS) || fail "a file of the bundle is not what the bundle was made with; nothing was installed"
  else
    echo "no SHA256SUMS beside this script: the files are taken as they are" >&2
  fi
  for archive in "$here"/images/*.tar "$here"/images/*.tar.gz; do
    [ -f "$archive" ] || continue
    echo "loading $(basename "$archive")"
    docker load -i "$archive" >/dev/null
  done
fi

if $build; then
  [ -f "$here/Dockerfile" ] && [ -f "$here/../package.json" ] || fail "--build needs the repository these files came from"
  image=skillcdn:local
  echo "building $image"
  docker build -f "$here/Dockerfile" -t "$image" "$here/.."
fi
if [ -z "$image" ]; then
  image=$(setting SKILLCDN_IMAGE)
fi
if [ -z "$image" ]; then
  image=$registry_image:${release:-latest}
fi

# The settings file: made once, readable by its owner alone, and never replaced.
umask 077
if [ ! -f "$env_file" ]; then
  echo "writing $env_file"
  : >"$env_file"
  set_setting POSTGRES_PASSWORD "$(secret)"
  set_setting ADMIN_TOKEN "$(secret)"
  set_setting USAGE_HASH_SECRET "$(secret)"
else
  echo "keeping the settings of $env_file"
  [ -n "$(setting POSTGRES_PASSWORD)" ] || fail "$env_file sets no POSTGRES_PASSWORD; set one, or move the file away to have one made"
fi
chmod 600 "$env_file" 2>/dev/null || true
set_setting SKILLCDN_IMAGE "$image"
[ -z "$url" ] || set_setting PUBLIC_URL "${url%/}"
[ -z "$port" ] || set_setting SKILLCDN_PORT "$port"

files=compose.yaml
if [ -n "$packs" ]; then
  [ -d "$packs" ] || fail "--packs names no directory: $packs"
  set_setting PACKS_PATH "$(cd "$packs" && pwd)"
fi
if [ -n "$(setting PACKS_PATH)" ]; then
  files=$files:compose.packs.yaml
fi
# What was turned on before stays on: the overlays are read back from the settings.
before=$(setting COMPOSE_FILE)
case ":$before:" in *:compose.meaning.yaml:*) meaning=true ;; esac
case ":$before:" in *:compose.rerank.yaml:*) rerank=true ;; esac
case ":$before:" in *:compose.gpu.yaml:*) gpu=true ;; esac
if $meaning; then
  files=$files:compose.meaning.yaml
  models=$(setting MODELS_DIR)
  models=${models:-$here/models}
  if ! ls "$models"/*.gguf >/dev/null 2>&1; then
    if $offline; then
      fail "the search by meaning needs its model files in $models; make the bundle with --models"
    fi
    echo "fetching the model files of the base profile"
    "$here/get-models.sh" "$models" base
  fi
fi
if $rerank; then files=$files:compose.rerank.yaml; fi
if $gpu; then files=$files:compose.gpu.yaml; fi
# Read by compose from this file, so that `docker compose` in this directory means the bundle
# as it was installed, overlays included.
set_setting COMPOSE_PATH_SEPARATOR ":"
set_setting COMPOSE_FILE "$files"

if ! $start; then
  echo "settings written; bring the bundle up with: (cd $here && docker compose up -d)"
  exit 0
fi

cd "$here"
if $offline; then
  docker compose up -d --pull never
else
  docker compose up -d
fi

listening=$(setting SKILLCDN_PORT)
listening=${listening:-11188}
echo "waiting for the server to be ready"
ready=false
for _ in $(seq 1 60); do
  id=$(docker compose ps -q api 2>/dev/null || true)
  if [ -n "$id" ] && [ "$(docker inspect --format '{{.State.Health.Status}}' "$id" 2>/dev/null)" = healthy ]; then
    ready=true
    break
  fi
  sleep 2
done
$ready || fail "the server did not become ready; see: (cd $here && docker compose logs migrate api)"

echo
echo "SkillCDN ${release:+$release }is running at http://127.0.0.1:$listening (image $image)."
[ -z "$(setting PACKS_PATH)" ] || echo "Packs: a directory <owner>/<name> under $(setting PACKS_PATH) is served at /local/<owner>/<name>."
echo "Settings and secrets: $env_file. The admin API takes the ADMIN_TOKEN written there."
echo "Put TLS in front before anything but this host reaches it (deploy/README.md, \"Behind a reverse proxy\")."
