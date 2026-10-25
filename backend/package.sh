#!/usr/bin/env bash
# Run manually from any directory. All dependency wheels must support Lambda arm64.
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
package_dir="$(mktemp -d)"
archive_path="$repo_dir/build/create-session.zip"
trap 'rm -rf -- "$package_dir"' EXIT

python3.13 -m pip install \
  --target "$package_dir" \
  --platform manylinux2014_aarch64 \
  --implementation cp \
  --python-version 3.13 \
  --only-binary=:all: \
  -r "$repo_dir/backend/requirements.txt"

# Copy only Lambda sources, never a venv, env files, frontend, or an old build tree.
cp "$repo_dir"/backend/*.py "$package_dir/"
mkdir -p "$repo_dir/build"
rm -f -- "$archive_path"
(cd "$package_dir" && zip -q -r "$archive_path" . -x '*/__pycache__/*' '*.pyc')
