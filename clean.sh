#!/usr/bin/env bash
# ==============================================================================
# clean.sh - Clean & Rebuild Script for AFT-Preflight & Bungee Runtime
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
echo "🧹  AFT-Preflight & Bungee Runtime Cleaner & Rebuilder"
echo "=================================================="

# Delegate to clear.ts
bun run clear.ts "$@"

echo ""
echo "✨  Clean and rebuild completed successfully!"
