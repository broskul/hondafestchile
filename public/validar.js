let stream = null;
let scanTimer = null;
let barcodeDetector = null;

async function validateTicket(code, action = "lookup") {
  const result = HFC.$("#validationResult");
  HFC.setStatus(result, "Consultando ticket...");

  try {
    const data = await HFC.api("/api/tickets/validate", {
      method: "POST",
      body: JSON.stringify({ code, action })
    });

    const checked = data.ticket.status === "checked_in";
    HFC.setStatus(
      result,
      `<div class="validation-state ${checked ? "checked" : "valid"}">
        <strong>${checked ? "Entrada ya validada" : "Entrada valida"}</strong>
        <span>${data.ticket.code}</span>
      </div>
      <dl class="detail-list">
        <dt>Asistente</dt><dd>${data.ticket.holderName}</dd>
        <dt>RUT</dt><dd>${data.ticket.holderRut}</dd>
        <dt>Evento</dt><dd>${data.ticket.eventName || ""}</dd>
        <dt>Entrada</dt><dd>${data.ticket.ticketTypeName || ""}</dd>
        <dt>Estado</dt><dd>${data.ticket.status}</dd>
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
