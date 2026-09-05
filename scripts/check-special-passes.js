const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hfc-special-pass-check-"));
process.env.HFC_SKIP_LOCAL_ENV = "1";
process.env.JSON_STORE_DIR = tempDir;
process.env.BACKOFFICE_TOKEN = "qa-special-pass-token";
process.env.PROFILE_PENDING_REMINDER_HOURS = "9999";
process.env.SPECIAL_PASS_SALES_ENABLED = "true";
process.env.HFC_ALLOW_DEMO_PAYMENT = "true";
process.env.HFC_ALLOW_DEMO_EMAIL = "true";

const app = require("../server/index");
const {
  SPECIAL_PASS_PRIVACY_SHA256,
  SPECIAL_PASS_RULES_SHA256
} = require("../server/config/specialPasses");

async function request(base, pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(data?.message || String(data));
    error.status = response.status;
    throw error;
  }
  return { response, data };
}

async function main() {
  const actualRulesHash = require("node:crypto")
    .createHash("sha256")
    .update(fs.readFileSync(path.join(process.cwd(), "public", "bases-sorteo.html")))
    .digest("hex");
  assert.equal(actualRulesHash, SPECIAL_PASS_RULES_SHA256, "Actualiza el hash de las bases al cambiar el documento");
  const actualPrivacyHash = require("node:crypto")
    .createHash("sha256")
    .update(fs.readFileSync(path.join(process.cwd(), "public", "terminos-datos-personales.html")))
    .digest("hex");
  assert.equal(
    actualPrivacyHash,
    SPECIAL_PASS_PRIVACY_SHA256,
    "Actualiza el hash de privacidad al cambiar el documento"
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  process.env.PUBLIC_BASE_URL = base;

  try {
    const initialCatalog = (await request(base, "/api/special-passes/catalog")).data.specialPass;
    assert.equal(initialCatalog.active, false, "El Upgrade debe iniciar bloqueado aunque exista almacenamiento");
    await request(base, "/api/backoffice/special-passes/config", {
      method: "PUT",
      headers: { "x-admin-token": process.env.BACKOFFICE_TOKEN },
      body: JSON.stringify({
        activationConfirmed: true,
        specialPass: {
          active: true,
          rulesPublished: true,
          rulesVersion: "upgrade-hfc-2026-v1"
        }
      })
    });
    const catalog = (await request(base, "/api/special-passes/catalog")).data.specialPass;
    assert.equal(catalog.active, true);
    assert.equal(catalog.notEntryLabel, "NO ES VÁLIDO COMO ENTRADA");
    assert.deepEqual(catalog.levels.map((level) => level.pistons), [1, 3, 5, 7, 9]);

    const created = (
      await request(base, "/api/special-passes/orders", {
        method: "POST",
        body: JSON.stringify({
          levelId: "piston-5",
          name: "QA Pase HFC",
          rut: "12.345.678-5",
          email: "qa.pase@example.com",
          phone: "+56 9 5555 1234",
          termsAccepted: true,
          rulesAccepted: true,
          rulesVersion: "upgrade-hfc-2026-v1",
          notEntryAccepted: true
        })
      })
    ).data;
    assert.equal(created.order.kind, "special_pass");
    assert.equal(created.order.pistonCount, 5);
    assert.equal(created.order.total, 15000);
    assert.ok(created.order.notEntryAcceptedAt);
    assert.ok(created.order.specialPassRulesAcceptedAt);
    assert.equal(created.order.specialPassRulesVersion, "upgrade-hfc-2026-v1");
    assert.ok(created.order.specialPassPrivacyAcceptedAt);
    const accountHeaders = { Authorization: `Bearer ${created.accountToken}` };

    await assert.rejects(
      request(base, "/api/special-passes/orders", {
        method: "POST",
        body: JSON.stringify({
          levelId: "piston-1",
          name: "Intento de apropiación",
          rut: "12.345.678-5",
          email: "atacante@example.com",
          phone: "+56 9 1111 2222",
          termsAccepted: true,
          rulesAccepted: true,
          rulesVersion: "upgrade-hfc-2026-v1",
          notEntryAccepted: true
        })
      }),
      (error) => error.status === 409
    );

    await assert.rejects(
      request(base, `/api/orders/${encodeURIComponent(created.order.id)}`),
      (error) => error.status === 401
    );
    const securedOrder = (
      await request(base, `/api/orders/${encodeURIComponent(created.order.id)}`, { headers: accountHeaders })
    ).data;
    assert.equal(securedOrder.user.rut, "12.345.678-5");
    assert.equal(securedOrder.user.email, "qa.pase@example.com");
    assert.equal(securedOrder.user.name, "QA Pase HFC");

    const paid = (
      await request(base, `/api/orders/${encodeURIComponent(created.order.id)}/simulate-payment`, {
        method: "POST",
        headers: accountHeaders,
        body: "{}"
      })
    ).data;
    assert.equal(paid.order.status, "paid");
    assert.equal(paid.order.profileRequired, false);
    assert.equal(paid.tickets.length, 0);
    assert.equal(paid.specialPasses.length, 1);
    assert.equal(paid.specialPasses[0].pistonCount, 5);
    assert.equal(paid.specialPasses[0].drawEntryCodes.length, 5);
    const code = paid.specialPasses[0].code;
    const persistedAfterIssue = JSON.parse(fs.readFileSync(path.join(tempDir, "app-state.json"), "utf8"));
    const persistedPass = persistedAfterIssue.specialPasses.find((pass) => pass.code === code);
    assert.equal(persistedPass.pistons.length, 5);
    assert.ok(persistedPass.pistons.every((piston) => piston.holderRutNormalized === "123456785"));
    assert.ok(persistedPass.pistons.every((piston) => piston.automobileEligible === true));
    assert.ok(persistedPass.pistons.every((piston) => piston.onsiteEligible === false));
    assert.ok(persistedPass.privacyAcceptedAt);
    assert.equal(persistedPass.privacyTermsHash, SPECIAL_PASS_PRIVACY_SHA256);

    const lookup = (
      await request(base, "/api/special-passes/validate", {
        method: "POST",
        body: JSON.stringify({ code, action: "lookup" })
      })
    ).data;
    assert.equal(lookup.pass.pickupStatus, "pending");
    assert.equal(lookup.pass.accessStatus, "not_checked_in");
    assert.equal(lookup.pass.drawEntryCodes, undefined);
    assert.equal(lookup.pass.entryValidationStatus, undefined);
    assert.notEqual(lookup.pass.holderName, "QA Pase HFC");

    await assert.rejects(
      request(base, "/api/special-passes/validate", {
        method: "POST",
        body: JSON.stringify({ code, action: "pickup" })
      }),
      (error) => error.status === 401
    );

    const operatorHeaders = { "x-admin-token": process.env.BACKOFFICE_TOKEN };
    const pickedUp = (
      await request(base, "/api/special-passes/validate", {
        method: "POST",
        headers: operatorHeaders,
        body: JSON.stringify({ code, action: "pickup" })
      })
    ).data;
    assert.equal(pickedUp.changed, true);
    assert.equal(pickedUp.pass.pickupStatus, "picked_up");

    const entryVerified = (
      await request(base, "/api/special-passes/validate", {
        method: "POST",
        headers: operatorHeaders,
        body: JSON.stringify({ code, action: "verify_entry" })
      })
    ).data;
    assert.equal(entryVerified.pass.entryValidationStatus, "valid");

    const checkedIn = (
      await request(base, "/api/special-passes/validate", {
        method: "POST",
        headers: operatorHeaders,
        body: JSON.stringify({ code, action: "checkin" })
      })
    ).data;
    assert.equal(checkedIn.pass.accessStatus, "checked_in");
    const persistedAfterCheckin = JSON.parse(fs.readFileSync(path.join(tempDir, "app-state.json"), "utf8"));
    const checkedInPass = persistedAfterCheckin.specialPasses.find((pass) => pass.code === code);
    assert.equal(checkedInPass.attendanceStatus, "present");
    assert.ok(checkedInPass.pistons.every((piston) => piston.onsiteEligible === true));

    await assert.rejects(
      request(
        base,
        "/api/users/purchases?email=qa.pase%40example.com&rut=12.345.678-5&phone=%2B56955551234"
      ),
      (error) => error.status === 401
    );
    const accessRequest = (
      await request(base, "/api/account/access", {
        method: "POST",
        body: JSON.stringify({ rut: "12.345.678-5", contact: "qa.pase@example.com" })
      })
    ).data;
    assert.equal(accessRequest.token, undefined, "El token de cuenta nunca debe devolverse al pedir acceso");
    const persistedAfterAccessRequest = JSON.parse(fs.readFileSync(path.join(tempDir, "app-state.json"), "utf8"));
    const emailedSession = persistedAfterAccessRequest.sessions
      .filter((session) => session.type === "account" && session.userId === created.user.id)
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0];
    assert.ok(emailedSession?.token);
    const purchasesWithEmailedToken = (
      await request(base, "/api/users/purchases", {
        headers: { Authorization: `Bearer ${emailedSession.token}` }
      })
    ).data;
    assert.equal(purchasesWithEmailedToken.user.rut, "12.345.678-5");
    assert.ok(purchasesWithEmailedToken.orders.some((order) => order.id === created.order.id));

    const repeated = (
      await request(base, "/api/special-passes/validate", {
        method: "POST",
        headers: operatorHeaders,
        body: JSON.stringify({ code, action: "checkin" })
      })
    ).data;
    assert.equal(repeated.changed, false);

    const summary = (
      await request(base, "/api/backoffice/summary", { headers: operatorHeaders })
    ).data;
    assert.equal(summary.summary.specialPasses, 1);
    assert.equal(summary.summary.pistonsIssued, 5);
    assert.equal(summary.summary.pickedUpSpecialPasses, 1);
    assert.equal(summary.summary.checkedInSpecialPasses, 1);

    const csv = (
      await request(base, "/api/backoffice/special-passes/export.csv", { headers: operatorHeaders })
    ).data;
    assert.match(csv, /codigo_piston/);
    assert.equal(csv.split(/\r?\n/).length, 6);

    console.log("Pases Especiales: flujo de compra, enrolamiento, emisión, retiro, acceso y exportación verificado.");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    const resolvedTemp = path.resolve(tempDir);
    if (resolvedTemp.startsWith(path.resolve(os.tmpdir())) && path.basename(resolvedTemp).startsWith("hfc-special-pass-check-")) {
      fs.rmSync(resolvedTemp, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
