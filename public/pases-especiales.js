(() => {
  let catalog = null;
  let selectedLevel = null;

  const escapeHtml = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

  function pistonLabel(count) {
    return Number(count) === 1 ? "Pistón" : "Pistones";
  }

  function pistonIconRow(count) {
    const visible = Math.min(Number(count || 0), 9);
    return `<div class="piston-row" aria-label="${visible} ${pistonLabel(visible)}">${Array.from(
      { length: visible },
      () => '<span class="mini-piston" aria-hidden="true"></span>'
    ).join("")}</div>`;
  }

  function renderLevels() {
    const grid = HFC.$("#passLevelGrid");
    const purchaseAvailable = Boolean(catalog.active);
    grid.innerHTML = catalog.levels
      .map(
        (level) => `
          <article class="pass-level-card accent-${escapeHtml(level.accent)} ${level.featured ? "featured" : ""}" data-level-card="${escapeHtml(level.id)}">
            ${level.featured ? '<span class="level-featured">Nivel destacado</span>' : ""}
            <div class="pass-level-number"><strong>${level.pistons}</strong><span>${pistonLabel(level.pistons)}</span></div>
            ${pistonIconRow(level.pistons)}
            <h3>${escapeHtml(level.name)}</h3>
            <p>Pase de Jornada con ${escapeHtml(catalog.physicalFormat.toLowerCase())}, experiencias y participación en premios especiales.</p>
            <strong class="pass-level-price">${HFC.formatCurrency(level.price)}</strong>
            <button class="button ${level.featured ? "primary" : "secondary"} full" type="button" data-select-level="${escapeHtml(level.id)}" ${purchaseAvailable ? "" : "disabled"}>${purchaseAvailable ? `Elegir ${level.pistons} ${pistonLabel(level.pistons)}` : "Próximamente"}</button>
            <small>REQUIERE ENTRADA HFC</small>
          </article>`
      )
      .join("");

    HFC.$$('[data-select-level]').forEach((button) => {
      button.addEventListener("click", () => selectLevel(button.dataset.selectLevel));
    });
  }

  function renderBenefits() {
    HFC.$("#commonBenefitList").innerHTML = catalog.commonBenefits
      .map((benefit) => `<div><span aria-hidden="true">✓</span><p>${escapeHtml(benefit)}</p></div>`)
      .join("");
    HFC.$("#pickupEventDay").textContent = catalog.pickup.eventDay;
    HFC.$("#pickupPreEvent").textContent = catalog.pickup.preEvent;
  }

  function selectLevel(levelId) {
    if (!catalog.active) return;
    selectedLevel = catalog.levels.find((level) => level.id === levelId) || null;
    if (!selectedLevel) return;
    HFC.$$('[data-level-card]').forEach((card) => card.classList.toggle("selected", card.dataset.levelCard === levelId));
    const form = HFC.$("#specialPassCheckoutForm");
    form.levelId.value = selectedLevel.id;
    const payButton = HFC.$("#specialPassPayButton");
    payButton.disabled = false;
    payButton.textContent = `Pagar ${HFC.formatCurrency(selectedLevel.price)}`;
    HFC.$("#selectedPassSummary").innerHTML = `
      <p class="section-kicker">Tu selección</p>
      <div class="selected-pass-lockup"><span>${selectedLevel.pistons}</span><div><small>${pistonLabel(selectedLevel.pistons)}</small><h2>${escapeHtml(selectedLevel.name)}</h2></div></div>
      <strong>${HFC.formatCurrency(selectedLevel.price)}</strong>
      <p>Pase de Jornada con ${escapeHtml(catalog.physicalFormat.toLowerCase())}, experiencias y participación en premios especiales.</p>
      <div class="not-entry-inline">${escapeHtml(catalog.notEntryLabel)}</div>`;
    HFC.$("#comprar").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function validEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
  }

  function validPhone(value) {
    return String(value || "").replace(/\D/g, "").length >= 8;
  }

  async function handleCreatedOrder(data, status) {
    if (data.accountToken || data.user) HFC.saveAccountSession({ token: data.accountToken, user: data.user });
    if (data.paymentMode === "mercadopago_api") {
      await HFC.renderInternalPayment(status, data);
      return;
    }
    if (data.paymentMode === "mercadopago") {
      HFC.setStatus(status, `<strong>Orden creada.</strong><br>Te llevamos a Mercado Pago para completar la compra.<div class="status-actions"><a class="button primary" href="${escapeHtml(data.checkoutUrl)}">Ir a pagar</a></div>`);
      window.location.href = data.checkoutUrl;
      return;
    }
    HFC.setStatus(status, `<strong>Orden demo creada.</strong><br>Total: ${HFC.formatCurrency(data.order.total)}<div class="status-actions"><button class="button primary" type="button" data-pass-demo-pay>Confirmar pago demo</button></div>`);
    HFC.$("[data-pass-demo-pay]", status)?.addEventListener("click", async () => {
      HFC.setStatus(status, "Confirmando el pago y preparando el enrolamiento...");
      const paid = await HFC.api(`/api/orders/${encodeURIComponent(data.order.id)}/simulate-payment`, { method: "POST", body: "{}" });
      await HFC.renderOrderResult(status, paid);
    });
  }

  async function mountCheckout() {
    const form = HFC.$("#specialPassCheckoutForm");
    const status = HFC.$("#checkoutStatus");
    const stored = HFC.getAccountUser?.();
    if (stored?.email) form.email.value = stored.email;
    if (stored?.phone) form.phone.value = stored.phone;
    if (!catalog.active) {
      form.querySelectorAll("input, button").forEach((field) => {
        field.disabled = true;
      });
      HFC.setStatus(status, catalog.unavailableMessage || "Los Pases Especiales estarán disponibles próximamente.");
      return;
    }
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!selectedLevel) return HFC.setStatus(status, "Selecciona un nivel de Pase de Jornada.", true);
      const payload = Object.fromEntries(new FormData(form).entries());
      payload.termsAccepted = form.termsAccepted.checked;
      payload.notEntryAccepted = form.notEntryAccepted.checked;
      if (!validEmail(payload.email)) return HFC.setStatus(status, "Ingresa un correo válido.", true);
      if (!validPhone(payload.phone)) return HFC.setStatus(status, "Ingresa un teléfono válido.", true);
      if (!payload.termsAccepted || !payload.notEntryAccepted) return HFC.setStatus(status, "Debes aceptar ambas confirmaciones para continuar.", true);
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      HFC.setStatus(status, "Creando tu Pase de Jornada...");
      try {
        const data = await HFC.api("/api/special-passes/orders", { method: "POST", body: JSON.stringify(payload) });
        await handleCreatedOrder(data, status);
      } catch (error) {
        HFC.setStatus(status, error.message, true);
      } finally {
        submit.disabled = false;
      }
    });
  }

  async function init() {
    try {
      const data = await HFC.api("/api/special-passes/catalog");
      catalog = data.specialPass;
      renderLevels();
      renderBenefits();
      await mountCheckout();
    } catch (error) {
      HFC.$("#passLevelGrid").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
