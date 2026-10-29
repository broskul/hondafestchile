const dotenv = require("dotenv");

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Falta ${name}`);
  return value;
}

async function main() {
  const baseUrl = requiredEnv("PUBLIC_BASE_URL").replace(/\/$/, "");
  const accessToken = String(process.env.BACKOFFICE_TOKEN || process.env.BACKOFFICE_PASSWORD || "").trim();
  if (!accessToken) throw new Error("Falta BACKOFFICE_TOKEN o BACKOFFICE_PASSWORD");
  const apply = process.argv.includes("--apply");
  const response = await fetch(`${baseUrl}/api/backoffice/hfc-event-dates`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-token": accessToken },
    body: JSON.stringify({ apply })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.message || `HTTP ${response.status}`);
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
