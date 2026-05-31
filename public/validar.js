let stream = null;
let scanTimer = null;
let barcodeDetector = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return entities[char];
  });
}

async function validateTicket(code, action = "lookup") {
  const result = HFC.$("#validationResult");
  HFC.setStatus(result, "Consultando ticket...");

  try {
    const data = await HFC.api("/api/tickets/validate", {
      method: "POST",
      body: JSON.stringify({ code, action })
    });

    const checked = data.ticket.status === "checked_in";
    const pilotRows =
      data.ticket.entryType === "pilot"
        ? `
        <dt>Patente</dt><dd>${escapeHtml(data.ticket.holderLicensePlate || "")}</dd>
        <dt>Auto</dt><dd>${escapeHtml(data.ticket.holderVehicle || "")}</dd>
        <dt>Club</dt><dd>${escapeHtml(data.ticket.holderClub || "")}</dd>
      `
        : "";
    HFC.setStatus(
      result,
      `<div class="validation-state ${checked ? "checked" : "valid"}">
        <strong>${checked ? "Entrada ya validada" : "Entrada valida"}</strong>
        <span>${escapeHtml(data.ticket.code)}</span>
      </div>
      <dl class="detail-list">
        <dt>Asistente</dt><dd>${escapeHtml(data.ticket.holderName)}</dd>
        <dt>RUT</dt><dd>${escapeHtml(data.ticket.holderRut)}</dd>
        <dt>Evento</dt><dd>${escapeHtml(data.ticket.eventName || "")}</dd>
        <dt>Entrada</dt><dd>${escapeHtml(data.ticket.ticketTypeName || "")}</dd>
        ${pilotRows}
        <dt>Estado</dt><dd>${escapeHtml(data.ticket.status)}</dd>
      </dl>
      ${
        data.ticket.status === "valid"
          ? `<button class="button primary full" type="button" id="checkinButton">Marcar ingreso</button>`
          : ""
      }`
    );

    HFC.$("#checkinButton")?.addEventListener("click", () => validateTicket(code, "checkin"));
  } catch (error) {
    HFC.setStatus(result, error.message, true);
  }
}

async function startScanner() {
  if (!("BarcodeDetector" in window)) {
    HFC.toast("Este navegador no soporta escaneo QR nativo. Usa ingreso manual.");
    return;
  }

  barcodeDetector = new BarcodeDetector({ formats: ["qr_code"] });
  stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  const video = HFC.$("#qrVideo");
  video.srcObject = stream;
  await video.play();

  scanTimer = setInterval(async () => {
    const codes = await barcodeDetector.detect(video).catch(() => []);
    if (!codes.length) return;

    const raw = codes[0].rawValue || "";
    const url = new URL(raw, window.location.origin);
    const code = url.searchParams.get("code") || raw;
    HFC.$("#validateForm").code.value = code;
    stopScanner();
    validateTicket(code);
  }, 700);
}

function stopScanner() {
  clearInterval(scanTimer);
  scanTimer = null;
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  HFC.$("#qrVideo").srcObject = null;
}

document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (code) {
    HFC.$("#validateForm").code.value = code;
    validateTicket(code);
  }

  HFC.$("#validateForm").addEventListener("submit", (event) => {
    event.preventDefault();
    validateTicket(event.currentTarget.code.value);
  });

  HFC.$("#startScanner").addEventListener("click", () => {
    startScanner().catch((error) => HFC.toast(error.message));
  });
  HFC.$("#stopScanner").addEventListener("click", stopScanner);
});
