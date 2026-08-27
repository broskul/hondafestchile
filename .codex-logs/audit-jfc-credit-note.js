const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(process.cwd(), ".env.local"), override: false });

const { readState } = require("../server/lib/storage");

const JFC_EVENT_ID = "japon-fest-chile-2026";
const MP_API_BASE = "https://api.mercadopago.com";
const WALLET_MOVEMENTS_PATH =
  "C:\\Users\\Usuario\\Prof3sional Chile SpA\\Prof3sional - Documentos\\Contabilidad\\Conciliaciones\\MercadoPago\\_movimientos_mercadopago_2025-07-28_a_2026-07-24.json";
const SUPABASE_TABLES = {
  users: "hfc_users",
  sessions: "hfc_sessions",
  orders: "hfc_orders",
  tickets: "hfc_tickets",
  invoices: "hfc_invoices",
  payments: "hfc_payments",
  settings: "hfc_settings",
  contacts: "hfc_contacts",
  emailTemplates: "hfc_email_templates",
  emailLogs: "hfc_email_logs",
  audit: "hfc_audit"
};

const pesos = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0
});

function money(value) {
  return pesos.format(Math.round(Number(value || 0)));
}

function sum(items, fn) {
  return items.reduce((total, item) => total + Number(fn(item) || 0), 0);
}

function readPath(source, dottedPath) {
  return dottedPath.split(".").reduce((value, key) => {
    if (value === undefined || value === null) return undefined;
    return value[key];
  }, source);
}

function firstValue(source, paths) {
  for (const currentPath of paths) {
    const value = readPath(source, currentPath);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function firstNumber(source, paths) {
  for (const currentPath of paths) {
    const value = readPath(source, currentPath);
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
  }
  return null;
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

function orderJfcItems(order) {
  return getOrderItems(order).filter(itemIsJfc);
}

function itemTotal(item) {
  const explicit = Number(item.total);
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit);
  const unit = Number(item.unitPrice || item.price || 0);
  const quantity = Number(item.quantity || 1);
  return Math.round(unit * quantity);
}

function invoiceLooksDemo(invoice) {
  if (!invoice) return false;
  return (
    invoice.mode === "demo" ||
    /^dte_demo_/i.test(String(invoice.id || "")) ||
    /^DEMO-/i.test(String(invoice.folio || "")) ||
    /^OF-DEMO-/i.test(String(invoice.providerId || ""))
  );
}

function invoiceLooksReal(invoice) {
  return Boolean(invoice && !invoiceLooksDemo(invoice));
}

function invoiceFolio(invoice) {
  if (!invoice) return "";
  return (
    invoice.folio ||
    (String(invoice.pdfFileName || "").match(/boleta-(\d+)/i)?.[1] || "") ||
    firstValue(invoice.raw || {}, [
      "folio",
      "Folio",
      "FOLIO",
      "number",
      "Numero",
      "NumeroDTE",
      "dte.folio",
      "document.folio",
      "response.folio",
      "response.FOLIO",
      "data.folio",
      "data.FOLIO"
    ]) ||
    invoice.providerId ||
    invoice.id ||
    ""
  );
}

function invoiceAmount(invoice, fallback) {
  if (!invoice) return 0;
  return (
    firstNumber(invoice, [
      "total",
      "amount",
      "payload.dte.Encabezado.Totales.MntTotal",
      "payload.Encabezado.Totales.MntTotal",
      "raw.dte.Encabezado.Totales.MntTotal",
      "raw.Encabezado.Totales.MntTotal",
      "raw.MntTotal",
      "raw.total",
      "raw.amount",
      "raw.response.MntTotal",
      "raw.data.MntTotal"
    ]) || fallback
  );
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function supabaseRestUrl() {
  const explicit = process.env.SUPABASE_REST_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const value = String(process.env.SUPABASE_URL || "").trim();
  return /^https?:\/\//i.test(value) ? value.replace(/\/$/, "") : "";
}

function supabaseRestKey() {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ""
  ).trim();
}

async function readSupabaseRestState() {
  const baseUrl = supabaseRestUrl();
  const key = supabaseRestKey();
  if (!baseUrl || !key) {
    throw new Error("Supabase REST no esta configurado para fallback");
  }

  const entries = await Promise.all(
    Object.entries(SUPABASE_TABLES).map(async ([collection, table]) => {
      const url = new URL(`${baseUrl}/rest/v1/${table}`);
      url.searchParams.set("select", "payload");
      url.searchParams.set("order", "created_at.asc");
      const response = await fetch(url, {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`
        }
      });
      const payload = await response.json().catch(() => []);
      if (!response.ok) {
        const detail = payload?.message || payload?.hint || `HTTP ${response.status}`;
        throw new Error(`Supabase REST ${table}: ${detail}`);
      }
      return [collection, payload.map((row) => row.payload).filter(Boolean)];
    })
  );

  return Object.fromEntries(entries);
}

async function readStateSafely() {
  try {
    const state = await readState();
    return { state, source: "postgres-or-storage" };
  } catch (error) {
    const state = await readSupabaseRestState();
    return { state, source: `supabase-rest-fallback (${error.message})` };
  }
}

async function readProductionBackofficeState() {
  const token = String(process.env.BACKOFFICE_TOKEN || "").trim();
  if (!token) throw new Error("Falta BACKOFFICE_TOKEN para leer backoffice productivo");
  const baseUrl = String(process.env.PUBLIC_BASE_URL || "https://www.hondafestchile.cl").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/api/backoffice/summary`, {
    headers: {
      "x-admin-token": token
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Backoffice productivo: ${payload.message || payload.error || `HTTP ${response.status}`}`);
  }
  return {
    state: {
      users: payload.users || [],
      sessions: [],
      orders: payload.orders || [],
      tickets: payload.tickets || [],
      invoices: payload.invoices || [],
      payments: [],
      settings: [],
      contacts: payload.contacts || [],
      emailTemplates: payload.emailTemplates || [],
      emailLogs: payload.emailLogs || [],
      audit: []
    },
    source: "production-backoffice-summary",
    sideEffects: {
      enrollmentRemindersSent: payload.summary?.enrollmentRemindersSent ?? null,
      storage: payload.storage || null
    }
  };
}

function paymentIdsForOrder(order, payments) {
  const orderPayments = payments.filter((payment) => payment.orderId === order.id || payment?.payload?.orderId === order.id);
  return unique([
    order.paymentId,
    order.payment?.paymentId,
    order.payment?.id,
    ...orderPayments.flatMap((payment) => [
      payment.paymentId,
      payment.id,
      payment.payload?.paymentId,
      payment.payload?.id,
      payment.payload?.raw?.id
    ])
  ]).filter((value) => /^\d+$/.test(value));
}

function savedPaymentStatuses(order, payments) {
  const orderPayments = payments.filter((payment) => payment.orderId === order.id || payment?.payload?.orderId === order.id);
  return unique([
    order.paymentStatus,
    order.payment?.status,
    order.payment?.statusDetail,
    ...orderPayments.flatMap((payment) => [payment.status, payment.statusDetail, payment.payload?.status, payment.payload?.statusDetail])
  ]);
}

async function getMercadoPagoPayment(paymentId) {
  const candidates = unique([
    process.env.MERCADOPAGO_CHECKOUTPRO_ACCESS_TOKEN,
    process.env.MERCADOPAGO_ACCESS_TOKEN
  ]);
  const errors = [];

  for (const token of candidates) {
    const response = await fetch(`${MP_API_BASE}/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const bodyText = await response.text();
    let payload = {};
    try {
      payload = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      payload = { message: bodyText.slice(0, 200) };
    }

    if (response.ok) return payload;
    errors.push(`${response.status}:${payload.message || payload.error || "sin detalle"}`);
  }

  return {
    id: paymentId,
    __error: errors.join(" | ") || "sin token disponible"
  };
}

function paymentRefundInfo(payment) {
  const refunds = Array.isArray(payment?.refunds) ? payment.refunds : [];
  const approvedRefunds = refunds.filter((refund) => /approved|completed|success/i.test(String(refund.status || "")));
  const refundTotal = Math.round(sum(approvedRefunds, (refund) => refund.amount || refund.transaction_amount || 0));
  return {
    refundTotal,
    refunds: approvedRefunds.map((refund) => ({
      id: refund.id || null,
      amount: Math.round(Number(refund.amount || refund.transaction_amount || 0)),
      status: refund.status || null,
      date: refund.date_created || refund.date_last_updated || null
    }))
  };
}

function loadWalletMovements() {
  if (!fs.existsSync(WALLET_MOVEMENTS_PATH)) {
    return { sourceAvailable: false, rows: [], extractedAt: null, source: null };
  }

  const payload = JSON.parse(fs.readFileSync(WALLET_MOVEMENTS_PATH, "utf8"));
  return {
    sourceAvailable: true,
    rows: Array.isArray(payload.rows) ? payload.rows : [],
    extractedAt: payload.extractedAt || null,
    source: payload.source || null
  };
}

function walletEvidenceForRows(walletRows, auditRows) {
  const refundAmounts = unique(auditRows.map((row) => row.mpRefundTotal))
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  const directTerms = unique(
    auditRows.flatMap((row) => [row.orderId, ...row.paymentIds, row.email, row.rut])
  )
    .filter((value) => value.length >= 5)
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const directPattern = directTerms.length ? new RegExp(directTerms.join("|"), "i") : null;
  const refundDates = new Set(
    auditRows
      .flatMap((row) => row.mpRefunds || [])
      .map((refund) => {
        const date = refund.date ? new Date(refund.date) : null;
        if (!date || Number.isNaN(date.getTime())) return "";
        return date.toLocaleDateString("es-CL", {
          day: "numeric",
          month: "long",
          year: "numeric",
          timeZone: "America/Santiago"
        });
      })
      .filter(Boolean)
  );

  const directReferenceHits = walletRows
    .filter((row) => {
      const text = String(row.description || "");
      return directPattern && directPattern.test(text);
    })
    .map((row) => ({
      dateText: row.dateText || null,
      time: row.time || null,
      amount: Number(row.amount || 0),
      description: row.description || "",
      activityId: row.activityId || null,
      matchKind: "direct-reference"
    }));

  const amountAndRefundDateHits = walletRows
    .filter((row) => refundAmounts.includes(Math.abs(Number(row.amount || 0))) && refundDates.has(String(row.dateText || "")))
    .map((row) => ({
      dateText: row.dateText || null,
      time: row.time || null,
      amount: Number(row.amount || 0),
      description: row.description || "",
      activityId: row.activityId || null,
      matchKind: "amount-and-refund-date"
    }));

  return {
    directReferenceHits,
    amountAndRefundDateHits
  };
}

function writeCsv(rows, outputPath) {
  const headers = [
    "orderId",
    "createdAt",
    "name",
    "email",
    "rut",
    "orderStatus",
    "paymentIds",
    "mpStatus",
    "mpStatusDetail",
    "orderTotal",
    "jfcTotal",
    "mpRefundTotal",
    "invoiceClass",
    "invoiceFolio",
    "invoiceAmount",
    "tickets",
    "notes"
  ];
  const escape = (value) => {
    const stringValue = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
    return /[",\n;]/.test(stringValue) ? `"${stringValue.replace(/"/g, '""')}"` : stringValue;
  };
  fs.writeFileSync(outputPath, [headers.join(";"), ...rows.map((row) => headers.map((key) => escape(row[key])).join(";"))].join("\n"), "utf8");
}

async function main() {
  let stateResult = await readStateSafely();
  let state = stateResult.state;
  const invoicesByOrder = new Map((state.invoices || []).map((invoice) => [invoice.orderId, invoice]));
  const payments = state.payments || [];
  const tickets = state.tickets || [];
  const usersById = new Map((state.users || []).map((user) => [user.id, user]));

  let jfcOrders = (state.orders || [])
    .map((order) => {
      const jfcItems = orderJfcItems(order);
      return { order, jfcItems };
    })
    .filter((entry) => entry.jfcItems.length);

  if (!jfcOrders.length) {
    stateResult = await readProductionBackofficeState();
    state = stateResult.state;
    jfcOrders = (state.orders || [])
      .map((order) => {
        const jfcItems = orderJfcItems(order);
        return { order, jfcItems };
      })
      .filter((entry) => entry.jfcItems.length);
  }

  const auditRows = [];
  for (const { order, jfcItems } of jfcOrders) {
    const user = usersById.get(order.userId) || order.user || {};
    const invoice = invoicesByOrder.get(order.id) || order.invoice || null;
    const paymentIds = paymentIdsForOrder(order, payments);
    const mpPayments = [];

    for (const paymentId of paymentIds) {
      mpPayments.push(await getMercadoPagoPayment(paymentId));
    }

    const refundParts = mpPayments.map(paymentRefundInfo);
    const mpRefundTotal = sum(refundParts, (part) => part.refundTotal);
    const mpMain = mpPayments.find((payment) => !payment.__error) || mpPayments[0] || null;
    const orderTickets =
      Array.isArray(order.tickets) && order.tickets.length
        ? order.tickets
        : tickets.filter((ticket) => ticket.orderId === order.id);
    const orderTicketCount = orderTickets.filter(itemIsJfc).length;
    const jfcTotal = Math.round(sum(jfcItems, itemTotal));
    const fallbackTotal = jfcTotal || Math.round(Number(order.total || 0));
    const className = invoice ? (invoiceLooksDemo(invoice) ? "demo" : "real") : "none";
    const notes = [];

    if (!paymentIds.length) notes.push("sin paymentId numerico");
    if (mpPayments.some((payment) => payment.__error)) notes.push("MP no consultado para algun paymentId");
    if (mpRefundTotal && mpRefundTotal !== fallbackTotal) notes.push(`refund ${money(mpRefundTotal)} distinto a JFC ${money(fallbackTotal)}`);
    if (invoice && invoiceAmount(invoice, fallbackTotal) !== fallbackTotal) {
      notes.push(`DTE ${money(invoiceAmount(invoice, fallbackTotal))} distinto a JFC ${money(fallbackTotal)}`);
    }
    if (!invoice && order.status === "paid") notes.push("pagada sin DTE registrado");
    if (invoiceLooksDemo(invoice)) notes.push("DTE demo; no usar para NC tributaria real");

    auditRows.push({
      orderId: order.id,
      createdAt: order.createdAt || null,
      name: user.name || order.customerName || "",
      email: user.email || order.email || "",
      rut: user.rut || order.rut || "",
      orderStatus: order.status || "",
      savedPaymentStatuses: savedPaymentStatuses(order, payments),
      paymentIds,
      mpStatus: mpMain?.status || mpMain?.__error || "",
      mpStatusDetail: mpMain?.status_detail || "",
      orderTotal: Math.round(Number(order.total || fallbackTotal || 0)),
      jfcTotal: fallbackTotal,
      mpRefundTotal,
      mpRefunds: refundParts.flatMap((part) => part.refunds),
      invoiceClass: className,
      invoiceFolio: invoiceFolio(invoice),
      invoiceAmount: invoice ? invoiceAmount(invoice, fallbackTotal) : 0,
      tickets: orderTicketCount,
      notes: notes.join(" | ")
    });
  }

  const refundedRows = auditRows.filter((row) => row.mpRefundTotal > 0);
  const realInvoiceRows = refundedRows.filter((row) => row.invoiceClass === "real");
  const demoInvoiceRows = refundedRows.filter((row) => row.invoiceClass === "demo");
  const noInvoiceRows = refundedRows.filter((row) => row.invoiceClass === "none");
  const wallet = loadWalletMovements();
  const walletEvidence = walletEvidenceForRows(wallet.rows, auditRows);

  const report = {
    generatedAt: new Date().toISOString(),
    sources: {
      supabase: {
        mode: stateResult.source,
        sideEffects: stateResult.sideEffects || null,
        orders: state.orders?.length || 0,
        tickets: state.tickets?.length || 0,
        invoices: state.invoices?.length || 0,
        payments: state.payments?.length || 0
      },
      mercadoPagoApi: {
        queriedPaymentIds: unique(auditRows.flatMap((row) => row.paymentIds)).length
      },
      mercadoPagoWalletExport: {
        available: wallet.sourceAvailable,
        path: wallet.sourceAvailable ? WALLET_MOVEMENTS_PATH : null,
        extractedAt: wallet.extractedAt,
        source: wallet.source,
        rows: wallet.rows.length,
        directReferenceHits: walletEvidence.directReferenceHits.length,
        amountAndRefundDateHits: walletEvidence.amountAndRefundDateHits.length
      }
    },
    totals: {
      jfcOrders: auditRows.length,
      jfcTicketsFromOrders: sum(auditRows, (row) => row.tickets),
      jfcOrderGrossTotal: sum(auditRows, (row) => row.jfcTotal),
      mpRefundedOrders: refundedRows.length,
      mpRefundedTotal: sum(refundedRows, (row) => row.mpRefundTotal),
      realInvoiceRefundedOrders: realInvoiceRows.length,
      realInvoiceRefundedTotal: sum(realInvoiceRows, (row) => row.invoiceAmount),
      realInvoiceMpRefundedTotal: sum(realInvoiceRows, (row) => row.mpRefundTotal),
      demoInvoiceRefundedOrders: demoInvoiceRows.length,
      demoInvoiceRefundedTotal: sum(demoInvoiceRows, (row) => row.invoiceAmount),
      demoInvoiceMpRefundedTotal: sum(demoInvoiceRows, (row) => row.mpRefundTotal),
      noInvoiceRefundedOrders: noInvoiceRows.length,
      noInvoiceMpRefundedTotal: sum(noInvoiceRows, (row) => row.mpRefundTotal)
    },
    rows: auditRows,
    walletEvidence,
    notes: [
      "La nota de credito tributaria debe calcularse sobre boletas reales, no sobre DTE demo ni ventas sin boleta emitida.",
      "El export local de Mercado Pago usado como contraste corresponde a movimientos de wallet/actividades; si no aparecen IDs o nombres de checkout, se considera contraste parcial, no cartola bancaria final."
    ]
  };

  const outputJson = path.join(process.cwd(), ".codex-logs", "jfc-credit-note-audit.json");
  const outputCsv = path.join(process.cwd(), ".codex-logs", "jfc-credit-note-audit.csv");
  fs.writeFileSync(outputJson, JSON.stringify(report, null, 2), "utf8");
  writeCsv(auditRows, outputCsv);

  const summary = {
    generatedAt: report.generatedAt,
    totals: Object.fromEntries(Object.entries(report.totals).map(([key, value]) => [key, typeof value === "number" ? `${value} (${money(value)})` : value])),
    realInvoiceFolios: realInvoiceRows.map((row) => ({
      folio: row.invoiceFolio,
      orderId: row.orderId,
      name: row.name,
      invoiceAmount: money(row.invoiceAmount),
      mpRefundTotal: money(row.mpRefundTotal),
      mpStatus: row.mpStatus,
      paymentIds: row.paymentIds
    })),
    demoOrNoInvoice: [...demoInvoiceRows, ...noInvoiceRows].map((row) => ({
      class: row.invoiceClass,
      folio: row.invoiceFolio || null,
      orderId: row.orderId,
      name: row.name,
      mpRefundTotal: money(row.mpRefundTotal)
    })),
    walletExport: report.sources.mercadoPagoWalletExport,
    files: { outputJson, outputCsv }
  };

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
