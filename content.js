(function () {
  "use strict";

  const EXECUTION_TIME_LIMIT_SECONDS = 2.0;
  const PANEL_ID = "atcoder-online-test-runner-panel";
  const extensionApi = globalThis.browser || globalThis.chrome;
  const STORAGE_KEY_PREFIX = "aotr-draft";
  const LANGUAGE_OPTIONS = [
    { value: "python3", label: "Python 3" },
    { value: "cpp", label: "C++" },
    { value: "c", label: "C" },
    { value: "javascript", label: "JavaScript" }
  ];
  const FALLBACK_LANGUAGE = "python3";
  // 普段使う言語をここで変更できます（python3 / cpp / c / javascript）READMEとPAIZA_SPEC_AND_DISCLAIMER.md参照
  const PREFERRED_LANGUAGE = "python3";
  // 本体実行する言語。cpp/c は paiza.IO フォールバック。
  const LOCAL_LANGUAGES = ["javascript", "python3"];
  const PYODIDE_VERSION = "0.26.4";
  // Blob Worker内から同梱Pyodideを読めない場合の予備 (CDN)。
  const PYODIDE_CDN_BASE = "https://cdn.jsdelivr.net/pyodide/v" + PYODIDE_VERSION + "/full/";
  let pyodideWorker = null;
  let pyodideWorkerSeq = 0;
  const pyodideWorkerPending = new Map();

  function getInitialLanguage() {
    if (LANGUAGE_OPTIONS.some((lang) => lang.value === PREFERRED_LANGUAGE)) {
      return PREFERRED_LANGUAGE;
    }
    return FALLBACK_LANGUAGE;
  }

  function collectTestCases() {
    const testCases = [];
    for (let i = 0; ; i += 2) {
      const inputEl = document.getElementById("pre-sample" + i);
      const outputEl = document.getElementById("pre-sample" + (i + 1));
      if (!inputEl || !outputEl) {
        break;
      }
      testCases.push({
        caseNumber: i / 2 + 1,
        input: (inputEl.textContent || "").trim(),
        output: (outputEl.textContent || "").trim()
      });
    }
    const halfCount = Math.floor(testCases.length / 2);
    if (halfCount > 0) {
      return testCases.slice(0, halfCount).map((testCase, index) => ({
        caseNumber: index + 1,
        input: testCase.input,
        output: testCase.output
      }));
    }
    return testCases;
  }

  function buildLanguageOptionsHtml() {
    const initialLanguage = getInitialLanguage();
    return LANGUAGE_OPTIONS.map((lang) => {
      const selected = lang.value === initialLanguage ? " selected" : "";
      return '<option value="' + lang.value + '"' + selected + ">" + lang.label + "</option>";
    }).join("");
  }

  function updateLineNumbers(editor, lineNumbersEl) {
    const lineCount = editor.value.split("\n").length;
    const lines = [];
    for (let i = 1; i <= lineCount; i += 1) {
      lines.push(String(i));
    }
    lineNumbersEl.textContent = lines.join("\n");
  }

  function syncLineNumberScroll(editor, lineNumbersEl) {
    lineNumbersEl.scrollTop = editor.scrollTop;
  }

  function getStorageKey(suffix) {
    return STORAGE_KEY_PREFIX + ":" + window.location.pathname + ":" + suffix;
  }

  function saveDraft(code, language) {
    try {
      localStorage.setItem(getStorageKey("code"), code);
      localStorage.setItem(getStorageKey("language"), language);
      const customInputEl = document.getElementById("aotr-custom-input");
      if (customInputEl && customInputEl instanceof HTMLTextAreaElement) {
        localStorage.setItem(getStorageKey("customInput"), customInputEl.value);
      }
    } catch (error) {
      console.error("Failed to save draft to localStorage.", error);
    }
  }

  function loadDraft() {
    try {
      return {
        code: localStorage.getItem(getStorageKey("code")),
        language: localStorage.getItem(getStorageKey("language")),
        customInput: localStorage.getItem(getStorageKey("customInput"))
      };
    } catch (error) {
      console.error("Failed to load draft from localStorage.", error);
      return { code: null, language: null, customInput: null };
    }
  }

  function createPanel() {
    if (document.getElementById(PANEL_ID)) {
      return;
    }

    const taskScreen = document.querySelector("#task-statement");
    const mountPoint = taskScreen ? taskScreen.parentElement : document.body;
    if (!mountPoint) {
      throw new Error("Could not find mount point for test runner panel.");
    }

    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.innerHTML = [
      '<div class="aotr-header">',
      '<h2 class="aotr-title">AtCoder Online Test Runner</h2>',
      '<p class="aotr-subtitle">入力例をまとめて実行します（本体高速実行＋paiza.IOフォールバック）</p>',
      "</div>",
      '<div class="aotr-editor-head">',
      '<label class="aotr-label" for="aotr-editor">コード</label>',
      '<label class="aotr-language-label" for="aotr-language">言語',
      '<select id="aotr-language" class="aotr-language-select">' + buildLanguageOptionsHtml() + "</select>",
      "</label>",
      "</div>",
      '<div class="aotr-editor-shell">',
      '<pre id="aotr-line-numbers" class="aotr-line-numbers" aria-hidden="true">1</pre>',
      '<textarea id="aotr-editor" class="aotr-editor" spellcheck="false" placeholder="ここにコードを貼り付けてください"></textarea>',
      "</div>",
      '<label class="aotr-label" for="aotr-custom-input">標準入力（自分で試す用）</label>',
      '<textarea id="aotr-custom-input" class="aotr-custom-input" spellcheck="false" placeholder="例: 3&#10;1 2 3"></textarea>',
      '<div class="aotr-actions">',
      '<button id="aotr-run-all" class="aotr-run-button" type="button">全テスト実行</button>',
      '<button id="aotr-run-custom" class="aotr-run-button aotr-run-sub-button" type="button">標準入力で実行</button>',
      '<span id="aotr-status" class="aotr-status">待機中</span>',
      "</div>",
      '<div id="aotr-error" class="aotr-error" role="alert" aria-live="polite"></div>',
      '<div id="aotr-results" class="aotr-results"></div>'
    ].join("");

    mountPoint.appendChild(panel);

    const runButton = document.getElementById("aotr-run-all");
    if (!runButton) {
      throw new Error("Run button was not created.");
    }
    const editor = document.getElementById("aotr-editor");
    const lineNumbersEl = document.getElementById("aotr-line-numbers");
    const languageEl = document.getElementById("aotr-language");
    const customInputEl = document.getElementById("aotr-custom-input");
    const customRunButton = document.getElementById("aotr-run-custom");
    if (!editor || !(editor instanceof HTMLTextAreaElement)) {
      throw new Error("Editor was not created.");
    }
    if (!lineNumbersEl) {
      throw new Error("Line number element was not created.");
    }
    if (!languageEl || !(languageEl instanceof HTMLSelectElement)) {
      throw new Error("Language select was not created.");
    }
    if (!customInputEl || !(customInputEl instanceof HTMLTextAreaElement)) {
      throw new Error("Custom input textarea was not created.");
    }
    if (!customRunButton || !(customRunButton instanceof HTMLButtonElement)) {
      throw new Error("Custom run button was not created.");
    }

    const draft = loadDraft();
    languageEl.value = getInitialLanguage();
    if (typeof draft.code === "string" && draft.code.length > 0) {
      editor.value = draft.code;
    }
    if (
      typeof draft.language === "string" &&
      LANGUAGE_OPTIONS.some((lang) => lang.value === draft.language)
    ) {
      languageEl.value = draft.language;
    }
    if (typeof draft.customInput === "string" && draft.customInput.length > 0) {
      customInputEl.value = draft.customInput;
    }

    updateLineNumbers(editor, lineNumbersEl);
    editor.addEventListener("input", () => {
      updateLineNumbers(editor, lineNumbersEl);
      saveDraft(editor.value, languageEl.value);
    });
    editor.addEventListener("scroll", () => {
      syncLineNumberScroll(editor, lineNumbersEl);
    });
    languageEl.addEventListener("change", () => {
      saveDraft(editor.value, languageEl.value);
      if (languageEl.value === "python3") {
        prewarmPyodideWorker();
      }
    });
    customInputEl.addEventListener("input", () => {
      saveDraft(editor.value, languageEl.value);
    });

    runButton.addEventListener("click", handleRunAllClick);
    customRunButton.addEventListener("click", handleRunCustomClick);

    if (languageEl.value === "python3") {
      prewarmPyodideWorker();
    }
  }

  function setStatus(text) {
    const statusEl = document.getElementById("aotr-status");
    if (statusEl) {
      statusEl.textContent = text;
    }
  }

  function formatCompletionStatus(items) {
    const fallbacks = items.filter((item) => item.engine === "paiza" && item.fallbackReason);
    if (fallbacks.length === 0) {
      const usedPaiza = items.some((item) => item.engine === "paiza");
      return usedPaiza ? "完了 (paiza.IO)" : "完了 (本体実行)";
    }
    const reason = String(fallbacks[0].fallbackReason || "");
    const short = reason.length > 80 ? reason.slice(0, 80) + "…" : reason;
    return "完了 (本体→paizaにフォールバック: " + short + ")";
  }

  function setError(message) {
    const errorEl = document.getElementById("aotr-error");
    if (!errorEl) {
      return;
    }
    errorEl.textContent = message || "";
    errorEl.style.display = message ? "block" : "none";
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function toSecondsNumber(value) {
    const parsed = Number(value);
    if (Number.isNaN(parsed) || parsed < 0) {
      return null;
    }
    return parsed;
  }

  function formatSeconds(value) {
    const seconds = toSecondsNumber(value);
    if (seconds === null) {
      return "-";
    }
    return seconds.toFixed(2) + "s";
  }

  function formatMemory(value) {
    const memory = Number(value);
    if (Number.isNaN(memory) || memory < 0) {
      return "-";
    }
    return memory.toFixed(0) + "KB";
  }

  function judgeCase(runResult, expectedOutput) {
    const detail = runResult.detail || {};
    const status = runResult.status || "";
    const stdout = (detail.stdout || "").trim();
    const stderr = (detail.stderr || "").trim();
    const expected = (expectedOutput || "").trim();
    const time = toSecondsNumber(detail.time);
    const buildResult = detail.build_result || "";

    if (buildResult === "failure") {
      return "CE";
    }
    if (status === "timeout" || (time !== null && time > EXECUTION_TIME_LIMIT_SECONDS)) {
      return "TLE";
    }
    if (stderr.length > 0) {
      return "RE";
    }
    if (stdout === expected) {
      return "AC";
    }
    return "WA";
  }

  function resultBadgeClass(result) {
    if (result === "OK") {
      return "aotr-badge-ok";
    }
    if (result === "AC") {
      return "aotr-badge-ac";
    }
    if (result === "WA") {
      return "aotr-badge-wa";
    }
    if (result === "TLE") {
      return "aotr-badge-tle";
    }
    if (result === "CE") {
      return "aotr-badge-ce";
    }
    return "aotr-badge-re";
  }

  function renderResults(results) {
    const resultsEl = document.getElementById("aotr-results");
    if (!resultsEl) {
      return;
    }

    const html = results
      .map((item) => {
        const actualOutput = (item.detail.stdout || "").trim();
        const expectedOutput = item.expectedOutput;
        const stderr = (item.detail.stderr || "").trim();
        const buildStderr = (item.detail.build_stderr || "").trim();
        const buildStdout = (item.detail.build_stdout || "").trim();
        const runtime = formatSeconds(item.detail.time);
        const memory = formatMemory(item.detail.memory);
        const title = item.title || ("Case " + item.caseNumber);
        const engine = item.engine === "paiza" ? "paiza" : "local";
        const engineLabel = engine === "paiza" ? "paiza" : "local";
        const expectedOutputBlock =
          typeof expectedOutput === "string"
            ? '<div><h4>想定出力</h4><pre>' + escapeHtml(expectedOutput || "(empty)") + "</pre></div>"
            : "";

        return [
          '<article class="aotr-case-card">',
          '<div class="aotr-case-header">',
          '<h3 class="aotr-case-title">' + escapeHtml(title) + "</h3>",
          '<span class="aotr-badge ' + resultBadgeClass(item.judgement) + '">' + item.judgement + "</span>",
          '<span class="aotr-engine">Engine: ' + escapeHtml(engineLabel) + "</span>",
          '<span class="aotr-time">Time: ' + runtime + "</span>",
          '<span class="aotr-memory">Memory: ' + memory + "</span>",
          "</div>",
          '<details class="aotr-detail-block">',
          "<summary>入出力を表示</summary>",
          '<div class="aotr-io-grid">',
          '<div><h4>入力</h4><pre>' + escapeHtml(item.input) + "</pre></div>",
          '<div><h4>実際の出力</h4><pre>' + escapeHtml(actualOutput || "(empty)") + "</pre></div>",
          expectedOutputBlock,
          "</div>",
          buildStdout ? '<div class="aotr-stderr"><h4>build stdout</h4><pre>' + escapeHtml(buildStdout) + "</pre></div>" : "",
          buildStderr ? '<div class="aotr-stderr"><h4>build stderr</h4><pre>' + escapeHtml(buildStderr) + "</pre></div>" : "",
          stderr ? '<div class="aotr-stderr"><h4>stderr</h4><pre>' + escapeHtml(stderr) + "</pre></div>" : "",
          "</details>",
          "</article>"
        ].join("");
      })
      .join("");

    resultsEl.innerHTML = html;
  }

  function judgeCustomRun(runResult) {
    const detail = runResult.detail || {};
    const status = runResult.status || "";
    const stderr = (detail.stderr || "").trim();
    const time = toSecondsNumber(detail.time);
    const buildResult = detail.build_result || "";

    if (buildResult === "failure") {
      return "CE";
    }
    if (status === "timeout" || (time !== null && time > EXECUTION_TIME_LIMIT_SECONDS)) {
      return "TLE";
    }
    if (stderr.length > 0) {
      return "RE";
    }
    return "OK";
  }

  function getRunContext() {
    const editor = document.getElementById("aotr-editor");
    if (!editor || !(editor instanceof HTMLTextAreaElement)) {
      setError("エディタが見つかりません。ページを再読み込みしてください。");
      return null;
    }
    const sourceCode = editor.value;
    if (!sourceCode.trim()) {
      setError("コードを入力してから実行してください。");
      return null;
    }

    const languageEl = document.getElementById("aotr-language");
    if (!languageEl || !(languageEl instanceof HTMLSelectElement)) {
      setError("言語選択が見つかりません。ページを再読み込みしてください。");
      return null;
    }
    return {
      sourceCode,
      selectedLanguage: languageEl.value
    };
  }

  function getPyodideAssetUrls() {
    const runtimeApi = extensionApi && extensionApi.runtime;
    const getUrl =
      runtimeApi && typeof runtimeApi.getURL === "function"
        ? (path) => runtimeApi.getURL(path)
        : null;
    if (!getUrl) {
      throw new Error("拡張機能のURLを取得できません。");
    }
    const base = getUrl("vendor/pyodide/");
    return {
      pyodideJsUrl: base + "pyodide.js",
      indexURL: base,
      cdnJsUrl: PYODIDE_CDN_BASE + "pyodide.js",
      cdnIndexURL: PYODIDE_CDN_BASE
    };
  }

  // Pyodideを動かすBlob Workerの起動コード。
  // ページ由来のWorkerなので拡張機能CSPの影響を受けず、Chrome/Firefox共通で動く。
  function buildPyodideWorkerSource(urls) {
    return [
      "const __AOTR_URLS = " + JSON.stringify(urls) + ";",
      "let __aotr_pyodide = null;",
      "async function __aotr_ensure() {",
      "  if (__aotr_pyodide) return __aotr_pyodide;",
      "  try {",
      "    importScripts(__AOTR_URLS.pyodideJsUrl);",
      "    __aotr_pyodide = await loadPyodide({ indexURL: __AOTR_URLS.indexURL });",
      "    return __aotr_pyodide;",
      "  } catch (e) {",
      "    self.postMessage({ type: 'AOTR_PYODIDE_VENDOR_FAILED', error: (e && e.message) || String(e) });",
      "  }",
      "  importScripts(__AOTR_URLS.cdnJsUrl);",
      "  __aotr_pyodide = await loadPyodide({ indexURL: __AOTR_URLS.cdnIndexURL });",
      "  return __aotr_pyodide;",
      "}",
      "async function __aotr_run(id, sourceCode, input) {",
      "  const started = performance.now();",
      "  try {",
      "    const pyodide = await __aotr_ensure();",
      "    pyodide.globals.set('__aotr_input_text', (typeof input === 'string') ? input : '');",
      "    await pyodide.runPythonAsync('import io, sys\\nsys.stdin = io.StringIO(__aotr_input_text)\\nsys.stdout = io.StringIO()\\nsys.stderr = io.StringIO()\\n');",
      "    let stderr = '';",
      "    try {",
      "      await pyodide.runPythonAsync(sourceCode);",
      "    } catch (e) {",
      "      try { stderr = await pyodide.runPythonAsync('sys.stderr.getvalue()'); } catch (ignored) {}",
      "      if (!stderr) stderr = (e && e.message) || String(e);",
      "    }",
      "    let stdout = '';",
      "    try { stdout = await pyodide.runPythonAsync('sys.stdout.getvalue()'); } catch (ignored) {}",
      "    if (!stderr) { try { stderr = await pyodide.runPythonAsync('sys.stderr.getvalue()'); } catch (ignored) {} }",
      "    self.postMessage({ id, ok: true, result: { status: 'completed', detail: { stdout: (typeof stdout === 'string') ? stdout : String(stdout || ''), stderr: (typeof stderr === 'string') ? stderr : String(stderr || ''), time: (performance.now() - started) / 1000, memory: -1, build_result: '', build_stdout: '', build_stderr: '' } } });",
      "  } catch (e) {",
      "    self.postMessage({ id, ok: false, error: (e && e.message) || String(e) });",
      "  }",
      "}",
      "self.onmessage = function (event) {",
      "  const msg = event.data || {};",
      "  if (msg.type === 'AOTR_RUN_PYTHON') { __aotr_run(msg.id, msg.payload.sourceCode, msg.payload.input); }",
      "  else if (msg.type === 'AOTR_WARMUP') { __aotr_ensure().then(function () { self.postMessage({ type: 'AOTR_WARMED' }); }, function (e) { self.postMessage({ type: 'AOTR_WARMED', error: (e && e.message) || String(e) }); }); }",
      "};"
    ].join("\n");
  }

  function ensurePyodideWorker() {
    if (pyodideWorker) {
      return pyodideWorker;
    }
    if (typeof Worker === "undefined" || typeof Blob === "undefined") {
      throw new Error("この環境ではWeb Workerが使えません。");
    }
    const urls = getPyodideAssetUrls();
    const blob = new Blob([buildPyodideWorkerSource(urls)], { type: "text/javascript" });
    const blobUrl = URL.createObjectURL(blob);
    const worker = new Worker(blobUrl);
    worker.onmessage = (event) => {
      const data = event.data;
      if (!data || typeof data !== "object") {
        return;
      }
      if (typeof data.id !== "undefined") {
        const pending = pyodideWorkerPending.get(data.id);
        if (pending) {
          pyodideWorkerPending.delete(data.id);
          pending(data);
        }
      }
    };
    worker.onerror = (event) => {
      const message =
        (event && event.message) || (event && event.error && event.error.message) || "Worker error";
      pyodideWorkerPending.forEach((pending) => {
        try {
          pending({ ok: false, error: String(message) });
        } catch (ignored) {}
      });
      pyodideWorkerPending.clear();
    };
    pyodideWorker = worker;
    pyodideWorker._aotrBlobUrl = blobUrl;
    return worker;
  }

  function prewarmPyodideWorker() {
    try {
      const worker = ensurePyodideWorker();
      try {
        worker.postMessage({ type: "AOTR_WARMUP" });
      } catch (ignored) {}
    } catch (ignored) {}
  }

  // 無限ループ等で固まったWorkerを破棄し、次回実行時に作り直す。
  function resetPyodideWorker() {
    if (pyodideWorker) {
      try {
        pyodideWorker.terminate();
      } catch (ignored) {}
      try {
        URL.revokeObjectURL(pyodideWorker._aotrBlobUrl);
      } catch (ignored) {}
      pyodideWorker = null;
    }
    pyodideWorkerPending.forEach((pending) => {
      try {
        pending({ ok: false, error: "Python実行環境を再生成したため中断しました。" });
      } catch (ignored) {}
    });
    pyodideWorkerPending.clear();
  }

  function runJavaScriptLocal(sourceCode, input) {
    const startedAt = performance.now();
    const safeInput = typeof input === "string" ? input : "";
    const workerSource = [
      "let __aotr_stdout = '';",
      "const __AOTR_INPUT = " + JSON.stringify(safeInput) + ";",
      "const __aotr_user_code = " + JSON.stringify(sourceCode) + ";",
      "const __aotr_lines = __AOTR_INPUT.split('\\n');",
      "let __aotr_lineIdx = 0;",
      "function __aotr_push(s) { __aotr_stdout += String(s); }",
      "const __aotr_console = {",
      "  log: function () { __aotr_push(Array.prototype.map.call(arguments, function (x) { try { return typeof x === 'string' ? x : JSON.stringify(x); } catch (e) { return String(x); } }).join(' ') + '\\n'); },",
      "  error: function () { __aotr_push(Array.prototype.map.call(arguments, String).join(' ') + '\\n'); },",
      "  warn: function () { __aotr_push(Array.prototype.map.call(arguments, String).join(' ') + '\\n'); },",
      "  info: function () { __aotr_push(Array.prototype.map.call(arguments, String).join(' ') + '\\n'); }",
      "};",
      "const fs = { readFileSync: function (fd) { if (fd === 0 || fd === '/dev/stdin' || fd === '/dev/stdin.txt') return __AOTR_INPUT; return ''; } };",
      "function __aotr_require(name) { if (name === 'fs') return fs; throw new Error(\"Cannot find module '\" + name + \"'\"); }",
      "const process = { argv: ['node', 'main.js'], stdout: { write: function (s) { __aotr_push(s); } }, stderr: { write: function (s) { __aotr_push(s); } }, exit: function (c) { throw new Error('__AOTR_EXIT__:' + c); } };",
      "function readline() { const v = __aotr_lines[__aotr_lineIdx]; __aotr_lineIdx += 1; return v === undefined ? '' : v; }",
      "try {",
      "  const __aotr_fn = new Function('console', 'require', 'fs', 'process', 'readline', 'module', 'exports', __aotr_user_code);",
      "  __aotr_fn(__aotr_console, __aotr_require, fs, process, readline, { exports: {} }, {});",
      "  self.postMessage({ ok: true, stdout: __aotr_stdout, stderr: '' });",
      "} catch (e) {",
      "  const msg = (e && e.message) ? e.message : String(e);",
      "  if (msg.indexOf('__AOTR_EXIT__:') === 0) { self.postMessage({ ok: true, stdout: __aotr_stdout, stderr: '' }); }",
      "  else { self.postMessage({ ok: false, stdout: __aotr_stdout, stderr: msg + '\\n' + ((e && e.stack) ? e.stack : '') }); }",
      "}"
    ].join("\n");

    return new Promise((resolve, reject) => {
      if (typeof Worker === "undefined") {
        reject(new Error("この環境ではWeb Workerが使えません。"));
        return;
      }
      const finish = (status, stdout, stderr) => {
        const elapsed = (performance.now() - startedAt) / 1000;
        resolve({
          status,
          detail: {
            stdout: stdout || "",
            stderr: stderr || "",
            time: elapsed,
            memory: -1,
            build_result: "",
            build_stdout: "",
            build_stderr: ""
          }
        });
      };
      let worker = null;
      try {
        const blob = new Blob([workerSource], { type: "text/javascript" });
        const url = URL.createObjectURL(blob);
        worker = new Worker(url);
        const timer = setTimeout(() => {
          try {
            worker.terminate();
          } catch (ignored) {}
          try {
            URL.revokeObjectURL(url);
          } catch (ignored) {}
          finish("timeout", "", "");
        }, Math.ceil(EXECUTION_TIME_LIMIT_SECONDS * 1000));
        worker.onmessage = (event) => {
          clearTimeout(timer);
          try {
            worker.terminate();
          } catch (ignored) {}
          try {
            URL.revokeObjectURL(url);
          } catch (ignored) {}
          const data = event.data || {};
          finish("completed", data.stdout || "", data.stderr || "");
        };
        worker.onerror = (event) => {
          clearTimeout(timer);
          try {
            worker.terminate();
          } catch (ignored) {}
          try {
            URL.revokeObjectURL(url);
          } catch (ignored) {}
          const message =
            (event && event.message) || (event && event.error && event.error.message) || "Worker error";
          finish("completed", "", String(message));
        };
      } catch (error) {
        // Worker生成自体の失敗は環境起因とみなし、paizaフォールバックのためrejectする。
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  function runPythonLocal(sourceCode, input) {
    let worker;
    try {
      worker = ensurePyodideWorker();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return new Promise((resolve, reject) => {
      const id = (pyodideWorkerSeq += 1);
      const timer = setTimeout(() => {
        pyodideWorkerPending.delete(id);
        resetPyodideWorker();
        reject(new Error("Python本体実行がタイムアウトしました。"));
      }, 30000);
      pyodideWorkerPending.set(id, (response) => {
        clearTimeout(timer);
        if (response && response.ok) {
          resolve(response.result);
        } else {
          reject(new Error((response && response.error) || "Python本体実行に失敗しました。"));
        }
      });
      try {
        worker.postMessage({ type: "AOTR_RUN_PYTHON", id, payload: { sourceCode, input } });
      } catch (error) {
        clearTimeout(timer);
        pyodideWorkerPending.delete(id);
        resetPyodideWorker();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  function isLocalLanguage(language) {
    return LOCAL_LANGUAGES.indexOf(language) !== -1;
  }

  function toFallbackResult(runResult, localError) {
    const reason = localError instanceof Error ? localError.message : String(localError);
    const detail = runResult.detail || {};
    const note = "[本体実行に失敗したためpaiza.IOにフォールバック: " + reason + "]";
    detail.build_stderr = detail.build_stderr ? detail.build_stderr + "\n" + note : note;
    runResult.detail = detail;
    return { runResult, engine: "paiza", fallbackReason: reason };
  }

  function runCaseWithEngine(payload, hooks) {
    const notify = (hooks && hooks.onPythonWarmup) || null;
    if (payload.language === "javascript") {
      return runJavaScriptLocal(payload.sourceCode, payload.input).then(
        (runResult) => ({ runResult, engine: "local" }),
        (localError) => runPaizaCase(payload).then((runResult) => toFallbackResult(runResult, localError))
      );
    }
    if (payload.language === "python3") {
      if (notify) {
        try {
          notify();
        } catch (ignored) {}
      }
      return runPythonLocal(payload.sourceCode, payload.input).then(
        (runResult) => {
          if (runResult && runResult.status === "timeout") {
            resetPyodideWorker();
          }
          return { runResult, engine: "local" };
        },
        (localError) => {
          resetPyodideWorker();
          return runPaizaCase(payload).then((runResult) => toFallbackResult(runResult, localError));
        }
      );
    }
    return runPaizaCase(payload).then((runResult) => ({ runResult, engine: "paiza" }));
  }

  function runPaizaCase(payload) {
    const message = { type: "RUN_PAIZA_CASE", payload };
    if (globalThis.browser && globalThis.browser.runtime) {
      return globalThis.browser.runtime.sendMessage(message).then((response) => {
        if (!response) {
          throw new Error("No response from background script.");
        }
        if (!response.ok) {
          throw new Error(response.error || "Failed to execute case.");
        }
        return response.result;
      });
    }

    return new Promise((resolve, reject) => {
      extensionApi.runtime.sendMessage(message, (response) => {
        const runtimeApi = extensionApi.runtime;
        const lastError = runtimeApi && runtimeApi.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        if (!response) {
          reject(new Error("No response from background script."));
          return;
        }
        if (!response.ok) {
          reject(new Error(response.error || "Failed to execute case."));
          return;
        }
        resolve(response.result);
      });
    });
  }

  async function handleRunAllClick() {
    setError("");
    const runContext = getRunContext();
    if (!runContext) {
      return;
    }
    const sourceCode = runContext.sourceCode;
    const selectedLanguage = runContext.selectedLanguage;

    const testCases = collectTestCases();
    if (testCases.length === 0) {
      setError("入力例が見つかりませんでした。");
      return;
    }

    const runButton = document.getElementById("aotr-run-all");
    const customRunButton = document.getElementById("aotr-run-custom");
    if (!runButton || !(runButton instanceof HTMLButtonElement)) {
      setError("実行ボタンが見つかりません。ページを再読み込みしてください。");
      return;
    }
    if (!customRunButton || !(customRunButton instanceof HTMLButtonElement)) {
      setError("標準入力実行ボタンが見つかりません。ページを再読み込みしてください。");
      return;
    }
    runButton.disabled = true;
    customRunButton.disabled = true;
    setStatus("実行中...");

    const results = [];
    try {
      for (let i = 0; i < testCases.length; i += 1) {
        const testCase = testCases[i];
        setStatus("実行中... Case " + testCase.caseNumber + "/" + testCases.length);

        const executed = await runCaseWithEngine(
          {
            sourceCode,
            language: selectedLanguage,
            input: testCase.input
          },
          {
            onPythonWarmup: () => {
              setStatus(
                "実行中... Case " + testCase.caseNumber + "/" + testCases.length + " (本体準備中)"
              );
            }
          }
        );
        const runResult = executed.runResult;

        const detail = runResult.detail || {};
        const judgement = judgeCase(runResult, testCase.output);
        results.push({
          caseNumber: testCase.caseNumber,
          input: testCase.input,
          expectedOutput: testCase.output,
          detail,
          judgement,
          engine: executed.engine,
          fallbackReason: executed.fallbackReason
        });
      }

      renderResults(results);
      setStatus(formatCompletionStatus(results));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError("実行中にエラーが発生しました: " + message);
      setStatus("エラー");
    } finally {
      runButton.disabled = false;
      customRunButton.disabled = false;
    }
  }

  async function handleRunCustomClick() {
    setError("");
    const runContext = getRunContext();
    if (!runContext) {
      return;
    }
    const sourceCode = runContext.sourceCode;
    const selectedLanguage = runContext.selectedLanguage;

    const customInputEl = document.getElementById("aotr-custom-input");
    if (!customInputEl || !(customInputEl instanceof HTMLTextAreaElement)) {
      setError("標準入力欄が見つかりません。ページを再読み込みしてください。");
      return;
    }
    const runButton = document.getElementById("aotr-run-all");
    const customRunButton = document.getElementById("aotr-run-custom");
    if (
      !runButton ||
      !(runButton instanceof HTMLButtonElement) ||
      !customRunButton ||
      !(customRunButton instanceof HTMLButtonElement)
    ) {
      setError("実行ボタンが見つかりません。ページを再読み込みしてください。");
      return;
    }

    runButton.disabled = true;
    customRunButton.disabled = true;
    setStatus("標準入力で実行中...");

    try {
      const executed = await runCaseWithEngine({
        sourceCode,
        language: selectedLanguage,
        input: customInputEl.value
      });
      const runResult = executed.runResult;
      const detail = runResult.detail || {};
      const judgement = judgeCustomRun(runResult);
      renderResults([
        {
          title: "Custom Input",
          caseNumber: 1,
          input: customInputEl.value,
          detail,
          judgement,
          engine: executed.engine,
          fallbackReason: executed.fallbackReason
        }
      ]);
      setStatus(
        formatCompletionStatus([{ engine: executed.engine, fallbackReason: executed.fallbackReason }])
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError("実行中にエラーが発生しました: " + message);
      setStatus("エラー");
    } finally {
      runButton.disabled = false;
      customRunButton.disabled = false;
    }
  }

  createPanel();
})();
