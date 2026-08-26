const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hfc-special-pass-check-"));
process.env.HFC_SKIP_LOCAL_ENV = "1";
process.env.JSON_STORE_DIR = tempDir;
process.env.BACKOFFICE_TOKEN = "qa-special-pass-token";
process.env.PROFILE_PENDING_REMINDER_HOURS = "9999";

const app = require("../server/index");

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
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  process.env.PUBLIC_BASE_URL = base;

  try {
    const catalog = (await request(base, "/api/special-passes/catalog")).data.specialPass;
    assert.equal(catalog.notEntryLabel, "NO ES VÁLIDO COMO ENTRADA");
    assert.deepEqual(catalog.levels.map((level) => level.pistons), [1, 3, 5, 7, 9]);

    const created = (
      await request(base, "/api/special-passes/orders", {
        method: "POST",
        body: JSON.stringify({
          levelId: "piston-5",
          email: "qa.pase@example.com",
          phone: "+56 9 5555 1234",
          termsAccepted: true,
          notEntryAccepted: true
        })
      })
    ).data;
    assert.equal(created.order.kind, "special_pass");
    assert.equal(created.order.pistonCount, 5);
    assert.equal(created.order.total, 15000);
    assert.ok(created.order.notEntryAcceptedAt);

    const paid = (
      await request(base, `/api/orders/${encodeURIComponent(created.order.id)}/simulate-payment`, {
        method: "POST",
        body: "{}"
      })
    ).data;
    assert.equal(paid.order.status, "paid");
    assert.equal(paid.order.profileRequired, true);
    assert.ok(paid.enrollmentUrl);
    const token = new URL(paid.enrollmentUrl).searchParams.get("token");
    assert.ok(token);

    const enrollment = (await request(base, `/api/enrollment/${encodeURIComponent(token)}`)).data;
    assert.equal(enrollment.order.kind, "special_pass");
    assert.equal(enrollment.specialPasses.length, 0);

    const enrolled = (
      await request(base, `/api/enrollment/orders/${encodeURIComponent(created.order.id)}/profile`, {
        method: "POST",
        body: JSON.stringify({
          enrollmentToken: token,
          email: "qa.pase@example.com",
          name: "QA Pase HFC",
          rut: "12.345.678-5",
          phone: "+56 9 5555 1234"
        })
      })
    ).data;
    assert.equal(enrolled.tickets.length, 0);
    assert.equal(enrolled.specialPasses.length, 1);
    assert.equal(enrolled.specialPasses[0].pistonCount, 5);
    assert.equal(enrolled.specialPasses[0].drawEntryCodes.length, 5);
    const code = enrolled.specialPasses[0].code;

    const lookup = (
      await request(base, "/api/special-passes/validate", {
        method: "POST",
        body: JSON.stringify({ code, action: "lookup" })
      })
    ).data;
    assert.equal(lookup.pass.pickupStatus, "pending");
    assert.equal(lookup.pass.accessStatus, "not_checked_in");
    assert.equal(lookup.pass.drawEntryCodes, undefined);

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

    const checkedIn = (
      await request(base, "/api/special-passes/validate", {
        method: "POST",
        headers: operatorHeaders,
        body: JSON.stringify({ code, action: "checkin" })
      })
    ).data;
    assert.equal(checkedIn.pass.accessStatus, "checked_in");

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
