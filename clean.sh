#!/usr/bin/env bash
# ==============================================================================
# clean.sh - Clean & Rebuild Script for AFT-Testpilot
# ==============================================================================
#
# DESCRIPTION:
#   This script wipes compiled TypeScript proxy classes from proxies/, removes
#   ALL YAML files across data/ (including deployments, proxies, products, users,
#   kvm, and templates), and runs `bun run build.ts` to rebuild a fresh, clean index.ts.
#
# USAGE:
#   ./clean.sh                 # Default: Full wipe of ALL data YAMLs (including deployments)
#                              # and compiled proxies, followed by rebuilding a clean index.ts.
#
#   ./clean.sh --keep-deployments  # Preserves data/deployments/ while cleaning extracted
#                                  # YAMLs & compiled proxies, then rebuilds from deployments.
#
#   ./clean.sh --help          # Displays this documentation.
#
# PREREQUISITES:
#   - Bun runtime installed (`bun` command in PATH)
#
# EXAMPLES:
#   chmod +x clean.sh
#   ./clean.sh
#   ./clean.sh --keep-deployments
# ==============================================================================

set -e

# Resolve script directory to project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ "$1" == "--help" || "$1" == "-h" ]]; then
  sed -n '2,24p' "$0" | sed 's/^# \?//'
  exit 0
fi

KEEP_DEPLOYMENTS=false
if [[ "$1" == "--keep-deployments" || "$1" == "--preserve-deployments" || "$1" == "-k" ]]; then
  KEEP_DEPLOYMENTS=true
fi

echo "=================================================="
echo "🧹  AFT-Testpilot Cleaner & Rebuilder"
echo "=================================================="

# 1. Clean proxies directory (*.ts, *.js)
if [ -d "proxies" ]; then
  echo "🗑️  Cleaning compiled proxies in proxies/..."
  rm -f proxies/*.ts proxies/*.js 2>/dev/null || true
fi

# 2. Clean extracted data YAML files
echo "🗑️  Cleaning extracted YAMLs in data/..."
rm -f data/proxies/*.yaml data/proxies/*.yml 2>/dev/null || true
rm -f data/products/*.yaml data/products/*.yml 2>/dev/null || true
rm -f data/users/*.yaml data/users/*.yml 2>/dev/null || true
rm -f data/kvm/*.yaml data/kvm/*.yml data/kvm/*.json 2>/dev/null || true
rm -f data/templates/*.yaml data/templates/*.yml 2>/dev/null || true
rm -f data/tests/*.yaml data/tests/*.yml 2>/dev/null || true

# 3. Clean deployments (default behavior: wipe all deployments unless --keep-deployments is set)
if [ "$KEEP_DEPLOYMENTS" = false ]; then
  echo "🗑️  Cleaning data/deployments/ (default: --all)..."
  rm -f data/deployments/*.yaml data/deployments/*.yml 2>/dev/null || true
else
  echo "📦  Preserving data/deployments/ (--keep-deployments set)..."
fi

# 4. Run build.ts to generate clean index.ts
echo ""
echo "🚀  Rebuilding clean index.ts via bun run build.ts..."
echo "=================================================="
bun run build.ts

echo ""
echo "✨  Clean and rebuild completed successfully!"
