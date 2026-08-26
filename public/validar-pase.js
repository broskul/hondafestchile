(() => {
  const params = new URLSearchParams(window.location.search);
  let currentCode = String(params.get("code") || "").trim();
  let stream = null;
  let scanning = false;

  const escapeHtml = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

  function operatorHeaders() {
    const token = String(HFC.$("#passAdminToken")?.value || "").trim();
    return token ? { "x-admin-token": token } : {};
  }

  function statusLabel(value) {
    return {
      valid: "Vigente",
      picked_up: "Retirado",
      pending: "Pendiente de retiro",
      checked_in: "Acceso registrado",
      not_checked_in: "Sin acceso registrado"
    }[value] || value || "Sin estado";
  }

  function render(data) {
    const pass = data.pass;
    const node = HFC.$("#passValidationResult");
    const canOperate = Boolean(data.canOperate || String(HFC.$("#passAdminToken")?.value || "").trim());
    node.className = "pass-validation-card";
    node.innerHTML = `
      <div class="pass-validation-status"><span class="status-pill ${pass.status === "valid" ? "success" : "error"}">${escapeHtml(statusLabel(pass.status))}</span><strong>${escapeHtml(pass.pistonCount)} ${pass.pistonCount === 1 ? "Pistón" : "Pistones"}</strong></div>
      <h2>${escapeHtml(pass.levelName || pass.passName)}</h2>
      <code>${escapeHtml(pass.code)}</code>
      <dl>
        <div><dt>Titular</dt><dd>${escapeHtml(pass.holderName || "Pendiente")}</dd></div>
        <div><dt>Retiro</dt><dd>${escapeHtml(statusLabel(pass.pickupStatus))}</dd></div>
        <div><dt>Acceso</dt><dd>${escapeHtml(statusLabel(pass.accessStatus))}</dd></div>
        <div><dt>Formato</dt><dd>${escapeHtml(pass.physicalFormat)}</dd></div>
      </dl>
      <div class="not-entry-inline">${escapeHtml(pass.notEntryLabel || "NO ES VÁLIDO COMO ENTRADA")}</div>
      ${canOperate ? `
        <div class="pass-operator-actions">
          <button class="button secondary" type="button" data-pass-action="pickup" ${pass.pickupStatus === "picked_up" ? "disabled" : ""}>Registrar retiro</button>
          <button class="button primary" type="button" data-pass-action="checkin" ${pass.pickupStatus !== "picked_up" || pass.accessStatus === "checked_in" ? "disabled" : ""}>Registrar acceso</button>
          <button class="button ghost-light" type="button" data-pass-action="pickup_and_checkin" ${pass.accessStatus === "checked_in" ? "disabled" : ""}>Retiro + acceso</button>
        </div>` : '<p class="form-note">Consulta informativa. Ingresa la clave del equipo HFC para registrar acciones.</p>'}
    `;
    HFC.$$('[data-pass-action]', node).forEach((button) => button.addEventListener("click", () => operate(button.dataset.passAction)));
  }

  async function lookup(code = currentCode) {
    currentCode = String(code || "").trim().toUpperCase();
    if (!currentCode) return;
    const node = HFC.$("#passValidationResult");
    node.className = "empty-state";
    node.textContent = "Consultando Pase...";
    try {
      const data = await HFC.api("/api/special-passes/validate", {
        method: "POST",
        headers: operatorHeaders(),
        body: JSON.stringify({ code: currentCode, action: "lookup" })
      });
      render(data);
    } catch (error) {
      node.className = "empty-state error";
      node.textContent = error.message;
    }
  }

  async function operate(action) {
    const node = HFC.$("#passValidationResult");
    try {
      const data = await HFC.api("/api/special-passes/validate", {
        method: "POST",
        headers: operatorHeaders(),
        body: JSON.stringify({ code: currentCode, action })
      });
      render(data);
      HFC.toast(data.changed ? "Estado del Pase actualizado." : "El estado ya estaba registrado.");
    } catch (error) {
      node.insertAdjacentHTML("beforeend", `<div class="status-box error">${escapeHtml(error.message)}</div>`);
    }
  }

  function codeFromDetection(rawValue) {
    try {
      const url = new URL(rawValue);
      return url.searchParams.get("code") || rawValue;
    } catch {
      return rawValue;
    }
  }

  async function startScanner() {
    if (!("BarcodeDetector" in window)) {
      HFC.toast("Este navegador no permite escanear QR. Ingresa el código manualmente.");
      return;
    }
    const video = HFC.$("#passQrVideo");
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    video.srcObject = stream;
    await video.play();
    scanning = true;
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    const scan = async () => {
      if (!scanning) return;
      try {
        const results = await detector.detect(video);
        if (results[0]?.rawValue) {
          const code = codeFromDetection(results[0].rawValue);
          HFC.$("#passValidateForm").code.value = code;
          stopScanner();
          await lookup(code);
          return;
        }
      } catch {
        // La siguiente captura vuelve a intentar.
      }
      requestAnimationFrame(scan);
    };
    requestAnimationFrame(scan);
  }

  function stopScanner() {
    scanning = false;
    (stream?.getTracks() || []).forEach((track) => track.stop());
    stream = null;
    HFC.$("#passQrVideo").srcObject = null;
  }

  document.addEventListener("DOMContentLoaded", () => {
    const form = HFC.$("#passValidateForm");
    if (currentCode) form.code.value = currentCode;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      lookup(form.code.value);
    });
    HFC.$("#passOperatorForm").addEventListener("submit", (event) => event.preventDefault());
    HFC.$("#startPassScanner").addEventListener("click", () => startScanner().catch((error) => HFC.toast(error.message)));
    HFC.$("#stopPassScanner").addEventListener("click", stopScanner);
    HFC.$("#passAdminToken").addEventListener("change", () => currentCode && lookup(currentCode));
    if (currentCode) lookup(currentCode);
  });
})();
