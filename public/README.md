# AFT-Preflight Client App (`public/`)

The AFT-Preflight client app is a lightweight, zero-dependency Single-Page Application (SPA) delivered natively by the Bungee Runtime Bun server at `http://localhost:3000/`. It provides a read-only configuration explorer, visual pipeline inspector, and interactive test console for local Apigee-compatible proxies, products, developers, and execution traces.

---

## 1. Architecture & Design Principles

- **Zero Build Step**: Built using modern vanilla HTML5, CSS3, and JavaScript (ES6+). No npm build, bundlers, or heavy frameworks required.
- **Native Web Standards**:
  - Semantic HTML with `<dialog>` for modal overlays (light-dismissible with `Esc`).
  - CSS Custom Properties (`--bg-surface`, `--primary`, `--border-light`, etc.) supporting instant light/dark theme switching.
  - Flexbox and CSS Grid responsive layouts with custom scrollbars and status badges.
  - Safe YAML parsing and snippet generation using client-side `js-yaml`.
- **Read-Only Explorer Scope**:
  - Focuses on runtime exploration and testing: **Proxies**, **Products**, **Users & Apps**, and **Traces**.
  - Deployments management is intentionally separated from this view (reserved for a dedicated administrative section).
- **Interactive Testing & Tracing**:
  - Direct request execution against local proxy endpoints.
  - Automatic injection of developer API keys.
  - Full execution pipeline inspection with step-by-step timings, context variable snapshots, and trace exports (Apigee Debug, OpenTelemetry ResourceSpans, Native).

---

## 2. Server API Integrations

The client app consumes the following native Bun server endpoints:

| Endpoint | Method | Description |
|---|---|---|
| `/` | `GET` | Serves `public/index.html` entry point |
| `/style.css` | `GET` | Main stylesheet with theming and layout styles |
| `/app.js` | `GET` | Client application logic and event bindings |
| `/api/data` | `GET` | Returns aggregated data summary: counts, file names, and raw YAML contents |
| `/api/products` | `GET` | Lists all active API product configurations |
| `/api/users` | `GET` | Lists all developer users, apps, and credentials |
| `/api/traces` | `GET` | Lists recent runtime execution traces |
| `/api/traces` | `DELETE` | Clears stored in-memory runtime execution traces |
| `/api/trace/:id` | `GET` | Retrieves full trace details (steps, timings, variable state) |
| `/api/trace/:id/export?format=<apigee\|otel\|native>` | `GET` | Exports execution trace in Apigee, OTEL, or Native format |
| `/rebuild` | `POST` | Triggers project recompilation via `build.ts` |

---

## 3. Core Functional Views

### 3.1. Sidebar & Resource Selector
- **Entity Counters**: Header badges display current counts of loaded Proxies, Products, and Developer Users.
- **Search & Filter**: Real-time substring filter on entity names across all categories.
- **Collapsible Category Sections**:
  - **Proxies**: All active proxy configurations (`data/proxies/` and deployments).
  - **Products**: All loaded API products (`data/products/`).
  - **Users & Apps**: Developer accounts with registered credentials (`data/users/`).
  - **Traces**: History of executed requests with status codes and latency.

---

### 3.2. Proxy Visual Configuration View
When an API Proxy is selected, the Visual Overview provides a focused, high-level inspection of the routing and execution architecture:

1. **Header & Summary Stats**:
   - Proxy Name, Display Name, Description, and `PROXY` category badge (singular).
   - High-level metric boxes: Base Endpoints, Route Rules, Upstream Targets, and Configured Policies.
   - **Open Test Console**: Pre-fills the interactive tester with the proxy's base path.
   - **Proxy YAML Button**: Opens a modal showing the full proxy specification.
2. **Endpoints & Route Rules**:
   - Base Path and endpoint identifier.
   - **Target Route Rules**: Lists conditional and default route rules pointing to upstream targets or direct responses.
   - **Route YAML Snippets**: View individual YAML snippet for each route rule.
   - **Flow Policy Summary**: Summarizes the policies executed in each flow phase without clutter:
     - Policy count and policy types executed (e.g., `4 policies: VerifyAPIKey, KeyValueMapOperations, AssignMessage, DataCapture`).
     - Supports `PreFlow`, conditional flows (`⚡ Condition`), `PostFlow`, and `FaultRules`.
     - In-context **View YAML** button to inspect the full YAML snippet of each flow.
3. **Upstream Targets**:
   - Target name, upstream base URL (with outbound link), and Target YAML snippet button.
   - **Target Flow Policy Summary**:
     - Summarizes target execution flows (`Target PreFlow`, `Target EventFlow` for SSE streams, `Target PostFlow`, and Fault Rules) with policy counts and policy types.
     - In-context **View YAML** button for each target flow.

---

### 3.3. Product View & Granular Operations
API Products define how API Proxies are bundled, authorized, and metered. The product view breaks down configuration details:

1. **Product Specifications**:
   - Rate Quota limits (e.g., `100 / 1 minute`), approval type (`auto` / `manual`), and access visibility.
   - **Bound Proxies**: Interactive clickable chips that jump directly to the proxy configuration in the explorer.
   - **Environments**: List of deployed environments (e.g., `dev`, `prod`).
2. **Standard HTTP Operations**:
   - Grouped by `apiSource` proxy.
   - Resource path (e.g., `/v1/weather`, `/items/*`).
   - Allowed HTTP method badges with color-coding: `GET` (green), `POST` (blue), `PUT` (amber), `DELETE` (red), `PATCH` (purple).
   - Operation-specific quota limits or inheritance from product quota.
3. **LLM Model Operations & Token Quotas**:
   - Grouped by `apiSource` AI proxy.
   - Target Model badges (e.g., `google/gemini-3.7-flash`, `google/gemini-3.8-flash`, `anthropic/claude-3-5-sonnet`).
   - Token quota limits (e.g., `100,000 tokens / 1 minute`).
   - Methods and resource paths.
4. **Payload & MCP Operations**:
   - Model Context Protocol (MCP) and custom payload operation mappings.
   - Protocol badge (`MCP`).
   - Tool / operation names (e.g., `tools/list`, `tools/call/query_database`).
   - Operation-specific rate quotas.
5. **Operation Snippets**:
   - Individual YAML snippet buttons for each operations group to inspect the exact configuration snippet.

---

### 3.4. Users & Developer Apps View
Displays the developer identity and registered applications:
- Developer name, email, and account status (`active`).
- Registered applications under the developer account.
- **Consumer Keys (API Keys)** with a **Copy Key** button for convenient testing in the API Console.
- Associated API products authorized for each key.

---

### 3.5. YAML Snippet Viewer Modal
Every entity, endpoint, flow, route, policy, operation, and credential card features a **View YAML** button:
- Uses a native HTML5 `<dialog>` overlay with custom backdrop blur.
- Dynamically renders isolated, formatted YAML for the selected component.
- Includes a **Copy Snippet** button with clipboard feedback.

---

### 3.6. Interactive Test Console & Traces
The **Test Console** subtab allows users to send live HTTP requests to any local proxy:
- **Method & URL Bar**: Select HTTP method (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`) and endpoint path.
- **Pre-Fill Actions**:
  - `Insert Dev API Key`: Automatically detects developer API keys from `data/users/` and sets the `x-ai-key` or `x-api-key` header.
  - `Preset AI Request`: Injects a sample OpenAI-compatible chat completion payload.
  - `Format JSON`: Pretty-prints the request JSON body.
- **Execution & Response Viewer**:
  - Real-time HTTP status code with latency timer (e.g., `200 OK • 18ms`).
  - Response headers table.
  - Formatted response body with syntax highlighting and copy button.
- **Embedded Trace & Step Profiler**:
  - Visual breakdown of the executed pipeline (PreFlow, Target Flow, PostFlow, FaultRules).
  - Individual step latency and execution status (`success`, `fault`).
  - **Context Variables Drawer**: Inspect Apigee context variables (`request.*`, `response.*`, `flow.*`, `client.*`, `ai.*`) at any step.
  - **Trace Exports**: One-click download of execution traces in **Apigee Debug**, **OpenTelemetry (OTEL)**, or **Native** formats.

---

## 4. Running & Testing

1. **Start the Service**:
   ```bash
   bun run index.ts
   # or with live reloading:
   bun --watch index.ts
   ```
2. **Access the Client App**:
   Open `http://localhost:3000/` in any modern web browser.
3. **Run Client & Server Tests**:
   ```bash
   bun test
   ```
