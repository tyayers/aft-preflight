/* ==========================================================================
   PRELOADED YAML TEMPLATES DATA
   ========================================================================== */
const TEMPLATES = {
    "apigee-mock": `name: hello-world
displayName: ""
type: proxy
categories: []
description: API proxy for HelloWorld-v1
parameters:
  - name: response-helloworld.helloworld.MESSAGE
    displayName: MESSAGE
    description: Configuration input for MESSAGE
    default: Hello world!
    examples:
      - Hello mars!
      - Hello internet!
endpoints:
  - name: apigee-mock
    basePath: /apigeemock
    routes:
      - name: default
        target: apigee-mock
    flows:
      - name: PostFlow
        mode: Response
        steps:
          - name: helloworld-JS-AddHelloWorld
    faultRules: []
targets:
  - name: apigee-mock
    url: https://mocktarget.apigee.net
    flows: []
    faultRules: []
    httpTargetConnection:
      properties: {}
      url: https://mocktarget.apigee.net
policies:
  - name: helloworld-JS-AddHelloWorld
    type: Javascript
    content:
      javascript:
        metadata:
          continueOnError: "false"
          enabled: "true"
          timeLimit: "200"
          name: helloworld-JS-AddHelloWorld
        displayName: JS-AddHelloWorld
        properties: {}
        resourceUrl: jsc://helloworld-hello-world.js
resources:
  - name: helloworld-hello-world.js
    type: jsc
    content: |-
      var responseText = response.content;
      if (!responseText) responseText = "";

      var responseObject = undefined;

      try {
        responseObject = JSON.parse(responseText);
      } catch(e) {
        print("Could not parse JSON.");
      }

      var message = context.getVariable("request.queryparam.message");
      if (!message)
        message = context.getVariable("propertyset.helloworld-helloworld.MESSAGE");
      if (!message)
        message = "Hello world!";

      if (responseObject) {
        responseObject["message"] = message;
        context.setVariable("response.content", JSON.stringify(responseObject));
      } else {
        responseText = responseText + " " + message;
        context.setVariable("response.content", responseText);
      }
  - name: helloworld-helloworld.properties
    type: properties
    content: |
      MESSAGE=Hello world!
tests: []`,

    "llm": `name: llm
displayName: ""
type: proxy
categories: []
description: API proxy for LLM integration
parameters: []
endpoints:
  - name: llm
    basePath: /llm
    routes:
      - name: default
        target: llm
    flows: []
    faultRules: []
targets:
  - name: llm
    url: https://aiplatform.googleapis.com
    flows: []
    faultRules: []
    httpTargetConnection:
      properties: {}
      url: https://aiplatform.googleapis.com
policies: []
resources: []
tests: []`,

    "local-service": `name: local-service
displayName: ""
type: proxy
categories: []
description: API proxy for a local service
parameters: []
endpoints:
  - name: local-service
    basePath: /local-service
    routes:
      - name: default
        target: local-service
    flows:
      - name: PostFlow
        mode: Response
        steps:
          - name: helloworld-JS-AddHelloWorld
    faultRules: []
targets:
  - name: local-service
    url: http://localhost:8080
    flows: []
    faultRules: []
    httpTargetConnection:
      properties: {}
      url: http://localhost:8080
policies:
  - name: helloworld-JS-AddHelloWorld
    type: Javascript
    content:
      javascript:
        metadata:
          continueOnError: "false"
          enabled: "true"
          timeLimit: "200"
          name: helloworld-JS-AddHelloWorld
        displayName: JS-AddHelloWorld
        properties: {}
        resourceUrl: jsc://helloworld-hello-world.js
resources:
  - name: helloworld-hello-world.js
    type: jsc
    content: |-
      var responseText = response.content;
      if (!responseText) responseText = "";

      var responseObject = undefined;

      try {
        responseObject = JSON.parse(responseText);
      } catch(e) {
        print("Could not parse JSON.");
      }

      var message = context.getVariable("request.queryparam.message");
      if (!message)
        message = context.getVariable("propertyset.helloworld-helloworld.MESSAGE");
      if (!message)
        message = "Hello world!";

      if (responseObject) {
        responseObject["message"] = message;
        context.setVariable("response.content", JSON.stringify(responseObject));
      } else {
        responseText = responseText + " " + message;
        context.setVariable("response.content", responseText);
      }
  - name: helloworld-helloworld.properties
    type: properties
    content: |
      MESSAGE=Hello world!
tests: []`,

    "blank": `name: blank-proxy
displayName: ""
type: proxy
categories: []
description: A blank API proxy template
parameters: []
endpoints:
  - name: default
    basePath: /v1
    routes: []
    flows: []
targets: []
policies: []
resources: []
tests: []`
};

/* ==========================================================================
   APP STATE MANAGEMENT
   ========================================================================== */
let proxyData = null;
let selectedItem = { type: 'proxy' }; // Tracks active inspector element
let currentTheme = 'dark';
let activeTab = 'form'; // 'form' or 'yaml'

// Monaco instances & status
let monacoLoaded = false;
let yamlEditorInstance = null;
let jsEditorInstance = null;

// Drag and drop tracking
let draggedStepElement = null;

/* ==========================================================================
   APPLICATION ENTRYPOINT
   ========================================================================== */
window.addEventListener('DOMContentLoaded', () => {
    initTheme();
    
    // Load saved collapsible sidebar state before paint to prevent flicker
    const sidebar = document.querySelector('.sidebar');
    if (sidebar && localStorage.getItem('sidebar-collapsed') === 'true') {
        sidebar.classList.add('collapsed');
    }
    
    initEventListeners();
    setupDragAndDrop();
    
    // Initialize resizer drag and sidebar toggle features
    initResizer();
    initSidebarCollapse();
    
    // Load templates from Server REST API and initialize
    fetchTemplatesAndPopulate().then(() => {
        if (currentTemplateId) {
            loadTemplate(currentTemplateId);
        }
    });
    
    // Initialize Monaco asynchronously
    initMonaco();
});

/* ==========================================================================
   MONACO EDITOR INTEGRATION
   ========================================================================== */
function initMonaco() {
    if (typeof require === 'undefined') {
        console.warn("RequireJS not loaded, falling back to textarea editing");
        updateEditorSyncStatus(false, "Using text fallback");
        return;
    }

    // Configure Monaco Environment to load workers via data URIs to bypass CORS restrictions.
    // By configuring baseUrl and requiring workerMain.js, Monaco will automatically
    // spin up Javascript, JSON, CSS, and general editor worker threads dynamically.
    window.MonacoEnvironment = {
        getWorkerUrl: function (moduleId, label) {
            const cdnBase = 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.39.0/min/';
            return `data:text/javascript;charset=utf-8,${encodeURIComponent(`
                self.MonacoEnvironment = {
                    baseUrl: '${cdnBase}'
                };
                importScripts('${cdnBase}vs/base/worker/workerMain.js');
            `)}`;
        }
    };

    require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.39.0/min/vs' } });
    
    require(['vs/editor/editor.main'], function() {
        monacoLoaded = true;
        document.querySelector('.js-badge').textContent = 'Intellisense Enabled';
        
        // Enable deep semantic validation & JS code checking
        // This flags runtime errors like undeclared variables (e.g., fdsfdsfs) as compile errors!
        monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
            noSemanticValidation: false, // Enable semantic validation
            noSyntaxValidation: false,    // Enable syntax validation
            diagnosticCodesToIgnore: [2554] // Ignore argument count mismatch to allow print(msg) without browser DOM collisions
        });

        monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
            target: monaco.languages.typescript.ScriptTarget.ES6,
            allowNonTsExtensions: true,
            checkJs: true,               // Type-check JS files (flags undeclared variable names)
            allowJs: true
        });

        // Register the Apigee Global Objects Model to prevent "Cannot find name" errors,
        // and to provide full API Intellisense autocompletions for Apigee JavaScript objects!
        const apigeeLib = `
            /**
             * Prints a message to the Apigee execution logs.
             * @param message The content to print.
             */
            declare function print(message: any, ...optionalParams: any[]): void;

            interface Window {
                print(message?: any, ...args: any[]): void;
            }

            interface ApigeeMessage {
                /**
                 * The body content of the HTTP message (request/response).
                 */
                content: string;
                /**
                 * Key-value map of headers on this message.
                 */
                headers: Record<string, string>;
                /**
                 * Alternative shorthand for headers.
                 */
                header: Record<string, string>;
                /**
                 * HTTP Status code.
                 */
                status: number;
            }

            interface ApigeeRequest extends ApigeeMessage {
                /**
                 * The HTTP Method (e.g. "GET", "POST").
                 */
                method: string;
                /**
                 * The full URL of the request.
                 */
                url: string;
                /**
                 * The path portion of the URL.
                 */
                path: string;
                /**
                 * Key-value map of request query parameters.
                 */
                queryParams: Record<string, string>;
                /**
                 * Alternative shorthand for query parameters.
                 */
                queryparam: Record<string, string>;
            }

            interface ApigeeContext {
                /**
                 * Returns the value of a flow variable or properties-set key.
                 * @param name The variable path (e.g. "response.content" or "request.queryparam.message").
                 */
                getVariable(name: string): any;
                /**
                 * Sets the value of a flow variable.
                 * @param name The variable path.
                 * @param value The value to set (string, number, boolean, etc.).
                 */
                setVariable(name: string, value: any): void;
                /**
                 * Removes a flow variable from execution context.
                 * @param name The variable path.
                 */
                removeVariable(name: string): void;
                /**
                 * Current flow stage (e.g. "PROXY_REQ_FLOW", "PROXY_RESP_FLOW").
                 */
                flow: string;
                /**
                 * Request object at Proxy Endpoint flow.
                 */
                proxyRequest: ApigeeRequest;
                /**
                 * Response object at Proxy Endpoint flow.
                 */
                proxyResponse: ApigeeMessage;
                /**
                 * Request object at Target Endpoint flow.
                 */
                targetRequest: ApigeeRequest;
                /**
                 * Response object at Target Endpoint flow.
                 */
                targetResponse: ApigeeMessage;
            }

            /** Global Apigee Flow Context Object */
            declare const context: ApigeeContext;
            /** Global Apigee Request Message Object */
            declare const request: ApigeeRequest;
            /** Global Apigee Response Message Object */
            declare const response: ApigeeMessage;
        `;
        
        monaco.languages.typescript.javascriptDefaults.addExtraLib(apigeeLib, 'file:///node_modules/@types/apigee/index.d.ts');
        monaco.languages.typescript.typescriptDefaults.addExtraLib(apigeeLib, 'file:///node_modules/@types/apigee/index.d.ts');
        
        // Hide fallback textareas
        document.getElementById('yaml-textarea-fallback').classList.add('hidden');
        document.getElementById('js-code-textarea-fallback').classList.add('hidden');
        
        const monacoTheme = currentTheme === 'dark' ? 'vs-dark' : 'vs';
        
        // 1. YAML Raw Source Editor
        yamlEditorInstance = monaco.editor.create(document.getElementById('monaco-yaml-editor'), {
            value: getYamlText(),
            language: 'yaml',
            theme: monacoTheme,
            automaticLayout: true,
            fontSize: 13,
            fontFamily: 'var(--font-mono)',
            minimap: { enabled: false },
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            tabSize: 2
        });
        
        // Live sync from YAML source code changes
        yamlEditorInstance.onDidChangeModelContent(() => {
            if (activeTab === 'yaml') {
                const updatedYaml = yamlEditorInstance.getValue();
                const parseSuccess = processYamlInput(updatedYaml, false);
                if (parseSuccess) {
                    updateEditorSyncStatus(true, "Synchronized");
                } else {
                    updateEditorSyncStatus(false, "YAML Error", 'yellow');
                }
            }
        });
        
        // 2. JavaScript Resource Editor (Contextual) with explicit virtual file path
        const jsModel = monaco.editor.createModel(
            "",
            "javascript",
            monaco.Uri.parse("file:///main.js")
        );
        jsEditorInstance = monaco.editor.create(document.getElementById('monaco-code-editor'), {
            model: jsModel,
            theme: monacoTheme,
            automaticLayout: true,
            fontSize: 13,
            fontFamily: 'var(--font-mono)',
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            tabSize: 4
        });
        
        // Live sync from JS editor changes into YAML model
        jsEditorInstance.onDidChangeModelContent(() => {
            if (selectedItem && selectedItem.type === 'step') {
                const jsContent = jsEditorInstance.getValue();
                updateJsResourceContent(jsContent);
            }
        });

        // 3. Listen to diagnostics (Markers) in JavaScript Editor for Compilation Error Visualizations
        monaco.editor.onDidChangeMarkers(([uri]) => {
            if (!jsEditorInstance) return;
            const model = jsEditorInstance.getModel();
            if (!model) return;
            
            // Only update diagnostics if markers belong to current JS editor model
            if (uri.toString() === model.uri.toString()) {
                updateJsEditorDiagnostics(model);
            }
        });

        // Trigger updates in case templates are pre-loaded
        syncMonacoValues();
    });
}

/* ==========================================================================
   LIVE COMPILATION DIAGNOSTICS & ERROR PANEL VISUALIZATION
   ========================================================================== */
function updateJsEditorDiagnostics(model) {
    const markers = monaco.editor.getModelMarkers({ resource: model.uri });
    const errorPanel = document.getElementById('js-editor-error-panel');
    const errorList = document.getElementById('js-error-list');
    const countLabel = document.getElementById('js-error-count-label');
    const badge = document.querySelector('.js-badge');
    
    if (!errorPanel || !errorList || !countLabel || !badge) return;
    
    errorList.innerHTML = ''; // Clear previous errors
    
    // Filter for errors only (severity 8 is Error in Monaco)
    const errors = markers.filter(m => m.severity === 8);
    
    if (errors.length > 0) {
        errorPanel.classList.remove('hidden');
        countLabel.textContent = `${errors.length} Compilation Error${errors.length > 1 ? 's' : ''}`;
        
        // Update header badge
        badge.textContent = "⚠️ Compile Errors";
        badge.style.backgroundColor = "var(--danger-muted)";
        badge.style.color = "var(--danger-color)";
        
        // List each error
        errors.forEach(err => {
            const li = document.createElement('li');
            li.className = 'js-error-item';
            li.innerHTML = `
                <span class="js-error-loc">Line ${err.startLineNumber}:${err.startColumn}</span>
                <span class="js-error-msg" title="${err.message}">${err.message}</span>
            `;
            
            // Clicking error jumps cursor inside editor
            li.addEventListener('click', () => {
                jsEditorInstance.setPosition({ lineNumber: err.startLineNumber, column: err.startColumn });
                jsEditorInstance.focus();
                jsEditorInstance.revealLineInCenter(err.startLineNumber);
            });
            
            errorList.appendChild(li);
        });
    } else {
        // No errors found!
        errorPanel.classList.add('hidden');
        countLabel.textContent = "No compile errors";
        
        badge.textContent = "Intellisense Active";
        badge.style.backgroundColor = "var(--warning-muted)";
        badge.style.color = "var(--warning-color)";
    }
}

function syncMonacoValues() {
    if (!monacoLoaded) return;
    
    // Sync YAML raw code
    if (yamlEditorInstance && activeTab !== 'yaml') {
        yamlEditorInstance.setValue(getYamlText());
    }
}

function updateThemeInMonaco() {
    if (!monacoLoaded) return;
    const monacoTheme = currentTheme === 'dark' ? 'vs-dark' : 'vs';
    if (yamlEditorInstance) monaco.editor.setTheme(monacoTheme);
    if (jsEditorInstance) monaco.editor.setTheme(monacoTheme);
}

/* ==========================================================================
   THEME TOGGLING MANAGEMENT
   ========================================================================== */
function initTheme() {
    // Detect system theme preference
    const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    const initialTheme = prefersLight ? 'light' : 'dark';
    setTheme(initialTheme);
}

function setTheme(theme) {
    currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    
    const themeBtnSpan = document.querySelector('#btn-theme-toggle span');
    if (theme === 'dark') {
        themeBtnSpan.textContent = 'Light Mode';
    } else {
        themeBtnSpan.textContent = 'Dark Mode';
    }
    
    updateThemeInMonaco();
}

/* ==========================================================================
   EVENT LISTENERS SETUP
   ========================================================================== */
function initEventListeners() {
    // Theme Toggle
    document.getElementById('btn-theme-toggle').addEventListener('click', () => {
        setTheme(currentTheme === 'dark' ? 'light' : 'dark');
    });

    // Tab Switching
    document.getElementById('tab-form').addEventListener('click', () => switchTab('form'));
    document.getElementById('tab-yaml').addEventListener('click', () => switchTab('yaml'));

    // File Import Input
    const fileInput = document.getElementById('file-input');
    document.getElementById('btn-open').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);

    // File Download Action
    document.getElementById('btn-download').addEventListener('click', downloadYamlFile);

    // Template Dropdown
    document.getElementById('sample-select').addEventListener('change', (e) => {
        loadTemplate(e.target.value);
    });

    // Save Template to Server
    document.getElementById('btn-save-template').addEventListener('click', saveActiveTemplate);

    // Create New Template (Modal triggers)
    document.getElementById('btn-new-template').addEventListener('click', openNewTemplateModal);
    document.getElementById('btn-close-modal').addEventListener('click', closeNewTemplateModal);
    document.getElementById('btn-cancel-modal').addEventListener('click', closeNewTemplateModal);
    document.getElementById('btn-confirm-modal').addEventListener('click', confirmCreateTemplate);
    document.getElementById('modal-backdrop').addEventListener('click', closeNewTemplateModal);

    // Delete Template from Server
    document.getElementById('btn-delete-template').addEventListener('click', deleteActiveTemplate);

    // Rebuild and Reload Gateway
    document.getElementById('btn-rebuild-server').addEventListener('click', rebuildServer);

    // Native textareas sync fallback
    document.getElementById('yaml-textarea-fallback').addEventListener('input', (e) => {
        processYamlInput(e.target.value, false);
    });
    
    document.getElementById('js-code-textarea-fallback').addEventListener('input', (e) => {
        updateJsResourceContent(e.target.value);
    });
}

/* ==========================================================================
   TAB MANAGEMENT (FORM vs YAML)
   ========================================================================== */
function switchTab(tab) {
    if (activeTab === tab) return;
    
    activeTab = tab;
    document.getElementById('tab-form').classList.toggle('active', tab === 'form');
    document.getElementById('tab-yaml').classList.toggle('active', tab === 'yaml');
    
    document.getElementById('panel-form').classList.toggle('active', tab === 'form');
    document.getElementById('panel-yaml').classList.toggle('active', tab === 'yaml');

    if (tab === 'yaml') {
        // Switching to YAML tab: update code view from memory model
        const currentYaml = getYamlText();
        if (monacoLoaded && yamlEditorInstance) {
            yamlEditorInstance.setValue(currentYaml);
        } else {
            document.getElementById('yaml-textarea-fallback').value = currentYaml;
        }
        updateEditorSyncStatus(true, "Synchronized");
    } else {
        // Switching back to Form Editor: parse current editor code first
        let yamlContent = "";
        if (monacoLoaded && yamlEditorInstance) {
            yamlContent = yamlEditorInstance.getValue();
        } else {
            yamlContent = document.getElementById('yaml-textarea-fallback').value;
        }
        
        const parseSuccess = processYamlInput(yamlContent, true);
        if (parseSuccess) {
            renderVisualCanvas();
            renderInspector();
            updateEditorSyncStatus(true, "Synchronized");
        } else {
            // Warn user, refuse switch if heavily corrupted
            alert("Please fix the YAML syntax errors before switching back to the form editor.");
            switchTab('yaml'); // Revert tab select
        }
    }
}

function updateEditorSyncStatus(isSynced, text, color = null) {
    const dot = document.querySelector('.status-dot');
    const label = document.querySelector('.status-text');
    
    dot.className = "status-dot";
    label.textContent = text;
    
    if (isSynced) {
        dot.classList.add('green');
    } else if (color === 'yellow') {
        dot.classList.add('yellow');
    } else {
        dot.classList.add('red');
    }
}

/* ==========================================================================
   YAML PROCESSING (PARSE, SERIALIZE, LOAD)
   ========================================================================== */
let currentTemplateId = '';

async function fetchTemplatesAndPopulate() {
    try {
        const response = await fetch('/api/templates');
        const list = await response.json();
        
        const select = document.getElementById('sample-select');
        select.innerHTML = '';
        
        list.forEach(tpl => {
            const opt = document.createElement('option');
            opt.value = tpl.id;
            opt.textContent = tpl.filename;
            select.appendChild(opt);
        });

        if (list.length > 0) {
            if (!currentTemplateId || !list.some(tpl => tpl.id === currentTemplateId)) {
                currentTemplateId = list[0].id;
            }
            select.value = currentTemplateId;
        } else {
            currentTemplateId = '';
        }
    } catch (err) {
        console.error("Failed to load templates:", err);
        showToast("Failed to fetch templates from server", "error");
    }
}

async function loadTemplate(key) {
    if (!key) return;
    try {
        currentTemplateId = key;
        const response = await fetch(`/api/templates/${key}`);
        if (!response.ok) {
            throw new Error(`Failed to load template (status: ${response.status})`);
        }
        const yamlContent = await response.text();
        
        processYamlInput(yamlContent, true);
        selectedItem = { type: 'proxy' }; // reset select to root
        renderVisualCanvas();
        renderInspector();
        syncMonacoValues();
        updateEditorSyncStatus(true, "Synchronized");
        
        const select = document.getElementById('sample-select');
        if (select) {
            select.value = key;
        }
    } catch (err) {
        console.error("Template load error:", err);
        showToast(`Error loading template: ${err.message}`, "error");
    }
}

async function saveActiveTemplate() {
    if (!currentTemplateId) {
        showToast("No active template selected", "error");
        return;
    }
    
    const yamlContent = getYamlText();
    if (!yamlContent) {
        showToast("Cannot save empty template", "error");
        return;
    }
    
    try {
        const response = await fetch(`/api/templates/${currentTemplateId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ content: yamlContent })
        });
        
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || "Save failed");
        }
        
        showToast("Template saved successfully!", "success");
    } catch (err) {
        console.error("Save template error:", err);
        showToast(`Failed to save template: ${err.message}`, "error");
    }
}

function openNewTemplateModal() {
    const modal = document.getElementById('new-template-modal');
    const input = document.getElementById('new-template-id');
    input.value = '';
    modal.classList.remove('hidden');
    input.focus();
}

function closeNewTemplateModal() {
    const modal = document.getElementById('new-template-modal');
    modal.classList.add('hidden');
}

async function confirmCreateTemplate() {
    const input = document.getElementById('new-template-id');
    const id = input.value.trim().replace(/[^a-zA-Z0-9_-]/g, "");
    
    if (!id) {
        showToast("Please enter a valid template ID (letters, numbers, dashes, underscores)", "error");
        return;
    }
    
    const blankTemplate = `name: ${id}
type: proxy
description: Custom API proxy template
endpoints: []
targets: []
policies: []
resources: []
`;
    
    try {
        const response = await fetch('/api/templates', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ id, content: blankTemplate })
        });
        
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || "Creation failed");
        }
        
        closeNewTemplateModal();
        showToast(`Template "${id}" created successfully!`, "success");
        
        currentTemplateId = id;
        await fetchTemplatesAndPopulate();
        await loadTemplate(id);
    } catch (err) {
        console.error("Create template error:", err);
        showToast(`Failed to create template: ${err.message}`, "error");
    }
}

async function deleteActiveTemplate() {
    if (!currentTemplateId) {
        showToast("No active template selected", "error");
        return;
    }
    
    if (!confirm(`Are you sure you want to delete the template "${currentTemplateId}"? This action cannot be undone.`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/templates/${currentTemplateId}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || "Delete failed");
        }
        
        showToast("Template deleted successfully", "success");
        
        currentTemplateId = '';
        await fetchTemplatesAndPopulate();
        if (currentTemplateId) {
            await loadTemplate(currentTemplateId);
        } else {
            processYamlInput("", true);
            syncMonacoValues();
        }
    } catch (err) {
        console.error("Delete template error:", err);
        showToast(`Failed to delete template: ${err.message}`, "error");
    }
}

async function rebuildServer() {
    const btn = document.getElementById('btn-rebuild-server');
    const origText = btn.innerHTML;
    
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader" class="spin"></i> Rebuilding...`;
    if (window.lucide) window.lucide.createIcons();
    
    showToast("Triggering gateway rebuild and reload...", "info");
    
    try {
        const response = await fetch('/rebuild', {
            method: 'POST'
        });
        
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || "Rebuild failed");
        }
        
        showToast("Rebuild successful! Reloading page in 2 seconds...", "success");
        
        setTimeout(() => {
            window.location.reload();
        }, 2000);
    } catch (err) {
        console.error("Rebuild error:", err);
        showToast(`Rebuild failed: ${err.message}`, "error");
        btn.disabled = false;
        btn.innerHTML = origText;
        if (window.lucide) window.lucide.createIcons();
    }
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let iconName = 'info';
    if (type === 'success') iconName = 'check-circle';
    if (type === 'error') iconName = 'alert-triangle';
    
    toast.innerHTML = `
        <div class="toast-icon"><i data-lucide="${iconName}"></i></div>
        <div class="toast-message">${message}</div>
        <button class="toast-close" onclick="this.parentElement.remove()"><i data-lucide="x"></i></button>
    `;
    
    container.appendChild(toast);
    
    if (window.lucide) {
        window.lucide.createIcons();
    }
    
    setTimeout(() => {
        toast.classList.add('removing');
        toast.addEventListener('animationend', () => toast.remove());
    }, 4000);
}

function getYamlText() {
    if (!proxyData) return "";
    try {
        // Prevent references anchors in dumped YAML (e.g., *ref0) for cleaner readability
        return jsyaml.dump(proxyData, { 
            noRefs: true, 
            lineWidth: -1, 
            quotingType: '"',
            forceQuotes: false
        });
    } catch (e) {
        console.error("YAML stringify error:", e);
        return "";
    }
}

function processYamlInput(yamlText, forceRebuild = false) {
    try {
        const parsed = jsyaml.load(yamlText);
        if (parsed && typeof parsed === 'object') {
            // Guard clauses to inject empty nodes if missing
            if (!parsed.endpoints) parsed.endpoints = [];
            if (!parsed.targets) parsed.targets = [];
            if (!parsed.policies) parsed.policies = [];
            if (!parsed.resources) parsed.resources = [];
            
            proxyData = parsed;
            
            // Hide error banners if any
            document.getElementById('yaml-error-banner').classList.add('hidden');
            
            // Synchronize the header summarized details
            document.getElementById('summary-proxy-name').textContent = `Proxy: ${proxyData.name || 'Unnamed'}`;
            
            if (forceRebuild) {
                renderVisualCanvas();
            }
            return true;
        }
    } catch (err) {
        console.error("YAML parsing failed:", err);
        // Show syntax error alert inside editor pane
        const banner = document.getElementById('yaml-error-banner');
        const msg = document.getElementById('yaml-error-message');
        banner.classList.remove('hidden');
        msg.textContent = err.message || "Failed to parse YAML. Check your formatting.";
    }
    return false;
}

/* ==========================================================================
   FILE SELECTION & DRAG-AND-DROP UPLOADS
   ========================================================================== */
function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    openFileContent(file);
}

function openFileContent(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        const success = processYamlInput(text, true);
        if (success) {
            selectedItem = { type: 'proxy' };
            renderVisualCanvas();
            renderInspector();
            syncMonacoValues();
            updateEditorSyncStatus(true, `Opened ${file.name}`);
        } else {
            alert(`Could not parse ${file.name}. Ensure it is a valid Apigee Gateway YAML file.`);
        }
    };
    reader.readAsText(file);
}

function downloadYamlFile() {
    const yamlOutput = getYamlText();
    const filename = `${proxyData.name || 'proxy'}-config.yaml`;
    const blob = new Blob([yamlOutput], { type: 'text/yaml;charset=utf-8' });
    
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function setupDragAndDrop() {
    const overlay = document.getElementById('drag-overlay');
    
    window.addEventListener('dragenter', (e) => {
        e.preventDefault();
        overlay.classList.add('active');
    });

    overlay.addEventListener('dragover', (e) => {
        e.preventDefault();
    });

    overlay.addEventListener('dragleave', (e) => {
        e.preventDefault();
        // Only remove active if mouse left the overlay itself
        if (e.relatedTarget === null || !overlay.contains(e.relatedTarget)) {
            overlay.classList.remove('active');
        }
    });

    overlay.addEventListener('drop', (e) => {
        e.preventDefault();
        overlay.classList.remove('active');
        
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            openFileContent(e.dataTransfer.files[0]);
        }
    });
}

/* ==========================================================================
   VISUAL FLOW DESIGNER RENDERING
   ========================================================================== */
function renderVisualCanvas() {
    const canvas = document.getElementById('visual-canvas');
    canvas.innerHTML = ''; // wipe UI

    if (!proxyData) {
        canvas.innerHTML = `
            <div class="empty-canvas-state">
                <i data-lucide="help-circle" class="empty-canvas-icon"></i>
                <h3>No Proxy Loaded</h3>
                <p>Drag in a YAML config or select a sample from the left panel.</p>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    // Render 1. Global Proxy Config Header Card
    const rootBadge = document.createElement('div');
    rootBadge.className = `canvas-root-badge ${selectedItem.type === 'proxy' ? 'active-selection' : ''}`;
    rootBadge.innerHTML = `
        <div class="node-title-group">
            <i data-lucide="sliders" style="color: var(--accent-color); width: 18px;"></i>
            <span>Proxy Core: <strong>${proxyData.name || 'unnamed'}</strong></span>
        </div>
        <span class="badge" style="background-color: var(--border-color); color: var(--text-secondary)">v1.0</span>
    `;
    rootBadge.addEventListener('click', (e) => {
        e.stopPropagation();
        selectWorkspaceElement({ type: 'proxy' });
    });
    canvas.appendChild(rootBadge);

    // Flow Pipeline Connection Arrow
    canvas.appendChild(createConnectorArrow());

    // Render 2. Endpoints Sections
    if (proxyData.endpoints && proxyData.endpoints.length > 0) {
        proxyData.endpoints.forEach((ep, epIdx) => {
            const epCard = document.createElement('div');
            const isEpSelected = selectedItem.type === 'endpoint' && selectedItem.endpointIndex === epIdx;
            epCard.className = `canvas-node node-endpoint ${isEpSelected ? 'active-selection' : ''}`;
            
            // Generate header
            let routesHtml = '';
            if (ep.routes && ep.routes.length > 0) {
                routesHtml = `
                    <div class="node-routes">
                        <div class="route-heading">Routes Connection</div>
                        ${ep.routes.map(r => `
                            <div class="route-item">
                                <span>Route: <strong>${r.name}</strong></span>
                                <div class="route-target">
                                    <i data-lucide="corner-down-right"></i>
                                    <span>Target: ${r.target}</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `;
            }

            epCard.innerHTML = `
                <div class="node-header">
                    <div class="node-title-group">
                        <i data-lucide="log-in" class="node-icon"></i>
                        <span class="node-title">Proxy Endpoint</span>
                    </div>
                    <span class="badge" style="background-color: var(--accent-muted); color: var(--accent-color)">EP</span>
                </div>
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <div>Name: <span class="node-subtitle">${ep.name}</span></div>
                    <div>Base Path: <span class="node-subtitle" style="color: var(--accent-color)">${ep.basePath}</span></div>
                </div>
                
                ${routesHtml}
                
                <!-- Flows list within this endpoint -->
                <div class="node-flows">
                    <div class="route-heading" style="margin-bottom: 4px;">Endpoint Flows</div>
                    ${renderFlowsContainer(ep.flows, 'endpoint', epIdx)}
                </div>
            `;
            
            epCard.addEventListener('click', (e) => {
                e.stopPropagation();
                selectWorkspaceElement({ type: 'endpoint', endpointIndex: epIdx });
            });
            
            canvas.appendChild(epCard);
            
            // Flow Pipeline Connection Arrow between Endpoints and Targets
            if (epIdx < proxyData.endpoints.length - 1 || (proxyData.targets && proxyData.targets.length > 0)) {
                canvas.appendChild(createConnectorArrow());
            }
        });
    } else {
        // No Endpoints message
        const emptyEp = document.createElement('div');
        emptyEp.className = "empty-steps-placeholder";
        emptyEp.innerHTML = "No Endpoints configured. Add an endpoint in the YAML code view.";
        canvas.appendChild(emptyEp);
        canvas.appendChild(createConnectorArrow());
    }

    // Render 3. Targets Sections
    if (proxyData.targets && proxyData.targets.length > 0) {
        proxyData.targets.forEach((tgt, tgtIdx) => {
            const tgtCard = document.createElement('div');
            const isTgtSelected = selectedItem.type === 'target' && selectedItem.targetIndex === tgtIdx;
            tgtCard.className = `canvas-node node-target ${isTgtSelected ? 'active-selection' : ''}`;
            
            tgtCard.innerHTML = `
                <div class="node-header">
                    <div class="node-title-group">
                        <i data-lucide="send" class="node-icon"></i>
                        <span class="node-title">HTTP Target Destination</span>
                    </div>
                    <span class="badge" style="background-color: var(--success-muted); color: var(--success-color)">TGT</span>
                </div>
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <div>Name: <span class="node-subtitle">${tgt.name}</span></div>
                    <div>Target URL: <span class="node-subtitle">${tgt.url || (tgt.httpTargetConnection ? tgt.httpTargetConnection.url : 'None')}</span></div>
                </div>
                
                <!-- Flows inside target (Apigee supports target flows) -->
                ${tgt.flows && tgt.flows.length > 0 ? `
                    <div class="node-flows" style="margin-top: 14px;">
                        <div class="route-heading" style="margin-bottom: 4px;">Target Flows</div>
                        ${renderFlowsContainer(tgt.flows, 'target', tgtIdx)}
                    </div>
                ` : ''}
            `;
            
            tgtCard.addEventListener('click', (e) => {
                e.stopPropagation();
                selectWorkspaceElement({ type: 'target', targetIndex: tgtIdx });
            });
            
            canvas.appendChild(tgtCard);
            
            if (tgtIdx < proxyData.targets.length - 1) {
                canvas.appendChild(createConnectorArrow());
            }
        });
    }

    // Reactivate icons parsed dynamically
    lucide.createIcons();
    bindInteractiveDelegates();
}

function createConnectorArrow() {
    const wrapper = document.createElement('div');
    wrapper.className = 'flow-connector';
    wrapper.innerHTML = `
        <div class="flow-connector-line">
            <div class="flow-connector-arrow"></div>
        </div>
    `;
    return wrapper;
}

/* RENDERS FLOW COLLAPSIBLES WITH CORRESPONDING TIMELINE STEPS */
function renderFlowsContainer(flows, parentType, parentIdx) {
    if (!flows || flows.length === 0) {
        return `<div class="empty-steps-placeholder">No custom flows configured. Click card to inspect endpoints.</div>`;
    }

    return flows.map((fl, flIdx) => {
        const isFlowSelected = selectedItem.type === 'flow' && 
                               selectedItem.parentType === parentType && 
                               (parentType === 'endpoint' ? selectedItem.endpointIndex === parentIdx : selectedItem.targetIndex === parentIdx) &&
                               selectedItem.flowIndex === flIdx;

        // Steps lists chronological timeline
        let stepsTimelineHtml = '';
        if (fl.steps && fl.steps.length > 0) {
            stepsTimelineHtml = fl.steps.map((st, stIdx) => {
                const isStepSelected = selectedItem.type === 'step' && 
                                       selectedItem.parentType === parentType &&
                                       (parentType === 'endpoint' ? selectedItem.endpointIndex === parentIdx : selectedItem.targetIndex === parentIdx) &&
                                       selectedItem.flowIndex === flIdx &&
                                       selectedItem.stepIndex === stIdx;
                
                // Lookup Policy
                const policyObj = proxyData.policies.find(p => p.name === st.name);
                const policyType = policyObj ? policyObj.type : "Unknown";
                const displayLabel = policyObj ? policyObj.displayName || policyObj.name : st.name;

                return `
                    <div class="step-node ${isStepSelected ? 'active-selection' : ''}" 
                         draggable="true"
                         data-parent-type="${parentType}"
                         data-parent-index="${parentIdx}"
                         data-flow-index="${flIdx}"
                         data-step-index="${stIdx}"
                         title="Drag step to reorder inside this flow">
                         
                        <div class="step-dot"></div>
                        
                        <div class="step-card-body">
                            <div class="step-info-group">
                                <span class="step-type-badge">${policyType}</span>
                                <span class="step-label">${displayLabel}</span>
                            </div>
                            
                            <div class="step-actions">
                                <button type="button" class="step-action-btn move-up" data-action="up" title="Move Up">
                                    <i data-lucide="arrow-up"></i>
                                </button>
                                <button type="button" class="step-action-btn move-down" data-action="down" title="Move Down">
                                    <i data-lucide="arrow-down"></i>
                                </button>
                                <button type="button" class="step-action-btn delete" data-action="delete" title="Delete Step">
                                    <i data-lucide="trash-2"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            stepsTimelineHtml = `<div class="empty-steps-placeholder">This flow has no active policies. Add a step below.</div>`;
        }

        const modeBadge = fl.mode ? `<span class="flow-mode-badge ${fl.mode.toLowerCase()}">${fl.mode}</span>` : '';

        return `
            <div class="flow-card ${isFlowSelected ? 'active-selection' : ''}" data-flow-idx="${flIdx}" data-parent-type="${parentType}" data-parent-idx="${parentIdx}">
                <div class="flow-header">
                    <div class="flow-title-group">
                        <i data-lucide="git-commit" class="flow-icon"></i>
                        <span>Flow: <strong>${fl.name}</strong></span>
                    </div>
                    ${modeBadge}
                </div>
                
                <div class="flow-steps-timeline">
                    ${stepsTimelineHtml}
                    
                    <div class="add-step-btn-container">
                        <button type="button" class="add-step-btn" data-action="add-step">
                            <i data-lucide="plus-circle"></i>
                            <span>Add Step Policy</span>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

/* ATTACH CLICK DELEGATES TO DYNAMIC HTML GENERATED IN VISUAL DIAGRAM */
function bindInteractiveDelegates() {
    // 1. Selecting flows
    document.querySelectorAll('.flow-header').forEach(hdr => {
        hdr.addEventListener('click', (e) => {
            e.stopPropagation();
            const parent = hdr.closest('.flow-card');
            const parentType = parent.dataset.parentType;
            const parentIdx = parseInt(parent.dataset.parentIdx);
            const flowIdx = parseInt(parent.dataset.flowIdx);
            
            const selection = { type: 'flow', parentType, flowIndex: flowIdx };
            if (parentType === 'endpoint') {
                selection.endpointIndex = parentIdx;
            } else {
                selection.targetIndex = parentIdx;
            }
            selectWorkspaceElement(selection);
        });
    });

    // 2. Selecting / acting on timeline steps
    document.querySelectorAll('.step-node').forEach(node => {
        node.addEventListener('click', (e) => {
            e.stopPropagation();
            const pType = node.dataset.parentType;
            const pIdx = parseInt(node.dataset.parentIndex);
            const flIdx = parseInt(node.dataset.flowIndex);
            const stIdx = parseInt(node.dataset.stepIndex);
            
            const selection = { type: 'step', parentType: pType, flowIndex: flIdx, stepIndex: stIdx };
            if (pType === 'endpoint') {
                selection.endpointIndex = pIdx;
            } else {
                selection.targetIndex = pIdx;
            }
            selectWorkspaceElement(selection);
        });
    });

    // 3. Click handler inside step controls (up/down/delete)
    document.querySelectorAll('.step-action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const stepNode = btn.closest('.step-node');
            const pType = stepNode.dataset.parentType;
            const pIdx = parseInt(stepNode.dataset.parentIndex);
            const flIdx = parseInt(stepNode.dataset.flowIndex);
            const stIdx = parseInt(stepNode.dataset.stepIndex);
            const action = btn.dataset.action;

            handleStepAction(action, pType, pIdx, flIdx, stIdx);
        });
    });

    // 4. Click handler for Add Step buttons
    document.querySelectorAll('.add-step-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const parent = btn.closest('.flow-card');
            const parentType = parent.dataset.parentType;
            const parentIdx = parseInt(parent.dataset.parentIdx);
            const flowIdx = parseInt(parent.dataset.flowIdx);
            
            addStepToFlow(parentType, parentIdx, flowIdx);
        });
    });
}

/* ==========================================================================
   WORKSPACE SELECTION & FOCUS CONTROL
   ========================================================================== */
function selectWorkspaceElement(selection) {
    selectedItem = selection;
    
    // Highlight elements visually inside visual canvas
    renderVisualCanvas();
    
    // Update the inspector forms and show values
    renderInspector();
}

/* ==========================================================================
   FORM INSPECTOR ENGINE & DYNAMIC INPUT BINDING
   ========================================================================== */
function renderInspector() {
    const heading = document.getElementById('inspector-heading');
    const desc = document.getElementById('inspector-description');
    const icon = document.getElementById('inspector-icon');
    const form = document.getElementById('inspector-form');
    const jsSection = document.getElementById('js-code-section');
    
    form.innerHTML = ''; // wipe form
    jsSection.classList.add('hidden'); // hide JS editor by default
    
    if (!proxyData) {
        heading.textContent = 'No selection';
        desc.textContent = 'Load a config first.';
        return;
    }

    // Adjust inspector header title and content based on selections
    if (selectedItem.type === 'proxy') {
        icon.className = "lucide-sliders";
        heading.textContent = "Proxy Core Settings";
        desc.textContent = "Global metadata for this API Proxy router.";
        
        form.innerHTML = `
            <div class="form-group">
                <label>Proxy Technical Name</label>
                <input type="text" class="form-control" id="form-proxy-name" value="${proxyData.name || ''}" placeholder="e.g. hello-world">
            </div>
            <div class="form-group">
                <label>Display Name</label>
                <input type="text" class="form-control" id="form-proxy-display" value="${proxyData.displayName || ''}">
            </div>
            <div class="form-group">
                <label>Proxy Description</label>
                <textarea class="form-control form-control-textarea" id="form-proxy-desc" placeholder="Describe what this gateway proxy does...">${proxyData.description || ''}</textarea>
            </div>
        `;
        
        // Setup direct state binding
        document.getElementById('form-proxy-name').addEventListener('input', (e) => {
            proxyData.name = e.target.value;
            document.getElementById('summary-proxy-name').textContent = `Proxy: ${e.target.value || 'Unnamed'}`;
            saveMemoryToRawCode();
        });
        document.getElementById('form-proxy-display').addEventListener('input', (e) => {
            proxyData.displayName = e.target.value;
            saveMemoryToRawCode();
        });
        document.getElementById('form-proxy-desc').addEventListener('input', (e) => {
            proxyData.description = e.target.value;
            saveMemoryToRawCode();
        });
        
    } else if (selectedItem.type === 'endpoint') {
        const ep = proxyData.endpoints[selectedItem.endpointIndex];
        icon.className = "lucide-log-in";
        heading.textContent = `Endpoint: ${ep.name}`;
        desc.textContent = "Exposes base paths that clients send API calls to.";
        
        form.innerHTML = `
            <div class="form-group">
                <label>Endpoint Name</label>
                <input type="text" class="form-control" id="form-ep-name" value="${ep.name || ''}">
            </div>
            <div class="form-group">
                <label>Client Base Path</label>
                <input type="text" class="form-control" id="form-ep-base" value="${ep.basePath || ''}" placeholder="/v1/my-path">
            </div>
        `;
        
        document.getElementById('form-ep-name').addEventListener('input', (e) => {
            ep.name = e.target.value;
            saveMemoryToRawCode();
        });
        document.getElementById('form-ep-base').addEventListener('input', (e) => {
            ep.basePath = e.target.value;
            saveMemoryToRawCode();
        });
        
    } else if (selectedItem.type === 'target') {
        const tgt = proxyData.targets[selectedItem.targetIndex];
        icon.className = "lucide-send";
        heading.textContent = `Target: ${tgt.name}`;
        desc.textContent = "Configure where the traffic is routed after policy evaluations.";
        
        const targetUrl = tgt.url || (tgt.httpTargetConnection ? tgt.httpTargetConnection.url : '');

        form.innerHTML = `
            <div class="form-group">
                <label>Target Name</label>
                <input type="text" class="form-control" id="form-tgt-name" value="${tgt.name || ''}">
            </div>
            <div class="form-group">
                <label>Destination Target URL</label>
                <input type="text" class="form-control" id="form-tgt-url" value="${targetUrl}" placeholder="https://backend-service.net">
            </div>
        `;
        
        document.getElementById('form-tgt-name').addEventListener('input', (e) => {
            tgt.name = e.target.value;
            saveMemoryToRawCode();
        });
        document.getElementById('form-tgt-url').addEventListener('input', (e) => {
            tgt.url = e.target.value;
            if (tgt.httpTargetConnection) {
                tgt.httpTargetConnection.url = e.target.value;
            } else {
                tgt.httpTargetConnection = { url: e.target.value, properties: {} };
            }
            saveMemoryToRawCode();
        });
        
    } else if (selectedItem.type === 'flow') {
        const flowsList = selectedItem.parentType === 'endpoint' ? 
                           proxyData.endpoints[selectedItem.endpointIndex].flows : 
                           proxyData.targets[selectedItem.targetIndex].flows;
        const fl = flowsList[selectedItem.flowIndex];
        
        icon.className = "lucide-git-commit";
        heading.textContent = `Flow: ${fl.name}`;
        desc.textContent = "Evaluate policies on request matching conditions.";
        
        form.innerHTML = `
            <div class="form-group">
                <label>Flow Name</label>
                <input type="text" class="form-control" id="form-flow-name" value="${fl.name || ''}">
            </div>
            <div class="form-group">
                <label>Execution Pipeline Mode</label>
                <select class="sidebar-select" id="form-flow-mode" style="background-color: var(--bg-surface); width:100%">
                    <option value="Request" ${fl.mode === 'Request' ? 'selected' : ''}>Request (Triggered before target request)</option>
                    <option value="Response" ${fl.mode === 'Response' ? 'selected' : ''}>Response (Triggered after target response)</option>
                </select>
            </div>
        `;
        
        document.getElementById('form-flow-name').addEventListener('input', (e) => {
            fl.name = e.target.value;
            saveMemoryToRawCode();
        });
        document.getElementById('form-flow-mode').addEventListener('change', (e) => {
            fl.mode = e.target.value;
            saveMemoryToRawCode();
            renderVisualCanvas(); // Re-render to show correct mode color badge immediately
        });
        
    } else if (selectedItem.type === 'step') {
        const flowsList = selectedItem.parentType === 'endpoint' ? 
                           proxyData.endpoints[selectedItem.endpointIndex].flows : 
                           proxyData.targets[selectedItem.targetIndex].flows;
        const fl = flowsList[selectedItem.flowIndex];
        const step = fl.steps[selectedItem.stepIndex];
        
        // Match associated policy
        const policyObj = proxyData.policies.find(p => p.name === step.name);
        
        icon.className = "lucide-info";
        heading.textContent = `Step: ${policyObj ? policyObj.displayName || policyObj.name : step.name}`;
        desc.textContent = "Evaluation properties for this specific policy step.";
        
        if (!policyObj) {
            form.innerHTML = `
                <div class="empty-steps-placeholder">
                    Warning: Policy named "${step.name}" not declared in policies list.
                </div>
            `;
            return;
        }

        // Gather metadata values
        let continueOnError = "false";
        let isEnabled = "true";
        let timeLimit = "200";
        
        if (policyObj.content) {
            // Depending on policy type, parse properties
            const typeKey = policyObj.type.toLowerCase();
            const details = policyObj.content[typeKey];
            if (details && details.metadata) {
                continueOnError = details.metadata.continueOnError || "false";
                isEnabled = details.metadata.enabled || "true";
                timeLimit = details.metadata.timeLimit || "200";
            }
        }

        form.innerHTML = `
            <div class="form-group">
                <label>Step Display Name</label>
                <input type="text" class="form-control" id="form-policy-display" value="${policyObj.displayName || policyObj.name}">
            </div>
            
            <div class="form-row-2">
                <div class="form-group row">
                    <label for="form-policy-enabled">Enabled</label>
                    <label class="switch">
                        <input type="checkbox" id="form-policy-enabled" ${isEnabled === "true" ? "checked" : ""}>
                        <span class="slider"></span>
                    </label>
                </div>
                
                <div class="form-group row">
                    <label for="form-policy-continue">Continue on Error</label>
                    <label class="switch">
                        <input type="checkbox" id="form-policy-continue" ${continueOnError === "true" ? "checked" : ""}>
                        <span class="slider"></span>
                    </label>
                </div>
            </div>
            
            <div class="form-group">
                <label>Policy Technical Type</label>
                <select class="sidebar-select" id="form-policy-type" style="background-color: var(--bg-surface); width:100%" disabled>
                    <option value="${policyObj.type}">${policyObj.type}</option>
                </select>
                <span class="copyright" style="text-align: left; margin-top:2px;">Contact system admin to mutate global types.</span>
            </div>
        `;

        // Direct input change handlers
        document.getElementById('form-policy-display').addEventListener('input', (e) => {
            policyObj.displayName = e.target.value;
            saveMemoryToRawCode();
            
            // Re-render only labels on visual steps so typing isn't lagging
            const activeStepNode = document.querySelector('.step-node.active-selection .step-label');
            if (activeStepNode) activeStepNode.textContent = e.target.value || policyObj.name;
        });

        document.getElementById('form-policy-enabled').addEventListener('change', (e) => {
            setPolicyMetadata(policyObj, 'enabled', e.target.checked ? "true" : "false");
            saveMemoryToRawCode();
        });

        document.getElementById('form-policy-continue').addEventListener('change', (e) => {
            setPolicyMetadata(policyObj, 'continueOnError', e.target.checked ? "true" : "false");
            saveMemoryToRawCode();
        });

        // SPECIAL CONDITIONAL: Render JavaScript code editor if type is Javascript
        if (policyObj.type === 'Javascript') {
            jsSection.classList.remove('hidden');
            
            // Extract resource details
            let resourceUrl = '';
            if (policyObj.content && policyObj.content.javascript) {
                resourceUrl = policyObj.content.javascript.resourceUrl || '';
            }
            
            const filename = resourceUrl.replace('jsc://', '');
            document.getElementById('js-filename-label').textContent = filename || 'script.js';
            
            // Lookup script contents in proxyData.resources
            let resourceObj = proxyData.resources.find(r => r.name === filename);
            if (!resourceObj && filename) {
                // Auto create empty resource so editor works
                resourceObj = { name: filename, type: 'jsc', content: '// Write your javascript script here...\n' };
                proxyData.resources.push(resourceObj);
                saveMemoryToRawCode();
            }
            
            const scriptCode = resourceObj ? resourceObj.content : '';
            
            // Set values inside Monaco/fallback textarea
            if (monacoLoaded && jsEditorInstance) {
                jsEditorInstance.setValue(scriptCode);
            } else {
                document.getElementById('js-code-textarea-fallback').value = scriptCode;
            }
        }
    }
    
    // Reactivate custom select boxes
    lucide.createIcons();
}

/* HELPER TO INJECT VALUES INSIDE DEEP COPIES OF POLICY METADATA */
function setPolicyMetadata(policyObj, key, value) {
    if (!policyObj.content) policyObj.content = {};
    const typeKey = policyObj.type.toLowerCase();
    if (!policyObj.content[typeKey]) policyObj.content[typeKey] = {};
    if (!policyObj.content[typeKey].metadata) policyObj.content[typeKey].metadata = {};
    
    policyObj.content[typeKey].metadata[key] = value;
}

/* SYNC MEMORY REPRESENTATION INTO TEXT SOURCES (WITHOUT DESTROYING FOCUS STATE) */
function saveMemoryToRawCode() {
    const rawYaml = getYamlText();
    if (monacoLoaded && yamlEditorInstance) {
        yamlEditorInstance.setValue(rawYaml);
    } else {
        document.getElementById('yaml-textarea-fallback').value = rawYaml;
    }
    updateEditorSyncStatus(true, "Synchronized");
}

/* LIVE MUTATES THE JS RESOURCE TEXT RECORD AND TRIGGERS AUTO-SAVE */
function updateJsResourceContent(jsContent) {
    if (selectedItem && selectedItem.type === 'step') {
        const flowsList = selectedItem.parentType === 'endpoint' ? 
                           proxyData.endpoints[selectedItem.endpointIndex].flows : 
                           proxyData.targets[selectedItem.targetIndex].flows;
        const fl = flowsList[selectedItem.flowIndex];
        const step = fl.steps[selectedItem.stepIndex];
        const policyObj = proxyData.policies.find(p => p.name === step.name);
        
        if (policyObj && policyObj.type === 'Javascript' && policyObj.content && policyObj.content.javascript) {
            const url = policyObj.content.javascript.resourceUrl || '';
            const filename = url.replace('jsc://', '');
            
            const resource = proxyData.resources.find(r => r.name === filename);
            if (resource) {
                resource.content = jsContent;
                saveMemoryToRawCode();
            }
        }
    }
}

/* ==========================================================================
   DYNAMIC STEP ACTIONS: CREATIONS & REMOVALS
   ========================================================================== */
function handleStepAction(action, parentType, parentIdx, flowIdx, stepIdx) {
    const epOrTgt = parentType === 'endpoint' ? proxyData.endpoints[parentIdx] : proxyData.targets[parentIdx];
    const flowObj = epOrTgt.flows[flowIdx];
    
    if (action === 'delete') {
        if (confirm("Are you sure you want to delete this step policy?")) {
            // Splice out the step
            flowObj.steps.splice(stepIdx, 1);
            
            // Adjust active selection
            selectedItem = { type: 'flow', parentType, flowIndex: flowIdx };
            if (parentType === 'endpoint') {
                selectedItem.endpointIndex = parentIdx;
            } else {
                selectedItem.targetIndex = parentIdx;
            }
            
            saveMemoryToRawCode();
            renderVisualCanvas();
            renderInspector();
        }
    } else if (action === 'up') {
        if (stepIdx > 0) {
            // Swap in array
            const temp = flowObj.steps[stepIdx];
            flowObj.steps[stepIdx] = flowObj.steps[stepIdx - 1];
            flowObj.steps[stepIdx - 1] = temp;
            
            // Move selection up
            selectedItem.stepIndex = stepIdx - 1;
            
            saveMemoryToRawCode();
            renderVisualCanvas();
            renderInspector();
        }
    } else if (action === 'down') {
        if (stepIdx < flowObj.steps.length - 1) {
            // Swap
            const temp = flowObj.steps[stepIdx];
            flowObj.steps[stepIdx] = flowObj.steps[stepIdx + 1];
            flowObj.steps[stepIdx + 1] = temp;
            
            // Move selection down
            selectedItem.stepIndex = stepIdx + 1;
            
            saveMemoryToRawCode();
            renderVisualCanvas();
            renderInspector();
        }
    }
}

function addStepToFlow(parentType, parentIdx, flowIdx) {
    // Show quick selection of policies to add
    const typeSelected = prompt(
        "Enter policy type to create:\n\n" +
        "1. Javascript (Runs JS scripts)\n" +
        "2. SpikeArrest (API Rate Limiting)\n" +
        "3. KeyValueMap (Fetch cache keys)\n" +
        "4. VerifyAPIKey (Validate client credentials)\n\n" +
        "Please type the name or select (e.g. 'SpikeArrest' or 'Javascript'):", 
        "Javascript"
    );
    
    if (!typeSelected) return; // user cancelled

    let normalizedType = "Javascript";
    if (typeSelected.toLowerCase().includes("spike")) normalizedType = "SpikeArrest";
    if (typeSelected.toLowerCase().includes("key")) normalizedType = "KeyValueMap";
    if (typeSelected.toLowerCase().includes("verify")) normalizedType = "VerifyAPIKey";

    // Generate unique names
    const randId = Math.floor(1000 + Math.random() * 9000);
    const policyName = `policy-${normalizedType}-${randId}`;
    const displayName = `${normalizedType} Policy`;

    // 1. Create policy definition structure
    const newPolicy = {
        name: policyName,
        type: normalizedType,
        content: {}
    };

    // Deep map content structures matching Apigee standards
    if (normalizedType === 'Javascript') {
        const scriptFile = `jsc-script-${randId}.js`;
        newPolicy.content.javascript = {
            metadata: {
                continueOnError: "false",
                enabled: "true",
                timeLimit: "200",
                name: policyName
            },
            displayName: displayName,
            properties: {},
            resourceUrl: `jsc://${scriptFile}`
        };
        
        // Also inject empty resource record
        proxyData.resources.push({
            name: scriptFile,
            type: "jsc",
            content: `// Dynamic script generated for ${policyName}\nvar header = context.getVariable("request.header.Authorization");\n`
        });
    } else if (normalizedType === 'SpikeArrest') {
        newPolicy.content.spikearrest = {
            metadata: {
                continueOnError: "false",
                enabled: "true",
                name: policyName
            },
            displayName: displayName,
            properties: {},
            rate: "10pm"
        };
    } else {
        // Fallback structures
        const typeLower = normalizedType.toLowerCase();
        newPolicy.content[typeLower] = {
            metadata: { continueOnError: "false", enabled: "true", name: policyName },
            displayName: displayName,
            properties: {}
        };
    }

    // Append to policies array
    proxyData.policies.push(newPolicy);

    // 2. Append step link to flow
    const epOrTgt = parentType === 'endpoint' ? proxyData.endpoints[parentIdx] : proxyData.targets[parentIdx];
    if (!epOrTgt.flows[flowIdx].steps) {
        epOrTgt.flows[flowIdx].steps = [];
    }
    epOrTgt.flows[flowIdx].steps.push({ name: policyName });

    // Select the newly added step
    selectedItem = {
        type: 'step',
        parentType,
        flowIndex: flowIdx,
        stepIndex: epOrTgt.flows[flowIdx].steps.length - 1
    };
    if (parentType === 'endpoint') {
        selectedItem.endpointIndex = parentIdx;
    } else {
        selectedItem.targetIndex = parentIdx;
    }

    // Save, render and notify user
    saveMemoryToRawCode();
    renderVisualCanvas();
    renderInspector();
}

/* ==========================================================================
   HTML5 DRAG AND DROP HANDLERS (STEP REORDERING WITHIN A FLOW)
   ========================================================================== */
function setupDragAndDrop() {
    const canvas = document.getElementById('visual-canvas');
    
    // Delegate drag start to children
    canvas.addEventListener('dragstart', (e) => {
        const stepNode = e.target.closest('.step-node');
        if (!stepNode) return;
        
        draggedStepElement = stepNode;
        stepNode.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        
        // Store visual indices inside drag event
        e.dataTransfer.setData('text/plain', JSON.stringify({
            parentType: stepNode.dataset.parentType,
            parentIdx: parseInt(stepNode.dataset.parentIndex),
            flowIdx: parseInt(stepNode.dataset.flowIndex),
            stepIdx: parseInt(stepNode.dataset.stepIndex)
        }));
    });

    canvas.addEventListener('dragend', (e) => {
        if (draggedStepElement) {
            draggedStepElement.classList.remove('dragging');
        }
        document.querySelectorAll('.step-node').forEach(node => {
            node.classList.remove('drag-over');
        });
        draggedStepElement = null;
    });

    canvas.addEventListener('dragover', (e) => {
        e.preventDefault();
        const stepNode = e.target.closest('.step-node');
        if (!stepNode || stepNode === draggedStepElement) return;
        
        // Ensure we only drop steps within the SAME parent & SAME flow
        if (stepNode.dataset.parentType === draggedStepElement.dataset.parentType &&
            stepNode.dataset.parentIndex === draggedStepElement.dataset.parentIndex &&
            stepNode.dataset.flowIndex === draggedStepElement.dataset.flowIndex) {
            
            stepNode.classList.add('drag-over');
        }
    });

    canvas.addEventListener('dragleave', (e) => {
        const stepNode = e.target.closest('.step-node');
        if (stepNode) {
            stepNode.classList.remove('drag-over');
        }
    });

    canvas.addEventListener('drop', (e) => {
        e.preventDefault();
        const dropTarget = e.target.closest('.step-node');
        if (!dropTarget || dropTarget === draggedStepElement) return;
        
        try {
            const dragData = JSON.parse(e.dataTransfer.getData('text/plain'));
            
            const dropParentType = dropTarget.dataset.parentType;
            const dropParentIdx = parseInt(dropTarget.dataset.parentIndex);
            const dropFlowIdx = parseInt(dropTarget.dataset.flowIndex);
            const dropStepIdx = parseInt(dropTarget.dataset.stepIndex);
            
            // Only reorder within the exact same flow container
            if (dragData.parentType === dropParentType &&
                dragData.parentIdx === dropParentIdx &&
                dragData.flowIdx === dropFlowIdx) {
                
                const epOrTgt = dropParentType === 'endpoint' ? 
                               proxyData.endpoints[dropParentIdx] : 
                               proxyData.targets[dropParentIdx];
                               
                const stepsArray = epOrTgt.flows[dropFlowIdx].steps;
                
                // Splice out the dragged index and insert it at drop index
                const draggedItem = stepsArray.splice(dragData.stepIdx, 1)[0];
                stepsArray.splice(dropStepIdx, 0, draggedItem);
                
                // Relocate selection
                selectedItem = {
                    type: 'step',
                    parentType: dropParentType,
                    flowIndex: dropFlowIdx,
                    stepIndex: dropStepIdx
                };
                if (dropParentType === 'endpoint') {
                    selectedItem.endpointIndex = dropParentIdx;
                } else {
                    selectedItem.targetIndex = dropParentIdx;
                }
                
                // Re-serialize YAML and render canvas/forms
                saveMemoryToRawCode();
                renderVisualCanvas();
                renderInspector();
            }
        } catch(err) {
            console.error("Drop evaluation failed:", err);
        }
    });
}

/* ==========================================================================
   WORKSPACE COLLAPSIBILITY & RESIZING INTEGRATION
   ========================================================================== */
function initSidebarCollapse() {
    const toggleBtn = document.getElementById('btn-sidebar-toggle');
    const sidebar = document.querySelector('.sidebar');
    if (!toggleBtn || !sidebar) return;

    // Handle click
    toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        const collapsed = sidebar.classList.contains('collapsed');
        localStorage.setItem('sidebar-collapsed', collapsed);
        
        // Force immediate and delayed layouts to capture intermediate transition width steps
        if (yamlEditorInstance) yamlEditorInstance.layout();
        if (jsEditorInstance) jsEditorInstance.layout();
        
        setTimeout(() => {
            if (yamlEditorInstance) yamlEditorInstance.layout();
            if (jsEditorInstance) jsEditorInstance.layout();
        }, 50);
    });

    // Recalculate editor geometry exactly when transition ends
    sidebar.addEventListener('transitionend', (e) => {
        if (e.propertyName === 'width') {
            if (yamlEditorInstance) yamlEditorInstance.layout();
            if (jsEditorInstance) jsEditorInstance.layout();
        }
    });
}

function initResizer() {
    const resizer = document.getElementById('pane-resizer');
    const editorPane = document.querySelector('.pane-editor');
    if (!resizer || !editorPane) return;

    // Load saved width from localStorage if exists
    const savedWidth = localStorage.getItem('pane-editor-width');
    if (savedWidth) {
        editorPane.style.width = savedWidth;
    }

    let isDragging = false;
    let startX = 0;
    let startWidth = 0;

    resizer.addEventListener('mousedown', function(e) {
        e.preventDefault();
        isDragging = true;
        startX = e.clientX;
        startWidth = editorPane.offsetWidth;
        
        resizer.classList.add('dragging');
        document.body.classList.add('resizing');

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    function onMouseMove(e) {
        if (!isDragging) return;
        // Since editor is on the right, dragging left (negative deltaX) should increase its width
        const deltaX = e.clientX - startX;
        let newWidth = startWidth - deltaX;

        // Apply boundary constraints
        const minWidth = 300;
        const maxWidth = window.innerWidth * 0.8;
        if (newWidth < minWidth) newWidth = minWidth;
        if (newWidth > maxWidth) newWidth = maxWidth;

        editorPane.style.width = `${newWidth}px`;

        // Real-time Monaco layouts
        if (yamlEditorInstance) yamlEditorInstance.layout();
        if (jsEditorInstance) jsEditorInstance.layout();
    }

    function onMouseUp() {
        if (!isDragging) return;
        isDragging = false;
        resizer.classList.remove('dragging');
        document.body.classList.remove('resizing');

        // Save layout width
        localStorage.setItem('pane-editor-width', editorPane.style.width);

        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        
        // Final frame layouts
        if (yamlEditorInstance) yamlEditorInstance.layout();
        if (jsEditorInstance) jsEditorInstance.layout();
    }
}

// Global window resize listener to ensure editor canvases always scale perfectly
window.addEventListener('resize', () => {
    if (yamlEditorInstance) yamlEditorInstance.layout();
    if (jsEditorInstance) jsEditorInstance.layout();
});
