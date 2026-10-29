const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const remote = process.env.HFC_STOREFRONT_BASE_URL;
const serve = process.argv.includes("--serve");
const originalFetch = global.fetch;

async function request(base, route, options = {}) {
  const response = await originalFetch(`${base}${route}`, { ...options, signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, `${route}: HTTP ${response.status}`);
  return response;
}

async function verify(base) {
  const passPage = await (await request(base, "/pases-especiales")).text();
  assert.match(passPage, /id="passLevelGrid"/);
  assert.match(passPage, /id="specialPassCheckoutForm"/);
  const response = await request(base, "/api/special-passes/catalog");
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  const catalog = (await response.json()).specialPass;
  assert.deepEqual(catalog.levels.map((level) => level.pistons), [1, 3, 5, 7, 9]);
  for (const route of ["/", "/ticketera", "/carrito", "/mi-pit-lane", "/mis-compras", "/pases-especiales"]) {
    const html = await (await request(base, route)).text();
    assert.match(html, /src="\/test-mode\.js"/, `${route} necesita la carga compartida`);
  }
  const loader = await (await request(base, "/test-mode.js")).text();
  assert.match(loader, /loadPistonStorefront\(\)/);
  const scriptResponse = await request(base, "/piston-storefront.js");
  assert.match(scriptResponse.headers.get("content-type") || "", /javascript/);
  const script = await scriptResponse.text();
  new vm.Script(script);
  assert.match(script, /\/pases-especiales#niveles/);
  assert.doesNotMatch(script, /https:\/\/wa\.me/);
  assert.match(await (await request(base, "/piston-storefront.css")).text(), /hfc-piston-float/);
  console.log("PASS: tienda real, catalogo JSON con cinco niveles y accesos compartidos a compra de Pistones.");
}

async function main() {
  if (remote) {
    assert(!serve, "No usar --serve con un destino remoto");
    await verify(remote.replace(/\/$/, ""));
    return;
  }
  process.env.HFC_SKIP_LOCAL_ENV = "1";
  for (const key of Object.keys(process.env)) {
    if (/^(?:SUPABASE|NEXT_PUBLIC_SUPABASE|DATABASE|POSTGRES|PG|MERCADOPAGO|MS_GRAPH|SMTP|OPENFACTURA|HAULMER|VERCEL|BACKOFFICE)/.test(key)) delete process.env[key];
  }
  process.env.NODE_ENV = "test";
  process.env.JSON_STORE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hfc-piston-storefront-"));
  process.env.BACKOFFICE_TOKEN = "qa-local-storefront-only";
  process.env.SPECIAL_PASS_SALES_ENABLED = "true";
  process.env.HFC_ALLOW_DEMO_PAYMENT = "true";
  process.env.HFC_ALLOW_DEMO_EMAIL = "true";
  global.fetch = (input, options) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    assert.equal(url.hostname, "127.0.0.1", "La prueba no puede llamar servicios externos");
    return originalFetch(input, options);
  };
  const express = require("express");
  const app = express();
  app.get("/qa/piston-legacy", (_req, res) => res.type("html").send(`<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><script defer src="/test-mode.js"></script></head><body><header class="site-header"><nav class="main-nav"><a href="/ticketera">Entradas</a></nav></header><main><section class="page-hero"><h1>Recorrido anterior</h1><a href="https://wa.me/56972934950" target="_blank">Quiero mejorar mi experiencia</a><a href="https://wa.me/56972934950" data-qa-help>Ayuda con mi compra</a></section></main><footer class="site-footer"></footer></body></html>`));
  app.use(require("../server/index"));
  const server = app.listen(serve ? 3229 : 0, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.PUBLIC_BASE_URL = base;
  try {
    await verify(base);
    if (serve) {
      await request(base, "/api/backoffice/special-passes/config", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-admin-token": process.env.BACKOFFICE_TOKEN },
        body: JSON.stringify({ activationConfirmed: true, specialPass: { active: true, rulesPublished: true, rulesVersion: "upgrade-hfc-2026-v1" } })
      });
      console.log(`Visual QA: ${base}/ticketera | almacen temporal, sin servicios externos`);
      return;
    }
  } finally {
    if (!serve) await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error.message); process.exit(1); });
