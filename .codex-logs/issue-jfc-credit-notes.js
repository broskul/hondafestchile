const fs = require("fs");
const path = require("path");

const ISSUE = process.argv.includes("--issue");
const JFC_EVENT_ID = "japon-fest-chile-2026";
const DTE_TYPE_BOLETA = 39;
const DTE_TYPE_CREDIT_NOTE = 61;
const HAULMER_BASE_URL = "https://api.haulmer.com/v2/dte";
const EXPECTED_REAL_FOLIOS = new Set(["15351", "15352", "15353", "15354", "15355", "15356"]);
const OUTPUT_PATH = path.join(
  process.cwd(),
  ".codex-logs",
  ISSUE ? "jfc-credit-notes-issued.json" : "jfc-credit-notes-dry-run.json"
);

function cleanEnv(name) {
  return String(process.env[name] || "").trim();
}

function requireEnv(names) {
  for (const name of names) {
    if (!cleanEnv(name)) throw new Error(`Missing ${name}`);
  }
}

function supabaseUrl() {
  return (cleanEnv("SUPABASE_REST_URL") || cleanEnv("NEXT_PUBLIC_SUPABASE_URL")).replace(/\/$/, "");
}

function supabaseKey() {
  return cleanEnv("SUPABASE_SERVICE_ROLE_KEY") || cleanEnv("SUPABASE_ANON_KEY") || cleanEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

async function supabaseRequest(table, options = {}) {
  const url = new URL(`${supabaseUrl()}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(options.query || {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      apikey: supabaseKey(),
      Authorization: `Bearer ${supabaseKey()}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }
  if (!response.ok) {
    throw new Error(`Supabase ${table}: ${payload?.message || payload?.hint || `HTTP ${response.status}`}`);
  }
  return payload;
}

async function readCollection(table) {
  const rows = await supabaseRequest(table, {
    query: {
      select: "payload",
      order: "created_at.asc"
    }
  });
  return rows.map((row) => row.payload).filter(Boolean);
}

async function readProductionBackofficeState() {
  const token = cleanEnv("BACKOFFICE_TOKEN");
  if (!token) throw new Error("Missing BACKOFFICE_TOKEN");
  const baseUrl = (cleanEnv("PUBLIC_BASE_URL") || "https://www.hondafestchile.cl").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/api/backoffice/summary`, {
    headers: { "x-admin-token": token }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Backoffice production summary: ${payload?.message || payload?.error || `HTTP ${response.status}`}`);
  }
  return {
    orders: payload.orders || [],
    users: payload.users || [],
    invoices: payload.invoices || [],
    audit: payload.audit || [],
    source: "production-backoffice-summary",
    storage: payload.storage || null
  };
}

async function upsertCollection(table, item) {
  await supabaseRequest(table, {
    method: "POST",
    query: { on_conflict: "id" },
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: [
      {
        id: item.id,
        order_id: item.orderId || null,
        type: item.type || item.kind || null,
        payload: item,
        created_at: item.createdAt || new Date().toISOString(),
        updated_at: item.updatedAt || new Date().toISOString()
      }
    ]
  });
}

function getOrderItems(order) {
  if (Array.isArray(order.items) && order.items.length) return order.items;
  return [
    {
      eventId: order.eventId,
      eventName: order.eventName,
      ticketTypeId: order.ticketTypeId,
      ticketTypeName: order.ticketTypeName,
      quantity: order.quantity || 1,
      unitPrice: order.unitPrice || order.total || 0,
      total: order.total || 0
    }
  ];
}

function itemIsJfc(item) {
  return (
    item?.eventId === JFC_EVENT_ID ||
    /jap[oó]n fest|japon fest|japan fest/i.test(String(item?.eventName || item?.description || ""))
  );
}

function invoiceLooksDemo(invoice) {
  return Boolean(
    invoice &&
      (invoice.mode === "demo" ||
        /^dte_demo_/i.test(String(invoice.id || "")) ||
        /^DEMO-/i.test(String(invoice.folio || "")) ||
        /^OF-DEMO-/i.test(String(invoice.providerId || "")))
  );
}

function invoiceLooksCreditNote(invoice) {
  return Boolean(
    invoice &&
      (invoice.kind === "credit_note" ||
        invoice.type === "credit_note" ||
        Number(invoice.dteType || invoice?.payload?.dte?.Encabezado?.IdDoc?.TipoDTE) === DTE_TYPE_CREDIT_NOTE)
  );
}

function originalFolioForCreditNote(invoice) {
  return String(
    invoice?.originalFolio ||
      invoice?.originalInvoiceFolio ||
      invoice?.payload?.dte?.Referencia?.[0]?.FolioRef ||
      invoice?.raw?.dte?.Referencia?.[0]?.FolioRef ||
      ""
  );
}

function readOriginalDte(invoice) {
  return invoice?.payload?.dte || invoice?.raw?.dte || null;
}

function invoiceFolio(invoice) {
  return String(invoice?.folio || invoice?.raw?.FOLIO || invoice?.raw?.folio || "");
}

function money(value) {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0
  }).format(Math.round(Number(value || 0)));
}

function chileDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function dateFromIso(value) {
  if (!value) return chileDate();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return chileDate();
  return chileDate(date);
}

function normalizeResult(result, orderId) {
  const folio = String(result?.FOLIO || result?.folio || result?.Folio || "");
  const token = String(result?.TOKEN || result?.token || result?.Token || "");
  const pdf = String(result?.PDF || result?.pdf || "");
  const xml = String(result?.XML || result?.xml || "");
  return {
    id: `credit_note_${orderId}`,
    folio,
    token,
    providerId: token || (folio ? `HAULMER-NC-${folio}` : `HAULMER-NC-${orderId}`),
    pdfBase64: pdf || null,
    xmlBase64: xml || null
  };
}

function safeResult(result) {
  if (!result || typeof result !== "object") return result;
  return {
    ...result,
    PDF: result.PDF ? `[base64:${String(result.PDF).length}]` : undefined,
    XML: result.XML ? `[base64:${String(result.XML).length}]` : undefined,
    TIMBRE: result.TIMBRE ? `[base64:${String(result.TIMBRE).length}]` : undefined,
    LOGO: result.LOGO ? `[base64:${String(result.LOGO).length}]` : undefined
  };
}

function buildCreditNotePayload({ order, user, invoice, amount }) {
  const originalDte = readOriginalDte(invoice);
  const originalHeader = originalDte?.Encabezado || {};
  const originalTotals = originalHeader.Totales || {};
  const originalDetail = Array.isArray(originalDte?.Detalle) ? originalDte.Detalle : [];
  const originalFolio = invoiceFolio(invoice);
  const issueDate = chileDate();
  const referenceDate = dateFromIso(invoice.createdAt || order.createdAt);

  const total = Math.round(Number(amount || originalTotals.MntTotal || order.total || 0));
  const net = Math.round(Number(originalTotals.MntNeto || Math.round(total / 1.19)));
  const iva = Math.round(Number(originalTotals.IVA || total - net));
  const jfcItems = getOrderItems(order).filter(itemIsJfc);
  const detail = originalDetail.length
    ? originalDetail
    : jfcItems.length
      ? jfcItems.map((item, index) => {
          const quantity = Number(item.quantity || 1);
          const lineTotal = Math.round(Number(item.total || item.unitPrice || 0));
          return {
            NroLinDet: index + 1,
            NmbItem: `${item.ticketTypeName || "Entrada"} - ${item.eventName || "Japon Fest Chile"}`,
            QtyItem: quantity,
            PrcItem: Math.round(lineTotal / quantity),
            MontoItem: lineTotal
          };
        })
      : [
          {
            NroLinDet: 1,
            NmbItem: "Anulacion Japon Fest Chile",
            QtyItem: 1,
            PrcItem: total,
            MontoItem: total
          }
        ];

  return {
    response: ["XML", "PDF", "TIMBRE", "LOGO", "FOLIO", "RESOLUCION", "LETTER"],
    dte: {
      Encabezado: {
        IdDoc: {
          TipoDTE: DTE_TYPE_CREDIT_NOTE,
          Folio: 0,
          FchEmis: issueDate,
          TpoTranVenta: "1",
          FmaPago: "2"
        },
        Emisor: {
          RUTEmisor: cleanEnv("OPENFACTURA_COMPANY_RUT").replace(/[.\s]/g, ""),
          RznSoc: (cleanEnv("OPENFACTURA_COMPANY_NAME") || originalHeader.Emisor?.RznSoc || originalHeader.Emisor?.RznSocEmisor || "").toUpperCase(),
          GiroEmis: (
            cleanEnv("OPENFACTURA_COMPANY_GIRO") ||
            originalHeader.Emisor?.GiroEmis ||
            originalHeader.Emisor?.GiroEmisor ||
            ""
          ).toUpperCase(),
          DirOrigen: cleanEnv("OPENFACTURA_COMPANY_ADDRESS") || originalHeader.Emisor?.DirOrigen || "",
          CmnaOrigen: cleanEnv("OPENFACTURA_COMPANY_COMUNA") || originalHeader.Emisor?.CmnaOrigen || "",
          CiudadOrigen: cleanEnv("OPENFACTURA_COMPANY_CITY") || originalHeader.Emisor?.CiudadOrigen || "",
          CdgSIISucur: Number(cleanEnv("OPENFACTURA_COMPANY_BRANCH_CODE") || originalHeader.Emisor?.CdgSIISucur || 90061542)
        },
        Receptor: {
          RUTRecep: String(originalHeader.Receptor?.RUTRecep || user.rut || order.rut || "66666666-6").replace(/[.\s]/g, ""),
          RznSocRecep: originalHeader.Receptor?.RznSocRecep || user.name || order.customerName || "Consumidor final",
          DirRecep: originalHeader.Receptor?.DirRecep || user.address || cleanEnv("OPENFACTURA_COMPANY_ADDRESS") || "",
          CmnaRecep: originalHeader.Receptor?.CmnaRecep || user.city || user.comuna || cleanEnv("OPENFACTURA_COMPANY_COMUNA") || ""
        },
        Totales: {
          MntNeto: net,
          TasaIVA: "19",
          IVA: iva,
          MntTotal: total,
          MontoPeriodo: total,
          VlrPagar: total
        }
      },
      Detalle: detail,
      Referencia: [
        {
          NroLinRef: 1,
          TpoDocRef: String(DTE_TYPE_BOLETA),
          FolioRef: originalFolio,
          FchRef: referenceDate,
          CodRef: "1",
          RazonRef: "Anula boleta por cancelacion Japon Fest Chile"
        }
      ]
    },
    referenciaExterna: `jfc-cancel-${order.id}-${originalFolio}`
  };
}

async function fetchHaulmerDocuments() {
  const response = await fetch(`${HAULMER_BASE_URL}/organization/document`, {
    headers: { apikey: cleanEnv("OPENFACTURA_API_KEY") || cleanEnv("OPENFACTURA_SUBSCRIPTION_KEY") }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Haulmer organization/document: ${payload?.message || `HTTP ${response.status}`}`);
  }
  return payload;
}

async function emitCreditNote({ order, invoice, payload }) {
  const apiKey = cleanEnv("OPENFACTURA_API_KEY") || cleanEnv("OPENFACTURA_SUBSCRIPTION_KEY");
  const idempotencyKey = `hfc-jfc-credit-note-${order.id}-${invoiceFolio(invoice)}`;
  const response = await fetch(`${HAULMER_BASE_URL}/document`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: apiKey,
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let result = {};
  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    result = { message: text };
  }
  if (!response.ok) {
    throw new Error(`Haulmer credit note ${invoiceFolio(invoice)}: ${result?.message || result?.error || `HTTP ${response.status}`}`);
  }
  return { result, idempotencyKey };
}

async function main() {
  requireEnv(["NEXT_PUBLIC_SUPABASE_URL", "OPENFACTURA_COMPANY_RUT", "OPENFACTURA_API_KEY"]);

  let [orders, users, invoices, audit] = await Promise.all([
    readCollection("hfc_orders"),
    readCollection("hfc_users"),
    readCollection("hfc_invoices"),
    readCollection("hfc_audit")
  ]);
  let stateSource = "supabase-rest";
  let productionStorage = null;
  if (!orders.some((order) => getOrderItems(order).some(itemIsJfc))) {
    const productionState = await readProductionBackofficeState();
    orders = productionState.orders;
    users = productionState.users;
    invoices = productionState.invoices;
    audit = productionState.audit;
    stateSource = productionState.source;
    productionStorage = productionState.storage;
  }
  const usersById = new Map(users.map((user) => [user.id, user]));
  const orderInvoices = orders.map((order) => order.invoice).filter(Boolean);
  const originalInvoicesByOrder = new Map(
    [...invoices, ...orderInvoices]
      .filter((invoice) => !invoiceLooksCreditNote(invoice) && !invoiceLooksDemo(invoice) && EXPECTED_REAL_FOLIOS.has(invoiceFolio(invoice)))
      .map((invoice) => [invoice.orderId, invoice])
  );
  const existingCreditNotesByOriginalFolio = new Map(
    [...invoices, ...orderInvoices]
      .filter(invoiceLooksCreditNote)
      .map((invoice) => [originalFolioForCreditNote(invoice), invoice])
      .filter(([folio]) => EXPECTED_REAL_FOLIOS.has(folio))
  );

  const candidates = orders
    .filter((order) => getOrderItems(order).some(itemIsJfc))
    .map((order) => ({
      order,
      user: usersById.get(order.userId) || order.user || {},
      invoice: originalInvoicesByOrder.get(order.id) || order.invoice
    }))
    .filter(({ invoice }) => invoice && EXPECTED_REAL_FOLIOS.has(invoiceFolio(invoice)))
    .sort((a, b) => Number(invoiceFolio(a.invoice)) - Number(invoiceFolio(b.invoice)));

  const planned = candidates.map(({ order, user, invoice }) => {
    const originalFolio = invoiceFolio(invoice);
    const existing = existingCreditNotesByOriginalFolio.get(originalFolio);
    const amount = Number(invoice?.payload?.dte?.Encabezado?.Totales?.MntTotal || order.total || 0);
    const payload = buildCreditNotePayload({ order, user, invoice, amount });
    return {
      order,
      user,
      invoice,
      originalFolio,
      amount,
      existing,
      payload
    };
  });

  const missing = planned.filter((entry) => !entry.existing);
  const haulmerDocuments = await fetchHaulmerDocuments();
  const creditNoteAvailability = (haulmerDocuments.documentos || []).find((document) => Number(document.dte) === DTE_TYPE_CREDIT_NOTE);
  const available = Number(creditNoteAvailability?.disponibles || 0);

  const summary = {
    generatedAt: new Date().toISOString(),
    mode: ISSUE ? "issue" : "dry-run",
    stateSource,
    productionStorage,
    expectedOriginalFolios: [...EXPECTED_REAL_FOLIOS].sort(),
    candidates: planned.map((entry) => ({
      orderId: entry.order.id,
      originalFolio: entry.originalFolio,
      amount: entry.amount,
      amountText: money(entry.amount),
      receptorRut: entry.payload.dte.Encabezado.Receptor.RUTRecep,
      receptorName: entry.payload.dte.Encabezado.Receptor.RznSocRecep,
      existingCreditNoteFolio: entry.existing?.folio || null,
      payload: ISSUE ? undefined : entry.payload
    })),
    missingCount: missing.length,
    totalToIssue: missing.reduce((sum, entry) => sum + entry.amount, 0),
    totalToIssueText: money(missing.reduce((sum, entry) => sum + entry.amount, 0)),
    haulmerDocuments,
    creditNoteAvailability: creditNoteAvailability || null,
    issued: [],
    skipped: planned
      .filter((entry) => entry.existing)
      .map((entry) => ({
        orderId: entry.order.id,
        originalFolio: entry.originalFolio,
        reason: "already_has_credit_note",
        creditNoteFolio: entry.existing.folio || null
      })),
    auditRows: audit.filter((row) => row.type === "jfc_credit_note_issued").length
  };

  if (!ISSUE) {
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(summary, null, 2), "utf8");
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (!missing.length) {
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(summary, null, 2), "utf8");
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (!creditNoteAvailability || available < missing.length) {
    summary.blocked = {
      reason: "missing_dte_61_folios",
      message: `Haulmer no informa folios disponibles para DTE ${DTE_TYPE_CREDIT_NOTE}; disponibles: ${available}, necesarios: ${missing.length}`
    };
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(summary, null, 2), "utf8");
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = 2;
    return;
  }

  if (stateSource !== "supabase-rest") {
    summary.blocked = {
      reason: "write_target_not_verified",
      message: "Los datos productivos se leyeron desde backoffice, pero Supabase REST local esta vacio; no se emiten DTE reales sin una ruta de guardado verificada."
    };
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(summary, null, 2), "utf8");
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = 3;
    return;
  }

  for (const entry of missing) {
    const { result, idempotencyKey } = await emitCreditNote(entry);
    const normalized = normalizeResult(result, entry.order.id);
    const now = new Date().toISOString();
    const creditNote = {
      ...normalized,
      id: `credit_note_${entry.order.id}_${entry.originalFolio}`,
      kind: "credit_note",
      type: "credit_note",
      dteType: DTE_TYPE_CREDIT_NOTE,
      orderId: entry.order.id,
      mode: "openfactura",
      provider: "openfactura",
      originalInvoiceId: entry.invoice.id,
      originalFolio: entry.originalFolio,
      originalDteType: DTE_TYPE_BOLETA,
      amount: entry.amount,
      payload: entry.payload,
      raw: result,
      idempotencyKey,
      createdAt: now,
      updatedAt: now
    };
    const auditRow = {
      id: `audit_credit_note_${entry.order.id}_${entry.originalFolio}`,
      type: "jfc_credit_note_issued",
      orderId: entry.order.id,
      invoiceId: creditNote.id,
      originalInvoiceId: entry.invoice.id,
      originalFolio: entry.originalFolio,
      creditNoteFolio: creditNote.folio,
      amount: entry.amount,
      idempotencyKey,
      createdAt: now,
      updatedAt: now
    };
    await upsertCollection("hfc_invoices", creditNote);
    await upsertCollection("hfc_audit", auditRow);
    summary.issued.push({
      orderId: entry.order.id,
      originalFolio: entry.originalFolio,
      creditNoteFolio: creditNote.folio,
      amount: entry.amount,
      amountText: money(entry.amount),
      idempotencyKey,
      result: safeResult(result)
    });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(summary, null, 2), "utf8");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
