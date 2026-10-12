#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" == "HEAD" ]]; then
  echo "Gagal: repo sedang detached HEAD. Pindah ke branch dulu."
  exit 1
fi

# Jangan pernah dorong rahasia atau data runtime.
if git ls-files | grep -Eq '(^|/)(\.env|\.env\.|node_modules|dist|uploads|storage|\.sqlite|\.db|supabase/\.temp|supabase/\.branches)(/|$)|\.(sqlite|db)$'; then
  echo "Gagal: ada file rahasia/runtime yang sudah tracked git. Bersihkan dulu sebelum push."
  git ls-files | grep -E '(^|/)(\.env|\.env\.|node_modules|dist|uploads|storage|\.sqlite|\.db|supabase/\.temp|supabase/\.branches)(/|$)|\.(sqlite|db)$' || true
  exit 1
fi

git fetch origin

if [[ -n "$(git status --porcelain)" ]]; then
  msg="${1:-Update Balasapp dari Hermes}"
  git add -A
  staged_bad="$(git diff --cached --name-only | grep -E '(^|/)(\.env|\.env\.|node_modules|dist|uploads|storage|\.sqlite|\.db|supabase/\.temp|supabase/\.branches)(/|$)|\.(sqlite|db)$' || true)"
  if [[ -n "$staged_bad" ]]; then
    echo "Gagal: perubahan mengandung file rahasia/runtime:"
    echo "$staged_bad"
    git reset
    exit 1
  fi
  git commit -m "$msg"
fi

# Dorong ke branch yang sedang aktif, bukan memaksa main.
git push -u origin "HEAD:${branch}"

echo "OK: $(git rev-parse --short HEAD) terdorong ke origin/${branch}"
