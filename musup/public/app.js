const state = {
  status: null,
  settings: null,
  chats: [],
  events: [],
  summaries: [],
  promptTemplate: null,
  promptVersions: [],
  auth: {
    configured: false,
    authenticated: false,
  },
  view: "monitor",
  chatScope: "all",
  summaryScope: "all",
  digestTimes: [],
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const views = new Set(["whatsapp", "config", "summaries", "monitor"]);

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    credentials: "same-origin",
    ...options,
  });

  if (!response.ok) {
    const text = await response.text();
    if (response.status === 401) {
      state.auth.authenticated = false;
      showAuthScreen();
    }
    throw new Error(text || `Request failed: ${response.status}`);
  }

  return response.json();
}

async function authApi(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    credentials: "same-origin",
    ...options,
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(body.error || text || `Request failed: ${response.status}`);
  }
  return body;
}

function setAppAuthenticated(authenticated) {
  state.auth.authenticated = authenticated;
  $(".app-shell").classList.toggle("auth-hidden", !authenticated);
  $("#auth-screen").classList.toggle("active", !authenticated);
}

function showAuthScreen() {
  const setupMode = !state.auth.configured;
  $("#auth-title").textContent = setupMode ? "Set admin password" : "Sign in";
  $("#auth-subtitle").textContent = setupMode
    ? "Create the local admin password"
    : "Admin access";
  $("#auth-submit").textContent = setupMode ? "Set password" : "Continue";
  $("#auth-password").autocomplete = setupMode ? "new-password" : "current-password";
  $("#auth-password").value = "";
  $("#auth-result").textContent = "";
  setAppAuthenticated(false);
  $("#auth-password").focus();
}

async function initAuth() {
  const auth = await authApi("/api/auth/status");
  state.auth = {
    configured: Boolean(auth.configured),
    authenticated: Boolean(auth.authenticated),
  };

  if (!state.auth.authenticated) {
    showAuthScreen();
    return false;
  }

  setAppAuthenticated(true);
  return true;
}

function getViewFromHash() {
  const view = window.location.hash.replace(/^#/, "");
  return views.has(view) ? view : "whatsapp";
}

function setView(view, updateHash = true) {
  if (!views.has(view)) view = "whatsapp";
  state.view = view;
  $$(".view").forEach((el) =>
    el.classList.toggle("active", el.id === `view-${view}`),
  );
  $$(".nav-item").forEach((el) =>
    el.classList.toggle("active", el.dataset.view === view),
  );
  $("#page-title").textContent = view[0].toUpperCase() + view.slice(1);
  if (updateHash && window.location.hash !== `#${view}`) {
    window.history.replaceState(null, "", `#${view}`);
  }
}

function renderStatus() {
  const runtime = state.status?.runtime;
  const connection = runtime?.whatsapp?.connection || "starting";
  const digest = runtime?.digest || {};
  const activity = runtime?.activity || {};
  const chatStats = state.status?.chatStats || {};
  const pill = $("#connection-pill");

  $("#connection-label").textContent = connection.replace("_", " ");
  pill.textContent = connection;
  pill.className = "pill";
  pill.classList.add(
    connection === "open" ? "ok" : connection === "qr" ? "warn" : "neutral",
  );

  $("#metric-detected").textContent = runtime?.counters?.detectedChats ?? 0;
  $("#metric-saved").textContent = runtime?.counters?.savedMessages ?? 0;
  $("#metric-skipped").textContent = runtime?.counters?.skippedMessages ?? 0;
  $("#metric-last-saved").textContent = relativeTime(
    activity.lastSavedMessageAt,
  );
  $("#summary-label").textContent = state.status?.summarizationEnabled
    ? "Enabled"
    : "Disabled";
  $("#digest-status").textContent = digest.running
    ? "Running"
    : digest.lastStatus
      ? digest.lastStatus
      : "Never";
  $("#digest-next-run").textContent = formatDateTimeWithZone(
    digest.nextScheduledAt,
  );
  $("#digest-duration").textContent =
    typeof digest.lastDurationMs === "number"
      ? `${digest.lastDurationMs} ms`
      : "-";
  $("#digest-reason").textContent =
    digest.lastError ||
    digest.lastReason ||
    "Summarization runs only when enabled and configured.";
  $("#app-uptime").textContent = formatDuration(
    state.status?.uptimeSeconds || 0,
  );
  $("#app-started").textContent = formatDate(runtime?.startedAt);
  $("#whatsapp-changed").textContent = relativeTime(
    runtime?.whatsapp?.lastChangeAt,
  );
  $("#monitor-chat-total").textContent = chatStats.total ?? 0;
  $("#monitor-chat-subscribed").textContent = chatStats.subscribed ?? 0;
  $("#monitor-chat-types").textContent =
    `${chatStats.groups ?? 0} / ${chatStats.contacts ?? 0}`;
  const latestBackfill = state.status?.backfills?.[0];
  $("#monitor-last-backfill").textContent = latestBackfill
    ? `${latestBackfill.status} · ${latestBackfill.savedMessages ?? 0}/${latestBackfill.receivedMessages ?? 0}`
    : "-";

  $(".qr-panel").classList.toggle("connected", connection === "open");
  const qrBox = $("#qr-box");
  qrBox.innerHTML = "";
  if (state.status?.qrAvailable) {
    const img = document.createElement("img");
    img.src = `/api/qr?ts=${Date.now()}`;
    img.alt = "WhatsApp login QR";
    qrBox.append(img);
  } else {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent =
      connection === "open"
        ? "WhatsApp is connected."
        : "QR code will appear here when WhatsApp needs login.";
    qrBox.append(empty);
  }
}

function renderSettings() {
  if (!state.settings) return;

  $("#summarization-enabled").checked = Boolean(
    state.settings.summarizationEnabled,
  );
  $("#summary-language").value = state.settings.summaryLanguage || "Russian";
  $("#whatsapp-delivery-enabled").checked = Boolean(
    state.settings.whatsappDeliveryEnabled,
  );
  renderWhatsappDeliveryTargets();
  $("#telegram-enabled").checked = Boolean(state.settings.telegramEnabled);
  const storedDigestTimes = normalizeDigestTimes(
    state.settings.digestTimes?.length
      ? state.settings.digestTimes
      : cronToTimes(state.settings.digestCron || "0 0 9,18 * * ?"),
  );
  state.digestTimes = convertStoredTimesToBrowser(
    storedDigestTimes,
    state.settings.digestTimezone || getBrowserTimezone(),
  );
  renderScheduleTimes();
  $("#llm-api-url").value = state.settings.llmApiUrl || "";
  $("#llm-model").value = state.settings.llmModel || "";
  $("#llm-api-key").value = state.settings.llmApiKey || "";
  $("#telegram-bot-token").value = state.settings.telegramBotToken || "";
  $("#telegram-chat-ids").value = (state.settings.telegramChatIds || []).join(
    "\n",
  );
  const missing = getMissingSummarySettings(state.settings);
  $("#settings-readiness").textContent = missing.length
    ? `Missing: ${missing.join(", ")}`
    : "";
}

function renderWhatsappDeliveryTargets() {
  const select = $("#whatsapp-delivery-chat");
  const selectedJid = state.settings?.whatsappDeliveryChatJid || "";
  select.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a chat";
  placeholder.selected = !selectedJid;
  select.append(placeholder);

  for (const chat of state.chats) {
    const option = document.createElement("option");
    option.value = chat.jid;
    option.textContent = `${chat.name || chat.jid} · ${chat.type}${
      chat.subscribed ? " · subscribed source" : ""
    }`;
    option.disabled = Boolean(chat.subscribed);
    option.selected = chat.jid === selectedJid;
    select.append(option);
  }

  const selectedChat = state.chats.find((chat) => chat.jid === selectedJid);
  const hint = $("#whatsapp-delivery-hint");
  if (selectedChat?.subscribed) {
    hint.textContent = "Selected target is subscribed and cannot receive digests.";
  } else if (state.chats.length === 0) {
    hint.textContent = "Known chats will appear after WhatsApp detects them.";
  } else {
    hint.textContent = "Subscribed source chats are not valid delivery targets.";
  }
}

function setSaveDirty(selector, dirty) {
  const button = $(selector);
  if (button) button.classList.toggle("dirty", Boolean(dirty));
}

function clearSaveDirtyStates() {
  $$(".save-button").forEach((button) => button.classList.remove("dirty"));
}

function renderPromptTemplate() {
  const template = state.promptTemplate;
  if (!template) return;

  const sections = template.sections || {};
  const versionSelect = $("#prompt-version-select");
  versionSelect.innerHTML = "";
  for (const version of state.promptVersions) {
    const option = document.createElement("option");
    option.value = String(version.version);
    option.textContent = `v${version.version}${
      version.updatedAt ? ` - ${formatDateTimeWithZone(version.updatedAt)}` : ""
    }${version.active ? " (active)" : ""}`;
    option.selected = version.version === template.version;
    versionSelect.append(option);
  }

  $("#prompt-instructions").value = sections.instructions || "";
  $("#prompt-output-format").value = sections.outputFormat || "";
  $("#prompt-per-chat-template").value = sections.perChatTemplate || "";
  $("#prompt-transcript-intro").value = sections.transcriptIntro || "";
  $("#prompt-meta").textContent = `Version ${template.version || 1}${
    template.updatedAt ? ` · updated ${formatDateTimeWithZone(template.updatedAt)}` : ""
  }`;
}

function renderEvents() {
  const list = $("#events-list");
  list.innerHTML = "";

  if (state.events.length === 0) {
    list.innerHTML = '<div class="empty-state">No events yet.</div>';
    return;
  }

  for (const event of state.events) {
    const row = document.createElement("div");
    row.className = "event-row";
    row.innerHTML = `
      <div class="row-title">${escapeHtml(event.message)}</div>
      <div class="row-meta">${escapeHtml(event.ts)} · ${escapeHtml(event.level)} · ${escapeHtml(event.type)}</div>
    `;
    list.append(row);
  }
}

function renderSummaries() {
  const list = $("#summaries-list");
  const summaries = getVisibleSummaries();
  list.innerHTML = "";

  if (summaries.length === 0) {
    list.innerHTML = '<div class="empty-state">No summaries yet.</div>';
    return;
  }

  for (const summary of summaries) {
    const row = document.createElement("article");
    row.className = "summary-row";
    const statusClass =
      summary.status === "ok"
        ? "ok"
        : summary.status === "error"
          ? "error"
          : "warn";
    const reason = summary.error || summary.reason || "";
    const bodyText = summary.summary || "";

    row.innerHTML = `
      <div class="summary-header">
        <div>
          <div class="row-title">${formatDateTimeWithZone(summary.createdAt)}</div>
          <div class="row-meta">
            ${formatDateTimeWithZone(summary.from)} - ${formatDateTimeWithZone(summary.to)}
          </div>
        </div>
        <div class="summary-badges">
          <span class="pill ${statusClass}">${escapeHtml(summary.status)}</span>
          <span class="type-badge">${Number(summary.messageCount || 0)} messages</span>
          <span class="type-badge">${summary.deliveredToTelegram ? "Telegram sent" : "Telegram off"}</span>
          <span class="type-badge">${summary.deliveredToWhatsapp ? "WhatsApp sent" : "WhatsApp off"}</span>
        </div>
      </div>
      ${reason ? `<div class="summary-reason">${escapeHtml(reason)}</div>` : ""}
      <pre class="summary-body"></pre>
    `;

    const body = row.querySelector(".summary-body");
    body.classList.toggle("empty", !bodyText);
    body.textContent = bodyText || "Empty summary";
    list.append(row);
  }
}

function getVisibleSummaries() {
  return state.summaries.filter((summary) => {
    const hasText = Boolean(summary.summary);
    if (state.summaryScope === "text") return hasText;
    if (state.summaryScope === "empty")
      return !hasText && summary.status !== "error";
    if (state.summaryScope === "errors") return summary.status === "error";
    return true;
  });
}

function renderChats() {
  const query = ($("#chat-filter").value || "").toLowerCase();
  const list = $("#chats-list");
  const chats = getVisibleChats(query);

  list.innerHTML = "";
  if (chats.length === 0) {
    list.innerHTML = '<div class="empty-state">No detected chats yet.</div>';
    return;
  }

  for (const chat of chats) {
    const row = document.createElement("div");
    row.className = "chat-row";
    row.classList.toggle("subscribed", Boolean(chat.subscribed));
    row.innerHTML = `
      <div>
        <div class="row-title">
          ${escapeHtml(chat.name || chat.jid)}
          <span class="type-badge">${escapeHtml(chat.type)}</span>
          ${chat.subscribed ? '<span class="subscribed-badge">Subscribed</span>' : ""}
        </div>
        <div class="row-meta">${escapeHtml(chat.jid)}</div>
        <div class="row-meta">
          ${chat.messageCount || 0} messages · first seen ${formatDate(chat.firstSeen)} · last seen ${formatDate(chat.lastSeen)}
        </div>
      </div>
      <div class="chat-actions">
        ${
          chat.subscribed
            ? `<button class="secondary-button compact-button" type="button" data-backfill-jid="${escapeHtml(chat.jid)}">Backfill</button>`
            : ""
        }
        <label class="switch-row chat-switch">
          <input type="checkbox" ${chat.subscribed ? "checked" : ""} data-jid="${escapeHtml(chat.jid)}" />
        </label>
      </div>
    `;
    list.append(row);
  }
}

function getVisibleChats(
  query = ($("#chat-filter").value || "").toLowerCase(),
) {
  return state.chats.filter((chat) => {
    const matchesQuery = `${chat.name} ${chat.jid} ${chat.type}`
      .toLowerCase()
      .includes(query);
    if (!matchesQuery) return false;
    if (state.chatScope === "subscribed") return Boolean(chat.subscribed);
    if (state.chatScope === "groups") return chat.type === "group";
    if (state.chatScope === "contacts") return chat.type === "contact";
    return true;
  });
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return escapeHtml(
    date.toLocaleString(undefined, {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
  );
}

function formatDateTimeWithZone(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return escapeHtml(
    date.toLocaleString(undefined, {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    }),
  );
}

function relativeTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDuration(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function getMissingSummarySettings(settings) {
  const missing = [];
  if (!settings.llmApiKey) missing.push("LLM API key");
  if (!settings.llmApiUrl) missing.push("LLM API URL");
  if (!settings.llmModel) missing.push("LLM model");
  return missing;
}

function cronToTimes(cron) {
  const parts = String(cron || "")
    .trim()
    .split(/\s+/);
  const minute = Number(parts[1]);
  const hours = String(parts[2] || "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 23);

  const safeMinute =
    Number.isInteger(minute) && minute >= 0 && minute < 60 ? minute : 0;
  const safeHours = hours.length > 0 ? hours : [6, 17];

  return safeHours.map(
    (hour) =>
      `${String(hour).padStart(2, "0")}:${String(safeMinute).padStart(2, "0")}`,
  );
}

function normalizeDigestTimes(times) {
  return [...new Set(times)]
    .filter((time) => /^\d{2}:\d{2}$/.test(time))
    .filter((time) => {
      const [hour, minute] = time.split(":").map(Number);
      return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
    })
    .sort();
}

function getBrowserTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function getZonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
}

function addLocalDays(parts, days) {
  const date = new Date(
    Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + days, 12, 0, 0),
  );
  return {
    year: String(date.getUTCFullYear()),
    month: String(date.getUTCMonth() + 1).padStart(2, "0"),
    day: String(date.getUTCDate()).padStart(2, "0"),
  };
}

function zonedLocalTimeToDate(localDate, time, timeZone) {
  const [hour, minute] = time.split(":").map(Number);
  const desiredUtc = Date.UTC(
    Number(localDate.year),
    Number(localDate.month) - 1,
    Number(localDate.day),
    hour,
    minute,
    0,
    0,
  );
  let guess = desiredUtc;

  for (let i = 0; i < 5; i += 1) {
    const actual = getZonedParts(new Date(guess), timeZone);
    const actualUtc = Date.UTC(
      Number(actual.year),
      Number(actual.month) - 1,
      Number(actual.day),
      Number(actual.hour),
      Number(actual.minute),
      Number(actual.second),
      0,
    );
    const diff = desiredUtc - actualUtc;
    if (diff === 0) break;
    guess += diff;
  }

  return new Date(guess);
}

function formatTimeInZone(date, timeZone) {
  const parts = getZonedParts(date, timeZone);
  return `${parts.hour}:${parts.minute}`;
}

function convertStoredTimesToBrowser(times, storedTimezone) {
  const browserTimezone = getBrowserTimezone();
  const now = new Date();
  const storedNow = getZonedParts(now, storedTimezone);

  return normalizeDigestTimes(
    times.map((time) => {
      let candidate = zonedLocalTimeToDate(storedNow, time, storedTimezone);
      if (candidate.getTime() <= now.getTime()) {
        candidate = zonedLocalTimeToDate(addLocalDays(storedNow, 1), time, storedTimezone);
      }
      return formatTimeInZone(candidate, browserTimezone);
    }),
  );
}

function buildDigestCron() {
  const times =
    state.digestTimes.length > 0 ? state.digestTimes : ["09:00", "18:00"];
  const firstMinute = Number(times[0].slice(3, 5));
  const hoursAtSameMinute = times
    .filter((time) => Number(time.slice(3, 5)) === firstMinute)
    .map((time) => Number(time.slice(0, 2)));

  return `0 ${firstMinute} ${hoursAtSameMinute.join(",")} * * ?`;
}

function renderScheduleTimes() {
  const list = $("#schedule-times-list");
  list.innerHTML = "";

  for (const time of state.digestTimes) {
    const item = document.createElement("button");
    item.className = "time-chip";
    item.type = "button";
    item.dataset.time = time;
    item.textContent = `${time} x`;
    list.append(item);
  }

  renderSchedulePreview();
}

function renderSchedulePreview() {
  const times =
    state.digestTimes.length > 0 ? state.digestTimes : ["09:00", "18:00"];
  $("#schedule-preview").textContent = `Runs daily at ${times.join(", ")} in your browser time.`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function refreshAll() {
  const [status, settings, chats, events, summaries, prompt] = await Promise.all([
    api("/api/status"),
    api("/api/settings"),
    api("/api/chats"),
    api("/api/events?limit=40"),
    api("/api/summaries?limit=60"),
    api("/api/prompts/summary"),
  ]);

  state.status = status;
  state.settings = settings;
  state.chats = chats.chats || [];
  state.events = events.events || [];
  state.summaries = summaries.summaries || [];
  state.promptTemplate = prompt.template || null;
  state.promptVersions = prompt.versions || [];

  renderStatus();
  renderSettings();
  clearSaveDirtyStates();
  renderPromptTemplate();
  renderEvents();
  renderSummaries();
  renderChats();
}

$$("[data-summary-scope]").forEach((button) => {
  button.addEventListener("click", () => {
    state.summaryScope = button.dataset.summaryScope;
    $$("[data-summary-scope]").forEach((el) =>
      el.classList.toggle(
        "active",
        el.dataset.summaryScope === state.summaryScope,
      ),
    );
    renderSummaries();
  });
});

$$(".nav-item").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

window.addEventListener("hashchange", () => {
  setView(getViewFromHash(), false);
});

function getTelegramChatIdsFromForm() {
  return $("#telegram-chat-ids")
    .value.split(/\n|,/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function getPromptTemplateFromForm() {
  return {
    version: state.promptTemplate?.version || 1,
    sections: {
      instructions: $("#prompt-instructions").value,
      outputFormat: $("#prompt-output-format").value,
      perChatTemplate: $("#prompt-per-chat-template").value,
      transcriptIntro: $("#prompt-transcript-intro").value,
    },
  };
}

async function saveSettingsPatch(patch, resultSelector, successText) {
  const settings = await api("/api/settings", {
    method: "PUT",
    body: JSON.stringify(patch),
  });

  state.settings = settings;
  $(resultSelector).className = "form-result";
  $(resultSelector).textContent = successText;
  renderSettings();
  await refreshAll();
}

async function saveDigestSettings(successText) {
  await saveSettingsPatch(
    {
      summarizationEnabled: $("#summarization-enabled").checked,
      summaryLanguage: $("#summary-language").value.trim() || "Russian",
      digestCron: buildDigestCron(),
      digestTimes:
        state.digestTimes.length > 0 ? state.digestTimes : ["09:00", "18:00"],
      digestTimezone: getBrowserTimezone(),
    },
    "#digest-settings-result",
    successText,
  );
}

function wireDirtyState(selectors, saveSelector) {
  for (const selector of selectors) {
    const element = $(selector);
    if (!element) continue;
    element.addEventListener("input", () => setSaveDirty(saveSelector, true));
    element.addEventListener("change", () => setSaveDirty(saveSelector, true));
  }
}

wireDirtyState(
  ["#summarization-enabled", "#summary-language"],
  "#save-digest-button",
);
wireDirtyState(
  ["#llm-api-url", "#llm-model", "#llm-api-key"],
  "#save-llm-button",
);
wireDirtyState(
  ["#whatsapp-delivery-chat"],
  "#save-whatsapp-button",
);
wireDirtyState(
  ["#telegram-bot-token", "#telegram-chat-ids"],
  "#save-telegram-button",
);
wireDirtyState(
  [
    "#prompt-instructions",
    "#prompt-output-format",
    "#prompt-per-chat-template",
    "#prompt-transcript-intro",
  ],
  "#save-prompt-button",
);

async function saveToggleSetting(
  inputSelector,
  settingKey,
  resultSelector,
  enabledText,
  disabledText,
) {
  const input = $(inputSelector);
  const previousValue = Boolean(state.settings?.[settingKey]);
  const nextValue = input.checked;

  input.disabled = true;
  try {
    const settings = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ [settingKey]: nextValue }),
    });

    state.settings = settings;
    $(resultSelector).className = "form-result";
    $(resultSelector).textContent = nextValue ? enabledText : disabledText;
    renderSettings();
  } catch (err) {
    input.checked = previousValue;
    $(resultSelector).className = "form-result error-text";
    $(resultSelector).textContent =
      err instanceof Error ? err.message : String(err);
  } finally {
    input.disabled = false;
  }
}

$("#save-digest-button").addEventListener("click", async () => {
  try {
    await saveDigestSettings("Digest settings saved.");
    setSaveDirty("#save-digest-button", false);
  } catch (err) {
    $("#digest-settings-result").className = "form-result error-text";
    $("#digest-settings-result").textContent =
      err instanceof Error ? err.message : String(err);
  }
});

$("#add-schedule-time-button").addEventListener("click", async () => {
  state.digestTimes = normalizeDigestTimes([
    ...state.digestTimes,
    $("#schedule-time-input").value,
  ]);
  renderScheduleTimes();
  try {
    await saveDigestSettings("Schedule updated.");
  } catch (err) {
    $("#digest-settings-result").className = "form-result error-text";
    $("#digest-settings-result").textContent =
      err instanceof Error ? err.message : String(err);
  }
});

$("#schedule-times-list").addEventListener("click", async (event) => {
  const button = event.target;
  if (!(button instanceof HTMLButtonElement)) return;
  const time = button.dataset.time;
  state.digestTimes = state.digestTimes.filter((item) => item !== time);
  renderScheduleTimes();
  try {
    await saveDigestSettings("Schedule updated.");
  } catch (err) {
    $("#digest-settings-result").className = "form-result error-text";
    $("#digest-settings-result").textContent =
      err instanceof Error ? err.message : String(err);
  }
});

$("#save-llm-button").addEventListener("click", async () => {
  try {
    await saveSettingsPatch(
      {
        llmApiUrl: $("#llm-api-url").value.trim(),
        llmModel: $("#llm-model").value.trim(),
        llmApiKey: $("#llm-api-key").value,
      },
      "#llm-test-result",
      "LLM settings saved.",
    );
    setSaveDirty("#save-llm-button", false);
  } catch (err) {
    $("#llm-test-result").className = "form-result error-text";
    $("#llm-test-result").textContent =
      err instanceof Error ? err.message : String(err);
  }
});

$("#telegram-enabled").addEventListener("change", () => {
  saveToggleSetting(
    "#telegram-enabled",
    "telegramEnabled",
    "#telegram-test-result",
    "Telegram delivery enabled.",
    "Telegram delivery disabled.",
  );
});

$("#whatsapp-delivery-enabled").addEventListener("change", () => {
  const enabled = $("#whatsapp-delivery-enabled").checked;
  saveSettingsPatch(
    {
      whatsappDeliveryEnabled: enabled,
      whatsappDeliveryChatJid: $("#whatsapp-delivery-chat").value,
    },
    "#whatsapp-test-result",
    enabled ? "WhatsApp delivery enabled." : "WhatsApp delivery disabled.",
  ).catch((err) => {
    $("#whatsapp-delivery-enabled").checked = Boolean(
      state.settings?.whatsappDeliveryEnabled,
    );
    $("#whatsapp-test-result").className = "form-result error-text";
    $("#whatsapp-test-result").textContent =
      err instanceof Error ? err.message : String(err);
  });
});

$("#save-whatsapp-button").addEventListener("click", async () => {
  try {
    await saveSettingsPatch(
      {
        whatsappDeliveryEnabled: $("#whatsapp-delivery-enabled").checked,
        whatsappDeliveryChatJid: $("#whatsapp-delivery-chat").value,
      },
      "#whatsapp-test-result",
      "WhatsApp delivery settings saved.",
    );
    setSaveDirty("#save-whatsapp-button", false);
  } catch (err) {
    $("#whatsapp-test-result").className = "form-result error-text";
    $("#whatsapp-test-result").textContent =
      err instanceof Error ? err.message : String(err);
  }
});

$("#save-telegram-button").addEventListener("click", async () => {
  try {
    await saveSettingsPatch(
      {
        telegramEnabled: $("#telegram-enabled").checked,
        telegramBotToken: $("#telegram-bot-token").value,
        telegramChatIds: getTelegramChatIdsFromForm(),
      },
      "#telegram-test-result",
      "Telegram settings saved.",
    );
    setSaveDirty("#save-telegram-button", false);
  } catch (err) {
    $("#telegram-test-result").className = "form-result error-text";
    $("#telegram-test-result").textContent =
      err instanceof Error ? err.message : String(err);
  }
});

$("#test-llm-button").addEventListener("click", async () => {
  const button = $("#test-llm-button");
  const result = $("#llm-test-result");
  button.disabled = true;
  result.className = "form-result";
  result.textContent = "Testing...";

  try {
    const response = await api("/api/settings/test-llm", {
      method: "POST",
      body: JSON.stringify({
        llmApiUrl: $("#llm-api-url").value.trim(),
        llmModel: $("#llm-model").value.trim(),
        llmApiKey: $("#llm-api-key").value,
      }),
    });
    result.textContent = `Connected in ${response.latencyMs} ms. Reply: ${response.text}`;
  } catch (err) {
    result.className = "form-result error-text";
    result.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    button.disabled = false;
    await refreshAll();
  }
});

$("#test-telegram-button").addEventListener("click", async () => {
  const button = $("#test-telegram-button");
  const result = $("#telegram-test-result");
  button.disabled = true;
  result.className = "form-result";
  result.textContent = "Testing...";

  try {
    const response = await api("/api/settings/test-telegram", {
      method: "POST",
      body: JSON.stringify({
        telegramBotToken: $("#telegram-bot-token").value,
        telegramChatIds: getTelegramChatIdsFromForm(),
      }),
    });
    result.textContent = `Sent test message to ${response.recipients} recipient(s).`;
  } catch (err) {
    result.className = "form-result error-text";
    result.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    button.disabled = false;
    await refreshAll();
  }
});

$("#test-whatsapp-button").addEventListener("click", async () => {
  const button = $("#test-whatsapp-button");
  const result = $("#whatsapp-test-result");
  button.disabled = true;
  result.className = "form-result";
  result.textContent = "Testing...";

  try {
    const response = await api("/api/settings/test-whatsapp", {
      method: "POST",
      body: JSON.stringify({
        jid: $("#whatsapp-delivery-chat").value,
      }),
    });
    result.textContent = `Sent test message to ${response.jid}.`;
  } catch (err) {
    result.className = "form-result error-text";
    result.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    button.disabled = false;
    await refreshAll();
  }
});

$("#save-prompt-button").addEventListener("click", async () => {
  const button = $("#save-prompt-button");
  const result = $("#prompt-result");
  button.disabled = true;
  result.className = "form-result";
  result.textContent = "Saving...";

  try {
    const response = await api("/api/prompts/summary", {
      method: "PUT",
      body: JSON.stringify(getPromptTemplateFromForm()),
    });
    state.promptTemplate = response.template;
    state.promptVersions = response.versions || [];
    renderPromptTemplate();
    setSaveDirty("#save-prompt-button", false);
    result.textContent = "Prompt saved.";
  } catch (err) {
    result.className = "form-result error-text";
    result.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    button.disabled = false;
  }
});

$("#reset-prompt-button").addEventListener("click", async () => {
  const button = $("#reset-prompt-button");
  const result = $("#prompt-result");
  button.disabled = true;
  result.className = "form-result";
  result.textContent = "Resetting...";

  try {
    const response = await api("/api/prompts/summary/reset", { method: "POST" });
    state.promptTemplate = response.template;
    state.promptVersions = response.versions || [];
    renderPromptTemplate();
    setSaveDirty("#save-prompt-button", false);
    result.textContent = "Prompt reset to defaults.";
  } catch (err) {
    result.className = "form-result error-text";
    result.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    button.disabled = false;
  }
});

$("#prompt-version-select").addEventListener("change", async () => {
  const result = $("#prompt-result");
  result.className = "form-result";
  result.textContent = "Loading version...";

  try {
    const version = $("#prompt-version-select").value;
    const response = await api(`/api/prompts/summary?version=${encodeURIComponent(version)}`);
    state.promptTemplate = response.template;
    state.promptVersions = response.versions || [];
    renderPromptTemplate();
    setSaveDirty("#save-prompt-button", false);
    result.textContent = `Loaded prompt version ${version}.`;
  } catch (err) {
    result.className = "form-result error-text";
    result.textContent = err instanceof Error ? err.message : String(err);
  }
});

$("#prune-prompts-button").addEventListener("click", async () => {
  const button = $("#prune-prompts-button");
  const result = $("#prompt-result");
  button.disabled = true;
  result.className = "form-result";
  result.textContent = "Deleting old prompt versions...";

  try {
    const response = await api("/api/prompts/summary/prune", { method: "POST" });
    state.promptTemplate = response.template || state.promptTemplate;
    state.promptVersions = response.versions || [];
    renderPromptTemplate();
    result.textContent = `Deleted ${response.deleted || 0} old prompt version(s).`;
  } catch (err) {
    result.className = "form-result error-text";
    result.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    button.disabled = false;
  }
});

$("#trigger-digest-button").addEventListener("click", async () => {
  try {
    const result = await api("/jobs/whatsapp-summary", { method: "POST" });
    $("#digest-output").textContent = JSON.stringify(result, null, 2);
    await refreshAll();
  } catch (err) {
    $("#digest-output").textContent =
      err instanceof Error ? err.message : String(err);
    await refreshAll();
  }
});

$("#mark-unprocessed-button").addEventListener("click", async () => {
  const button = $("#mark-unprocessed-button");
  button.disabled = true;
  try {
    const result = await api("/api/messages/mark-unprocessed", { method: "POST" });
    $("#digest-output").textContent = JSON.stringify(result, null, 2);
    await refreshAll();
  } catch (err) {
    $("#digest-output").textContent =
      err instanceof Error ? err.message : String(err);
    await refreshAll();
  } finally {
    button.disabled = false;
  }
});

$("#chat-filter").addEventListener("input", renderChats);

$$("[data-chat-scope]").forEach((button) => {
  button.addEventListener("click", () => {
    state.chatScope = button.dataset.chatScope;
    $$("[data-chat-scope]").forEach((el) =>
      el.classList.toggle("active", el.dataset.chatScope === state.chatScope),
    );
    renderChats();
  });
});

$("#chats-list").addEventListener("change", async (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  const jid = input.dataset.jid;
  if (!jid) return;

  await api(`/api/chats/${encodeURIComponent(jid)}/subscription`, {
    method: "PUT",
    body: JSON.stringify({ subscribed: input.checked }),
  });
  await refreshAll();
});

$("#chats-list").addEventListener("click", async (event) => {
  const button = event.target;
  if (!(button instanceof HTMLButtonElement)) return;
  const jid = button.dataset.backfillJid;
  if (!jid) return;

  button.disabled = true;
  button.textContent = "Asked";
  try {
    const result = await api(`/api/chats/${encodeURIComponent(jid)}/backfill`, {
      method: "POST",
      body: JSON.stringify({ count: 50 }),
    });
    $("#digest-output").textContent = JSON.stringify(result, null, 2);
    await refreshAll();
  } catch (err) {
    button.textContent = "Failed";
    $("#digest-output").textContent = err instanceof Error ? err.message : String(err);
    await refreshAll();
  } finally {
    button.disabled = false;
  }
});

$("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#auth-submit");
  const result = $("#auth-result");
  const password = $("#auth-password").value;
  const endpoint = state.auth.configured ? "/api/auth/login" : "/api/auth/setup";

  button.disabled = true;
  result.className = "form-result";
  result.textContent = state.auth.configured ? "Signing in..." : "Saving...";

  try {
    await authApi(endpoint, {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    state.auth.configured = true;
    setAppAuthenticated(true);
    setView(getViewFromHash(), false);
    await refreshAll();
  } catch (err) {
    result.className = "form-result error-text";
    result.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    button.disabled = false;
  }
});

$("#logout-button").addEventListener("click", async () => {
  await authApi("/api/auth/logout", { method: "POST" });
  state.auth.configured = true;
  showAuthScreen();
});

async function boot() {
  setView(getViewFromHash(), false);
  if (!(await initAuth())) return;
  await refreshAll();
}

boot().catch((err) => {
  $("#events-list").innerHTML =
    `<div class="empty-state">${escapeHtml(err.message)}</div>`;
});

setInterval(() => {
  if (!state.auth.authenticated) return;
  if (state.view === "monitor" || state.view === "whatsapp") {
    refreshAll().catch(() => {});
  }
}, 5000);
