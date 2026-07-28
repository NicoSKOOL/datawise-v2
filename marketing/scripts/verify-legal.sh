#!/usr/bin/env bash
# Build gates for the marketing legal pages + support contact work.
#
# Usage: run from the marketing/ directory of the fix-app-cta-links worktree,
# AFTER `npm run build`:
#
#   npm run build && bash scripts/verify-legal.sh
#
# Exits 0 only if every gate passes. Never deploy on a non-zero exit.

set -uo pipefail

DIST="dist"
FAILED=0

check() {
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then
    printf '  PASS  %s\n' "$label"
  else
    printf '  FAIL  %s\n' "$label"
    FAILED=1
  fi
}

# file pattern min -> true when the file contains at least `min` matches
contains_at_least() {
  local file="$1" pattern="$2" min="$3" n
  [ -f "$file" ] || return 1
  n=$(grep -o -- "$pattern" "$file" | wc -l | tr -d ' ')
  [ "$n" -ge "$min" ]
}

# file pattern -> true when the file exists and does NOT contain the pattern
lacks() {
  local file="$1" pattern="$2"
  [ -f "$file" ] || return 1
  ! grep -q -- "$pattern" "$file"
}

if [ ! -d "$DIST" ]; then
  echo "No dist/ directory. Run 'npm run build' first."
  exit 1
fi

echo
echo "Regression guards (pre-existing, must never break):"
check "GA4 tag present on homepage"      contains_at_least "$DIST/index.html" "googletagmanager" 1
check "CL0 Pages Function shipped"       test -f "$DIST/functions/CL0/[[path]].ts"

echo
echo "New pages built:"
check "privacy page built"               test -f "$DIST/privacy/index.html"
check "terms page built"                 test -f "$DIST/terms/index.html"
check "contact page built"               test -f "$DIST/contact/index.html"

echo
echo "Support email visible sitewide:"
check "email on homepage"                contains_at_least "$DIST/index.html" "support@datawiseseo.com" 1
check "email on pricing page"            contains_at_least "$DIST/pricing/index.html" "support@datawiseseo.com" 1

echo
echo "Legal links present on every page (via footer):"
check "privacy link on homepage"         contains_at_least "$DIST/index.html" 'href="/privacy"' 1
check "terms link on homepage"           contains_at_least "$DIST/index.html" 'href="/terms"' 1
check "contact link on homepage"         contains_at_least "$DIST/index.html" 'href="/contact"' 1
check "refund link on homepage"          contains_at_least "$DIST/index.html" 'href="/terms#refunds"' 1
check "privacy link on pricing page"     contains_at_least "$DIST/pricing/index.html" 'href="/privacy"' 1

echo
echo "Content requirements:"
check "refunds anchor exists in terms"   contains_at_least "$DIST/terms/index.html" 'id="refunds"' 1
check "14-day window stated in terms"    contains_at_least "$DIST/terms/index.html" "14 days" 1
check "2 business days SLA in terms"     contains_at_least "$DIST/terms/index.html" "2 business days" 1
check "Creem named in terms"             contains_at_least "$DIST/terms/index.html" "Creem" 1
check "Creem named in privacy"           contains_at_least "$DIST/privacy/index.html" "Creem" 1
check "entity named in terms"            contains_at_least "$DIST/terms/index.html" "AI Ranking SpA" 1
check "entity named on contact page"     contains_at_least "$DIST/contact/index.html" "AI Ranking SpA" 1

echo
echo "Stale contact address fully replaced:"
check "no old email in privacy"          lacks "$DIST/privacy/index.html" "nico@airankingskool.com"
check "no old email in terms"            lacks "$DIST/terms/index.html" "nico@airankingskool.com"
check "no old email anywhere in dist"    bash -c '! grep -rq "nico@airankingskool.com" dist'

echo
echo "Publicly indexable:"
check "privacy in sitemap"               contains_at_least "$DIST/sitemap-0.xml" "/privacy" 1
check "terms in sitemap"                 contains_at_least "$DIST/sitemap-0.xml" "/terms" 1
check "contact in sitemap"               contains_at_least "$DIST/sitemap-0.xml" "/contact" 1
check "privacy is not noindex"           lacks "$DIST/privacy/index.html" "noindex"
check "terms is not noindex"             lacks "$DIST/terms/index.html" "noindex"
check "contact is not noindex"           lacks "$DIST/contact/index.html" "noindex"

echo
if [ "$FAILED" -ne 0 ]; then
  echo "RESULT: FAIL. Do not deploy."
  exit 1
fi
echo "RESULT: PASS. Safe to deploy."
