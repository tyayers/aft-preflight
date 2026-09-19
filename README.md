# AFT PREFLIGHT & BUNGEE RUNTIME

> **Note**: This project is in **beta**. Features, configurations, and internal APIs are actively evolving.

**BUNGEE RUNTIME** is a high-performance local execution and testing engine for [Apigee Flow Templates (AFT)](https://github.com/gcp-samples/apigee-template-repository) and Apigee API proxies, powered by [Bun](https://bun.sh).

**AFT PREFLIGHT** is the built-in developer client application—a zero-dependency Single-Page Application (SPA) providing a visual proxy configuration explorer, API product inspector, interactive test console with SSE chunk streaming, and deep execution tracing.

Together, they allow developers to simulate, test, debug, and profile Apigee API proxies locally without needing to deploy to a live Google Cloud Apigee environment.

---

## How Bungee Runtime Works

Bungee Runtime uses an Ahead-Of-Time (AOT) code generation architecture that compiles declarative Apigee proxy YAMLs into native Bun TypeScript classes:

```
┌──────────────────────────────────────┐
│  Declarative Apigee YAMLs           │
│  - data/proxies/*.yaml               │
│  - data/deployments/*.yaml           │
│  - data/templates/*.yaml             │
│  - data/products/ & data/users/      │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│  Code Generator (build.ts)           │
│  - Translates PreFlow, Flows, Target │
│  - Compiles JS Policies & Conditions │
│  - Generates typed proxy classes     │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│  Generated TypeScript Proxy Classes │
│  - proxies/<ProxyName>.ts            │
│  - Mounted in index.ts HTTP server   │
└──────────────────┬───────────────────┘
                   │
                   ▼
┌──────────────────────────────────────┐
│  BUNGEE PROXY RUNTIME (index.ts)     │
│  - In-memory ApigeeContext pipeline  │
│  - Policy execution & fault rules    │
│  - Target routing & SSE streaming    │
│  - Tracing & Profiling engine        │
└───────────┬──────────────────────┬───┘
            │                      │
            ▼                      ▼
┌───────────────────────┐  ┌───────────────────────┐
│  AFT PREFLIGHT Client │  │  Automated Tests      │
│  - Visual Explorer    │  │  - bun test           │
│  - Interactive Tester │  │  - Deployment Tests   │
│  - Live Tracing Graph │  │  - Policy Unit Tests  │
└───────────────────────┘  └───────────────────────┘
```

### 1. Declarative YAML Ingestion
Apigee proxy bundles and AFT deployments define API behavior declaratively:
- **Proxy Endpoints**: BasePaths, HTTP method matching, path suffix rules, and fault rules.
- **Flow Pipeline**: Sequential `PreFlow`, conditional `Flows` (evaluated via Apigee condition syntax), and `PostFlow` steps.
- **Policies**: Declarations for `VerifyAPIKey`, `KeyValueMapOperations` (KVM), `AssignMessage`, `ServiceCallout`, `DataCapture`, `RaiseFault`, `OASValidation`, and `Javascript` (including helper scripts like `ai-functions.js`).
- **Upstream Targets**: Route rules directing traffic to backend targets with target flow policies and dynamic endpoint URLs.

### 2. Bun TypeScript Code Generation (`build.ts`)
Running `bun run build.ts` executes the compiler:
- **Class Synthesis**: Generates a dedicated TypeScript class for each proxy (e.g., `proxies/REST-AI-Completions.ts`) implementing the `ApigeeProxy` contract.
- **Condition Optimization**: Converts Apigee condition strings (such as `(request.verb = "POST") and (proxy.pathsuffix MatchesPath "/chat/completions")`) into high-speed native TypeScript evaluation logic via `ConditionEvaluator`.
- **JavaScript Policy Inlining**: Extracts inline JavaScript policies, resolves `IncludeURL` scripts, binds legacy context variables (`context.getVariable()`, `context.setVariable()`) into strongly typed runtime calls, and sanitizes debug output.
- **Step Sequences**: Maps flow steps directly to async method invocations, automatically recording execution timings and state snapshots.
- **Registry Generation**: Generates `index.ts` which imports all compiled proxy classes and mounts them to their basepath routes on the native Bun HTTP server.

### 3. Execution in the Bungee Proxy Runtime
When an HTTP request arrives at Bungee Runtime:
1. **Context Initialization**: Creates an `ApigeeContext`, `ApigeeRequest`, and `ApigeeResponse` mimicking the Apigee message processor pipeline.
2. **Security & Authentication**: Authenticates API keys (`VerifyAPIKey`) against products and developer apps loaded in memory from `data/products/` and `data/users/`.
3. **Execution Waterfall**:
   - **Endpoint PreFlow**: Executes request-phase policies.
   - **Conditional Flows**: Evaluates condition rules and executes matching flow steps.
   - **Route Rules & Target Calling**: Resolves the upstream target, executes target PreFlow policies, forwards headers (sanitizing hop-by-hop headers), and dispatches the HTTP request.
   - **Streaming & SSE**: For streaming endpoints (such as LLM Server-Sent Events), chunks are streamed in real time to the client while Bungee's tracer buffers the stream chunks to assemble the full response body without corrupting data.
   - **Target PostFlow & Endpoint PostFlow**: Processes response transformation, data capture, and analytics calculations.
4. **Fault Handling**: Any policy fault or network error triggers `FaultRules`, invoking custom fault policies (e.g., `AM-Unauthorized`, `AM-RateLimitExceeded`) and formatting RFC 7807 problem details or custom error payloads.
5. **Tracing & Profiling**: Captures step durations, variable deltas, request/response headers, and payloads, exportable in Apigee Trace/Debug format or OpenTelemetry (OTel) ResourceSpans.

### 4. Testing with AFT Preflight and Bun Test
- **AFT Preflight Web Console**: Developers open `http://localhost:8080/` to visually inspect endpoints, examine policy flow chains, view complete available proxy URLs, send live requests, inspect streaming SSE output, and review traces.
- **Automated Native Tests**: Developers run `bun test` to execute end-to-end proxy tests, policy assertions, and tests defined inside deployment YAML manifests in milliseconds.

---

## Features

- **Local Proxy Simulation**: Compiles Apigee Flow Templates and proxy YAMLs into native Bun HTTP route handlers.
- **AFT Preflight Client**: Built-in, zero-dependency browser explorer and test console.
- **Policy Support**: Built-in implementations for Apigee policies:
  - `AssignMessage` (headers, query params, form params, payload templates)
  - `VerifyAPIKey` (API product binding, developer apps, credential validation)
  - `KeyValueMapOperations` (encrypted and unencrypted KVM lookups and mutations)
  - `ServiceCallout` (synchronous external HTTP calls within flow execution)
  - `DataCapture` (metric extraction and analytics capture)
  - `RaiseFault` (custom fault rules and error response flows)
  - `OASValidation` (OpenAPI specification validation)
  - `Javascript` (Rhino/Nashorn compatible script execution with helper library inclusions)
- **Tracing & Debugging**: Detailed transaction tracing available in:
  - Raw Bungee JSON
  - Apigee Trace/Debug format (compatible with Apigee cloud trace exports)
  - OpenTelemetry (OTel) ResourceSpans format
- **Data & Deployment Management**: Supports multi-resource deployments containing proxies, templates, products, developer apps, users, and KVM entries.
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
├── lib/               # Bungee Runtime engine, policies, and tracing
├── proxies/           # Generated Bun TypeScript proxy classes (built by build.ts)
├── public/            # AFT Preflight client app (SPA delivered at /)
├── build.ts           # Code generation compiler: YAML -> TypeScript classes
├── clear.ts / clean.sh# Cleanup and reset utilities
└── index.ts           # Bungee Runtime HTTP server and management API
```

---

## Getting Started

### 1. Install Dependencies

```bash
bun install
```

### 2. Compile Proxies

Compile templates and proxy definitions from `data/` into native TypeScript classes:

```bash
bun run build.ts
```

This compiles each proxy in `data/proxies/` into `proxies/<ProxyName>.ts` and registers all routes in `index.ts`.

### 3. Start Bungee Runtime

Start the runtime server (defaults to port `8080`, or configure via `PORT`):

```bash
bun run index.ts
```

For live reloading during development:

```bash
bun --watch index.ts
```

Open `http://localhost:8080/` in your browser to launch the **AFT PREFLIGHT** client.

---

## Usage

### 1. Testing via AFT Preflight (Browser)

Navigate to `http://localhost:8080/` to access **AFT Preflight**:
- **Visual Overview**: Inspect basepaths, routing rules, upstream targets, and policy execution order.
- **Available URLs**: View all complete URLs available from each proxy (combining host and endpoint paths) with one-click copy and console loading.
- **Test Console**: Send requests with pre-filled headers and payloads, with real-time SSE chunk streaming into the response window.
- **Traces**: Step-by-step waterfall execution timelines, context variable snapshots, and export in Apigee Trace or OpenTelemetry formats.

### 2. Invoking Endpoints via CLI / cURL

Once running, proxy endpoints are exposed on their configured basepaths. For example:

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{"model": "gemini", "messages": [{"role": "user", "content": "Hello"}]}'
```

### 3. Running Automated Tests

Run the full Bungee test suite:

```bash
bun test
```

### 4. Management API

Bungee Runtime provides built-in management endpoints on the same port:

| Endpoint | Method | Description |
| --- | --- | --- |
| `/` | `GET` | Serves the AFT Preflight client application |
| `/rebuild` | `POST` | Re-runs `build.ts` and reloads runtime data |
| `/api/data` | `GET` | Summary of loaded templates, proxies, products, users, and KVMs |
| `/api/deployments` | `GET` / `POST` | Inspect deployment status or submit a deployment manifest |
| `/api/templates` | `GET` / `POST` | List templates or create/update a template |
| `/api/traces` | `GET` / `DELETE` | View recent request traces or clear trace history |
| `/api/traces/:id` | `GET` | Inspect trace details (`?format=apigee` or `?format=otel`) |
| `/api/products` | `GET` | List configured API products |
| `/api/users` | `GET` | List configured users and developer apps |
| `/api/kvm` | `GET` | View global Key-Value Map data |

---

## Cleaning and Resetting

To remove generated proxy files and wipe data directories back to a clean state:

```bash
# Full wipe of generated proxies and data YAMLs, then rebuild a clean index.ts
./clean.sh

# Wipe generated proxies and extracted data, but preserve data/deployments/
./clean.sh --keep-deployments
```

Or using Bun directly:

```bash
bun run clear.ts
bun run clear.ts --keep-deployments
```

---

## Compilation & Deployment

### Standalone Binary Compilation

To compile Bungee Runtime into a standalone executable binary:

```bash
bun build --compile ./index.ts --outfile aft-testpilot
```

### Deploying to Google Cloud Run

Use the provided `deploy.sh` script to compile a Linux binary and deploy directly to Cloud Run:

```bash
# Build standalone Linux binary only
./deploy.sh --build-only

# Build and deploy to Google Cloud Run
export GOOGLE_CLOUD_PROJECT="your-project-id"
export GOOGLE_CLOUD_LOCATION="us-central1"
./deploy.sh -s aft-testpilot
```
