#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" == "HEAD" ]]; then
  echo "Gagal: repo sedang detached HEAD. Pindah ke branch dulu."
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Gagal: masih ada perubahan lokal. Commit/push dulu dengan scripts/dorong-github.sh, atau rapikan manual."
  git status --short
  exit 1
fi

git fetch origin

upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
if [[ -z "$upstream" ]]; then
  upstream="origin/${branch}"
fi

if ! git rev-parse --verify "$upstream" >/dev/null 2>&1; then
  echo "Gagal: upstream $upstream belum ada di GitHub."
  exit 1
fi

ahead_behind="$(git rev-list --left-right --count HEAD...$upstream)"
ahead="${ahead_behind%%$'\t'*}"
behind="${ahead_behind##*$'\t'}"

if [[ "$ahead" != "0" && "$behind" != "0" ]]; then
  echo "Gagal: branch lokal dan GitHub bercabang ($ahead commit lokal, $behind commit GitHub). Merge/rebase manual dulu."
  exit 1
fi

if [[ "$behind" != "0" ]]; then
  git merge --ff-only "$upstream"
fi

echo "OK: repo sudah sinkron dengan $upstream di $(git rev-parse --short HEAD)"
