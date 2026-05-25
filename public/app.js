const state = {
  events: [],
  ticketTypes: [],
  selectedOrderId: null,
  gallery: {
    items: [],
    categories: [],
    activeCategory: "all",
    activeIndex: 0,
    query: ""
  }
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const ALL_GALLERY_CATEGORY = "all";
let galleryRevealObserver = null;

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

function mediaPath(key) {
  return `/media/${String(key || "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function registerGalleryReveal(root = document) {
  const elements = Array.from(root.querySelectorAll(".gallery-reveal:not(.is-visible)"));
  if (!elements.length) return;

  if (!galleryRevealObserver) {
    elements.forEach((element) => element.classList.add("is-visible"));
    return;
  }

  elements.forEach((element) => galleryRevealObserver.observe(element));
}

function initGalleryTransitions() {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion || !("IntersectionObserver" in window)) {
    registerGalleryReveal();
    return;
  }

  galleryRevealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        galleryRevealObserver.unobserve(entry.target);
      });
    },
    {
      rootMargin: "0px 0px -12% 0px",
      threshold: 0.12
    }
  );

  registerGalleryReveal();
}

function formatCurrency(value) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0
  }).format(value || 0);
}

function ticketAvailability(ticket, eventId) {
  return (
    ticket?.availabilityByEvent?.[eventId] || {
      price: ticket?.price || 0,
      maxQuantity: ticket?.maxQuantity || 1,
      salePhaseName: ticket?.salePhaseName || "No disponible",
      available: Boolean(ticket?.available)
    }
  );
}

function setStatus(element, html, isError = false) {
  element.hidden = false;
  element.classList.toggle("error", isError);
  element.innerHTML = html;
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.hidden = false;
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => {
    node.hidden = true;
  }, 5200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.message || "No se pudo completar la accion");
  }
  return data;
}

function renderEvents() {
  const grid = $("#eventGrid");
  if (!grid) return;
  grid.innerHTML = state.events
    .map(
      (event) => `
        <article class="event-card" data-accent="${event.accent}">
          <div>
            <p class="section-kicker">${event.eyebrow}</p>
            <h3>${event.name}</h3>
            <div class="event-meta">
              <span>${event.dateLabel}</span>
              <span>${event.venue}</span>
            </div>
            <p>${event.summary}</p>
          </div>
          <ul class="highlight-list">
            ${event.highlights.map((item) => `<li>${item}</li>`).join("")}
          </ul>
        </article>
      `
    )
    .join("");
}

function populateSelects() {
  const eventSelect = $("#eventSelect");
  const ticketSelect = $("#ticketSelect");
  if (!eventSelect || !ticketSelect) return;

  const selectedEventId = eventSelect.value || state.events[0]?.id;
  eventSelect.innerHTML = state.events.map((event) => `<option value="${event.id}">${event.name}</option>`).join("");
  eventSelect.value = selectedEventId;
  const eventId = eventSelect.value || state.events[0]?.id;
  ticketSelect.innerHTML = state.ticketTypes
    .filter((ticket) => !Array.isArray(ticket.eventIds) || !ticket.eventIds.length || ticket.eventIds.includes(eventId))
    .map(
      (ticket) => {
        const availability = ticketAvailability(ticket, eventId);
        return `<option value="${ticket.id}" ${availability.available ? "" : "disabled"}>${ticket.name} - ${formatCurrency(availability.price)} (${availability.available ? availability.salePhaseName : "no disponible"})</option>`;
      }
    )
    .join("");

  updateTotal();
}

function updateTotal() {
  if (!$("#ticketSelect") || !$("#quantityInput") || !$("#totalOutput")) return;
  const ticket = state.ticketTypes.find((item) => item.id === $("#ticketSelect").value);
  const eventId = $("#eventSelect")?.value || state.events[0]?.id;
  const availability = ticketAvailability(ticket, eventId);
  const quantityInput = $("#quantityInput");
  const quantity = Math.max(1, Number(quantityInput.value || 1));

  if (ticket) {
    quantityInput.max = availability.maxQuantity;
    if (quantity > availability.maxQuantity) {
      quantityInput.value = availability.maxQuantity;
    }
  }

  const safeQuantity = Math.max(1, Number(quantityInput.value || 1));
  $("#totalOutput").textContent = formatCurrency((availability.price || 0) * safeQuantity);
}

function switchTab(tabName) {
  $$(".tab").forEach((button) => {
    const active = button.dataset.tab === tabName;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });

  $("#registerPanel")?.classList.toggle("active", tabName === "register");
  $("#buyPanel")?.classList.toggle("active", tabName === "buy");
}

function formToJson(form) {
  const data = new FormData(form);
  const payload = Object.fromEntries(data.entries());
  payload.interests = data.getAll("interests");
  return payload;
}

function rememberUser(user) {
  localStorage.setItem("hfc_user", JSON.stringify(user));
}

function loadRememberedUser() {
  try {
    return JSON.parse(localStorage.getItem("hfc_user") || "null");
  } catch {
    return null;
  }
}

function prefillOrderForm(user) {
  if (!user) return;
  const form = $("#orderForm");
  if (!form) return;
  form.email.value = user.email || "";
  form.rut.value = user.rut || "";
}

async function handleRegister(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = $("#registerStatus");
  const submit = form.querySelector("button[type='submit']");

  submit.disabled = true;
  setStatus(status, "Creando registro...");

  try {
    const data = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(formToJson(form))
    });

    rememberUser(data.user);
    prefillOrderForm(data.user);

    const devButton = data.devVerificationUrl
      ? `<div class="status-actions"><a class="button secondary" href="${data.devVerificationUrl}">Confirmar correo</a></div>`
      : "";

    setStatus(
      status,
      `<strong>Registro creado.</strong><br />Revisa tu correo para confirmar el enrolamiento.${devButton}`
    );
    toast("Registro creado. Falta confirmar el correo.");
  } catch (error) {
    setStatus(status, error.message, true);
  } finally {
    submit.disabled = false;
  }
}

async function handleOrder(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = $("#orderStatus");
  const submit = form.querySelector("button[type='submit']");

  submit.disabled = true;
  setStatus(status, "Creando orden...");

  try {
    const payload = {
      eventId: form.eventId.value,
      ticketTypeId: form.ticketTypeId.value,
      quantity: Number(form.quantity.value),
      email: form.email.value,
      rut: form.rut.value
    };

    const data = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    state.selectedOrderId = data.order.id;

    if (data.paymentMode === "mercadopago") {
      setStatus(
        status,
        `<strong>Orden creada.</strong><br />Continua en Mercado Pago para finalizar la compra.
        <div class="status-actions"><a class="button primary" href="${data.checkoutUrl}">Pagar con Mercado Pago</a></div>`
      );
      window.location.href = data.checkoutUrl;
      return;
    }

    setStatus(
      status,
      `<strong>Orden creada.</strong><br />Total: ${formatCurrency(data.order.total)}.
      <div class="status-actions">
        <button class="button primary" type="button" id="simulatePaymentButton">Confirmar pago</button>
      </div>`
    );

    $("#simulatePaymentButton").addEventListener("click", simulatePayment);
  } catch (error) {
    setStatus(status, error.message, true);
  } finally {
    submit.disabled = false;
  }
}

async function simulatePayment() {
  const status = $("#orderStatus");
  if (!state.selectedOrderId) return;

  setStatus(status, "Confirmando pago y emitiendo tickets...");

  try {
    const data = await api(`/api/orders/${state.selectedOrderId}/simulate-payment`, {
      method: "POST",
      body: JSON.stringify({})
    });

    setStatus(
      status,
      `<strong>Compra confirmada.</strong><br />
      Tickets emitidos: ${data.tickets.map((ticket) => `<code>${ticket.code}</code>`).join(" ")}<br />
      Boleta: ${data.invoice.folio || data.invoice.providerId}`
    );
    toast("Entradas emitidas y correo enviado.");
  } catch (error) {
    setStatus(status, error.message, true);
  }
}

async function inspectReturnParams() {
  const params = new URLSearchParams(window.location.search);
  const verified = params.get("verified");
  const payment = params.get("payment") || params.get("status") || params.get("collection_status");
  const orderId = params.get("order") || params.get("external_reference");

  if (verified === "1") {
    toast("Correo confirmado. Ya puedes comprar entradas.");
    if ($("#buyPanel")) switchTab("buy");
    const remembered = loadRememberedUser();
    if (remembered) {
      remembered.emailVerified = true;
      rememberUser(remembered);
      prefillOrderForm(remembered);
    }
  }

  if (payment && orderId) {
    if ($("#buyPanel")) switchTab("buy");
    const status = $("#orderStatus");
    if (!status) return;
    setStatus(status, "Consultando estado de la orden...");

    try {
      const data = await api(`/api/orders/${orderId}`);
      const paymentLabel =
        {
          success: "aprobado",
          approved: "aprobado",
          pending: "pendiente",
          in_process: "pendiente",
          failure: "rechazado",
          rejected: "rechazado"
        }[payment] || payment;
      const nextAction =
        data.order.status === "paid"
          ? `<div class="status-actions"><a class="button secondary" href="/mis-compras">Ver mis entradas</a></div>`
          : "";
      if (data.order.status === "paid") {
        localStorage.removeItem("hfc_cart");
      }
      setStatus(
        status,
        `<strong>Estado de pago:</strong> ${paymentLabel}.<br />
        Orden ${data.order.id}: ${data.order.status}.${nextAction}`
      );
    } catch (error) {
      setStatus(status, error.message, true);
    }
  }
}

async function loadGalleryData() {
  const response = await fetch("/gallery-data.json", { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error("No se pudo cargar la galeria de fotos");
  }
  return response.json();
}

function filteredGalleryItems() {
  const query = normalizeSearch(state.gallery.query);
  return state.gallery.items.filter((item) => {
    const matchesCategory =
      state.gallery.activeCategory === ALL_GALLERY_CATEGORY || item.categorySlug === state.gallery.activeCategory;
    if (!matchesCategory) return false;
    if (!query) return true;

    const haystack = normalizeSearch(
      [
        item.title,
        item.description,
        item.keywords,
        item.category,
        item.collection,
        item.capturedAt
      ].join(" ")
    );
    return haystack.includes(query);
  });
}

function galleryCategoryButtons() {
  const categories = [
    {
      name: "Todas",
      slug: ALL_GALLERY_CATEGORY,
      count: state.gallery.items.length
    },
    ...state.gallery.categories
  ];

  return categories
    .map((category) => {
      const active = state.gallery.activeCategory === category.slug;
      return `
        <button
          class="gallery-filter-button gallery-tab-button${active ? " is-active" : ""}"
          type="button"
          data-gallery-category="${escapeHtml(category.slug)}"
          role="tab"
          aria-pressed="${active}"
          aria-selected="${active}"
        >
          <span>${escapeHtml(category.name)}</span>
          <strong>${category.count}</strong>
        </button>
      `;
    })
    .join("");
}

function humanGalleryTitle(item) {
  const candidates = [item.title, item.category, item.collection, item.description, "Foto del evento"];
  for (const candidate of candidates) {
    const title = String(candidate || "")
      .replace(/\s*-\s*IMG[_-]?\d+\b/gi, "")
      .replace(/\bIMG[_-]?\d+\b/gi, "")
      .replace(/\.(jpe?g|png|webp|gif|mp4|mov)\b/gi, "")
      .replace(/^\d+[-_\s]+/g, "")
      .replace(/^Fotografia de\s+/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (title && !/IMG[_-]?\d+/i.test(title)) return title;
  }
  return "Foto del evento";
}

function humanGalleryDescription(item) {
  const fallback = humanGalleryTitle(item);
  const text = String(item.description || fallback)
    .replace(/\s*Coleccion original:.*$/i, "")
    .replace(/,\s*util para galeria deportiva, cobertura del evento y archivo historico de pista\.?/i, ".")
    .replace(/^Fotografia de\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : fallback;
}

function galleryTagList(item, limit = 4) {
  const blocked = new Set(["hfc", "honda fest chile", "honda-fest-2025", "honda-fest-2025-seleccion", "japon-2025"]);
  const tags = String(item.keywords || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag) => !blocked.has(tag.toLowerCase()));
  return [...new Set(tags)].slice(0, limit);
}

function renderGalleryTags(item) {
  const tags = galleryTagList(item);
  if (!tags.length) return "";
  return `<small>${tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join("")}</small>`;
}

function gallerySlide(item, index, total) {
  if (!item) {
    return `
      <div class="gallery-empty">
        <strong>No encontramos fotos para esa busqueda.</strong>
        <span>Prueba con pista, premiacion, paddock, comunidad, acceso o autos.</span>
      </div>
    `;
  }

  const src = mediaPath(item.r2Key);
  const title = humanGalleryTitle(item);
  const description = humanGalleryDescription(item);
  const width = item.width || 2048;
  const height = item.height || 1365;

  return `
    <button class="gallery-nav gallery-nav--prev" type="button" data-gallery-prev aria-label="Foto anterior">
      <span aria-hidden="true">&lsaquo;</span>
    </button>
    <figure class="gallery-slide">
      <a
        class="gallery-image-link gallery-slide__image"
        href="${escapeHtml(src)}"
        data-gallery-title="${escapeHtml(title)}"
        data-gallery-description="${escapeHtml(description)}"
      >
        <img
          src="${escapeHtml(src)}"
          alt="${escapeHtml(description)}"
          title="${escapeHtml(title)}"
          width="${width}"
          height="${height}"
          loading="eager"
          decoding="async"
        />
      </a>
      <figcaption class="gallery-slide__caption">
        <span class="gallery-slide__counter">${index + 1} / ${total}</span>
        <strong>${escapeHtml(title)}</strong>
        ${renderGalleryTags(item)}
      </figcaption>
    </figure>
    <button class="gallery-nav gallery-nav--next" type="button" data-gallery-next aria-label="Foto siguiente">
      <span aria-hidden="true">&rsaquo;</span>
    </button>
  `;
}

function galleryThumb(item, index, active) {
  const src = mediaPath(item.r2Key);
  const title = humanGalleryTitle(item);
  return `
    <button
      class="gallery-thumb${active ? " is-active" : ""}"
      type="button"
      data-gallery-index="${index}"
      aria-label="Ver ${escapeHtml(title)}"
      aria-current="${active ? "true" : "false"}"
    >
      <img
        src="${escapeHtml(src)}"
        alt=""
        width="${item.width || 2048}"
        height="${item.height || 1365}"
        loading="${index < 12 ? "eager" : "lazy"}"
        decoding="async"
      />
      <span>${escapeHtml(title)}</span>
    </button>
  `;
}

function galleryCanonicalOrigin() {
  try {
    return new URL(document.querySelector("link[rel='canonical']")?.href || window.location.href).origin;
  } catch {
    return window.location.origin;
  }
}

function updateGalleryStructuredData() {
  const script = $("#galleryJsonLd");
  if (!script || !state.gallery.items.length) return;

  const origin = galleryCanonicalOrigin();
  const payload = {
    "@context": "https://schema.org",
    "@type": "ImageGallery",
    name: "Galeria Honda Fest Chile",
    description:
      "Galeria completa de Honda Fest Chile con pista, paddock, premiaciones, comunidad y cultura japonesa.",
    image: state.gallery.items.map((item) => ({
      "@type": "ImageObject",
      name: humanGalleryTitle(item),
      contentUrl: `${origin}${mediaPath(item.r2Key)}`,
      caption: humanGalleryDescription(item),
      keywords: item.keywords
    }))
  };

  script.textContent = JSON.stringify(payload);
}

function renderGallery() {
  const controls = $("#galleryControls");
  const viewer = $("#galleryViewer");
  const thumbs = $("#galleryThumbs");
  const summary = $("#gallerySummary");
  const search = $("#gallerySearch");
  if (!controls || !viewer || !thumbs || !summary) return;

  const items = filteredGalleryItems();
  const activeCategory = state.gallery.categories.find((category) => category.slug === state.gallery.activeCategory);
  const activeLabel = activeCategory?.name || "Todas las categorias";
  state.gallery.activeIndex = Math.min(Math.max(0, state.gallery.activeIndex), Math.max(0, items.length - 1));
  const activeItem = items[state.gallery.activeIndex];
  const queryLabel = state.gallery.query ? ` / busqueda: "${state.gallery.query}"` : "";

  controls.innerHTML = galleryCategoryButtons();
  if (search && search.value !== state.gallery.query) {
    search.value = state.gallery.query;
  }
  summary.innerHTML = `
    <strong>${items.length}</strong>
    <span>${escapeHtml(activeLabel + queryLabel)} &middot; ${state.gallery.items.length} fotos totales &middot; ${state.gallery.categories.length} tipos</span>
  `;
  viewer.innerHTML = gallerySlide(activeItem, state.gallery.activeIndex, items.length);
  thumbs.innerHTML = items.map((item, index) => galleryThumb(item, index, index === state.gallery.activeIndex)).join("");
  thumbs.querySelector(".gallery-thumb.is-active")?.scrollIntoView({
    behavior: "smooth",
    inline: "center",
    block: "nearest"
  });
  registerGalleryReveal(viewer);
}

async function initGalleryCatalog() {
  const viewer = $("#galleryViewer");
  const summary = $("#gallerySummary");
  if (!viewer || !summary) return;

  try {
    const data = await loadGalleryData();
    state.gallery.items = Array.isArray(data.items) ? data.items : [];
    state.gallery.categories = Array.isArray(data.categories) ? data.categories : [];
    state.gallery.activeCategory = ALL_GALLERY_CATEGORY;
    state.gallery.activeIndex = 0;
    state.gallery.query = "";
    renderGallery();
    updateGalleryStructuredData();
  } catch (error) {
    summary.innerHTML = `<strong>Galeria no disponible</strong><span>${escapeHtml(error.message)}</span>`;
    viewer.innerHTML = "";
  }
}

function setGalleryIndex(index) {
  const items = filteredGalleryItems();
  if (!items.length) {
    state.gallery.activeIndex = 0;
    renderGallery();
    return;
  }

  state.gallery.activeIndex = ((index % items.length) + items.length) % items.length;
  renderGallery();
}

function changeGallerySlide(delta) {
  setGalleryIndex(state.gallery.activeIndex + delta);
}

function initGalleryLightbox() {
  const dialog = $("#galleryDialog");
  if (!dialog) return;

  const image = dialog.querySelector("img");
  const title = dialog.querySelector("h2");
  const description = dialog.querySelector("p");
  const closeButton = dialog.querySelector(".gallery-dialog-close");

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : event.target.parentElement;
    const link = target?.closest(".gallery-image-link");
    if (!link || typeof dialog.showModal !== "function") return;
    event.preventDefault();
    const thumbnail = link.querySelector("img");
    image.src = link.href;
    image.alt = thumbnail?.alt || "";
    title.textContent = link.dataset.galleryTitle || thumbnail?.title || "Galeria Honda Fest Chile";
    description.textContent = link.dataset.galleryDescription || thumbnail?.alt || "";
    dialog.showModal();
  });

  closeButton?.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });
}

async function init() {
  initGalleryTransitions();
  initGalleryLightbox();
  $("#galleryControls")?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : event.target.parentElement;
    const button = target?.closest("[data-gallery-category]");
    if (!button) return;
    state.gallery.activeCategory = button.dataset.galleryCategory || ALL_GALLERY_CATEGORY;
    state.gallery.activeIndex = 0;
    renderGallery();
  });
  $("#gallerySearch")?.addEventListener("input", (event) => {
    state.gallery.query = event.currentTarget.value.trim();
    state.gallery.activeIndex = 0;
    renderGallery();
  });
  $("#galleryViewer")?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : event.target.parentElement;
    if (target?.closest("[data-gallery-prev]")) changeGallerySlide(-1);
    if (target?.closest("[data-gallery-next]")) changeGallerySlide(1);
  });
  $("#galleryThumbs")?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : event.target.parentElement;
    const thumb = target?.closest("[data-gallery-index]");
    if (!thumb) return;
    setGalleryIndex(Number(thumb.dataset.galleryIndex || 0));
  });
  $("#galerias")?.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") changeGallerySlide(-1);
    if (event.key === "ArrowRight") changeGallerySlide(1);
  });

  const [catalog] = await Promise.all([api("/api/catalog"), initGalleryCatalog()]);
  state.events = catalog.events;
  state.ticketTypes = catalog.ticketTypes;
  renderEvents();
  if ($("#eventSelect")) {
    populateSelects();
    prefillOrderForm(loadRememberedUser());
  }

  $$(".tab").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  $("#ticketSelect")?.addEventListener("change", updateTotal);
  $("#eventSelect")?.addEventListener("change", populateSelects);
  $("#quantityInput")?.addEventListener("input", updateTotal);
  $("#registerForm")?.addEventListener("submit", handleRegister);
  $("#orderForm")?.addEventListener("submit", handleOrder);

  inspectReturnParams();
}

init().catch((error) => {
  toast(error.message);
});
