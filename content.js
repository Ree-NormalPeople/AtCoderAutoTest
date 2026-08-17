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
      '<p class="aotr-subtitle">入力例をまとめてオンライン実行します（paiza.IO）</p>',
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
    });
    customInputEl.addEventListener("input", () => {
      saveDraft(editor.value, languageEl.value);
    });

    runButton.addEventListener("click", handleRunAllClick);
    customRunButton.addEventListener("click", handleRunCustomClick);
  }

  function setStatus(text) {
    const statusEl = document.getElementById("aotr-status");
    if (statusEl) {
      statusEl.textContent = text;
    }
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
        const expectedOutputBlock =
          typeof expectedOutput === "string"
            ? '<div><h4>想定出力</h4><pre>' + escapeHtml(expectedOutput || "(empty)") + "</pre></div>"
            : "";

        return [
          '<article class="aotr-case-card">',
          '<div class="aotr-case-header">',
          '<h3 class="aotr-case-title">' + escapeHtml(title) + "</h3>",
          '<span class="aotr-badge ' + resultBadgeClass(item.judgement) + '">' + item.judgement + "</span>",
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

        const runResult = await runPaizaCase({
          sourceCode,
          language: selectedLanguage,
          input: testCase.input
        });

        const detail = runResult.detail || {};
        const judgement = judgeCase(runResult, testCase.output);
        results.push({
          caseNumber: testCase.caseNumber,
          input: testCase.input,
          expectedOutput: testCase.output,
          detail,
          judgement
        });
      }

      renderResults(results);
      setStatus("完了");
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
      const runResult = await runPaizaCase({
        sourceCode,
        language: selectedLanguage,
        input: customInputEl.value
      });
      const detail = runResult.detail || {};
      const judgement = judgeCustomRun(runResult);
      renderResults([
        {
          title: "Custom Input",
          caseNumber: 1,
          input: customInputEl.value,
          detail,
          judgement
        }
      ]);
      setStatus("完了");
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
