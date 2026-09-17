# aft-testpilot

> **Note**: This project is in **early beta**. Features, configurations, and internal APIs are subject to change.

`aft-testpilot` is a local execution and testing runtime for [Apigee Flow Templates (AFT)](https://github.com/gcp-samples/apigee-template-repository) and Apigee API proxies, powered by [Bun](https://bun.sh).

It compiles declarative AFT templates, features, and proxy definitions into native TypeScript handlers, allowing developers to simulate, test, and debug Apigee proxies locally without deploying to a live Apigee environment.

---

## Features

- **Local Proxy Execution**: Compiles Apigee Flow Templates and proxy YAMLs into native Bun HTTP route handlers.
- **Policy Support**: Built-in implementations for common Apigee policies, including `AssignMessage`, `VerifyAPIKey`, `KeyValueMapOperations`, `ServiceCallout`, `OASValidation`, `RaiseFault`, and `DataCapture`.
- **Trace & Debugging**: Detailed transaction tracing available in raw format, Apigee trace format, and OpenTelemetry (OTel) format via `/api/traces`.
- **Data & Deployment Management**: Supports multi-resource deployments containing proxies, templates, products, developer apps, users, and KVM entries.
- **REST Management API**: Endpoints to dynamically deploy templates, inspect data, query traces, and trigger proxy rebuilds.
- **Cloud Run Deployment**: Compile to standalone Linux binaries and deploy to Google Cloud Run using containerless fast deploys.

---

## Prerequisites

- [Bun](https://bun.sh) (v1.0 or later)
- (Optional) [Google Cloud SDK](https://cloud.google.com/sdk) (`gcloud`) for Cloud Run deployments

---

## Directory Structure

```text
├── data/
│   ├── deployments/   # Multi-resource deployment YAML files
│   ├── kvm/           # Key-Value Map configurations
│   ├── products/      # API Product definitions (quotas, operations)
│   ├── proxies/       # Standalone proxy definitions
│   ├── templates/     # AFT template definitions
│   ├── tests/         # Proxy test suites and assertions
│   └── users/         # Developer identities, apps, and credentials
├── lib/               # Runtime engine, policy implementations, and managers
├── proxies/           # Generated TypeScript handlers (built by build.ts)
├── build.ts           # Code generation script to compile YAMLs into route handlers
├── clear.ts / clean.sh# Cleanup and reset utilities
└── index.ts           # HTTP server and management API entry point
```

---

## Getting Started

### 1. Install Dependencies

```bash
bun install
```

### 2. Build Proxies

Compile templates and deployment definitions from `data/` into TypeScript proxy routes:

```bash
bun run build.ts
```

This generates route files in the `proxies/` directory and registers them in `index.ts`.

### 3. Run Locally

Start the runtime server (defaults to port `8080`, or configure via `PORT`):

```bash
bun run index.ts
```

For live reloading during development:

```bash
bun --watch index.ts
```

---

## Usage

### Invoking Proxy Endpoints

Once running, proxy endpoints are exposed based on their configured basepaths. For example:

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{"model": "gemini", "messages": [{"role": "user", "content": "Hello"}]}'
```

### Management API

`aft-testpilot` provides management endpoints on the same port:

| Endpoint | Method | Description |
| --- | --- | --- |
| `/rebuild` | `POST` | Re-runs `build.ts` and reloads runtime data |
| `/api/data` | `GET` | Summary of loaded templates, proxies, products, users, and KVMs |
| `/api/deployments` | `GET` / `POST` | Inspect deployment status or submit a deployment manifest |
| `/api/templates` | `GET` / `POST` | List templates or create/update a template |
| `/api/traces` | `GET` / `DELETE` | View recent request traces or clear trace history |
| `/api/traces/:id` | `GET` | Inspect trace details (`?format=apigee` or `?format=otel`) |
| `/api/products` | `GET` | List configured API products |
| `/api/users` | `GET` | List configured users and developer apps |
| `/api/kvm` | `GET` | View global Key-Value Map data |

### Cleaning and Resetting

To remove generated proxy files and wipe data directories:

```bash
# Full wipe of generated proxies and data YAMLs, then rebuild
./clean.sh

# Wipe generated proxies and extracted data, but keep data/deployments/
./clean.sh --keep-deployments
```

Alternatively, run the Bun script directly:

```bash
bun run clear.ts
bun run clear.ts --keep-deployments
```

---

## Compilation & Deployment

### Standalone Binary Compilation

To compile into a standalone binary:

```bash
bun build --compile ./index.ts --outfile aft-testpilot
```

### Deploying to Google Cloud Run

Use the provided `build.sh` script to compile a Linux binary and deploy directly to Cloud Run:

```bash
# Build standalone Linux binary only
./build.sh --build-only

# Build and deploy to Google Cloud Run
export GOOGLE_CLOUD_PROJECT="your-project-id"
export GOOGLE_CLOUD_LOCATION="us-central1"
./build.sh -s aft-testpilot
```
