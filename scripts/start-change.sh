#!/usr/bin/env bash
#
# start-change.sh — begin any change from EXACTLY what is live.
#
# The single rule that prevents "the app reverted and lost features":
# never start editing from an old copy. This script refreshes `production`
# (the live source of truth) and branches off it, every time.
#
# Usage:
#   scripts/start-change.sh fix/credits-badge
#   scripts/start-change.sh feat/content-export
#
# It refuses to run if you have uncommitted *tracked* changes, so nothing
# in progress is ever lost. Untracked files (images, scratch) are left alone.
#
set -euo pipefail

NAME="${1:-}"

if [ -z "$NAME" ]; then
  echo "Usage: scripts/start-change.sh <kind>/<short-name>"
  echo "Example: scripts/start-change.sh fix/login-redirect"
  exit 1
fi

case "$NAME" in
  fix/*|feat/*|chore/*) : ;;
  *)
    echo "Branch name must start with fix/ , feat/ or chore/  (got: $NAME)"
    exit 1
    ;;
esac

# Refuse if there are uncommitted tracked changes (staged or unstaged).
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "You have uncommitted changes to tracked files."
  echo "Commit, stash, or discard them first so nothing is lost, then re-run."
  git status --short
  exit 1
fi

echo "Fetching the latest live state..."
git fetch origin

echo "Switching to production and pulling the live source of truth..."
git checkout production
git pull --ff-only origin production

echo "Creating your working branch from live: $NAME"
git switch -c "$NAME"

echo ""
echo "Ready. You are on '$NAME', branched from the current live app."
echo "Next:"
echo "  1. Make the change."
echo "  2. Commit, push, open a PR into 'production'."
echo "  3. Push to the 'staging' branch (or run the staging workflow) to test"
echo "     at https://staging.datawise.pages.dev"
echo "  4. Merge the PR into 'production'. Production deploys from there."
