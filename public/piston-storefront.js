(() => {
  const PURCHASE_URL = "/pases-especiales#niveles";
  const OPERATOR_PATH = /^\/(?:backoffice-hfc|validar|validar-pase)(?:\.html)?\/?$/;

  function isPurchaseLink(link) {
    if (link.hasAttribute("data-piston-purchase")) return true;
    const label = String(link.textContent || "").trim().replace(/\s+/g, " ");
    if (/mejora(?:r)?\s+(?:(?:mi|tu|la)\s+)?experiencia/i.test(label)) return true;
    const target = new URL(link.getAttribute("href") || "", window.location.href);
    return target.origin === window.location.origin &&
      /^\/pases-especiales(?:\.html)?\/?$/.test(target.pathname) &&
      (!target.hash || target.hash === "#niveles");
  }

  function setPurchaseLink(link) {
    link.setAttribute("href", PURCHASE_URL);
    link.setAttribute("data-piston-purchase", "true");
    link.removeAttribute("target");
  }

  function mount() {
    if (!document.body || OPERATOR_PATH.test(window.location.pathname) ||
      document.body.hasAttribute("data-piston-storefront")) return;
    document.body.setAttribute("data-piston-storefront", "true");
    document.body.classList.add("hfc-piston-storefront");

    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = "/piston-storefront.css";
    document.head.appendChild(stylesheet);
    window.HFC_CONTACT_LINKS = { ...(window.HFC_CONTACT_LINKS || {}), upgradeUrl: PURCHASE_URL };

    document.querySelectorAll("a[href]").forEach((link) => {
      if (isPurchaseLink(link)) setPurchaseLink(link);
    });

    const nav = document.querySelector(".main-nav");
    if (nav) {
      let link = nav.querySelector("[data-piston-purchase]");
      if (!link) {
        link = document.createElement("a");
        nav.appendChild(link);
      }
      setPurchaseLink(link);
      link.textContent = "Pistones";
      link.classList.add("hfc-piston-nav");
    }

    let actions = document.querySelector("[data-floating-actions]");
    if (!actions) {
      actions = document.createElement("div");
      actions.className = "floating-actions";
      actions.setAttribute("data-floating-actions", "true");
      document.body.appendChild(actions);
    }
    actions.classList.add("hfc-piston-actions");
    actions.setAttribute("aria-label", "Compra de Pistones y ayuda");
    const buy = document.createElement("a");
    buy.className = "floating-action hfc-piston-float";
    buy.innerHTML = '<span class="hfc-piston-symbol" aria-hidden="true"><img src="/assets/pistons/pistons-watermark.webp" alt="" width="28" height="28" /></span><strong>Comprar Pistones</strong>';
    setPurchaseLink(buy);
    actions.insertBefore(buy, actions.firstChild);

    const main = document.querySelector("main");
    const isStore = /^\/pases-especiales(?:\.html)?\/?$/.test(window.location.pathname);
    if (main && !isStore && !document.querySelector(".home-special-pass-promo")) {
      const strip = document.createElement("section");
      strip.className = "hfc-piston-strip";
      strip.setAttribute("aria-label", "Mejora tu experiencia con Pistones");
      strip.innerHTML = `<div class="hfc-piston-strip-inner"><img src="/assets/pistons/pistons-watermark.webp" alt="" width="76" height="76" loading="lazy" /><div><p>Upgrade de experiencia</p><h2>Mejora tu experiencia con Pistones.</h2><span>Pases de 1, 3, 5, 7 o 9 Pistones. Beneficios exclusivos y participaci\u00f3n en los sorteos seg\u00fan las bases.</span><small>El Pase no reemplaza tu entrada.</small></div><a class="button primary" href="${PURCHASE_URL}" data-piston-purchase>Comprar Pistones</a></div>`;
      const hero = main.querySelector(".ticketera-editorial-hero, .page-hero, .racing-hero");
      if (hero) hero.insertAdjacentElement("afterend", strip);
      else main.insertBefore(strip, main.firstChild);
    }

    const footer = document.querySelector(".site-footer");
    if (footer && !footer.querySelector("[data-piston-purchase]")) {
      const link = document.createElement("a");
      setPurchaseLink(link);
      link.textContent = "Comprar Pistones";
      link.className = "hfc-piston-footer-link";
      footer.appendChild(link);
    }

    // El carrito agrega sus llamados despues de cargar el catalogo.
    document.addEventListener("click", (event) => {
      const link = event.target.closest?.("a[href]");
      if (link && isPurchaseLink(link)) setPurchaseLink(link);
    }, true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})();
