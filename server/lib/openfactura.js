function cleanEnv(name) {
  return String(process.env[name] || "").trim();
}

function openFacturaConfigured() {
  return Boolean(
    cleanEnv("OPENFACTURA_ENDPOINT") &&
      (cleanEnv("OPENFACTURA_API_KEY") || cleanEnv("OPENFACTURA_SUBSCRIPTION_KEY"))
  );
}

function openFacturaRuntimeStatus() {
  return {
    configured: openFacturaConfigured(),
    endpointConfigured: Boolean(cleanEnv("OPENFACTURA_ENDPOINT")),
    apiKeyConfigured: Boolean(cleanEnv("OPENFACTURA_API_KEY") || cleanEnv("OPENFACTURA_SUBSCRIPTION_KEY")),
    companyRutConfigured: Boolean(cleanEnv("OPENFACTURA_COMPANY_RUT")),
    companyNameConfigured: Boolean(cleanEnv("OPENFACTURA_COMPANY_NAME")),
    companyGiroConfigured: Boolean(cleanEnv("OPENFACTURA_COMPANY_GIRO")),
    companyAddressConfigured: Boolean(cleanEnv("OPENFACTURA_COMPANY_ADDRESS")),
    companyEmailConfigured: Boolean(cleanEnv("OPENFACTURA_COMPANY_EMAIL"))
  };
}

function responseErrorDetail(payload) {
  const candidates = [
    payload?.message,
    payload?.error,
    payload?.errors,
    payload?.detail,
    payload?.details,
    payload?.title,
    payload?.mensaje,
    payload?.descripcion
  ].filter((value) => value !== undefined && value !== null && value !== "");
  const first = candidates[0] || payload;
  if (typeof first === "string") return first;
  try {
    return JSON.stringify(first);
  } catch {
    return "No se pudo emitir la boleta";
  }
}

function readPath(source, path) {
  return path.split(".").reduce((value, key) => {
    if (value === undefined || value === null) return undefined;
    return value[key];
  }, source);
}

function firstResponseValue(source, paths) {
  for (const path of paths) {
    const value = readPath(source, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function normalizeFolio(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "object") {
    return (
      firstResponseValue(value, ["folio", "Folio", "FOLIO", "number", "Numero", "NumeroDTE"]) ||
      JSON.stringify(value)
    );
  }
  return String(value);
}

function normalizePdfValue(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "object") {
    return firstResponseValue(value, ["url", "href", "pdfUrl", "urlPdf", "PDF", "base64"]) || null;
  }
  return String(value);
}

function normalizeHaulmerResult(result, orderId) {
  const folio = normalizeFolio(
    firstResponseValue(result, [
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
    ])
  );
  const pdfUrl = normalizePdfValue(
    firstResponseValue(result, [
      "pdfUrl",
      "urlPdf",
      "representationUrl",
      "PDF",
      "pdf",
      "document.pdfUrl",
      "response.PDF",
      "response.pdf",
      "data.PDF",
      "data.pdf"
    ])
  );
  const providerId =
    firstResponseValue(result, [
      "id",
      "documentId",
      "trackId",
      "track_id",
      "TRACKID",
      "codigo",
      "Codigo",
      "TED",
      "TIMBRE",
      "timbre",
      "data.id",
      "data.trackId",
      "response.TRACKID"
    ]) || (folio ? `HAULMER-${folio}` : orderId);

  return {
    providerId: String(providerId),
    folio,
    pdfUrl
  };
}

function buildOpenFacturaPayload({ order, user, event, ticketType, tickets, items = [] }) {
  const detailItems = items.length
    ? items
    : [
        {
          ticketTypeName: ticketType.name,
          eventName: event.name,
          description: ticketType.description,
          quantity: order.quantity,
          unitPrice: ticketType.price,
          total: order.total
        }
      ];
  const tipoDte = Number(cleanEnv("OPENFACTURA_DTE_TYPE") || 39);
  const fechaEmision = new Date().toISOString().slice(0, 10);
  const rutEmisor = cleanEnv("OPENFACTURA_COMPANY_RUT").replace(/[.\s]/g, "");
  const razonSocial = (cleanEnv("OPENFACTURA_COMPANY_NAME") || "Honda Fest Chile").toUpperCase();
  const giroEmisor = (
    cleanEnv("OPENFACTURA_COMPANY_GIRO") || "SERVICIOS DE PRODUCCION DE OBRAS DE TEATRO"
  ).toUpperCase();
  const direccionEmisor = cleanEnv("OPENFACTURA_COMPANY_ADDRESS") || "";
  const comunaEmisor = cleanEnv("OPENFACTURA_COMPANY_COMUNA") || "";
  const ciudadEmisor = cleanEnv("OPENFACTURA_COMPANY_CITY") || comunaEmisor;
  const codigoSucursal = Number(cleanEnv("OPENFACTURA_COMPANY_BRANCH_CODE") || 90061542);
  const rutReceptor = String(user.rut || "66666666-6").replace(/[.\s]/g, "");
  const razonSocialReceptor = user.name || "Consumidor final";
  const detalle = detailItems.map((item, index) => ({
    NroLinDet: index + 1,
    NmbItem: `${item.ticketTypeName} - ${item.eventName}`,
    QtyItem: item.quantity,
    PrcItem: item.unitPrice,
    MontoItem: item.total
  }));
  const total = detalle.reduce((sum, item) => sum + Number(item.MontoItem || 0), 0);
  const neto = Math.round(total / 1.19);
  const iva = total - neto;

  const dte = {
    Encabezado: {
      IdDoc: {
        TipoDTE: tipoDte,
        Folio: 0,
        FchEmis: fechaEmision,
        IndServicio: 3
      },
      Emisor: {
        RUTEmisor: rutEmisor,
        RznSocEmisor: razonSocial,
        GiroEmisor: giroEmisor,
        CdgSIISucur: codigoSucursal,
        DirOrigen: direccionEmisor,
        CmnaOrigen: comunaEmisor,
        CiudadOrigen: ciudadEmisor
      },
      Receptor: {
        RUTRecep: rutReceptor,
        RznSocRecep: razonSocialReceptor,
        DirRecep: user.address || direccionEmisor,
        CmnaRecep: user.city || user.comuna || comunaEmisor
      },
      Totales: {
        MntNeto: neto,
        IVA: iva,
        MntTotal: total
      }
    },
    Detalle: detalle
  };

  return {
    response: ["XML", "PDF", "TIMBRE", "LOGO", "FOLIO", "RESOLUCION", tipoDte === 33 ? "LETTER" : "80MM"],
    dte,
    referenciaExterna: order.id
  };
}

async function issueBoleta({ order, user, event, ticketType, tickets, items }) {
  const payload = buildOpenFacturaPayload({ order, user, event, ticketType, tickets, items });

  if (!openFacturaConfigured()) {
    return {
      id: `dte_demo_${order.id}`,
      orderId: order.id,
      mode: "demo",
      provider: "openfactura",
      providerId: `OF-DEMO-${order.id}`,
      folio: `DEMO-${Date.now()}`,
      pdfUrl: null,
      payload,
      createdAt: new Date().toISOString()
    };
  }

  if (!cleanEnv("OPENFACTURA_COMPANY_RUT")) {
    throw new Error("OpenFactura: falta OPENFACTURA_COMPANY_RUT para informar RUTEmisor");
  }

  const apiKey = cleanEnv("OPENFACTURA_API_KEY") || cleanEnv("OPENFACTURA_SUBSCRIPTION_KEY");
  const bearerToken = cleanEnv("OPENFACTURA_BEARER_TOKEN") || cleanEnv("OPENFACTURA_ACCESS_TOKEN");
  const headers = {
    "Content-Type": "application/json",
    apikey: apiKey
  };
  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  } else if (/^bearer$/i.test(cleanEnv("OPENFACTURA_AUTH_SCHEME"))) {
    headers.Authorization = `Bearer ${cleanEnv("OPENFACTURA_API_KEY")}`;
  }

  const response = await fetch(cleanEnv("OPENFACTURA_ENDPOINT"), {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = responseErrorDetail(result);
    throw new Error(`OpenFactura: ${detail}`);
  }
  const normalizedResult = normalizeHaulmerResult(result, order.id);

  return {
    id: `dte_${order.id}`,
    orderId: order.id,
    mode: "openfactura",
    provider: "openfactura",
    providerId: normalizedResult.providerId,
    folio: normalizedResult.folio,
    pdfUrl: normalizedResult.pdfUrl,
    raw: result,
    createdAt: new Date().toISOString()
  };
}

module.exports = {
  buildOpenFacturaPayload,
  issueBoleta,
  openFacturaConfigured,
  openFacturaRuntimeStatus
};
