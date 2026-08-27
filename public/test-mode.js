(() => {
  const SUPPORT_WHATSAPP_URL =
    "https://wa.me/56972934950?text=Hola%20Honda%20Fest%20Chile%2C%20necesito%20ayuda%20con%20mi%20compra%20o%20entrada";
  const EVENT_WHATSAPP_URL = `https://wa.me/56975766596?text=${encodeURIComponent(
    "Hola Pablo, tengo una pregunta sobre el evento Honda Fest Chile."
  )}`;

  window.HFC_CONTACT_LINKS = {
    ...(window.HFC_CONTACT_LINKS || {}),
    supportUrl: SUPPORT_WHATSAPP_URL,
    eventUrl: EVENT_WHATSAPP_URL,
    participationUrl: EVENT_WHATSAPP_URL
  };

  async function loadCatalog() {
    if (window.__hfcCatalog) return window.__hfcCatalog;
    const response = await fetch("/api/catalog", { cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json();
    window.__hfcCatalog = Promise.resolve(data);
    return data;
  }

  function updateHeaderOffset(banner) {
    document.documentElement.style.setProperty("--test-banner-offset", `${banner.offsetHeight || 0}px`);
  }

  function showBanner(message) {
    if (!document.body || document.querySelector("[data-test-mode-banner]")) return;
    const banner = document.createElement("div");
    banner.className = "test-mode-banner";
    banner.dataset.testModeBanner = "true";
    banner.setAttribute("role", "status");
    banner.innerHTML = `<strong>Modo prueba</strong><span>${message}</span>`;
    document.body.insertBefore(banner, document.body.firstChild);
    updateHeaderOffset(banner);

    if (window.ResizeObserver) {
      new ResizeObserver(() => updateHeaderOffset(banner)).observe(banner);
    } else {
      window.addEventListener("resize", () => updateHeaderOffset(banner));
    }
  }

  function mountHelpButton() {
    if (!document.body || document.querySelector("[data-floating-actions]")) return;
    const actions = document.createElement("div");
    actions.className = "floating-actions";
    actions.dataset.floatingActions = "true";
    actions.setAttribute("aria-label", "Accesos rapidos por WhatsApp");
    actions.innerHTML = `
      <a class="floating-action floating-action--participate" data-event-whatsapp="true"
        href="${EVENT_WHATSAPP_URL}" target="_blank" rel="noreferrer"
        aria-label="Preguntas del evento por WhatsApp con Pablo">
        <span aria-hidden="true">+</span>
        <span class="floating-action-copy">
          <strong>Preguntas evento</strong>
          <small>Horario, ubicacion, participacion</small>
        </span>
      </a>
      <a class="floating-action floating-action--help" data-help-whatsapp="true"
        href="${SUPPORT_WHATSAPP_URL}" target="_blank" rel="noreferrer"
        aria-label="Ayuda con compra o entradas por WhatsApp">
        <span aria-hidden="true">?</span>
        <strong>Ayuda compra</strong>
      </a>
    `;
    document.body.appendChild(actions);
  }

  document.addEventListener("DOMContentLoaded", async () => {
    mountHelpButton();
    try {
      const catalog = await loadCatalog();
      if (!catalog?.integrations?.testMode) return;
      showBanner(
        catalog.integrations.testModeMessage ||
          "Sitio en modo prueba: no estas comprando entradas reales. Usa solo tarjetas de prueba."
      );
    } catch {
      // Si la API no responde, no bloqueamos la navegacion publica.
    }
  });
})();
