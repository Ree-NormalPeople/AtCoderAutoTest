const PAIZA_BASE_URL = "https://api.paiza.io/runners";
const API_KEY = "guest";
const POLLING_INTERVAL_MS = 1200;
const MAX_POLLING_COUNT = 30;
const extensionApi = globalThis.browser || globalThis.chrome;

function buildQuery(params) {
  return new URLSearchParams(params).toString();
}

async function callPaizaCreate(sourceCode, language, input) {
  const body = new URLSearchParams({
    source_code: sourceCode,
    language,
    input,
    api_key: API_KEY
  });

  const response = await fetch(PAIZA_BASE_URL + "/create", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    throw new Error("Paiza create API failed with status " + response.status);
  }

  const data = await response.json();
  if (!data.id) {
    const errorMessage = data.error || "Paiza create API response has no id.";
    throw new Error(errorMessage);
  }
  return data;
}

async function callPaizaStatus(id) {
  const query = buildQuery({ id, api_key: API_KEY });
  const response = await fetch(PAIZA_BASE_URL + "/get_status?" + query, {
    method: "GET"
  });

  if (!response.ok) {
    throw new Error("Paiza status API failed with status " + response.status);
  }

  return response.json();
}

async function callPaizaDetail(id) {
  const query = buildQuery({ id, api_key: API_KEY });
  const response = await fetch(PAIZA_BASE_URL + "/get_detail?" + query, {
    method: "GET"
  });

  if (response.ok) {
    return response.json();
  }

  const fallbackResponse = await fetch(PAIZA_BASE_URL + "/get_details?" + query, {
    method: "GET"
  });
  if (!fallbackResponse.ok) {
    throw new Error("Paiza detail API failed with status " + fallbackResponse.status);
  }
  return fallbackResponse.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSingleCase(payload) {
  const createResult = await callPaizaCreate(
    payload.sourceCode,
    payload.language,
    payload.input
  );
  const id = createResult.id;

  let statusData = null;
  for (let i = 0; i < MAX_POLLING_COUNT; i += 1) {
    statusData = await callPaizaStatus(id);
    if (statusData.status === "completed") {
      break;
    }
    await sleep(POLLING_INTERVAL_MS);
  }

  if (!statusData || statusData.status !== "completed") {
    throw new Error("Execution did not complete in expected time.");
  }

  const detail = await callPaizaDetail(id);
  return {
    id,
    status: statusData.status,
    detail
  };
}

extensionApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "RUN_PAIZA_CASE") {
    return;
  }

  if (globalThis.browser && globalThis.browser.runtime) {
    return runSingleCase(message.payload)
      .then((result) => ({ ok: true, result }))
      .catch((error) => ({ ok: false, error: error.message }));
  }

  runSingleCase(message.payload)
    .then((result) => {
      sendResponse({ ok: true, result });
    })
    .catch((error) => {
      sendResponse({ ok: false, error: error.message });
    });

  return true;
});
