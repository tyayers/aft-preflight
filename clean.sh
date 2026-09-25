#!/usr/bin/env bash
# ==============================================================================
# clean.sh - Clean & Rebuild Script for AFT-Preflight & Bungee Runtime
# ==============================================================================
#
# DESCRIPTION:
#   This script wipes compiled TypeScript proxy classes from proxies/, removes
#   extracted/generated data YAMLs across data/ (proxies, products, users, kvm,
#   templates, tests, temp), while leaving the data/deployments/ directory intact.
#   It then runs `bun run build.ts` to rebuild a clean index.ts.
#
# USAGE:
#   ./clean.sh                 # Default: Preserves data/deployments/ while cleaning
#                              # extracted YAMLs & compiled proxies, then rebuilds.
#
#   ./clean.sh --clean-deployments # Optional: Also wipes data/deployments/
#
#   ./clean.sh --help          # Displays this documentation.
#
# PREREQUISITES:
#   - Bun runtime installed (`bun` command in PATH)
#
# EXAMPLES:
#   chmod +x clean.sh
#   ./clean.sh
# ==============================================================================

set -e

# Resolve script directory to project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ "$1" == "--help" || "$1" == "-h" ]]; then
  sed -n '2,25p' "$0" | sed 's/^# \?//'
  exit 0
fi

echo "=================================================="
echo "🧹  AFT-Preflight & Bungee Runtime Cleaner & Rebuilder"
echo "=================================================="

# Delegate to clear.ts (which preserves data/deployments/ by default)
bun run clear.ts "$@"

echo ""
echo "✨  Clean and rebuild completed successfully!"
