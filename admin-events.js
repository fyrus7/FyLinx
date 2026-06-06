requireAdminLogin("admin-events.html");

const MAX_EVENT_IMAGE_SIZE = 2 * 1024 * 1024;

const ALLOWED_EVENT_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp"
];

/* GLOBAL VARIABLES */

let adminToastTimer = null;
let pendingDeleteEventId = null;
let currentPromoEventId = null;
let latestPromoCodes = [];
let promoEditMode = false;
let promoSelectMode = false;
let currentAccessEventId = null;
let latestAccessCodes = [];
let accessEditMode = false;
let accessSelectMode = false;
let infoPosterImages = [];
let savedEventImage = "";
let savedInfoPosterImages = [];
let draggedInfoPosterIndex = null;
let savedEmailProvider = "enginemailer";
let savedAdminFeeEnabled = 0;
let savedAdminFeeAmount = 4;
let savedAdminFeePercent = 8;

const LANDING_CAROUSEL_SETTING_API = "/api/admin/site-settings";
const PUBLIC_SITE_URL = "https://runxera.com";
const SHORT_EVENT_URL_PREFIX = "rx";

function closeAdminToast() {
  const toast = document.getElementById("adminToast");
  if (!toast) return;

  toast.classList.remove("show");

  if (adminToastTimer) {
    clearTimeout(adminToastTimer);
    adminToastTimer = null;
  }
}

function getToastType(message) {
  const text = String(message || "").toLowerCase();

  if (
    text.includes("failed") ||
    text.includes("error") ||
    text.includes("unable") ||
    text.includes("required") ||
    text.includes("unauthorized") ||
    text.includes("not found") ||
    text.includes("cannot")
  ) {
    return "error";
  }

  return "success";
}

function setMessage(message, type) {
  const text = message || "";

  const oldMessage = document.getElementById("adminMessage");
  if (oldMessage) oldMessage.textContent = "";

  const toast = document.getElementById("adminToast");
  const toastText = document.getElementById("adminToastText");

  if (!toast || !toastText) return;

  toastText.textContent = text;

  toast.classList.remove("success", "error");
  toast.classList.add(type || getToastType(text));
  toast.classList.add("show");

  if (adminToastTimer) {
    clearTimeout(adminToastTimer);
  }

  adminToastTimer = setTimeout(() => {
    closeAdminToast();
  }, 10000);
}

function setImageStatus(message, isError = false) {
  const el = document.getElementById("eventImageStatus");
  if (!el) return;

  el.textContent = message || "";
  el.style.color = isError ? "#dc2626" : "#16a34a";
}

function adminHeaders() {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${getAdminToken()}`
  };
}

function getAdminAccessMode() {
  return String(sessionStorage.getItem("RUNATION_ADMIN_ACCESS_MODE") || "").toLowerCase();
}

function getAdminRole() {
  return String(sessionStorage.getItem("RUNATION_ADMIN_ROLE") || "").toLowerCase();
}

function isMasterAdmin() {
  return (
    getAdminAccessMode() === "master" ||
    getAdminAccessMode() === "moderator" ||
    getAdminRole() === "master"
  );
}

function isRealMasterAdmin() {
  return getAdminAccessMode() === "master" || getAdminRole() === "master";
}

function isExternalOnlyAdmin() {
  return getAdminAccessMode() === "external_only";
}

function syncAdminFeeAccess() {
  const feeInputs = [
    document.getElementById("adminFeeAmount"),
    document.getElementById("adminFeePercent")
  ].filter(Boolean);

  if (!feeInputs.length) return;

  const canEdit = isRealMasterAdmin();

  feeInputs.forEach(input => {
    input.disabled = !canEdit;
    input.classList.toggle("is-readonly", !canEdit);
  });

  const adminFeeEnabled = document.getElementById("adminFeeEnabled");
  if (adminFeeEnabled) {
    adminFeeEnabled.disabled = !canEdit;
    adminFeeEnabled.classList.toggle("is-readonly", !canEdit);
  }
}

function formatAdminFeePercent(value) {
  const num = Number(value || 0);

  if (!Number.isFinite(num)) return "0";

  return Number.isInteger(num)
    ? String(num)
    : num.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function formatAdminFeeValue(value) {
  const num = Number(value || 0);

  if (!Number.isFinite(num)) return "0.00";

  return num.toFixed(2);
}

function updateAdminFeeHint() {
  const billingEl = document.getElementById("adminFeeEnabled");
  const amountEl = document.getElementById("adminFeeAmount");
  const percentEl = document.getElementById("adminFeePercent");
  const hintEl =
    document.getElementById("adminFeeHint") ||
    percentEl?.closest(".form-group")?.querySelector(".field-hint");

  if (!billingEl || !amountEl || !percentEl || !hintEl) return;

  const flatFee = formatAdminFeeValue(amountEl.value);
  const percentage = formatAdminFeePercent(percentEl.value);

  if (Number(billingEl.value || 0) === 1) {
    hintEl.textContent =
      `A flat fee RM${flatFee} or percentage ${percentage}%, whichever is higher, will be collected from event registrants in addition to the total registration fees.`;
    return;
  }

  hintEl.textContent =
    `A flat fee RM${flatFee} or percentage ${percentage}%, whichever is higher, will be absorbed by the event organizer.`;
}

function setupAdminFeeHint() {
  ["adminFeeEnabled", "adminFeeAmount", "adminFeePercent"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;

    el.addEventListener("input", updateAdminFeeHint);
    el.addEventListener("change", updateAdminFeeHint);
  });

  updateAdminFeeHint();
}

function renderAdminFeeText(event) {
  if (Number(event.admin_fee_enabled || 0) !== 1) {
    return "Off";
  }

  const fixedFee = Number(event.admin_fee_amount ?? 4);
  const percentFee = Number(event.admin_fee_percent ?? 8);

  if (percentFee > 0) {
    return `On - RM${fixedFee.toFixed(2)} or ${formatAdminFeePercent(percentFee)}% (higher)`;
  }

  return `On - RM${fixedFee.toFixed(2)}`;
}

function normalizePaymentGateway(value) {
  const gateway = String(value || "chip").toLowerCase();

  if (["toyyibpay", "chip", "manual"].includes(gateway)) {
    return gateway;
  }

  return "chip";
}

function normalizePaymentEnvironment(value) {
  const env = String(value || "sandbox").toLowerCase();

  if (["sandbox", "live"].includes(env)) {
    return env;
  }

  return "sandbox";
}

function normalizeRegistrationAccessMode(value) {
  const mode = String(value || "open").trim().toLowerCase();

  if (mode === "live" || mode === "sandbox") {
    return "open";
  }

  if (["open", "access_code"].includes(mode)) {
    return mode;
  }

  return "open";
}

function normalizeEmailProvider(value) {
  const provider = String(value || "enginemailer").trim().toLowerCase();

  if (["enginemailer", "resend", "brevo"].includes(provider)) {
    return provider;
  }

  return "enginemailer";
}

function gatewayFromLegacyPaymentMode(value) {
  const mode = String(value || "online").toLowerCase();

  if (mode === "offline") {
    return "manual";
  }

  return "chip";
}

function paymentModeFromGateway(gateway) {
  return normalizePaymentGateway(gateway) === "manual" ? "offline" : "online";
}

function getPaymentGatewayLabel(event) {
  const gateway = normalizePaymentGateway(
    event.payment_gateway || gatewayFromLegacyPaymentMode(event.payment_mode)
  );

  const env = normalizePaymentEnvironment(event.payment_environment);

  if (gateway === "manual") {
    return "Manual / Offline";
  }

  if (gateway === "chip") {
    return `CHIP-IN / ${env.toUpperCase()}`;
  }

  return `ToyyibPay / ${env.toUpperCase()}`;
}

function getEventListPaymentLabel(event) {
  const mode = String(event.registration_mode || "internal").toLowerCase();

  if (mode === "external") {
    return "External";
  }

  const gateway = normalizePaymentGateway(
    event.payment_gateway || gatewayFromLegacyPaymentMode(event.payment_mode)
  );

  if (gateway === "manual") {
    return "Manual / Offline";
  }

  const env = normalizePaymentEnvironment(event.payment_environment);

  return `FPX / ${env.toUpperCase()}`;
}

function syncPaymentEnvironmentVisibility() {
  const gateway = normalizePaymentGateway(getValue("paymentGateway"));
  const wrap = document.getElementById("paymentEnvironmentWrap");

  if (wrap) {
    wrap.hidden = gateway === "manual";
  }
}

function syncPaymentGatewayAccess() {
  const select = document.getElementById("paymentGateway");
  const wrap = document.getElementById("paymentGatewayWrap") || select?.closest(".form-group");

  const isMaster = isRealMasterAdmin();

  if (wrap) {
    wrap.hidden = !isMaster;
    wrap.style.display = isMaster ? "" : "none";
  }

  if (select) {
    const manualOption = select.querySelector('option[value="manual"]');

    if (manualOption) {
      manualOption.hidden = !isMaster;
      manualOption.disabled = !isMaster;
    }

    if (!isMaster && select.value === "manual") {
      select.value = "chip";
    }
  }

  syncPaymentEnvironmentVisibility();
}

function syncEmailProviderAccess() {
  const select = document.getElementById("emailProvider");
  const wrap = document.getElementById("emailProviderWrap") || select?.closest(".form-group");

  const canEdit = isRealMasterAdmin();

  if (wrap) {
    wrap.hidden = !canEdit;
    wrap.style.display = canEdit ? "" : "none";
  }

  if (select) {
    select.disabled = !canEdit;
  }
}

function getApprovalStatus(event) {
  return String(event.approval_status || "live").toLowerCase();
}

function renderApprovalText(event) {
  const approvalStatus = getApprovalStatus(event);
  const isVisible = Number(event.is_visible || 0) === 1;
  const mode = String(event.registration_mode || "internal").toLowerCase();

  const modeLabel = mode === "external" ? "External" : "Runxera";

  if (approvalStatus === "sandbox") {
    return `
      <div class="muted">
        Publish Status: <strong>${modeLabel} / Sandbox / Pending Approval</strong>
      </div>
    `;
  }

  if (approvalStatus === "live" && isVisible) {
    return `
      <div class="muted">
        Publish Status: <strong>${modeLabel} / Live / Visible</strong>
      </div>
    `;
  }

  if (approvalStatus === "live" && !isVisible) {
    return `
      <div class="muted">
        Publish Status: <strong>${modeLabel} / Live / Hidden</strong>
      </div>
    `;
  }

  return `
    <div class="muted">
      Publish Status: <strong>${modeLabel} / ${escapeHtml(approvalStatus || "-")}</strong>
    </div>
  `;
}

function renderApprovalButton(event) {
  if (!isMasterAdmin()) return "";

  const approvalStatus = getApprovalStatus(event);
  const id = Number(event.id);

  if (approvalStatus === "sandbox") {
    return `
      <button class="secondary" type="button" onclick="eventApprovalAction(${id}, 'approve')">
        Sandbox
      </button>
    `;
  }

  if (approvalStatus === "live") {
    return `
      <button class="secondary" type="button" onclick="eventApprovalAction(${id}, 'return_to_sandbox')">
        Live
      </button>
    `;
  }

  return "";
}


function renderDeleteButton(event) {
  if (!isRealMasterAdmin()) return "";

  return `
    <button class="danger" type="button" onclick="deleteEvent(${Number(event.id)})">
      Delete
    </button>
  `;
}

function renderEventOrderButtons(event, index, total) {
  if (!isMasterAdmin()) return "";

  const id = Number(event.id);

  return `
    <button
      class="secondary"
      type="button"
      onclick="moveEventOrder(${id}, 'up')"
      ${index <= 0 ? "disabled" : ""}
      title="Move up"
    >↑</button>

    <button
      class="secondary"
      type="button"
      onclick="moveEventOrder(${id}, 'down')"
      ${index >= total - 1 ? "disabled" : ""}
      title="Move down"
    >↓</button>
  `;
}


async function eventApprovalAction(eventId, action) {
  const label = action === "approve"
    ? "approve this event and make it live"
    : "return this event to sandbox";

  if (!confirm(`Are you sure you want to ${label}?\n\nEvent ID: ${eventId}`)) {
    return;
  }

  try {
    const res = await fetch("/api/admin/event-approval", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        event_id: Number(eventId),
        action
      })
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data || !data.success) {
      setMessage(data?.error || "Approval update failed.");
      return;
    }

    setMessage(data.message || "Approval updated.");
    loadEvents();

  } catch (err) {
    setMessage(err.message || "Approval update failed.");
  }
}

function adminAuthHeaders() {
  return {
    "Authorization": `Bearer ${getAdminToken()}`
  };
}

/* =========================
   LANDING CAROUSEL SETTING
========================= */

function setLandingCarouselMessage(message, isError = false) {
  const box = document.getElementById("landingCarouselMessage");
  if (!box) return;

  box.textContent = message || "";
  box.style.color = isError ? "#b42318" : "";
}

function parseLandingCarouselInput(value) {
  const raw = String(value || "").trim();

  if (!raw) return [];

  let parts = [];

  // Support lama juga kalau terisi [1,3,12,7], tapi input akan display tanpa bracket.
  if (raw.startsWith("[") && raw.endsWith("]")) {
    try {
      const parsed = JSON.parse(raw);

      if (!Array.isArray(parsed)) {
        throw new Error("Format mesti macam 1,3,12,7");
      }

      parts = parsed;
    } catch {
      throw new Error("Format mesti macam 1,3,12,7");
    }
  } else {
    parts = raw.split(",");
  }

  const ids = [];

  for (const item of parts) {
    const text = String(item || "").trim();
    if (!text) continue;

    const id = Number(text);

    if (!Number.isInteger(id) || id <= 0) {
      throw new Error("Event ID mesti nombor positif. Contoh: 1,3,12,7");
    }

    if (!ids.includes(id)) {
      ids.push(id);
    }

    if (ids.length > 10) {
      throw new Error("Maksimum 10 event sahaja.");
    }
  }

  return ids;
}

async function loadLandingCarouselSetting() {
  const input = document.getElementById("landingCarouselEventIds");
  if (!input) return;

  const res = await fetch(LANDING_CAROUSEL_SETTING_API, {
    headers: adminHeaders()
  });

  const data = await res.json().catch(() => null);

  if (!res.ok || !data || !data.success) {
    throw new Error(data?.error || "Failed to load carousel setting.");
  }

  input.value = Array.isArray(data.ids) && data.ids.length
   ? data.ids.join(",")
   : "";
}

async function saveLandingCarouselSetting() {
  try {
    const input = document.getElementById("landingCarouselEventIds");
    if (!input) return;

    const ids = parseLandingCarouselInput(input.value);

    const res = await fetch(LANDING_CAROUSEL_SETTING_API, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        value: JSON.stringify(ids)
      })
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data || !data.success) {
      throw new Error(data?.error || "Failed to save carousel setting.");
    }

    input.value = Array.isArray(data.ids) && data.ids.length
     ? data.ids.join(",")
     : "";

    setLandingCarouselMessage("Carousel saved.");
    setMessage("Carousel saved.");
  } catch (err) {
    setLandingCarouselMessage(err.message || "Failed to save carousel.", true);
    setMessage(err.message || "Failed to save carousel.");
  }
}

async function initLandingCarouselSetting() {
  const box = document.getElementById("landingCarouselSettingBox");
  const saveBtn = document.getElementById("saveLandingCarouselBtn");

  if (!box) return;

  if (!isMasterAdmin()) {
    box.hidden = true;
    return;
  }

  box.hidden = false;

  if (saveBtn) {
    saveBtn.addEventListener("click", saveLandingCarouselSetting);
  }

  try {
    await loadLandingCarouselSetting();
  } catch (err) {
    setLandingCarouselMessage(err.message || "Failed to load carousel setting.", true);
  }
}

function getValue(id) {
  const el = document.getElementById(id);
  return el ? String(el.value || "").trim() : "";
}

function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value ?? "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeUrl(url) {
  const value = String(url || "").trim();

  if (!value) return "";

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  return `https://${value}`;
}

function buildStandardEventUrl(slug) {
  const cleanSlug = String(slug || "").trim();

  if (!cleanSlug) return PUBLIC_SITE_URL;

  return `${PUBLIC_SITE_URL}/${encodeURIComponent(cleanSlug)}`;
}

function buildShortEventCode(eventId) {
  const id = Number(eventId || 0);

  if (!Number.isInteger(id) || id <= 0) return "";

  return `${SHORT_EVENT_URL_PREFIX}${id.toString(36).toUpperCase()}`;
}

function buildShortEventUrl(eventId) {
  const code = buildShortEventCode(eventId);

  if (!code) return "";

  return `${PUBLIC_SITE_URL}/${code}`;
}

function ensureEventShareModal() {
  let modal = document.getElementById("eventShareUrlModal");

  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "eventShareUrlModal";
  modal.className = "settings-modal";

  modal.innerHTML = `
    <div class="settings-modal-card share-url-modal-card">
      <div class="settings-modal-head">
        <div>
          <h3>Share Event URL</h3>
          <p id="shareEventTitle" class="muted"></p>
        </div>

        <button
          type="button"
          class="secondary"
          onclick="closeEventShareModal()"
          aria-label="Close share URL modal"
        >
          ×
        </button>
      </div>

      <div class="settings-modal-body">
        <div class="form-group">
          <label>Standard URL</label>
          <div class="share-url-copy-row">
            <input id="shareStandardUrl" readonly>
            <button type="button" onclick="copyShareEventUrl('standard')">
              Copy
            </button>
          </div>
        </div>

        <div class="form-group">
          <label>Short URL</label>
          <div class="share-url-copy-row">
            <input id="shareShortUrl" readonly>
            <button type="button" onclick="copyShareEventUrl('short')">
              Copy
            </button>
          </div>
        </div>

        <p class="muted">
          Short URL is generated from the Event ID, so it stays unique even if the event title changes.
        </p>
      </div>

      <div class="settings-modal-foot button-row">
        <button type="button" class="secondary" onclick="closeEventShareModal()">
          Close
        </button>
      </div>
    </div>
  `;

  modal.addEventListener("click", event => {
    if (event.target === modal) {
      closeEventShareModal();
    }
  });

  document.body.appendChild(modal);
  return modal;
}

function openEventShareModalFromButton(button) {
  if (!button) return;

  const eventId = Number(button.dataset.eventId || 0);
  const title = button.dataset.eventTitle || "";
  const slug = button.dataset.eventSlug || "";

  const standardUrl = buildStandardEventUrl(slug);
  const shortUrl = buildShortEventUrl(eventId);

  const modal = ensureEventShareModal();

  const titleEl = document.getElementById("shareEventTitle");
  const standardInput = document.getElementById("shareStandardUrl");
  const shortInput = document.getElementById("shareShortUrl");

  if (titleEl) titleEl.textContent = title;
  if (standardInput) standardInput.value = standardUrl;
  if (shortInput) shortInput.value = shortUrl;

  modal.classList.add("show");
  document.body.classList.add("admin-modal-open");
}

function closeEventShareModal() {
  const modal = document.getElementById("eventShareUrlModal");
  if (!modal) return;

  modal.classList.remove("show");
  document.body.classList.remove("admin-modal-open");
}

async function writeClipboardText(text) {
  const value = String(text || "").trim();

  if (!value) return false;

  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";

    document.body.appendChild(textarea);
    textarea.select();

    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);

    return copied;
  }
}

async function copyShareEventUrl(type) {
  const inputId = type === "short" ? "shareShortUrl" : "shareStandardUrl";
  const input = document.getElementById(inputId);

  if (!input || !input.value) {
    setMessage("URL not found.");
    return;
  }

  const copied = await writeClipboardText(input.value);

  if (copied) {
    setMessage(type === "short" ? "Short URL copied." : "Standard URL copied.");
    return;
  }

  setMessage(input.value);
}

function generateSlugFromTitle(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function syncSlugFromTitle() {
  const titleSlug = generateSlugFromTitle(getValue("title"));
  setValue("slug", titleSlug);
}

function syncExternalSlugFromTitle() {
  const titleSlug = generateSlugFromTitle(getValue("externalTitle"));
  setValue("externalSlug", titleSlug);
}

/* =========================
   FORM SHOW / HIDE
========================= */

function hideEventForms() {
  const full = document.getElementById("fullEventForm");
  const external = document.getElementById("externalEventForm");

  if (full) full.hidden = true;
  if (external) external.hidden = true;
}

function cancelEventForm() {
  resetForm();
  resetExternalEventForm();
  hideEventForms();
  closeAdminToast();

  const oldMessage = document.getElementById("adminMessage");
  if (oldMessage) oldMessage.textContent = "";
}

function showFullEventForm() {
  if (isExternalOnlyAdmin()) {
    showExternalEventForm();
    setMessage("External-only admin can create external events only.");
    return;
  }

  hideEventForms();

  const full = document.getElementById("fullEventForm");
  if (full) full.hidden = false;

  resetForm();

  setTimeout(() => {
    full?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }, 50);
}

function showExternalEventForm() {
  hideEventForms();

  const external = document.getElementById("externalEventForm");
  if (external) external.hidden = false;

  resetExternalEventForm();

  setTimeout(() => {
    external?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }, 50);
}

/* =========================
   DATE HELPERS
========================= */

function toIsoMalaysia(datetimeLocalValue) {
  if (!datetimeLocalValue) return "";
  return `${datetimeLocalValue}:00+08:00`;
}

function fromIsoToDatetimeLocal(value) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const pad = n => String(n).padStart(2, "0");

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-") + "T" + [
    pad(date.getHours()),
    pad(date.getMinutes())
  ].join(":");
}

function eventDateToDatetimeLocal(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) {
    return text.slice(0, 16);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return `${text}T00:00`;
  }

  return fromIsoToDatetimeLocal(text);
}

function formatEventListDate(value) {
  const text = String(value || "").trim();
  if (!text) return "-";
  return text.replace("T", " ");
}

function buildRacepackTime(fromId, toId) {
  const from = getValue(fromId);
  const to = getValue(toId);

  if (from && to) return `${from} - ${to}`;
  if (from) return from;
  if (to) return to;

  return "";
}

function setRacepackTimeRange(fromId, toId, value) {
  const text = String(value || "").trim();

  setValue(fromId, "");
  setValue(toId, "");

  if (!text) return;

  const parts = text.split(/\s*-\s*/);

  if (parts[0] && /^\d{2}:\d{2}$/.test(parts[0])) {
    setValue(fromId, parts[0]);
  }

  if (parts[1] && /^\d{2}:\d{2}$/.test(parts[1])) {
    setValue(toId, parts[1]);
  }
}

function splitRacepackTime(value) {
  const text = String(value || "").trim();

  if (!text) {
    return {
      from: "",
      to: ""
    };
  }

  const parts = text.split(/\s*-\s*/);

  return {
    from: parts[0] && /^\d{2}:\d{2}$/.test(parts[0]) ? parts[0] : "",
    to: parts[1] && /^\d{2}:\d{2}$/.test(parts[1]) ? parts[1] : ""
  };
}

function buildRacepackTimeValue(from, to) {
  const cleanFrom = String(from || "").trim();
  const cleanTo = String(to || "").trim();

  if (cleanFrom && cleanTo) return `${cleanFrom} - ${cleanTo}`;
  if (cleanFrom) return cleanFrom;
  if (cleanTo) return cleanTo;

  return "";
}

function addRacepackCollectionRow(item = {}) {
  const list = document.getElementById("racepackCollectionList");
  if (!list) return;

  const time = splitRacepackTime(item.collection_time || item.racepack_time);

  const row = document.createElement("div");
  row.className = "racepack-collection-row";

  row.innerHTML = `
    <div class="form-group">
      <label>Racepack Location</label>
      <input
        class="rpc-location"
        placeholder="Location / T.B.C"
        value="${escapeHtml(item.location || item.racepack_location || "")}"
      >
    </div>

    <div class="form-group">
      <label>Racepack Date</label>
      <input
        class="rpc-date"
        type="date"
        value="${escapeHtml(item.collection_date || item.racepack_date || "")}"
      >
    </div>

    <div class="form-group mobile-half">
      <label>Time From</label>
      <input
        class="rpc-time-from"
        type="time"
        value="${escapeHtml(time.from)}"
      >
    </div>

    <div class="form-group mobile-half">
      <label>Time To</label>
      <input
        class="rpc-time-to"
        type="time"
        value="${escapeHtml(time.to)}"
      >
    </div>

    <div class="racepack-row-actions">
      <button type="button" class="danger rpc-remove-btn">
        Remove
      </button>
    </div>
  `;

  list.appendChild(row);
}

function renderRacepackCollections(items = []) {
  const list = document.getElementById("racepackCollectionList");
  if (!list) return;

  list.innerHTML = "";

  const source = Array.isArray(items) && items.length
    ? items
    : [{}];

  source.forEach(item => addRacepackCollectionRow(item));
  updateRacepackSummary();
}

function getRacepackCollectionsFromForm() {
  return Array.from(document.querySelectorAll(".racepack-collection-row"))
    .map((row, index) => {
      const location = String(row.querySelector(".rpc-location")?.value || "")
        .trim()
        .toUpperCase();

      const collectionDate = String(row.querySelector(".rpc-date")?.value || "").trim();
      const timeFrom = row.querySelector(".rpc-time-from")?.value || "";
      const timeTo = row.querySelector(".rpc-time-to")?.value || "";

      return {
        location,
        collection_date: collectionDate,
        collection_time: buildRacepackTimeValue(timeFrom, timeTo),
        sort_order: index
      };
    })
    .filter(item =>
      item.location ||
      item.collection_date ||
      item.collection_time
    );
}

/* =========================
   IMAGE
========================= */

function updateEventImagePreview(url) {
  const preview = document.getElementById("eventImagePreview");
  if (!preview) return;

  if (url) {
    preview.src = url;
    preview.style.display = "block";
  } else {
    preview.removeAttribute("src");
    preview.style.display = "none";
  }
}

function clearEventImageInput() {
  const fileInput = document.getElementById("eventImageFile");
  if (fileInput) fileInput.value = "";

  setValue("eventImage", "");
  updateEventImagePreview("");
  setImageStatus("");
}

async function removeEventImage() {
  const fileInput = document.getElementById("eventImageFile");
  const currentUrl = getValue("eventImage");

  if (fileInput) fileInput.value = "";

  // Gambar baru upload tapi belum save:
  // delete terus dari R2 masa tekan Remove.
  if (currentUrl && currentUrl !== savedEventImage) {
    const deleted = await deleteUploadedImageFromR2(currentUrl);

    if (!deleted) {
      return;
    }
  }

  setValue("eventImage", "");
  updateEventImagePreview("");
  setImageStatus("");
}

async function uploadEventImage() {
  const fileInput = document.getElementById("eventImageFile");
  syncSlugFromTitle();

const slug = getValue("slug") || generateSlugFromTitle(getValue("title"));

if (!slug) {
  setImageStatus("Fill title first before upload image.", true);
  return;
}

  if (!fileInput || !fileInput.files || !fileInput.files[0]) {
    setImageStatus("Choose image first.", true);
    return;
  }

  const file = fileInput.files[0];

  if (!ALLOWED_EVENT_IMAGE_TYPES.includes(file.type)) {
    setImageStatus("Only JPG, PNG, or WEBP allowed.", true);
    return;
  }

  if (file.size > MAX_EVENT_IMAGE_SIZE) {
    setImageStatus("Image must be below 2MB.", true);
    return;
  }

  const formData = new FormData();
  formData.append("image", file);
  formData.append("event", slug);

  setImageStatus("Uploading image...");

  try {
    const res = await fetch("/api/admin/upload-image", {
      method: "POST",
      headers: adminAuthHeaders(),
      body: formData
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data || !data.success) {
      setImageStatus(data?.error || "Image upload failed.", true);
      return;
    }

    const previousUrl = getValue("eventImage");
	const newUrl = data.url || "";
	
	if (previousUrl && previousUrl !== savedEventImage && previousUrl !== newUrl) {
		await deleteUploadedImageFromR2(previousUrl);
	}
	
	setValue("eventImage", newUrl);
	updateEventImagePreview(newUrl);
	setImageStatus("");
  } catch (err) {
    setImageStatus(err.message || "Image upload failed.", true);
  }
}

/* =========================
   CATEGORY EDITOR
========================= */

function normalizeCategoryPricingType(value) {
  const type = String(value || "BLOCK").trim().toUpperCase();
  return type === "SCHEDULE" ? "SCHEDULE" : "BLOCK";
}

function normalizeCategoryTeeInclude(value) {
  const tee = String(value || "event_tee").trim().toLowerCase();

  if (["event_tee", "finisher_tee", "off"].includes(tee)) {
    return tee;
  }

  return "event_tee";
}

function toAdminPositiveInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
}

function normalizeCategoryGenderRule(value) {
  const gender = String(value || "OPEN").trim().toUpperCase();

  if (["OPEN", "MEN", "WOMEN"].includes(gender)) {
    return gender;
  }

  return "OPEN";
}

function normalizeGroupRuleGender(value) {
  const gender = String(value || "ALL").trim().toUpperCase();

  if (["ALL", "MEN", "WOMEN"].includes(gender)) {
    return gender;
  }

  return "ALL";
}

function parseCategoryGroupRules(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

function isCategoryToggleOn(row, selector) {
  const el = row?.querySelector(selector);
  return Boolean(el?.checked);
}

function getCategoryGroupRulesFromRow(row, minSize = 0) {
  if (!row) return [];

  return Array.from(row.querySelectorAll(".cat-group-rule-row"))
    .map((ruleRow, index) => {
      const slot = toAdminPositiveInt(ruleRow.dataset.slot, index + 1);
      const required = slot <= minSize;
      const toggle = ruleRow.querySelector(".cat-group-rule-enabled");

      return {
        slot,
        enabled: required ? true : Boolean(toggle?.checked),
        required,
        gender: normalizeGroupRuleGender(
          ruleRow.querySelector(".cat-group-rule-gender")?.value
        ),
        age_min: toAdminPositiveInt(
          ruleRow.querySelector(".cat-group-rule-age-min")?.value,
          0
        ),
        age_max: toAdminPositiveInt(
          ruleRow.querySelector(".cat-group-rule-age-max")?.value,
          0
        )
      };
    });
}

function renderCategoryGroupRules(row, sourceRules = null) {
  if (!row) return;

  const box = row.querySelector(".cat-group-rules-list");
  if (!box) return;

  const groupEnabled = isCategoryToggleOn(row, ".cat-group-enabled");
  const groupRulesEnabled = isCategoryToggleOn(row, ".cat-group-rules-enabled");

  const maxSize = toAdminPositiveInt(
    row.querySelector(".cat-group-max-size")?.value,
    0
  );

  const rawMinSize = toAdminPositiveInt(
    row.querySelector(".cat-group-min-size")?.value,
    0
  );

  const minSize = maxSize > 0
    ? Math.min(rawMinSize, maxSize)
    : 0;

  if (!groupEnabled || !groupRulesEnabled || maxSize <= 0) {
    box.innerHTML = "";
    return;
  }

  const currentRules = Array.isArray(sourceRules)
    ? sourceRules
    : getCategoryGroupRulesFromRow(row, minSize);

  const rows = [];

  for (let slot = 1; slot <= maxSize; slot++) {
    const existing =
      currentRules.find(item => Number(item?.slot || 0) === slot) ||
      currentRules[slot - 1] ||
      {};

    const required = slot <= minSize;
    const enabled = required ? true : Boolean(existing.enabled);
    const gender = normalizeGroupRuleGender(existing.gender);
    const ageMin = toAdminPositiveInt(existing.age_min, 0);
    const ageMax = toAdminPositiveInt(existing.age_max, 0);

    rows.push(`
  <div class="cat-group-rule-row" data-slot="${slot}">
    <label class="cat-toggle cat-rule-toggle ${required ? "is-locked" : ""}">
      <input
        class="cat-group-rule-enabled"
        type="checkbox"
        value="1"
        ${enabled ? "checked" : ""}
        ${required ? "disabled" : ""}
      >
      <span class="cat-toggle-ui"></span>
      <span class="cat-toggle-label">Slot ${slot}</span>
    </label>

    <div class="form-group">
      <label>Gender</label>
      <select class="cat-group-rule-gender">
        <option value="ALL" ${gender === "ALL" ? "selected" : ""}>All</option>
        <option value="MEN" ${gender === "MEN" ? "selected" : ""}>Men</option>
        <option value="WOMEN" ${gender === "WOMEN" ? "selected" : ""}>Women</option>
      </select>
    </div>

    <div class="form-group">
      <label>Min Age</label>
      <input class="cat-group-rule-age-min" type="number" min="0" value="${escapeHtml(ageMin)}">
    </div>

    <div class="form-group">
      <label>Max Age</label>
      <input class="cat-group-rule-age-max" type="number" min="0" value="${escapeHtml(ageMax)}">
    </div>
  </div>
`);
  }

  box.innerHTML = rows.join("");
}

function syncCategoryGroupRow(row) {
  if (!row) return;

  const groupEnabled = isCategoryToggleOn(row, ".cat-group-enabled");

  row.classList.toggle("is-group-enabled", groupEnabled);

  row.querySelectorAll(".cat-group-field").forEach(el => {
    el.hidden = !groupEnabled;
  });

  const groupRulesEnabled = groupEnabled && isCategoryToggleOn(row, ".cat-group-rules-enabled");

  row.classList.toggle("is-group-setup-enabled", groupRulesEnabled);

  const hideMainAgeFields = groupEnabled && groupRulesEnabled;

  row.querySelectorAll(".cat-main-age-field").forEach(el => {
    el.hidden = hideMainAgeFields;
  });

  row.querySelectorAll(".cat-group-rules-field").forEach(el => {
    el.hidden = !(groupEnabled && groupRulesEnabled);
  });

  const minInput = row.querySelector(".cat-group-min-size");
  const maxInput = row.querySelector(".cat-group-max-size");

  const maxSize = toAdminPositiveInt(maxInput?.value, 0);
  const minSize = toAdminPositiveInt(minInput?.value, 0);

  if (groupEnabled && maxSize > 0 && minSize > maxSize && minInput) {
    minInput.value = maxSize;
  }

  renderCategoryGroupRules(row);
}

function categoryDateToInput(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) {
    return text.slice(0, 16);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return `${text}T00:00`;
  }

  return fromIsoToDatetimeLocal(text);
}

function syncCategoryPricingRow(row) {
  if (!row) return;

  const pricingType = normalizeCategoryPricingType(
    row.querySelector(".cat-pricing-type")?.value
  );

  row.querySelectorAll(".cat-block-field").forEach(el => {
    el.style.display = pricingType === "BLOCK" ? "" : "none";
  });

  row.querySelectorAll(".cat-schedule-field").forEach(el => {
    el.style.display = pricingType === "SCHEDULE" ? "" : "none";
  });
}

function animateCategoryRowMove(row, targetRow, moveDom) {
  if (!row || !targetRow || typeof moveDom !== "function") return;

  const firstRowRect = row.getBoundingClientRect();
  const firstTargetRect = targetRow.getBoundingClientRect();

  moveDom();

  const lastRowRect = row.getBoundingClientRect();
  const lastTargetRect = targetRow.getBoundingClientRect();

  const rowDeltaY = firstRowRect.top - lastRowRect.top;
  const targetDeltaY = firstTargetRect.top - lastTargetRect.top;

  row.style.transform = `translateY(${rowDeltaY}px)`;
  targetRow.style.transform = `translateY(${targetDeltaY}px)`;

  row.style.transition = "transform 0s";
  targetRow.style.transition = "transform 0s";

  row.classList.add("cat-row-moving");
  targetRow.classList.add("cat-row-moving");

  requestAnimationFrame(() => {
    row.style.transition = "";
    targetRow.style.transition = "";

    row.style.transform = "";
    targetRow.style.transform = "";

    row.classList.add("cat-row-moved");
    targetRow.classList.add("cat-row-moved");

    setTimeout(() => {
      row.classList.remove("cat-row-moving", "cat-row-moved");
      targetRow.classList.remove("cat-row-moving", "cat-row-moved");

      row.style.transform = "";
      targetRow.style.transform = "";
      row.style.transition = "";
      targetRow.style.transition = "";
    }, 280);
  });
}

function moveCategoryRow(button, direction) {
  const row = button?.closest(".cat-row");
  const box = document.getElementById("categoryEditor");

  if (!row || !box) return;

  if (direction === "up") {
    const targetRow = row.previousElementSibling;
    if (!targetRow) return;

    animateCategoryRowMove(row, targetRow, () => {
      box.insertBefore(row, targetRow);
    });
  }

  if (direction === "down") {
    const targetRow = row.nextElementSibling;
    if (!targetRow) return;

    animateCategoryRowMove(row, targetRow, () => {
      box.insertBefore(targetRow, row);
    });
  }

  updateCategorySummary();
}

function addCategoryRow(cat = {}) {
  const box = document.getElementById("categoryEditor");
  if (!box) return;

  const row = document.createElement("div");
  row.className = "cat-row";

  const id = escapeHtml(cat.id || "");
  const name = escapeHtml(String(cat.name || cat.group_name || "").toUpperCase());
  const pricingLabel = escapeHtml(cat.pricing_label || "");
  const price = escapeHtml(cat.price || "");
  const limit = escapeHtml(cat.slot_limit || 0);
  const pricingType = normalizeCategoryPricingType(cat.pricing_type);
  const fromParticipant = escapeHtml(cat.from_participant ?? 1);
  const toParticipant = escapeHtml(cat.to_participant ?? 0);
  const priority = escapeHtml(cat.priority ?? "");
  const displayOrder = escapeHtml(cat.display_order ?? 0);
  const dateFrom = escapeHtml(categoryDateToInput(cat.date_from || cat.start_at || ""));
  const dateTo = escapeHtml(categoryDateToInput(cat.date_to || cat.end_at || ""));
  const active = Number(cat.is_active ?? 1);
  const teeInclude = normalizeCategoryTeeInclude(cat.tee_include);

  const genderRule = normalizeCategoryGenderRule(cat.gender_rule);
  const ageMin = escapeHtml(cat.age_min ?? 0);
  const ageMax = escapeHtml(cat.age_max ?? 0);

  const groupEnabled = Number(cat.group_enabled || 0) ? 1 : 0;
  const groupMinSize = escapeHtml(cat.group_min_size ?? 0);
  const groupMaxSize = escapeHtml(cat.group_max_size ?? 0);
  const groupRulesEnabled = Number(cat.group_rules_enabled || 0) ? 1 : 0;
  const groupRules = parseCategoryGroupRules(cat.group_rules_json);

  row.innerHTML = `
    <input class="cat-id" type="hidden" value="${id}">
    <input class="cat-display-order" type="hidden" value="${displayOrder}">

    <div class="form-group">
      <label>Category</label>
      <input class="cat-name" placeholder="Example: 5KM / 21KM MEN OPEN" value="${name}">
    </div>

    <div class="form-group">
      <label>Pricing Label</label>
      <input class="cat-pricing-label" placeholder="Optional: Early Bird / Normal / Promo" value="${pricingLabel}">
    </div>

    <div class="form-group">
      <label>Type</label>
      <select class="cat-pricing-type">
        <option value="BLOCK" ${pricingType === "BLOCK" ? "selected" : ""}>BLOCK</option>
        <option value="SCHEDULE" ${pricingType === "SCHEDULE" ? "selected" : ""}>SCHEDULE</option>
      </select>
    </div>

    <div class="form-group">
      <label>Price RM</label>
      <input class="cat-price" type="number" step="0.01" placeholder="RM" value="${price}">
    </div>

    <div class="form-group">
      <label>Limit</label>
      <input class="cat-limit" type="number" placeholder="0 = unlimited" value="${limit}">
    </div>

    <div class="form-group">
      <label>Gender</label>
      <select class="cat-gender-rule">
        <option value="OPEN" ${genderRule === "OPEN" ? "selected" : ""}>Open</option>
        <option value="MEN" ${genderRule === "MEN" ? "selected" : ""}>Men</option>
        <option value="WOMEN" ${genderRule === "WOMEN" ? "selected" : ""}>Women</option>
      </select>
    </div>

    <div class="form-group cat-main-age-field">
      <label>Age From</label>
      <input class="cat-age-min" type="number" min="0" placeholder="0" value="${ageMin}">
    </div>

    <div class="form-group cat-main-age-field">
      <label>Age To</label>
      <input class="cat-age-max" type="number" min="0" placeholder="0" value="${ageMax}">
    </div>

    <div class="form-group cat-block-field">
      <label>From Participant</label>
      <input class="cat-from-participant" type="number" min="0" placeholder="1" value="${fromParticipant}">
    </div>

    <div class="form-group cat-block-field">
      <label>To Participant</label>
      <input class="cat-to-participant" type="number" min="0" placeholder="0 = unlimited" value="${toParticipant}">
    </div>

    <div class="form-group cat-schedule-field">
      <label>Date From</label>
      <input class="cat-date-from" type="datetime-local" value="${dateFrom}">
    </div>

    <div class="form-group cat-schedule-field">
      <label>Date To</label>
      <input class="cat-date-to" type="datetime-local" value="${dateTo}">
    </div>

    <div class="form-group">
      <label>Priority</label>
      <input class="cat-priority" type="number" min="0" placeholder="0" value="${priority}">
    </div>

    <div class="form-group">
      <label>Status</label>
      <select class="cat-active">
        <option value="1" ${active === 1 ? "selected" : ""}>Active</option>
        <option value="0" ${active === 0 ? "selected" : ""}>Inactive</option>
      </select>
    </div>

    <div class="form-group">
      <label>Include</label>
      <select class="cat-tee-include">
        <option value="event_tee" ${teeInclude === "event_tee" ? "selected" : ""}>Event Tee</option>
        <option value="finisher_tee" ${teeInclude === "finisher_tee" ? "selected" : ""}>Finisher Tee</option>
        <option value="off" ${teeInclude === "off" ? "selected" : ""}>Off</option>
      </select>
    </div>

<div class="cat-group-section">
  <div class="cat-group-control-bar">
    <div class="form-group cat-toggle-field cat-main-group-toggle-field">
      <label>Group</label>
      <label class="cat-switch">
        <input
          class="cat-group-enabled"
          type="checkbox"
          value="1"
          ${groupEnabled === 1 ? "checked" : ""}
        >
        <span class="cat-toggle-ui"></span>
        <span class="cat-toggle-state"></span>
      </label>
    </div>

    <div class="cat-group-inline-fields cat-group-field" ${groupEnabled === 1 ? "" : "hidden"}>
      <div class="form-group cat-group-size-field">
        <label>Min Group Size</label>
        <input class="cat-group-min-size" type="number" min="0" placeholder="2" value="${groupMinSize}">
      </div>

      <div class="form-group cat-group-size-field">
        <label>Max Group Size</label>
        <input class="cat-group-max-size" type="number" min="0" placeholder="4" value="${groupMaxSize}">
      </div>

      <div class="form-group cat-toggle-field cat-group-setup-field">
        <label>Group Setup</label>
        <label class="cat-switch">
          <input
            class="cat-group-rules-enabled"
            type="checkbox"
            value="1"
            ${groupRulesEnabled === 1 ? "checked" : ""}
          >
          <span class="cat-toggle-ui"></span>
          <span class="cat-toggle-state"></span>
        </label>
      </div>
    </div>
  </div>

  <div class="form-group full cat-group-rules-field">
    <label>Group Rules</label>
    <div class="cat-group-rules-list"></div>
    <small class="muted">
      Required slots are locked ON based on Min Group Size. Extra slots can be ON/OFF.
    </small>
  </div>

  <div class="category-row-actions">
    <button
      type="button"
      class="secondary category-order-btn"
      title="Move up"
      aria-label="Move category up"
      onclick="moveCategoryRow(this, 'up')"
    >↑</button>

    <button
      type="button"
      class="secondary category-order-btn"
      title="Move down"
      aria-label="Move category down"
      onclick="moveCategoryRow(this, 'down')"
    >↓</button>

    <button
      type="button"
      class="danger cat-remove-btn category-order-btn"
      title="Remove category"
      aria-label="Remove category"
    >🗑</button>
  </div>
</div>
  `;

  box.appendChild(row);

  const typeSelect = row.querySelector(".cat-pricing-type");
  if (typeSelect) {
    typeSelect.addEventListener("change", () => syncCategoryPricingRow(row));
  }

  row.querySelector(".cat-group-enabled")?.addEventListener("change", () => {
    syncCategoryGroupRow(row);
    updateCategorySummary();
  });

  row.querySelector(".cat-group-rules-enabled")?.addEventListener("change", () => {
    syncCategoryGroupRow(row);
    updateCategorySummary();
  });

  row.querySelector(".cat-group-min-size")?.addEventListener("change", () => {
    syncCategoryGroupRow(row);
    updateCategorySummary();
  });

  row.querySelector(".cat-group-max-size")?.addEventListener("change", () => {
    syncCategoryGroupRow(row);
    updateCategorySummary();
  });

  syncCategoryPricingRow(row);
  syncCategoryGroupRow(row);
  renderCategoryGroupRules(row, groupRules);
  updateCategorySummary();
}

function renderCategories(categories = []) {
  const box = document.getElementById("categoryEditor");
  if (!box) return;

  box.innerHTML = "";

  const source = Array.isArray(categories) && categories.length
    ? categories
    : [{}];

  source.forEach(cat => addCategoryRow(cat));
  updateCategorySummary();
}

function getCategoriesFromForm() {
  return Array.from(document.querySelectorAll(".cat-row"))
    .map((row, index) => {
      const pricingType = normalizeCategoryPricingType(
        row.querySelector(".cat-pricing-type")?.value
      );

      const name = String(row.querySelector(".cat-name")?.value || "")
        .trim()
        .toUpperCase();

      const pricingLabel = String(row.querySelector(".cat-pricing-label")?.value || "")
        .trim();

      const groupName = name;

      const groupEnabled = isCategoryToggleOn(row, ".cat-group-enabled") ? 1 : 0;

      const rawGroupMinSize = groupEnabled
        ? toAdminPositiveInt(row.querySelector(".cat-group-min-size")?.value, 0)
        : 0;

      const groupMaxSize = groupEnabled
        ? toAdminPositiveInt(row.querySelector(".cat-group-max-size")?.value, 0)
        : 0;

      const groupMinSize =
        groupEnabled && groupMaxSize > 0
          ? Math.min(rawGroupMinSize, groupMaxSize)
          : 0;

      const groupRulesEnabled = groupEnabled
        ? isCategoryToggleOn(row, ".cat-group-rules-enabled") ? 1 : 0
        : 0;

      const groupRulesJson =
        groupEnabled && groupRulesEnabled
          ? getCategoryGroupRulesFromRow(row, groupMinSize)
          : [];

      return {
        id: row.querySelector(".cat-id")?.value || "",
        name,
        group_name: groupName,
        pricing_label: pricingLabel,
        pricing_type: pricingType,
        price: Number(row.querySelector(".cat-price")?.value || 0),
        slot_limit: Number(row.querySelector(".cat-limit")?.value || 0),

        gender_rule: normalizeCategoryGenderRule(
          row.querySelector(".cat-gender-rule")?.value
        ),
        age_min: toAdminPositiveInt(
          row.querySelector(".cat-age-min")?.value,
          0
        ),
        age_max: toAdminPositiveInt(
          row.querySelector(".cat-age-max")?.value,
          0
        ),

        group_enabled: groupEnabled,
        group_min_size: groupMinSize,
        group_max_size: groupEnabled ? groupMaxSize : 0,
        group_rules_enabled: groupRulesEnabled,
        group_rules_json: groupRulesJson,

        from_participant: pricingType === "BLOCK"
          ? Number(row.querySelector(".cat-from-participant")?.value || 0)
          : 0,
        to_participant: pricingType === "BLOCK"
          ? Number(row.querySelector(".cat-to-participant")?.value || 0)
          : 0,
        priority: Number(row.querySelector(".cat-priority")?.value || 0),
        display_order: index,
        date_from: pricingType === "SCHEDULE"
          ? toIsoMalaysia(String(row.querySelector(".cat-date-from")?.value || "").trim())
          : "",
        date_to: pricingType === "SCHEDULE"
          ? toIsoMalaysia(String(row.querySelector(".cat-date-to")?.value || "").trim())
          : "",
        is_active: Number(row.querySelector(".cat-active")?.value || 1),
        tee_include: normalizeCategoryTeeInclude(
          row.querySelector(".cat-tee-include")?.value
        )
      };
    })
    .filter(cat => cat.name);
}

/* =========================
   TEE OPTION EDITOR
========================= */

const DEFAULT_TEE_OPTIONS = [
  { label: "S", price: 0, slot_limit: 0, is_active: 1 },
  { label: "M", price: 0, slot_limit: 0, is_active: 1 },
  { label: "L", price: 0, slot_limit: 0, is_active: 1 },
  { label: "XL", price: 0, slot_limit: 0, is_active: 1 },
  { label: "2XL", price: 0, slot_limit: 0, is_active: 1 },
  { label: "3XL", price: 0, slot_limit: 0, is_active: 1 }
];

function getDefaultTeeOptions() {
  return DEFAULT_TEE_OPTIONS.map(item => ({ ...item }));
}

function addTeeOptionRow(editorId, teeType, option = {}) {
  const box = document.getElementById(editorId);
  if (!box) return;

  const row = document.createElement("div");
  row.className = "tee-row";
  row.dataset.teeType = teeType;

  const id = escapeHtml(option.id || "");
  const label = escapeHtml(option.label || "");
  const price = escapeHtml(option.price || "");
  const limit = escapeHtml(option.slot_limit ?? 0);
  const active = Number(option.is_active ?? 1);

  row.innerHTML = `
  <button
    type="button"
    class="secondary tee-drag-handle"
    draggable="true"
    title="Drag to reorder"
    aria-label="Drag to reorder"
  >☰</button>

  <input class="tee-id" type="hidden" value="${id}">
  <input class="tee-label" placeholder="Option e.g. S / Kecil / Normal / Besar" value="${label}">
    <input class="tee-price" type="number" step="0.01" placeholder="RM" value="${price}">
    <input class="tee-limit" type="number" placeholder="Limit" value="${limit}">
    <select class="tee-active">
      <option value="1" ${active === 1 ? "selected" : ""}>ON</option>
      <option value="0" ${active === 0 ? "selected" : ""}>OFF</option>
    </select>
    <button
      type="button"
      class="danger tee-remove-btn"
      title="Remove tee option"
      aria-label="Remove tee option"
    >🗑</button>
  `;

  box.appendChild(row);
}

function resetTeeEditor(editorId, teeType, options = null) {
  const box = document.getElementById(editorId);
  if (!box) return;

  box.innerHTML = "";

  const list = Array.isArray(options) && options.length
    ? options
    : getDefaultTeeOptions();

  list.forEach(option => addTeeOptionRow(editorId, teeType, option));
  updateTeeSummary(teeType);
}

function getTeeOptionsFromForm(editorId, teeType) {
  const box = document.getElementById(editorId);
  if (!box) return [];

  return Array.from(box.querySelectorAll(".tee-row"))
    .map((row, index) => ({
      id: row.querySelector(".tee-id")?.value || "",
      tee_type: teeType,
      label: String(row.querySelector(".tee-label")?.value || "").trim(),
      price: Number(row.querySelector(".tee-price")?.value || 0),
      slot_limit: Number(row.querySelector(".tee-limit")?.value || 0),
      is_active: Number(row.querySelector(".tee-active")?.value || 1),
      sort_order: index
    }))
    .filter(item => item.label);
}

function getAllTeeOptionsFromForm() {
  return [
    ...getTeeOptionsFromForm("eventTeeEditor", "event_tee"),
    ...getTeeOptionsFromForm("finisherTeeEditor", "finisher_tee")
  ];
}

let draggedTeeRow = null;

function moveTeeRowBefore(targetRow) {
  if (!draggedTeeRow || !targetRow || draggedTeeRow === targetRow) return;

  const box = targetRow.parentElement;
  if (!box || draggedTeeRow.parentElement !== box) return;

  const rows = Array.from(box.querySelectorAll(".tee-row"));
  const draggedIndex = rows.indexOf(draggedTeeRow);
  const targetIndex = rows.indexOf(targetRow);

  if (draggedIndex < 0 || targetIndex < 0) return;

  if (draggedIndex < targetIndex) {
    box.insertBefore(draggedTeeRow, targetRow.nextSibling);
  } else {
    box.insertBefore(draggedTeeRow, targetRow);
  }
}

function clearTeeDragState() {
  document.querySelectorAll(".tee-row.is-dragging, .tee-row.is-drag-over")
    .forEach(row => {
      row.classList.remove("is-dragging", "is-drag-over");
    });

  draggedTeeRow = null;
}


/* =========================
   SETTINGS MODALS
========================= */

let adminSettingsSnapshots = {};

function cloneAdminSettingsData(value) {
  return JSON.parse(JSON.stringify(value || []));
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function pluralize(count, one, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

function getSettingsSnapshot(key) {
  if (key === "racepack") return getRacepackCollectionsFromForm();
  if (key === "category") return getCategoriesFromForm();
  if (key === "eventTee") return getTeeOptionsFromForm("eventTeeEditor", "event_tee");
  if (key === "finisherTee") return getTeeOptionsFromForm("finisherTeeEditor", "finisher_tee");

  return [];
}

function restoreSettingsSnapshot(key, data) {
  if (key === "racepack") {
    renderRacepackCollections(data);
    return;
  }

  if (key === "category") {
    renderCategories(data);
    return;
  }

  if (key === "eventTee") {
    resetTeeEditor("eventTeeEditor", "event_tee", data);
    return;
  }

  if (key === "finisherTee") {
    resetTeeEditor("finisherTeeEditor", "finisher_tee", data);
    return;
  }
}

function getSettingsModalId(key) {
  return {
    racepack: "racepackSettingsModal",
    category: "categorySettingsModal",
    eventTee: "eventTeeSettingsModal",
    finisherTee: "finisherTeeSettingsModal",
    promo: "promoSettingsModal",
    accessCode: "accessCodeSettingsModal"
  }[key] || "";
}

function openAdminSettingsModal(key) {
  const modal = document.getElementById(getSettingsModalId(key));
  if (!modal) return;

  if (key !== "promo" && key !== "accessCode") {
    adminSettingsSnapshots[key] = cloneAdminSettingsData(getSettingsSnapshot(key));
  }

  updateAllAdminSettingsSummaries();
  modal.classList.add("show");
  document.body.classList.add("admin-modal-open");
}

function closeAdminSettingsModal(key, shouldSave) {
  const modal = document.getElementById(getSettingsModalId(key));
  if (!modal) return;

  if (!shouldSave && key !== "promo" && key !== "accessCode" && adminSettingsSnapshots[key]) {
    restoreSettingsSnapshot(key, adminSettingsSnapshots[key]);
  }

  delete adminSettingsSnapshots[key];

  modal.classList.remove("show");
  document.body.classList.remove("admin-modal-open");
  updateAllAdminSettingsSummaries();
}

function setupAdminSettingsModals() {
  document.querySelectorAll(".settings-modal").forEach(modal => {
    modal.addEventListener("click", event => {
      if (event.target !== modal) return;

      const key = Object.keys({
        racepack: 1,
        category: 1,
        eventTee: 1,
        finisherTee: 1,
        promo: 1,
		accessCode: 1
      }).find(item => getSettingsModalId(item) === modal.id);

      if (key) closeAdminSettingsModal(key, key === "promo" || key === "accessCode");
    });
  });
}

function updateRacepackSummary() {
  const count = getRacepackCollectionsFromForm().length;
  setText("racepackCollectionSummary", count ? pluralize(count, "collection") : "No collection set");
}

function updateCategorySummary() {
  const categories = getCategoriesFromForm();
  const active = categories.filter(cat => Number(cat.is_active) === 1).length;
  const total = categories.length;

  setText(
    "categorySummary",
    total
      ? `${pluralize(active, "active category", "active categories")} / ${pluralize(total, "total category", "total categories")}`
      : "No category set"
  );
}

function updateTeeSummary(teeType) {
  const editorId = teeType === "finisher_tee" ? "finisherTeeEditor" : "eventTeeEditor";
  const summaryId = teeType === "finisher_tee" ? "finisherTeeOptionSummary" : "eventTeeOptionSummary";
  const options = getTeeOptionsFromForm(editorId, teeType);
  const active = options.filter(item => Number(item.is_active) === 1).length;

  setText(
    summaryId,
    options.length
      ? `${pluralize(active, "active option")} / ${pluralize(options.length, "total option")}`
      : "No option set"
  );
}

function isPromoExpired(promo) {
  if (Number(promo.is_active ?? 1) !== 1) return true;

  const usageLimit = Number(promo.usage_limit || 0);
  const usedCount = Number(promo.used_count || 0);

  if (usageLimit > 0 && usedCount >= usageLimit) return true;

  const dateTo = promo.date_to || promo.end_at || promo.expired_at || "";
  if (!dateTo) return false;

  const end = new Date(dateTo);
  if (Number.isNaN(end.getTime())) return false;

  return end.getTime() < Date.now();
}

function updatePromoSummary(promoCodes = latestPromoCodes) {
  const list = Array.isArray(promoCodes) ? promoCodes : [];
  const active = list.filter(promo => !isPromoExpired(promo)).length;
  const expired = list.length - active;

  setText("promoCodeSummary", `[ ${active} Active | ${expired} Expired ]`);
}

function isAccessExpired(access) {
  if (Number(access.is_active ?? 1) !== 1) return true;

  const usageLimit = Number(access.usage_limit || 0);
  const usedCount = Number(access.used_count || 0);

  if (usageLimit > 0 && usedCount >= usageLimit) return true;

  const dateTo = access.valid_to || access.date_to || "";
  if (!dateTo) return false;

  const end = new Date(dateTo);
  if (Number.isNaN(end.getTime())) return false;

  return end.getTime() < Date.now();
}

function updateAccessSummary(accessCodes = latestAccessCodes) {
  const list = Array.isArray(accessCodes) ? accessCodes : [];
  const active = list.filter(code => !isAccessExpired(code)).length;
  const expired = list.length - active;

  setText("accessCodeSummary", `[ ${active} Active | ${expired} Expired ]`);
}

function updateAllAdminSettingsSummaries() {
  updateRacepackSummary();
  updateCategorySummary();
  updateTeeSummary("event_tee");
  updateTeeSummary("finisher_tee");
  updatePromoSummary();
  updateAccessSummary();
}

/* =========================
   PROMO CODES
========================= */

function resetPromoUi(message = "Save event first before adding promo code.") {
  currentPromoEventId = null;

  setValue("promoPrefixInput", "");
  setValue("promoDiscountInput", "");
  setValue("promoLimitInput", "");
  setValue("promoQuantityInput", "1");
  setValue("promoDateFromInput", "");
  setValue("promoDateToInput", "");

  latestPromoCodes = [];
  updatePromoSummary([]);
  
  const oldGenerateBtn = document.getElementById("addPromoCodeBtn");
    if (oldGenerateBtn) {
      oldGenerateBtn.classList.remove("promo-generate-main-hidden");
    }

  const box = document.getElementById("promoCodeList");
  if (box) {
    box.className = "muted";
    box.innerHTML = message;
  }
}

function formatPromoMoney(value) {
  return `RM${Number(value || 0).toFixed(2)}`;
}

async function loadPromoCodes(eventId) {
  currentPromoEventId = Number(eventId || 0);

  const box = document.getElementById("promoCodeList");
  if (!box) return;

  if (!currentPromoEventId) {
    resetPromoUi();
    return;
  }

  box.className = "";
  box.innerHTML = `<div class="muted">Loading promo codes...</div>`;

  try {
    const res = await fetch(`/api/admin/promo-codes?event_id=${encodeURIComponent(currentPromoEventId)}`, {
      headers: adminHeaders()
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data || !data.success) {
      box.innerHTML = `<div class="muted">${escapeHtml(data?.error || "Unable to load promo codes.")}</div>`;
      return;
    }

    renderPromoCodes(data.promo_codes || []);

  } catch (err) {
    box.innerHTML = `<div class="muted">${escapeHtml(err.message || "Unable to load promo codes.")}</div>`;
  }
}

function promoDateToInput(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return `${text}T00:00`;
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) {
    return text.slice(0, 16);
  }

  return fromIsoToDatetimeLocal(text);
}

function formatPromoDateLabel(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const input = promoDateToInput(text);
  if (!input) return text;

  return input.replace("T", " ");
}

function getPromoDateFrom(promo) {
  return promo.date_from || promo.start_at || promo.valid_from || "";
}

function getPromoDateTo(promo) {
  return promo.date_to || promo.end_at || promo.expired_at || "";
}

function getPromoStatusText(promo) {
  if (isPromoExpired(promo)) return "Expired";
  return "Active";
}

function toPromoDateOnly(value) {
  const text = String(value || "").trim();
  return text ? text.slice(0, 10) : "";
}

function jsString(value) {
  return JSON.stringify(String(value ?? ""));
}

async function copyPromoCode(code) {
  const text = String(code || "").trim();
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    setMessage(`Copied: ${text}`);
  } catch {
    setMessage(text);
  }
}

function copyPromoCodeFromButton(button) {
  copyPromoCode(button?.dataset?.code || "");
}

function setPromoEditMode(enabled) {
  promoEditMode = !!enabled;
  if (promoEditMode) promoSelectMode = false;
  renderPromoCodes(latestPromoCodes);
}

function setPromoSelectMode(enabled) {
  promoSelectMode = !!enabled;
  if (promoSelectMode) promoEditMode = false;
  renderPromoCodes(latestPromoCodes);
}

function getSelectedPromoIds() {
  return Array.from(document.querySelectorAll(".promo-row-checkbox:checked"))
    .map(input => Number(input.value || 0))
    .filter(Boolean);
}

function syncPromoBulkDeleteButton() {
  const ids = getSelectedPromoIds();

  const deleteBtn = document.getElementById("deleteSelectedPromoBtn");
  if (deleteBtn) deleteBtn.disabled = ids.length < 1;

  const exportBtn = document.getElementById("exportSelectedPromoBtn");
  if (exportBtn) exportBtn.disabled = ids.length < 1;
}

function toggleAllPromoCheckboxes(source) {
  const checked = !!source?.checked;

  document.querySelectorAll(".promo-row-checkbox").forEach(input => {
    input.checked = checked;
  });

  syncPromoBulkDeleteButton();
}

async function deletePromoCodeById(id) {
  const res = await fetch(`/api/admin/promo-code?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: adminHeaders()
  });

  const data = await res.json().catch(() => null);

  if (!res.ok || !data || !data.success) {
    throw new Error(data?.error || "Delete promo code failed.");
  }

  return data;
}

async function deleteSelectedPromoCodes() {
  const ids = getSelectedPromoIds();

  if (!ids.length) {
    setMessage("Select promo code first.");
    return;
  }

  if (!confirm(`Delete ${ids.length} selected promo code(s)?`)) {
    return;
  }

  try {
    const res = await fetch("/api/admin/promo-code", {
      method: "DELETE",
      headers: adminHeaders(),
      body: JSON.stringify({ ids })
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data || !data.success) {
      throw new Error(data?.error || "Delete selected promo codes failed.");
    }

    await loadPromoCodes(currentPromoEventId);
    promoEditMode = true;
    setMessage(data.message || `${ids.length} promo code(s) deleted.`);

  } catch (err) {
    setMessage(err.message || "Delete selected promo codes failed.");
  }
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function exportSelectedPromoCodesCsv() {
  const ids = getSelectedPromoIds();

  if (!ids.length) {
    setMessage("Select promo code first.");
    return;
  }

  const selected = latestPromoCodes.filter(promo =>
    ids.includes(Number(promo.id || 0))
  );

  const rows = [
    ["Code", "Discount Amount", "Limit", "Validity From", "Validity To"],
    ...selected.map(promo => {
      const dateFrom = getPromoDateFrom(promo);
      const dateTo = getPromoDateTo(promo);

      return [
        promo.code || "",
        formatPromoMoney(promo.discount_amount || 0),
        Number(promo.usage_limit || 0) > 0
          ? Number(promo.usage_limit || 0)
          : "Unlimited",
        formatPromoDateLabel(dateFrom) || "",
        formatPromoDateLabel(dateTo) || ""
      ];
    })
  ];

  const csv = rows
    .map(row => row.map(csvEscape).join(","))
    .join("\r\n");

  const blob = new Blob(["\ufeff" + csv], {
    type: "text/csv;charset=utf-8;"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `promo-codes-${currentPromoEventId || "event"}.csv`;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);

  setMessage(`${selected.length} promo code(s) exported.`);
}

function renderPromoCodes(promoCodes) {
  const box = document.getElementById("promoCodeList");
  if (!box) return;

  latestPromoCodes = Array.isArray(promoCodes) ? promoCodes : [];
  updatePromoSummary(latestPromoCodes);

  if (!latestPromoCodes.length) {
    promoEditMode = false;
    box.className = "muted";
    box.innerHTML = `<div class="muted">No promo code yet.</div>`;
    return;
  }

  box.className = "";

  const rows = latestPromoCodes.map(promo => {
    const id = Number(promo.id || 0);
    const code = promo.code || "-";
    const discountAmount = Number(promo.discount_amount || 0);
    const usageLimit = Number(promo.usage_limit || 0);
    const usedCount = Number(promo.used_count || 0);
    const active = Number(promo.is_active ?? 1);
    const dateFrom = getPromoDateFrom(promo);
    const dateTo = getPromoDateTo(promo);
    const statusText = getPromoStatusText(promo);

    const dateText = dateFrom || dateTo
      ? `${formatPromoDateLabel(dateFrom) || "Anytime"} → ${formatPromoDateLabel(dateTo) || "No expiry"}`
      : "No date limit";

    return `
      <tr data-promo-id="${id}" class="${statusText === "Expired" ? "is-expired" : ""}">
        <td class="promo-select-col">
          <input
            type="checkbox"
            class="promo-row-checkbox"
            value="${id}"
            onchange="syncPromoBulkDeleteButton()"
          >
        </td>

        <td class="promo-code-cell">
          <button
            type="button"
            class="promo-copy-code"
            data-code="${escapeHtml(code)}"
            onclick="copyPromoCodeFromButton(this)"
            title="Copy promo code"
          >
            ${escapeHtml(code)}
          </button>
        </td>

        <td>${formatPromoMoney(discountAmount)}</td>
        <td>${usageLimit > 0 ? usageLimit : "Unlimited"}</td>
        <td>${usedCount}</td>
        <td>${escapeHtml(dateText)}</td>

        <td>
          <span class="status-pill">${escapeHtml(statusText)}</span>
        </td>

        <td class="promo-action-col">
          <button
            type="button"
            class="secondary promo-icon-btn"
            onclick="togglePromoEdit(${id}, true)"
            title="Edit promo code"
            aria-label="Edit promo code"
          >
            ✎
          </button>
        </td>
      </tr>

      <tr class="promo-edit-row" data-promo-edit-id="${id}" hidden>
        <td colspan="8">
          <div class="promo-edit-panel">
            <div class="promo-edit-grid">
              <div class="form-group">
                <label>RM-</label>
                <input
                  class="promo-discount-edit"
                  type="number"
                  min="0"
                  step="0.01"
                  value="${discountAmount}"
                >
              </div>

              <div class="form-group">
                <label>Limit</label>
                <input
                  class="promo-limit-edit"
                  type="number"
                  min="0"
                  step="1"
                  value="${usageLimit}"
                >
              </div>

              <div class="form-group">
                <label>Date From</label>
                <input
                  class="promo-date-from-edit"
                  type="datetime-local"
                  value="${escapeHtml(promoDateToInput(dateFrom))}"
                >
              </div>

              <div class="form-group">
                <label>Date To</label>
                <input
                  class="promo-date-to-edit"
                  type="datetime-local"
                  value="${escapeHtml(promoDateToInput(dateTo))}"
                >
              </div>

              <div class="form-group">
                <label>Status</label>
                <select class="promo-active-edit">
                  <option value="1" ${active === 1 ? "selected" : ""}>Active</option>
                  <option value="0" ${active === 0 ? "selected" : ""}>Inactive</option>
                </select>
              </div>
            </div>

            <div class="button-row promo-edit-actions">
              <button type="button" class="secondary" onclick="updatePromoCode(${id})">
                Save
              </button>

              <button type="button" class="secondary" onclick="togglePromoEdit(${id}, false)">
                Cancel
              </button>

              <button type="button" class="danger" onclick="deletePromoCode(${id})">
                Delete
              </button>
            </div>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  box.innerHTML = `
    <div class="promo-table-toolbar">
      <button
	    type="button"
		id="promoToolbarGenerateBtn"
		onclick="addPromoCode()"
	  >
	    Generate Promo Code
	  </button>
	  
	  <button
        type="button"
        class="secondary"
        onclick="setPromoSelectMode(${promoSelectMode ? "false" : "true"})"
      >
        ${promoSelectMode ? "Done" : "Select"}
      </button>

      <button
        type="button"
        class="secondary"
        onclick="setPromoEditMode(${promoEditMode ? "false" : "true"})"
      >
        ${promoEditMode ? "Done" : "Edit"}
      </button>

      <button
        type="button"
        id="exportSelectedPromoBtn"
        class="secondary"
        onclick="exportSelectedPromoCodesCsv()"
        ${promoSelectMode ? "" : "hidden"}
        disabled
      >
        Export CSV
      </button>

      <button
        type="button"
        id="deleteSelectedPromoBtn"
        class="danger"
        onclick="deleteSelectedPromoCodes()"
        ${promoEditMode ? "" : "hidden"}
        disabled
      >
        Delete Selected
      </button>
    </div>

    <div class="promo-table-wrap ${promoEditMode || promoSelectMode ? "is-edit-mode" : ""}">
      <table class="promo-code-table">
        <thead>
          <tr>
            <th class="promo-select-col">
              <input type="checkbox" onchange="toggleAllPromoCheckboxes(this)">
            </th>
            <th>Code</th>
            <th>RM</th>
            <th>Limit</th>
            <th>Used</th>
            <th>Date</th>
            <th>Status</th>
            <th class="promo-action-col"></th>
          </tr>
        </thead>

        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
  
  const oldGenerateBtn = document.getElementById("addPromoCodeBtn");
    if (oldGenerateBtn) {
      oldGenerateBtn.classList.add("promo-generate-main-hidden");
    }

  syncPromoBulkDeleteButton();
}

function togglePromoEdit(id, forceOpen) {
  const editRow = document.querySelector(`[data-promo-edit-id="${Number(id)}"]`);
  if (!editRow) return;

  const shouldOpen = typeof forceOpen === "boolean"
    ? forceOpen
    : editRow.hidden;

  document.querySelectorAll(".promo-edit-row").forEach(row => {
    if (row !== editRow) row.hidden = true;
  });

  editRow.hidden = !shouldOpen;
}

function toPromoDateOnly(value) {
  const text = String(value || "").trim();
  return text ? text.slice(0, 10) : "";
}

async function addPromoCode() {
  if (!currentPromoEventId) {
    setMessage("Save event first before adding promo code.");
    return;
  }

  const prefix = getValue("promoPrefixInput").toUpperCase();
  const discountAmount = Number(getValue("promoDiscountInput") || 0);
  const usageLimit = Number(getValue("promoLimitInput") || 0);
  const quantity = Math.max(1, Number(getValue("promoQuantityInput") || 1));
  const dateFrom = getValue("promoDateFromInput");
  const dateTo = getValue("promoDateToInput");

  if (!prefix) {
    setMessage("Promo prefix is required.");
    return;
  }

  if (discountAmount <= 0) {
    setMessage("Discount amount is required.");
    return;
  }

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
    setMessage("Quantity must be between 1 and 100.");
    return;
  }

  try {
    const res = await fetch("/api/admin/promo-codes", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        event_id: currentPromoEventId,
        prefix,
        discount_amount: discountAmount,
        usage_limit: usageLimit,
        quantity,
        date_from: toPromoDateOnly(dateFrom),
        date_to: toPromoDateOnly(dateTo),
        is_active: 1
      })
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data || !data.success) {
      setMessage(data?.error || "Create promo code failed.");
      return;
    }

    setValue("promoDiscountInput", "");
    setValue("promoLimitInput", "");
    setValue("promoQuantityInput", "1");
    setValue("promoDateFromInput", "");
    setValue("promoDateToInput", "");

    await loadPromoCodes(currentPromoEventId);

    setMessage(
      Array.isArray(data.codes) && data.codes.length > 1
        ? `${data.codes.length} promo codes created.`
        : data.message || `Promo code created: ${data.code || ""}`
    );

  } catch (err) {
    setMessage(err.message || "Create promo code failed.");
  }
}

async function updatePromoCode(id) {
  const promoId = Number(id);
  const editRow = document.querySelector(`[data-promo-edit-id="${promoId}"]`);

  if (!editRow) {
    setMessage("Promo edit row not found.");
    return;
  }

  const discountAmount = Number(editRow.querySelector(".promo-discount-edit")?.value || 0);
  const usageLimit = Number(editRow.querySelector(".promo-limit-edit")?.value || 0);
  const dateFrom = editRow.querySelector(".promo-date-from-edit")?.value || "";
  const dateTo = editRow.querySelector(".promo-date-to-edit")?.value || "";
  const isActive = Number(editRow.querySelector(".promo-active-edit")?.value || 0);

  if (discountAmount <= 0) {
    setMessage("Discount amount is required.");
    return;
  }

  try {
    const res = await fetch(`/api/admin/promo-code?id=${encodeURIComponent(promoId)}`, {
      method: "PATCH",
      headers: adminHeaders(),
      body: JSON.stringify({
        discount_amount: discountAmount,
        usage_limit: usageLimit,
        is_active: isActive,
        date_from: toPromoDateOnly(dateFrom),
        date_to: toPromoDateOnly(dateTo)
      })
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data || !data.success) {
      setMessage(data?.error || "Update promo code failed.");
      return;
    }

    await loadPromoCodes(currentPromoEventId);
    setMessage(data.message || "Promo code updated.");

  } catch (err) {
    setMessage(err.message || "Update promo code failed.");
  }
}

async function deletePromoCode(id) {
  if (!confirm("Delete this promo code? Registration records will keep used discount history.")) {
    return;
  }

  try {
    const data = await deletePromoCodeById(id);

    await loadPromoCodes(currentPromoEventId);
    setMessage(data.message || "Promo code deleted.");

  } catch (err) {
    setMessage(err.message || "Delete promo code failed.");
  }
}

/* =========================
   ACCESS CODES
========================= */

function resetAccessUi(message = "Save event first before adding access code.") {
  currentAccessEventId = null;

  setValue("accessPrefixInput", "");
  setValue("accessLimitInput", "");
  setValue("accessQuantityInput", "1");
  setValue("accessDateFromInput", "");
  setValue("accessDateToInput", "");

  latestAccessCodes = [];
  updateAccessSummary([]);

  const oldGenerateBtn = document.getElementById("addAccessCodeBtn");
  if (oldGenerateBtn) {
    oldGenerateBtn.classList.remove("promo-generate-main-hidden");
  }

  const box = document.getElementById("accessCodeList");
  if (box) {
    box.className = "muted";
    box.innerHTML = message;
  }
}

async function loadAccessCodes(eventId) {
  currentAccessEventId = Number(eventId || 0);

  const box = document.getElementById("accessCodeList");
  if (!box) return;

  if (!currentAccessEventId) {
    resetAccessUi();
    return;
  }

  box.className = "";
  box.innerHTML = `<div class="muted">Loading access codes...</div>`;

  try {
    const res = await fetch(`/api/admin/access-code?event_id=${encodeURIComponent(currentAccessEventId)}`, {
      headers: adminHeaders()
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data || !data.success) {
      box.innerHTML = `<div class="muted">${escapeHtml(data?.error || "Unable to load access codes.")}</div>`;
      return;
    }

    renderAccessCodes(data.access_codes || []);

  } catch (err) {
    box.innerHTML = `<div class="muted">${escapeHtml(err.message || "Unable to load access codes.")}</div>`;
  }
}

function getAccessDateFrom(item) {
  return item.valid_from || item.date_from || "";
}

function getAccessDateTo(item) {
  return item.valid_to || item.date_to || "";
}

function getAccessStatusText(item) {
  if (isAccessExpired(item)) return "Expired";
  return "Active";
}

function setAccessEditMode(enabled) {
  accessEditMode = !!enabled;
  if (accessEditMode) accessSelectMode = false;
  renderAccessCodes(latestAccessCodes);
}

function setAccessSelectMode(enabled) {
  accessSelectMode = !!enabled;
  if (accessSelectMode) accessEditMode = false;
  renderAccessCodes(latestAccessCodes);
}

function getSelectedAccessIds() {
  return Array.from(document.querySelectorAll(".access-row-checkbox:checked"))
    .map(input => Number(input.value || 0))
    .filter(Boolean);
}

function syncAccessBulkDeleteButton() {
  const ids = getSelectedAccessIds();

  const deleteBtn = document.getElementById("deleteSelectedAccessBtn");
  if (deleteBtn) deleteBtn.disabled = ids.length < 1;

  const exportBtn = document.getElementById("exportSelectedAccessBtn");
  if (exportBtn) exportBtn.disabled = ids.length < 1;
}

function toggleAllAccessCheckboxes(source) {
  const checked = !!source?.checked;

  document.querySelectorAll(".access-row-checkbox").forEach(input => {
    input.checked = checked;
  });

  syncAccessBulkDeleteButton();
}

async function copyAccessCode(code) {
  const text = String(code || "").trim();
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    setMessage(`Copied: ${text}`);
  } catch {
    setMessage(text);
  }
}

function copyAccessCodeFromButton(button) {
  copyAccessCode(button?.dataset?.code || "");
}

function renderAccessCodes(accessCodes) {
  const box = document.getElementById("accessCodeList");
  if (!box) return;

  latestAccessCodes = Array.isArray(accessCodes) ? accessCodes : [];
  updateAccessSummary(latestAccessCodes);

  if (!latestAccessCodes.length) {
    accessEditMode = false;
    box.className = "muted";
    box.innerHTML = `<div class="muted">No access code yet.</div>`;
    return;
  }

  box.className = "";

  const rows = latestAccessCodes.map(item => {
    const id = Number(item.id || 0);
    const code = item.code || "-";
    const usageLimit = Number(item.usage_limit || 0);
    const usedCount = Number(item.used_count || 0);
    const active = Number(item.is_active ?? 1);
    const dateFrom = getAccessDateFrom(item);
    const dateTo = getAccessDateTo(item);
    const statusText = getAccessStatusText(item);

    const dateText = dateFrom || dateTo
      ? `${formatPromoDateLabel(dateFrom) || "Anytime"} → ${formatPromoDateLabel(dateTo) || "No expiry"}`
      : "No date limit";

    return `
      <tr data-access-id="${id}" class="${statusText === "Expired" ? "is-expired" : ""}">
        <td class="promo-select-col">
          <input
            type="checkbox"
            class="access-row-checkbox"
            value="${id}"
            onchange="syncAccessBulkDeleteButton()"
          >
        </td>

        <td class="promo-code-cell">
          <button
            type="button"
            class="promo-copy-code"
            data-code="${escapeHtml(code)}"
            onclick="copyAccessCodeFromButton(this)"
            title="Copy access code"
          >
            ${escapeHtml(code)}
          </button>
        </td>

        <td>${usageLimit > 0 ? usageLimit : "Unlimited"}</td>
        <td>${usedCount}</td>
        <td>${escapeHtml(dateText)}</td>

        <td>
          <span class="status-pill">${escapeHtml(statusText)}</span>
        </td>

        <td class="promo-action-col">
          <button
            type="button"
            class="secondary promo-icon-btn"
            onclick="toggleAccessEdit(${id}, true)"
            title="Edit access code"
            aria-label="Edit access code"
          >
            ✎
          </button>
        </td>
      </tr>

      <tr class="promo-edit-row" data-access-edit-id="${id}" hidden>
        <td colspan="7">
          <div class="promo-edit-panel">
            <div class="promo-edit-grid">
              <div class="form-group">
                <label>Limit</label>
                <input
                  class="access-limit-edit"
                  type="number"
                  min="0"
                  step="1"
                  value="${usageLimit}"
                >
              </div>

              <div class="form-group">
                <label>Date From</label>
                <input
                  class="access-date-from-edit"
                  type="datetime-local"
                  value="${escapeHtml(promoDateToInput(dateFrom))}"
                >
              </div>

              <div class="form-group">
                <label>Date To</label>
                <input
                  class="access-date-to-edit"
                  type="datetime-local"
                  value="${escapeHtml(promoDateToInput(dateTo))}"
                >
              </div>

              <div class="form-group">
                <label>Status</label>
                <select class="access-active-edit">
                  <option value="1" ${active === 1 ? "selected" : ""}>Active</option>
                  <option value="0" ${active === 0 ? "selected" : ""}>Inactive</option>
                </select>
              </div>
            </div>

            <div class="button-row promo-edit-actions">
              <button type="button" class="secondary" onclick="updateAccessCode(${id}, ${jsString(code)})">
                Save
              </button>

              <button type="button" class="secondary" onclick="toggleAccessEdit(${id}, false)">
                Cancel
              </button>

              <button type="button" class="danger" onclick="deleteAccessCode(${id})">
                Delete
              </button>
            </div>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  box.innerHTML = `
    <div class="promo-table-toolbar">
      <button
        type="button"
        class="secondary"
        onclick="setAccessSelectMode(${accessSelectMode ? "false" : "true"})"
      >
        ${accessSelectMode ? "Done" : "Select"}
      </button>

      <button
        type="button"
        class="secondary"
        onclick="setAccessEditMode(${accessEditMode ? "false" : "true"})"
      >
        ${accessEditMode ? "Done" : "Edit"}
      </button>

      <button
        type="button"
        id="exportSelectedAccessBtn"
        class="secondary"
        onclick="exportSelectedAccessCodesCsv()"
        ${accessSelectMode ? "" : "hidden"}
        disabled
      >
        Export CSV
      </button>

      <button
        type="button"
        id="deleteSelectedAccessBtn"
        class="danger"
        onclick="deleteSelectedAccessCodes()"
        ${accessEditMode ? "" : "hidden"}
        disabled
      >
        Delete Selected
      </button>
    </div>

    <div class="promo-table-wrap ${accessEditMode || accessSelectMode ? "is-edit-mode" : ""}">
      <table class="promo-code-table">
        <thead>
          <tr>
            <th class="promo-select-col">
              <input type="checkbox" onchange="toggleAllAccessCheckboxes(this)">
            </th>
            <th>Code</th>
            <th>Limit</th>
            <th>Used</th>
            <th>Date</th>
            <th>Status</th>
            <th class="promo-action-col"></th>
          </tr>
        </thead>

        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;

  syncAccessBulkDeleteButton();
}

function toggleAccessEdit(id, forceOpen) {
  const editRow = document.querySelector(`[data-access-edit-id="${Number(id)}"]`);
  if (!editRow) return;

  const shouldOpen = typeof forceOpen === "boolean"
    ? forceOpen
    : editRow.hidden;

  document.querySelectorAll("[data-access-edit-id]").forEach(row => {
    if (row !== editRow) row.hidden = true;
  });

  editRow.hidden = !shouldOpen;
}

async function addAccessCode() {
  if (!currentAccessEventId) {
    setMessage("Save event first before adding access code.");
    return;
  }

  const prefix = getValue("accessPrefixInput").toUpperCase();
  const usageLimit = Number(getValue("accessLimitInput") || 0);
  const quantity = Math.max(1, Number(getValue("accessQuantityInput") || 1));
  const validFrom = getValue("accessDateFromInput");
  const validTo = getValue("accessDateToInput");

  if (!prefix) {
    setMessage("Access code prefix is required.");
    return;
  }

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) {
    setMessage("Quantity must be between 1 and 500.");
    return;
  }

  try {
    const res = await fetch("/api/admin/access-code", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        action: "generate",
        event_id: currentAccessEventId,
        prefix,
        usage_limit: usageLimit,
        quantity,
        valid_from: toPromoDateOnly(validFrom),
        valid_to: toPromoDateOnly(validTo),
        is_active: 1
      })
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data || !data.success) {
      setMessage(data?.error || "Create access code failed.");
      return;
    }

    setValue("accessLimitInput", "");
    setValue("accessQuantityInput", "1");
    setValue("accessDateFromInput", "");
    setValue("accessDateToInput", "");

    await loadAccessCodes(currentAccessEventId);

    setMessage(
      Array.isArray(data.created) && data.created.length > 1
        ? `${data.created.length} access codes created.`
        : "Access code created."
    );

  } catch (err) {
    setMessage(err.message || "Create access code failed.");
  }
}

async function updateAccessCode(id, code) {
  const accessId = Number(id);
  const editRow = document.querySelector(`[data-access-edit-id="${accessId}"]`);

  if (!editRow) {
    setMessage("Access edit row not found.");
    return;
  }

  const usageLimit = Number(editRow.querySelector(".access-limit-edit")?.value || 0);
  const validFrom = editRow.querySelector(".access-date-from-edit")?.value || "";
  const validTo = editRow.querySelector(".access-date-to-edit")?.value || "";
  const isActive = Number(editRow.querySelector(".access-active-edit")?.value || 0);

  try {
    const res = await fetch("/api/admin/access-code", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        action: "update",
        id: accessId,
        event_id: currentAccessEventId,
        code,
        usage_limit: usageLimit,
        valid_from: toPromoDateOnly(validFrom),
        valid_to: toPromoDateOnly(validTo),
        is_active: isActive
      })
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data || !data.success) {
      setMessage(data?.error || "Update access code failed.");
      return;
    }

    await loadAccessCodes(currentAccessEventId);
    setMessage("Access code updated.");

  } catch (err) {
    setMessage(err.message || "Update access code failed.");
  }
}

async function deleteAccessCodeById(id) {
  const res = await fetch("/api/admin/access-code", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      action: "delete",
      id: Number(id)
    })
  });

  const data = await res.json().catch(() => null);

  if (!res.ok || !data || !data.success) {
    throw new Error(data?.error || "Delete access code failed.");
  }

  return data;
}

async function deleteAccessCode(id) {
  if (!confirm("Delete this access code?")) {
    return;
  }

  try {
    await deleteAccessCodeById(id);
    await loadAccessCodes(currentAccessEventId);
    setMessage("Access code deleted.");
  } catch (err) {
    setMessage(err.message || "Delete access code failed.");
  }
}

async function deleteSelectedAccessCodes() {
  const ids = getSelectedAccessIds();

  if (!ids.length) {
    setMessage("Select access code first.");
    return;
  }

  if (!confirm(`Delete ${ids.length} selected access code(s)?`)) {
    return;
  }

  try {
    const res = await fetch("/api/admin/access-code", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        action: "delete_selected",
        ids
      })
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data || !data.success) {
      throw new Error(data?.error || "Delete selected access codes failed.");
    }

    await loadAccessCodes(currentAccessEventId);
    accessEditMode = true;
    setMessage(`${ids.length} access code(s) deleted.`);

  } catch (err) {
    setMessage(err.message || "Delete selected access codes failed.");
  }
}

function exportSelectedAccessCodesCsv() {
  const ids = getSelectedAccessIds();

  if (!ids.length) {
    setMessage("Select access code first.");
    return;
  }

  const selected = latestAccessCodes.filter(item =>
    ids.includes(Number(item.id || 0))
  );

  const rows = [
    ["Code", "Limit", "Validity From", "Validity To"],
    ...selected.map(item => {
      const dateFrom = getAccessDateFrom(item);
      const dateTo = getAccessDateTo(item);

      return [
        item.code || "",
        Number(item.usage_limit || 0) > 0
          ? Number(item.usage_limit || 0)
          : "Unlimited",
        formatPromoDateLabel(dateFrom) || "",
        formatPromoDateLabel(dateTo) || ""
      ];
    })
  ];

  const csv = rows
    .map(row => row.map(csvEscape).join(","))
    .join("\r\n");

  const blob = new Blob(["\ufeff" + csv], {
    type: "text/csv;charset=utf-8;"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `access-codes-${currentAccessEventId || "event"}.csv`;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);

  setMessage(`${selected.length} access code(s) exported.`);
}

/* =========================
   INTERNAL EVENT FORM
========================= */

function resetForm() {
  const formTitle = document.getElementById("formTitle");
  if (formTitle) formTitle.textContent = "Create Event";

  setValue("editingId", "");

[
  "slug",
  "title",
  "eventType",
  "venue",
  "organizerName",
  "organizerUrl",
  "bankAccountName",
  "bankAccountNumber",
  "eventDate",
  "racepackLocation",
  "racepackDate",
  "racepackTimeFrom",
  "racepackTimeTo",
  "openAt",
  "closeAt",
  "totalLimit",
  "sortOrder",
  "shortDescription",
  "longDescription",
  "postageFee",
  "postageMaxParticipants"
].forEach(id => setValue(id, ""));

setValue("statusMode", "force_closed");
setValue("isVisible", "1");
setValue("paymentGateway", "chip");
setValue("paymentEnvironment", "sandbox");
setValue("registrationAccessMode", "open");
syncPaymentGatewayAccess();
setValue("eventTeeEnabled", "1");
setValue("finisherTeeEnabled", "0");
setValue("medicalConditionEnabled", "0");
setValue("postageEnabled", "0");
setValue("postageMaxParticipants", "0");
setValue("adminFeeEnabled", "1");
setValue("adminFeeAmount", "4");
setValue("adminFeePercent", "8");
savedAdminFeeEnabled = 1;
savedAdminFeeAmount = 4;
savedAdminFeePercent = 8;
savedEmailProvider = "enginemailer";
setValue("emailProvider", "enginemailer");
syncEmailProviderAccess();

syncAdminFeeAccess();
updateAdminFeeHint();
renderRacepackCollections();

  savedEventImage = "";
  clearEventImageInput();

infoPosterImages = [];
savedInfoPosterImages = [];
renderInfoPosters();

renderCategories();

  resetTeeEditor("eventTeeEditor", "event_tee");
  resetTeeEditor("finisherTeeEditor", "finisher_tee");

  resetPromoUi();
  resetAccessUi();
  updateAllAdminSettingsSummaries();
}

function buildEventPayload() {
  const selectedPaymentGateway = normalizePaymentGateway(getValue("paymentGateway"));

  const paymentGateway =
    !isMasterAdmin() && selectedPaymentGateway === "manual"
      ? "toyyibpay"
      : selectedPaymentGateway;

  const paymentEnvironment = normalizePaymentEnvironment(getValue("paymentEnvironment"));
  
  const racepackCollections = getRacepackCollectionsFromForm();
  
  const firstRacepack = racepackCollections[0] || {
	location: "",
	collection_date: "",
	collection_time: ""
  };

  return {
    registration_mode: "internal",
	registration_access_mode: normalizeRegistrationAccessMode(getValue("registrationAccessMode")),
    external_registration_url: "",

    payment_gateway: paymentGateway,
    payment_environment: paymentGateway === "manual" ? "" : paymentEnvironment,
    email_provider: isRealMasterAdmin()
      ? normalizeEmailProvider(getValue("emailProvider"))
      : savedEmailProvider,

    // keep old field so existing backend/manual logic does not break
    payment_mode: paymentModeFromGateway(paymentGateway),

    slug: generateSlugFromTitle(getValue("title")),
    title: getValue("title"),
    event_type: getValue("eventType"),
    short_description: getValue("shortDescription"),
	long_description: getValue("longDescription"),
    venue: getValue("venue"),
    organizer_name: getValue("organizerName"),
    organizer_url: getValue("organizerUrl"),
    bank_account_name: getValue("bankAccountName"),
    bank_account_number: getValue("bankAccountNumber"),
    event_date: getValue("eventDate"),
    racepack_location: firstRacepack.location,
	racepack_date: firstRacepack.collection_date,
	racepack_time: firstRacepack.collection_time,
	racepack_collections: racepackCollections,
    status_mode: getValue("statusMode"),
    open_at: toIsoMalaysia(getValue("openAt")),
    close_at: toIsoMalaysia(getValue("closeAt")),
    total_limit: Number(getValue("totalLimit") || 0),
    is_visible: Number(getValue("isVisible") || 1),
    event_image: getValue("eventImage"),
    info_images: JSON.stringify(infoPosterImages.slice(0, 8)),
    postage_enabled: Number(getValue("postageEnabled") || 0),
    postage_fee: Number(getValue("postageFee") || 0),
    postage_max_participants: toAdminPositiveInt(getValue("postageMaxParticipants"), 0),
    admin_fee_enabled: isRealMasterAdmin()
      ? Number(getValue("adminFeeEnabled") || 0)
      : savedAdminFeeEnabled,

    admin_fee_amount: isRealMasterAdmin()
      ? Number(getValue("adminFeeAmount") || 4)
      : savedAdminFeeAmount,

    admin_fee_percent: isRealMasterAdmin()
      ? Number(getValue("adminFeePercent") || 8)
      : savedAdminFeePercent,
    event_tee_enabled: Number(getValue("eventTeeEnabled") || 0),
    finisher_tee_enabled: Number(getValue("finisherTeeEnabled") || 0),
	medical_condition_enabled: Number(getValue("medicalConditionEnabled") || 0),
    categories: getCategoriesFromForm(),
	tee_options: getAllTeeOptionsFromForm()
  };
}

async function saveEvent() {
  const id = getValue("editingId");
  const payload = buildEventPayload();

  if (!payload.title) {
  setMessage("Event title is required.");
  return;
}

if (!payload.slug) {
  setMessage("Unable to generate event URL from title.");
  return;
}

  const url = id ? `/api/admin/event?id=${encodeURIComponent(id)}` : "/api/admin/events";
  const method = id ? "PATCH" : "POST";

  try {
    const res = await fetch(url, {
      method,
      headers: adminHeaders(),
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data || !data.success) {
      setMessage(data?.error || "Save failed.");
      return;
    }

    setMessage(id ? "Event updated." : "Event created.");
    resetForm();
    hideEventForms();
    loadEvents();
  } catch (err) {
    setMessage(err.message || "Save failed.");
  }
}

/* =========================
   EXTERNAL EVENT FORM
========================= */

function resetExternalEventForm() {
  [
    "externalEditingId",
    "externalCategoryId",
    "externalSlug",
    "externalRegistrationUrl",
    "externalTitle",
	"externalEventType",
    "externalVenue",
    "externalEventDate",
	"externalRacepackLocation",
	"externalRacepackDate",
	"externalRacepackTimeFrom",
	"externalRacepackTimeTo",
    "externalCategories",
    "externalOrganizerName",
    "externalShortDescription",
	"externalLongDescription",
    "externalEventImage"
  ].forEach(id => setValue(id, ""));
  
}

function populateExternalEventForm(event, categories) {
  hideEventForms();

  const external = document.getElementById("externalEventForm");
  if (external) external.hidden = false;

  const firstCategory = (categories || [])[0] || {};

  setValue("externalEditingId", event.id || "");
  setValue("externalCategoryId", firstCategory.id || "");

  setValue("externalSlug", generateSlugFromTitle(event.title || ""));
  setValue("externalRegistrationUrl", event.external_registration_url || "");
  setValue("externalTitle", event.title || "");
  
  const externalEventType = String(event.event_type || "").toLowerCase() === "external event"
    ? ""
	: event.event_type || "";
	
  setValue("externalEventType", externalEventType);
  setValue("externalVenue", event.venue || "");
  setValue("externalEventDate", eventDateToDatetimeLocal(event.event_date));
  setValue("externalRacepackLocation", event.racepack_location || "");
  setValue("externalRacepackDate", event.racepack_date || "");
  setRacepackTimeRange(
    "externalRacepackTimeFrom",
    "externalRacepackTimeTo",
    event.racepack_time || ""
  );

  setValue(
    "externalCategories",
    (categories || [])
      .map(cat => cat.name)
      .filter(Boolean)
      .join(", ")
      .toUpperCase()
  );

  setValue("externalOrganizerName", event.organizer_name || "");
  setValue("externalShortDescription", event.short_description || "");
  setValue("externalLongDescription", event.long_description || "");
  setValue("externalEventImage", event.event_image || "");

  setTimeout(() => {
    external?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }, 50);
}

async function saveExternalEvent() {
  const id = getValue("externalEditingId");

  const slug = getValue("externalSlug").toLowerCase();
  const title = getValue("externalTitle");
  const externalUrl = normalizeUrl(getValue("externalRegistrationUrl"));
  
  setValue("externalSlug", slug);
  const categoriesText = getValue("externalCategories").toUpperCase();
  const externalEventType = getValue("externalEventType");

  if (!title || !externalUrl) {
  setMessage("Title and external registration URL are required.");
  return;
}

if (!slug) {
  setMessage("Unable to generate event URL from title.");
  return;
}

  const payload = {
    registration_mode: "external",
    external_registration_url: externalUrl,

    slug,
    title,
    event_type: externalEventType,
    short_description: getValue("externalShortDescription"),
	long_description: getValue("externalLongDescription"),
    venue: getValue("externalVenue"),
    event_date: getValue("externalEventDate"),
	racepack_location: getValue("externalRacepackLocation").toUpperCase(),
	racepack_date: getValue("externalRacepackDate"),
	racepack_time: buildRacepackTime("externalRacepackTimeFrom", "externalRacepackTimeTo"),

    status_mode: "force_open",
    open_at: "",
    close_at: "",
    total_limit: 0,
    is_visible: 1,

    event_image: getValue("externalEventImage"),
    postage_enabled: 0,
    postage_fee: 0,
    postage_max_participants: 0,
    admin_fee_enabled: 0,
    admin_fee_amount: 3.5,
    admin_fee_percent: 8,
	email_provider: "enginemailer",

    organizer_name: getValue("externalOrganizerName"),
	organizer_url: "",

    categories: categoriesText
      ? [
          {
            id: getValue("externalCategoryId"),
            name: categoriesText,
            price: 0,
            slot_limit: 0,
            is_active: 1
          }
        ]
      : []
  };

  const url = id ? `/api/admin/event?id=${encodeURIComponent(id)}` : "/api/admin/events";
  const method = id ? "PATCH" : "POST";

  try {
    const res = await fetch(url, {
      method,
      headers: adminHeaders(),
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data || !data.success) {
      setMessage(data?.error || "Save external event failed.");
      return;
    }

    setMessage(id ? "External event updated." : "External event added.");
    resetExternalEventForm();
    hideEventForms();
    loadEvents();
  } catch (err) {
    setMessage(err.message || "Save external event failed.");
  }
}

/* =========================
   EDIT EVENT
========================= */

async function editEvent(id) {
  try {
    const res = await fetch(`/api/admin/event?id=${encodeURIComponent(id)}`, {
      headers: adminHeaders()
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data || !data.success) {
      setMessage(data?.error || "Failed to load event.");
      return;
    }

    const event = data.event;
    const categories = data.categories || [];
    const mode = String(event.registration_mode || "internal").toLowerCase();
	const teeOptions = Array.isArray(data.tee_options) ? data.tee_options : [];

    if (mode === "external") {
      populateExternalEventForm(event, categories);
      return;
    }

    hideEventForms();

    const full = document.getElementById("fullEventForm");
    if (full) full.hidden = false;

    const formTitle = document.getElementById("formTitle");
    if (formTitle) formTitle.textContent = "Edit Event";

    setValue("editingId", event.id);
    setValue("slug", event.slug || "");
    setValue("title", event.title || "");
    setValue("eventType", event.event_type || "");
	const savedPaymentGateway = normalizePaymentGateway(
      event.payment_gateway || gatewayFromLegacyPaymentMode(event.payment_mode)
    );

    setValue("paymentGateway", savedPaymentGateway);
    setValue(
      "paymentEnvironment",
      normalizePaymentEnvironment(event.payment_environment || event.approval_status)
    );
	
	setValue(
	  "registrationAccessMode",
	  normalizeRegistrationAccessMode(event.registration_access_mode)
	);

    savedEmailProvider = normalizeEmailProvider(event.email_provider);
    setValue("emailProvider", savedEmailProvider);
	syncEmailProviderAccess();

    syncPaymentGatewayAccess();
      setValue("venue", event.venue || "");
      setValue("organizerName", event.organizer_name || "");
      setValue("organizerUrl", event.organizer_url || "");
	  setValue("bankAccountName", event.bank_account_name || "");
	  setValue("bankAccountNumber", event.bank_account_number || "");
      setValue("eventDate", eventDateToDatetimeLocal(event.event_date));
	  renderRacepackCollections(
	    Array.isArray(data.racepack_collections) && data.racepack_collections.length
	    ? data.racepack_collections
		: [
            {
			 location: event.racepack_location || "",
			 collection_date: event.racepack_date || "",
			 collection_time: event.racepack_time || ""
			}
		  ]
	);;
    setValue("statusMode", event.status_mode || "force_closed");
    setValue("openAt", fromIsoToDatetimeLocal(event.open_at));
    setValue("closeAt", fromIsoToDatetimeLocal(event.close_at));
    setValue("totalLimit", event.total_limit || 0);
    setValue("isVisible", String(event.is_visible ?? 1));
    setValue("sortOrder", event.sort_order || 0);
    setValue("shortDescription", event.short_description || "");
	setValue("longDescription", event.long_description || "");
    setValue("postageEnabled", String(event.postage_enabled ?? 0));
    setValue("postageFee", event.postage_fee || "");
    setValue("postageMaxParticipants", String(event.postage_max_participants ?? 0));
    setValue("adminFeeEnabled", String(event.admin_fee_enabled ?? 0));
    setValue("adminFeeAmount", Number(event.admin_fee_amount ?? 4).toFixed(2));
    setValue("adminFeePercent", formatAdminFeePercent(event.admin_fee_percent ?? 8));

    savedAdminFeeEnabled = Number(event.admin_fee_enabled || 0);
    savedAdminFeeAmount = Number(event.admin_fee_amount ?? 4);
    savedAdminFeePercent = Number(event.admin_fee_percent ?? 8);

    syncAdminFeeAccess();
    updateAdminFeeHint();

    setValue("eventTeeEnabled", String(event.event_tee_enabled ?? 1));
    setValue("finisherTeeEnabled", String(event.finisher_tee_enabled ?? 0));
	setValue("medicalConditionEnabled", String(event.medical_condition_enabled ?? 0));

    savedEventImage = event.event_image || "";
	
	setValue("eventImage", savedEventImage);
	updateEventImagePreview(savedEventImage);
	setImageStatus(savedEventImage ? "Current image loaded." : "");
	
	infoPosterImages = normalizeInfoImages(event.info_images);
	savedInfoPosterImages = [...infoPosterImages];
	renderInfoPosters();

    const fileInput = document.getElementById("eventImageFile");
    if (fileInput) fileInput.value = "";

    renderCategories(categories);
	
	const eventTeeOptions = teeOptions.filter(item => String(item.tee_type || "") === "event_tee");
	const finisherTeeOptions = teeOptions.filter(item => String(item.tee_type || "") === "finisher_tee");
	
	resetTeeEditor(
    	"eventTeeEditor",
		"event_tee",
    	eventTeeOptions.length ? eventTeeOptions : getDefaultTeeOptions()
	);

resetTeeEditor(
  "finisherTeeEditor",
  "finisher_tee",
  finisherTeeOptions.length ? finisherTeeOptions : getDefaultTeeOptions()
);
	
	await loadPromoCodes(event.id);
	await loadAccessCodes(event.id);
	updateAllAdminSettingsSummaries();

    setTimeout(() => {
      full?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }, 50);

  } catch (err) {
    setMessage(err.message || "Failed to load event.");
  }
}

/* =========================
   DELETE EVENT
========================= */

function deleteEvent(id) {
  pendingDeleteEventId = Number(id || 0);

  const modal = document.getElementById("deleteEventModal");
  const idText = document.getElementById("deleteEventIdText");
  const input = document.getElementById("deleteEventConfirmInput");
  const error = document.getElementById("deleteEventError");

  if (!modal || !idText || !input) return;

  idText.textContent = pendingDeleteEventId;
  input.value = "";

  if (error) error.textContent = "";

  modal.classList.add("show");

  setTimeout(() => {
    input.focus();
  }, 50);
}

function closeDeleteEventModal() {
  pendingDeleteEventId = null;

  const modal = document.getElementById("deleteEventModal");
  const input = document.getElementById("deleteEventConfirmInput");
  const error = document.getElementById("deleteEventError");

  if (modal) modal.classList.remove("show");
  if (input) input.value = "";
  if (error) error.textContent = "";
}

async function confirmDeleteEvent() {
  const id = Number(pendingDeleteEventId || 0);
  const input = document.getElementById("deleteEventConfirmInput");
  const error = document.getElementById("deleteEventError");

  const typed = String(input?.value || "").trim();

  if (!id) {
    if (error) error.textContent = "Invalid event ID.";
    return;
  }

  if (typed !== String(id)) {
    if (error) error.textContent = `Type Event ID ${id} to confirm delete.`;
    return;
  }

  try {
    const res = await fetch(`/api/admin/event?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: adminHeaders()
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data || !data.success) {
      if (error) error.textContent = data?.error || "Delete failed.";
      return;
    }

    const editingId = getValue("editingId");
    const externalEditingId = getValue("externalEditingId");

    if (String(editingId) === String(id)) {
      resetForm();
      hideEventForms();
    }

    if (String(externalEditingId) === String(id)) {
      resetExternalEventForm();
      hideEventForms();
    }

    closeDeleteEventModal();
    setMessage("Event deleted.");
    loadEvents();

  } catch (err) {
    if (error) error.textContent = err.message || "Delete failed.";
  }
}

/* =========================
   EVENT LIST
========================= */



function sortAdminEventsForList(events) {
  return [...(Array.isArray(events) ? events : [])].sort((a, b) => {
    const orderA = Number(a.sort_order ?? 0);
    const orderB = Number(b.sort_order ?? 0);

    if (orderA !== orderB) {
      return orderA - orderB;
    }

    return Number(b.id || 0) - Number(a.id || 0);
  });
}

async function loadEvents() {
  const box = document.getElementById("eventList");
  if (!box) return;

  try {
    const res = await fetch(`/api/admin/events?t=${Date.now()}`, {
  headers: adminHeaders(),
  cache: "no-store"
});

    const data = await res.json().catch(() => null);

    if (!res.ok || !data || !data.success) {
      box.innerHTML = `<div class="muted">${escapeHtml(data?.error || "Unable to load events.")}</div>`;
      return;
    }

    const events = sortAdminEventsForList(data.events || []);

    if (!events.length) {
      box.innerHTML = `<div class="muted">No events yet.</div>`;
      return;
    }

    box.innerHTML = events.map((event, index) => {
      const title = escapeHtml(event.title);
      const slug = escapeHtml(event.slug);
      const date = escapeHtml(formatEventListDate(event.event_date));
      const mode = String(event.registration_mode || "internal").toLowerCase();
      const modeText = mode === "external" ? "External" : "Runxera";
	  const paymentModeText = getEventListPaymentLabel(event);
      const usedSlots = escapeHtml(event.used_slots || 0);
      const totalLimit = escapeHtml(Number(event.total_limit || 0) > 0 ? event.total_limit : "Available");
      const status = escapeHtml(event.status);
      const imageText = event.event_image ? "Yes" : "No";
	  const standardEventUrl = buildStandardEventUrl(event.slug);
	  
	  const eventBannerHtml = event.event_image
	    ? `
          <div class="event-list-banner">
            <img
              src="${escapeHtml(event.event_image)}"
              alt="${title}"
              loading="lazy"
            >
          </div>
        `
        : `
          <div class="event-list-banner event-list-banner-empty">
            No Image
          </div>
        `;

      const postageMaxParticipants = toAdminPositiveInt(event.postage_max_participants, 0);

      const postageText = Number(event.postage_enabled || 0) === 1
        ? postageMaxParticipants > 0
          ? `On - RM${Number(event.postage_fee || 0).toFixed(2)} / every ${postageMaxParticipants} participant(s)`
          : `On - RM${Number(event.postage_fee || 0).toFixed(2)} / unlimited participant(s)`
        : "Off";
		
	  const adminFeeText = renderAdminFeeText(event);
	  const medicalConditionText = Number(event.medical_condition_enabled || 0) === 1
	    ? "On"
		: "Off";

      return `
        <div class="event-row" data-event-id="${Number(event.id)}">
          ${eventBannerHtml}

          <div class="event-row-top">
            <div class="event-row-info">
              <h3>${title}</h3>

              <div class="muted">Payment: <strong>${paymentModeText}</strong></div>
              <div class="muted">Date: <strong>${date}</strong></div>
              <div class="muted">Registered: <strong>${usedSlots} / ${totalLimit}</strong></div>
              ${renderApprovalText(event)}
              <div class="muted">Image: <strong>${imageText}</strong></div>
              <div class="muted">Postage: <strong>${postageText}</strong></div>
            </div>

            <div class="event-row-badges">
              ${renderEventOrderButtons(event, index, events.length)}
              <span class="status-pill">${status}</span>
              <span class="status-pill">Event ID: ${Number(event.id)}</span>
            </div>
          </div>

          <div class="button-row event-main-actions">
            <button type="button" onclick="editEvent(${Number(event.id)})">Edit</button>

            <a href="${PUBLIC_SITE_URL}/${encodeURIComponent(event.slug)}" target="_blank">
			  <button class="secondary" type="button">View</button>
			</a>
			
			<button
			  class="secondary event-share-btn"
			  type="button"
			  data-share-event-url="1"
			  data-event-id="${Number(event.id)}"
			  data-event-title="${title}"
			  data-event-slug="${slug}"
			>
			  Share
			</button>

            ${renderApprovalButton(event)}

            ${renderDeleteButton(event)}
          </div>
        </div>
      `;
    }).join("");

  } catch (err) {
    box.innerHTML = `<div class="muted">${escapeHtml(err.message || "Unable to load events.")}</div>`;
  }
}

function animateEventRowMove(row, targetRow, moveDom) {
  if (!row || !targetRow || typeof moveDom !== "function") return Promise.resolve();

  const firstRowRect = row.getBoundingClientRect();
  const firstTargetRect = targetRow.getBoundingClientRect();

  moveDom();

  const lastRowRect = row.getBoundingClientRect();
  const lastTargetRect = targetRow.getBoundingClientRect();

  const rowDeltaY = firstRowRect.top - lastRowRect.top;
  const targetDeltaY = firstTargetRect.top - lastTargetRect.top;

  row.style.transform = `translateY(${rowDeltaY}px)`;
  targetRow.style.transform = `translateY(${targetDeltaY}px)`;

  row.style.transition = "transform 0s";
  targetRow.style.transition = "transform 0s";

  row.classList.add("event-row-moving");
  targetRow.classList.add("event-row-moving");

  return new Promise(resolve => {
    requestAnimationFrame(() => {
      row.style.transition = "";
      targetRow.style.transition = "";

      row.style.transform = "";
      targetRow.style.transform = "";

      row.classList.add("event-row-moved");
      targetRow.classList.add("event-row-moved");

      setTimeout(() => {
        row.classList.remove("event-row-moving", "event-row-moved");
        targetRow.classList.remove("event-row-moving", "event-row-moved");

        row.style.transform = "";
        targetRow.style.transform = "";
        row.style.transition = "";
        targetRow.style.transition = "";

        resolve();
      }, 260);
    });
  });
}

async function animateEventMoveBeforeSave(eventId, direction) {
  const list = document.getElementById("eventList");
  if (!list) return;

  const row = list.querySelector(`.event-row[data-event-id="${Number(eventId)}"]`);
  if (!row) return;

  if (direction === "up") {
    const targetRow = row.previousElementSibling;
    if (!targetRow) return;

    await animateEventRowMove(row, targetRow, () => {
      list.insertBefore(row, targetRow);
    });
  }

  if (direction === "down") {
    const targetRow = row.nextElementSibling;
    if (!targetRow) return;

    await animateEventRowMove(row, targetRow, () => {
      list.insertBefore(targetRow, row);
    });
  }
}

async function moveEventOrder(eventId, direction) {
  if (!isMasterAdmin()) return;

  try {
    await animateEventMoveBeforeSave(eventId, direction);

    const res = await fetch("/api/admin/event-order", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        event_id: Number(eventId),
        direction
      })
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data || !data.success) {
      throw new Error(data?.error || "Move event failed.");
    }

    setMessage("Event order updated.");
    await loadEvents();

  } catch (err) {
    setMessage(err.message || "Move event failed.");
    await loadEvents();
  }
}

function lockExternalOnlyUi() {
  if (!isExternalOnlyAdmin()) return;

  document.querySelectorAll("button, a").forEach(el => {
    const onclick = String(el.getAttribute("onclick") || "");
    const text = String(el.textContent || "").toLowerCase();

    if (
      onclick.includes("showFullEventForm") ||
      text === "create event" ||
      text === "add event"
    ) {
      el.style.display = "none";
    }
  });
}

/* =========================
   GLOBAL EVENTS
========================= */

document.addEventListener("click", function (e) {
  if (!e.target) return;

  const shareBtn = e.target.closest("[data-share-event-url]");

  if (shareBtn) {
    e.preventDefault();
    openEventShareModalFromButton(shareBtn);
    return;
  }

  if (e.target.classList.contains("cat-remove-btn")) {
    const row = e.target.closest(".cat-row");
    const rows = document.querySelectorAll(".cat-row");

    if (!row) return;

    if (rows.length <= 1) {
      row.querySelector(".cat-id").value = "";
      row.querySelector(".cat-name").value = "";
      row.querySelector(".cat-price").value = "";
      row.querySelector(".cat-limit").value = "0";
      row.querySelector(".cat-date-from").value = "";
      row.querySelector(".cat-date-to").value = "";
      row.querySelector(".cat-active").value = "1";
      updateCategorySummary();
      return;
    }

    row.remove();
    updateCategorySummary();
  }
  
    if (e.target.classList.contains("tee-remove-btn")) {
    const row = e.target.closest(".tee-row");
    const box = row?.parentElement;
    const rows = box ? box.querySelectorAll(".tee-row") : [];

    if (!row) return;

    if (rows.length <= 1) {
      row.querySelector(".tee-id").value = "";
      row.querySelector(".tee-label").value = "";
      row.querySelector(".tee-price").value = "";
      row.querySelector(".tee-limit").value = "0";
      row.querySelector(".tee-active").value = "1";
      updateTeeSummary(row.dataset.teeType || "event_tee");
      return;
    }

    const teeType = row.dataset.teeType || "event_tee";
    row.remove();
    updateTeeSummary(teeType);
  }
  
  if (e.target.classList.contains("rpc-remove-btn")) {
  const row = e.target.closest(".racepack-collection-row");
  const rows = document.querySelectorAll(".racepack-collection-row");

  if (!row) return;

  if (rows.length <= 1) {
    row.querySelector(".rpc-location").value = "";
    row.querySelector(".rpc-date").value = "";
    row.querySelector(".rpc-time-from").value = "";
    row.querySelector(".rpc-time-to").value = "";
    updateRacepackSummary();
    return;
  }

  row.remove();
  updateRacepackSummary();
 }
});

document.addEventListener("dragstart", function (e) {
  const handle = e.target.closest(".tee-drag-handle");
  if (!handle) return;

  const row = handle.closest(".tee-row");
  if (!row) return;

  draggedTeeRow = row;
  row.classList.add("is-dragging");

  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "tee-row");
  }
});

document.addEventListener("dragover", function (e) {
  if (!draggedTeeRow) return;

  const targetRow = e.target.closest(".tee-row");
  if (!targetRow || targetRow === draggedTeeRow) return;

  if (targetRow.parentElement !== draggedTeeRow.parentElement) return;

  e.preventDefault();
  targetRow.classList.add("is-drag-over");
});

document.addEventListener("dragleave", function (e) {
  const targetRow = e.target.closest(".tee-row");
  if (targetRow) {
    targetRow.classList.remove("is-drag-over");
  }
});

document.addEventListener("drop", function (e) {
  if (!draggedTeeRow) return;

  const targetRow = e.target.closest(".tee-row");
  if (!targetRow) {
    clearTeeDragState();
    return;
  }

  e.preventDefault();
  moveTeeRowBefore(targetRow);
  clearTeeDragState();
});

document.addEventListener("dragend", function () {
  clearTeeDragState();
});

document.addEventListener("input", function (e) {
  if (!e.target) return;

  if (
    e.target.id === "externalCategories" ||
    e.target.id === "racepackLocation" ||
    e.target.id === "externalRacepackLocation" ||
    e.target.classList.contains("cat-name") ||
	e.target.classList.contains("rpc-location")
  ) {
    const start = e.target.selectionStart;
    const end = e.target.selectionEnd;

    e.target.value = String(e.target.value || "").toUpperCase();

    try {
      e.target.setSelectionRange(start, end);
    } catch (err) {}
  }

  if (e.target.closest(".racepack-collection-row")) {
    updateRacepackSummary();
  }

  if (e.target.closest(".cat-row")) {
    updateCategorySummary();
  }

  if (e.target.closest(".tee-row")) {
    updateTeeSummary(e.target.closest(".tee-row").dataset.teeType || "event_tee");
  }
});


document.addEventListener("keydown", function (e) {
  if (e.key !== "Escape") return;

  ["racepack", "category", "eventTee", "finisherTee", "promo"].forEach(key => {
    const modal = document.getElementById(getSettingsModalId(key));
    if (modal && modal.classList.contains("show")) {
      closeAdminSettingsModal(key, key === "promo");
    }
  });
});

/* =========================
   INIT
========================= */
function applyAdminRoleVisibility() {
  const role = String(sessionStorage.getItem("RUNATION_ADMIN_ROLE") || "").toLowerCase();
  const accessMode = String(sessionStorage.getItem("RUNATION_ADMIN_ACCESS_MODE") || "").toLowerCase();

  const isMaster = role === "master" || accessMode === "master";
  const isExternalOnly = accessMode === "external_only";

  document.querySelectorAll("[data-master-only]").forEach(el => {
    el.style.display = isMasterAdmin() ? "" : "none";
  });

  document.querySelectorAll('a[href="admin-tools.html"], a[href="/admin-tools.html"]').forEach(el => {
    el.style.display = isRealMasterAdmin() ? "" : "none";
  });

  document.querySelectorAll("[data-not-external-only]").forEach(el => {
    el.style.display = isExternalOnly ? "none" : "";
  });
}


function normalizeInfoImages(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean).slice(0, 8);
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter(Boolean).slice(0, 8) : [];
    } catch {
      return [];
    }
  }

  return [];
}

function syncInfoPosterInput() {
  const input = document.getElementById("infoImages");
  if (input) {
    input.value = JSON.stringify(infoPosterImages.slice(0, 8));
  }
}

function renderInfoPosters() {
  const list = document.getElementById("infoPosterList");
  const addBtn = document.getElementById("addInfoPosterBtn");

  if (!list) return;

  list.innerHTML = "";

  infoPosterImages.forEach((url, index) => {
    const item = document.createElement("div");
    item.className = "info-poster-item";
	item.dataset.infoPosterIndex = String(index);

    item.innerHTML = `
      <button
        type="button"
        class="secondary btn-small info-poster-drag-handle"
        draggable="true"
        data-info-poster-drag="${index}"
		title="Drag to reorder"
		aria-label="Drag to reorder"
	  >
        ☰
	  </button>

      <img src="${url}" alt="Info poster ${index + 1}">

      <div class="info-poster-actions">
        <button
          type="button"
          class="danger btn-small"
          data-remove-info-poster="${index}"
        >
          Remove
        </button>
      </div>
    `;

    list.appendChild(item);
  });

  if (addBtn) {
    addBtn.disabled = infoPosterImages.length >= 8;
    addBtn.textContent = infoPosterImages.length >= 8 ? "Maximum 8 Posters" : "+ Add Poster";
  }

  syncInfoPosterInput();
}

function moveInfoPoster(fromIndex, toIndex) {
  const from = Number(fromIndex);
  const to = Number(toIndex);

  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= infoPosterImages.length ||
    to >= infoPosterImages.length ||
    from === to
  ) {
    return;
  }

  const [moved] = infoPosterImages.splice(from, 1);
  infoPosterImages.splice(to, 0, moved);

  renderInfoPosters();
}

function clearInfoPosterDragState() {
  document
    .querySelectorAll(".info-poster-item.is-dragging, .info-poster-item.is-drag-over")
    .forEach(item => {
      item.classList.remove("is-dragging", "is-drag-over");
    });

  draggedInfoPosterIndex = null;
}

async function uploadInfoPoster(file) {
  if (!file) return;

  if (file.size > MAX_EVENT_IMAGE_SIZE) {
    setMessage("Image must be below 2MB.", "error");
    return;
  }

  if (!ALLOWED_EVENT_IMAGE_TYPES.includes(file.type)) {
    setMessage("Only JPG, PNG, or WEBP images are allowed.", "error");
    return;
  }

  if (infoPosterImages.length >= 8) {
    setMessage("Maximum 8 info posters only.", "error");
    return;
  }

  syncSlugFromTitle();

  const slug = getValue("slug") || generateSlugFromTitle(getValue("title"));

  if (!slug) {
    setMessage("Fill title first before upload poster.", "error");
    return;
  }

  const formData = new FormData();
  formData.append("image", file);
  formData.append("event", slug);

  try {

    const res = await fetch("/api/admin/upload-image", {
      method: "POST",
      headers: adminAuthHeaders(),
      body: formData
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data || !data.success || !data.url) {
      setMessage(data?.error || "Poster upload failed.", "error");
      return;
    }

    infoPosterImages.push(data.url);
    renderInfoPosters();
  } catch (err) {
    setMessage(err.message || "Poster upload failed.", "error");
  }
}

async function deleteUploadedImageFromR2(url) {
  const cleanUrl = String(url || "").trim();

  if (!cleanUrl) return true;

  try {
    const res = await fetch("/api/admin/upload-image", {
      method: "DELETE",
      headers: adminHeaders(),
      body: JSON.stringify({
        url: cleanUrl
      })
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data || !data.success) {
      setMessage(data?.error || "Image delete failed.", "error");
      return false;
    }

    return true;

  } catch (err) {
    setMessage(err.message || "Image delete failed.", "error");
    return false;
  }
}

document.addEventListener("DOMContentLoaded", function () {
resetForm();
resetExternalEventForm();
hideEventForms();
syncAdminFeeAccess();
setupAdminFeeHint();
syncPaymentGatewayAccess();
setupAdminSettingsModals();

const paymentGatewayInput = document.getElementById("paymentGateway");
if (paymentGatewayInput) {
  paymentGatewayInput.addEventListener("change", syncPaymentGatewayAccess);
}
  
  if (isExternalOnlyAdmin()) {
	  showExternalEventForm();
	  lockExternalOnlyUi();
  }

  const uploadBtn = document.getElementById("uploadEventImageBtn");
  if (uploadBtn) {
    uploadBtn.addEventListener("click", uploadEventImage);
  }
  
  const addPromoBtn = document.getElementById("addPromoCodeBtn");
  if (addPromoBtn) {
    addPromoBtn.addEventListener("click", addPromoCode);
  }
  
  const addAccessBtn = document.getElementById("addAccessCodeBtn");
  if (addAccessBtn) {
    addAccessBtn.addEventListener("click", addAccessCode);
  }

  const addEventTeeOptionBtn = document.getElementById("addEventTeeOptionBtn");
  if (addEventTeeOptionBtn) {
    addEventTeeOptionBtn.addEventListener("click", () => {
      addTeeOptionRow("eventTeeEditor", "event_tee");
    });
  }

  const addFinisherTeeOptionBtn = document.getElementById("addFinisherTeeOptionBtn");
  if (addFinisherTeeOptionBtn) {
    addFinisherTeeOptionBtn.addEventListener("click", () => {
      addTeeOptionRow("finisherTeeEditor", "finisher_tee");
    });
  }

  const removeImageBtn = document.getElementById("removeEventImageBtn");
  if (removeImageBtn) {
    removeImageBtn.addEventListener("click", removeEventImage);
  }
  
  const titleInput = document.getElementById("title");
    if (titleInput) {
      titleInput.addEventListener("input", function () {
        syncSlugFromTitle();
      });
    }

const addRacepackCollectionBtn = document.getElementById("addRacepackCollectionBtn");
if (addRacepackCollectionBtn) {
  addRacepackCollectionBtn.addEventListener("click", () => {
    addRacepackCollectionRow();
  });
}

const addInfoPosterBtn = document.getElementById("addInfoPosterBtn");
const infoPosterInput = document.getElementById("infoPosterInput");
const infoPosterList = document.getElementById("infoPosterList");

if (addInfoPosterBtn && infoPosterInput) {
  addInfoPosterBtn.addEventListener("click", () => {
    infoPosterInput.value = "";
    infoPosterInput.click();
  });

  infoPosterInput.addEventListener("change", async () => {
  try {
    await uploadInfoPoster(infoPosterInput.files[0]);
  } catch (err) {
    setMessage(err.message || "Failed to upload poster.", "error");
  }
});
}

if (infoPosterList) {
  infoPosterList.addEventListener("click", async (event) => {
    const removeBtn = event.target.closest("[data-remove-info-poster]");

    if (removeBtn) {
      const index = Number(removeBtn.dataset.removeInfoPoster);
      const url = infoPosterImages[index];

      if (!url) return;

      const isAlreadySaved = savedInfoPosterImages.includes(url);

      if (!isAlreadySaved) {
        const deleted = await deleteUploadedImageFromR2(url);

        if (!deleted) {
          return;
        }
      }

      infoPosterImages.splice(index, 1);
      renderInfoPosters();
    }
  });

  infoPosterList.addEventListener("dragstart", (event) => {
    const handle = event.target.closest("[data-info-poster-drag]");
    if (!handle) return;

    const item = handle.closest(".info-poster-item");
    if (!item) return;

    draggedInfoPosterIndex = Number(handle.dataset.infoPosterDrag);
    item.classList.add("is-dragging");

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(draggedInfoPosterIndex));
    }
  });

  infoPosterList.addEventListener("dragover", (event) => {
    if (draggedInfoPosterIndex === null) return;

    const targetItem = event.target.closest(".info-poster-item");
    if (!targetItem) return;

    event.preventDefault();

    document
      .querySelectorAll(".info-poster-item.is-drag-over")
      .forEach(item => item.classList.remove("is-drag-over"));

    targetItem.classList.add("is-drag-over");
  });

  infoPosterList.addEventListener("dragleave", (event) => {
    const targetItem = event.target.closest(".info-poster-item");
    if (targetItem) {
      targetItem.classList.remove("is-drag-over");
    }
  });

  infoPosterList.addEventListener("drop", (event) => {
    if (draggedInfoPosterIndex === null) {
      clearInfoPosterDragState();
      return;
    }

    const targetItem = event.target.closest(".info-poster-item");
    if (!targetItem) {
      clearInfoPosterDragState();
      return;
    }

    event.preventDefault();

    const targetIndex = Number(targetItem.dataset.infoPosterIndex);

    moveInfoPoster(draggedInfoPosterIndex, targetIndex);
    clearInfoPosterDragState();
  });

  infoPosterList.addEventListener("dragend", () => {
    clearInfoPosterDragState();
  });
}

const externalTitleInput = document.getElementById("externalTitle");
if (externalTitleInput) {
  externalTitleInput.addEventListener("input", function () {
    syncExternalSlugFromTitle();
  });
}

  const imageInput = document.getElementById("eventImageFile");
  if (imageInput) {
    imageInput.addEventListener("change", function () {
      const file = imageInput.files && imageInput.files[0];

      if (!file) {
        setImageStatus("");
        return;
      }

      if (!ALLOWED_EVENT_IMAGE_TYPES.includes(file.type)) {
        setImageStatus("Only JPG, PNG, or WEBP allowed.", true);
        return;
      }

      if (file.size > MAX_EVENT_IMAGE_SIZE) {
        setImageStatus("Image must be below 2MB.", true);
        return;
      }

      setImageStatus("Image ready to upload.");
    });
  }

  const eventImageInput = document.getElementById("eventImage");
  if (eventImageInput) {
    eventImageInput.addEventListener("input", function () {
      const url = getValue("eventImage");

      updateEventImagePreview(url);

      if (url) {
        setImageStatus("Image URL ready. Click Save Event to apply.");
      } else {
        setImageStatus("");
      }
    });
  }

  if (getAdminToken()) {
    loadEvents();
  }
  
  applyAdminRoleVisibility();
  initLandingCarouselSetting();

  const topbarUsername = document.getElementById("topbarUsername");
  if (topbarUsername) {
    topbarUsername.textContent =
      sessionStorage.getItem("RUNATION_ADMIN_USERNAME") ||
      sessionStorage.getItem("RUNATION_ADMIN_ROLE") ||
      "Admin";
  }
});