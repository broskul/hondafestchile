(() => {
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
    if (!document.body || document.querySelector("[data-help-whatsapp]")) return;
    const link = document.createElement("a");
    link.className = "floating-help";
    link.dataset.helpWhatsapp = "true";
    link.href = "https://wa.me/56972934950?text=Hola%20Honda%20Fest%20Chile%2C%20necesito%20ayuda%20con%20mi%20compra";
    link.target = "_blank";
    link.rel = "noreferrer";
    link.setAttribute("aria-label", "Necesitas ayuda por WhatsApp");
    link.innerHTML = `<span>?</span><strong>Necesitas ayuda?</strong>`;
    document.body.appendChild(link);
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
