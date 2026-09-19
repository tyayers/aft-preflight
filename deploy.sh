#!/usr/bin/env bash
# ==============================================================================
# deploy.sh - Build Bun Linux standalone binary & deploy to Google Cloud Run
# ==============================================================================
set -euo pipefail

# ------------------------------------------------------------------------------
# Default Configuration
# ------------------------------------------------------------------------------
GCLOUD_PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
GCLOUD_REGION="$(gcloud config get-value run/region 2>/dev/null || gcloud config get-value compute/region 2>/dev/null || true)"

SERVICE_NAME="${SERVICE_NAME:-aft-testpilot}"
GOOGLE_CLOUD_PROJECT="${GOOGLE_CLOUD_PROJECT:-${GCLOUD_PROJECT}}"
GOOGLE_CLOUD_LOCATION="${GOOGLE_CLOUD_LOCATION:-${REGION:-${GCLOUD_REGION:-us-central1}}}"
BASE_IMAGE="osonly24"
BINARY_NAME="aft-testpilot"
BUILD_ONLY=false
DEPLOY_ONLY=false

# ------------------------------------------------------------------------------
# Color output helpers
# ------------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
log_succ()  { echo -e "${GREEN}[SUCCESS]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_err()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ------------------------------------------------------------------------------
# Usage / Help
# ------------------------------------------------------------------------------
usage() {
  cat <<EOF
Usage: ./deploy.sh [OPTIONS]

Builds a standalone Bun binary for Linux (bun-linux-x64) and deploys to Google Cloud Run
using the fast '--no-build' and '--base-image=osonly24' strategy.

Options:
  -s, --service <name>      Cloud Run service name (default: ${SERVICE_NAME})
  -p, --project <project>   GCP Project ID (default: ${GOOGLE_CLOUD_PROJECT:-<unset>})
  -r, --region <region>     Cloud Run region (default: ${GOOGLE_CLOUD_LOCATION})
  -b, --build-only          Compile Linux binary only, skip Cloud Run deployment
  -d, --deploy-only         Deploy existing binary only, skip compilation step
  -h, --help                Show this help message

Environment Variables:
  SERVICE_NAME              Cloud Run service name (default: aft-testpilot)
  GOOGLE_CLOUD_PROJECT      GCP Project ID
  GOOGLE_CLOUD_LOCATION     GCP Region/Location (e.g. us-central1)

Examples:
  # Build and deploy with default service name:
  ./deploy.sh

  # Build standalone Linux binary only:
  ./deploy.sh --build-only

  # Build and deploy to specific project and region:
  ./deploy.sh -s aft-testpilot -p my-gcp-project -r us-central1
EOF
  exit 0
}

# ------------------------------------------------------------------------------
# Argument Parsing
# ------------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    -s|--service)
      SERVICE_NAME="$2"
      shift 2
      ;;
    -p|--project)
      GOOGLE_CLOUD_PROJECT="$2"
      shift 2
      ;;
    -r|--region)
      GOOGLE_CLOUD_LOCATION="$2"
      shift 2
      ;;
    -b|--build-only)
      BUILD_ONLY=true
      shift
      ;;
    -d|--deploy-only)
      DEPLOY_ONLY=true
      shift
      ;;
    -h|--help)
      usage
      ;;
    *)
      log_err "Unknown argument: $1"
      usage
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ------------------------------------------------------------------------------
# Step 1: Build Bun Linux Standalone Binary
# ------------------------------------------------------------------------------
if [ "$DEPLOY_ONLY" = false ]; then
  log_info "Verifying Bun installation..."
  if ! command -v bun &>/dev/null; then
    log_err "Bun is not installed or not in PATH. Please install Bun from https://bun.sh"
    exit 1
  fi
  log_succ "Using Bun $(bun --version)"

  log_info "Step 1/2: Compiling Apigee proxies and updating index.ts..."
  bun run build.ts

  log_info "Step 2/2: Compiling Linux standalone binary (${BINARY_NAME}) for target 'bun-linux-x64'..."
  bun build --compile --target=bun-linux-x64 ./index.ts --outfile "$BINARY_NAME"
  chmod +x "$BINARY_NAME"

  if [ -f "$BINARY_NAME" ]; then
    BINARY_SIZE=$(ls -lh "$BINARY_NAME" | awk '{print $5}')
    log_succ "Binary '${BINARY_NAME}' (${BINARY_SIZE}) successfully built for Linux x86_64!"
  else
    log_err "Failed to produce binary '${BINARY_NAME}'"
    exit 1
  fi
else
  log_info "Skipping build step (--deploy-only specified)."
  if [ ! -f "$BINARY_NAME" ]; then
    log_err "Binary '${BINARY_NAME}' does not exist. Run without --deploy-only to build it first."
    exit 1
  fi
fi

# ------------------------------------------------------------------------------
# Step 2: Deploy to Google Cloud Run
# ------------------------------------------------------------------------------
if [ "$BUILD_ONLY" = true ]; then
  log_info "Build complete. Skipping deployment (--build-only specified)."
  exit 0
fi

log_info "Preparing deployment to Cloud Run..."

if ! command -v gcloud &>/dev/null; then
  log_err "'gcloud' CLI is not installed or not found in PATH."
  log_warn "You can deploy manually once gcloud is installed:"
  echo "  gcloud beta run deploy ${SERVICE_NAME} --source . --no-build --base-image=${BASE_IMAGE} --command=./${BINARY_NAME} --project ${GOOGLE_CLOUD_PROJECT:-YOUR_PROJECT} --region ${GOOGLE_CLOUD_LOCATION} --allow-unauthenticated"
  exit 1
fi

if [ -z "$GOOGLE_CLOUD_PROJECT" ]; then
  log_err "GOOGLE_CLOUD_PROJECT is not set and no active gcloud project was found."
  log_warn "Set the project using: export GOOGLE_CLOUD_PROJECT=your-project-id or pass -p <project>"
  exit 1
fi

log_info "Deploying to Cloud Run with configuration:"
echo "  Service Name:  ${SERVICE_NAME}"
echo "  Base Image:    ${BASE_IMAGE}"
echo "  Command:       ./${BINARY_NAME}"
echo "  Project:       ${GOOGLE_CLOUD_PROJECT}"
echo "  Region:        ${GOOGLE_CLOUD_LOCATION}"
echo "  Auth:          --allow-unauthenticated"

log_info "Running gcloud command:"
cat <<CMD
gcloud beta run deploy ${SERVICE_NAME} \\
  --source . \\
  --no-build \\
  --base-image=${BASE_IMAGE} \\
  --command=./${BINARY_NAME} \\
  --project ${GOOGLE_CLOUD_PROJECT} \\
  --region ${GOOGLE_CLOUD_LOCATION} \\
  --allow-unauthenticated
CMD

gcloud beta run deploy "${SERVICE_NAME}" \
  --source . \
  --no-build \
  --base-image="${BASE_IMAGE}" \
  --command="./${BINARY_NAME}" \
  --project "${GOOGLE_CLOUD_PROJECT}" \
  --region "${GOOGLE_CLOUD_LOCATION}" \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=$GOOGLE_CLOUD_PROJECT" \
  --allow-unauthenticated

log_succ "Deployment of ${SERVICE_NAME} completed successfully!"
