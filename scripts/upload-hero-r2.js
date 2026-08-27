const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const sourceRoot = path.resolve(
  process.argv[2] || process.env.HFC_HERO_SOURCE || path.join(os.homedir(), "Downloads", "HFC", "HeroWeb")
);
const remoteRoot = "hfc-web/HeroWeb";
const immutableCache = "public, max-age=31536000, immutable";
const uploadConcurrency = 6;

const endpoint = String(process.env.CLOUDFLARE_S3_DEFAULT || process.env.CLOUDFLARE_S3_API || "").replace(/\/$/, "");
const bucket = process.env.cloudflare_s3_bucket || process.env.CLOUDFLARE_R2_BUCKET || process.env.R2_BUCKET_NAME;
const accessKeyId = process.env.CLOUDFLARE_S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.CLOUDFLARE_S3_SECRET_ACCESS_KEY;

function requireConfiguration() {
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("Faltan las credenciales o el bucket R2 requeridos para publicar el hero");
  }
  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`No existe el paquete del hero: ${sourceRoot}`);
  }
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmac(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest(encoding);
}

function signingKey(dateStamp) {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, "auto");
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

function encodeKey(key) {
  return key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function signedRequest(method, key, payloadHash) {
  const url = new URL(`${endpoint}/${encodeURIComponent(bucket)}/${encodeKey(key)}`);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const headers = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate
  };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((name) => `${name}:${headers[name]}\n`)
    .join("");
  const canonicalRequest = [method, url.pathname, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256(canonicalRequest)
  ].join("\n");
  const signature = crypto.createHmac("sha256", signingKey(dateStamp)).update(stringToSign, "utf8").digest("hex");

  return {
    url,
    headers: {
      ...headers,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    }
  };
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".avif") return "image/avif";
  if (extension === ".webp") return "image/webp";
  if (extension === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(absolute);
    return entry.isFile() && entry.name !== ".DS_Store" ? [absolute] : [];
  });
}

function sourceFiles() {
  const targets = [
    path.join(sourceRoot, "manifest.json"),
    path.join(sourceRoot, "posters"),
    path.join(sourceRoot, "frames", "1280-avif"),
    path.join(sourceRoot, "frames", "1920-webp"),
    path.join(sourceRoot, "frames", "2560-avif")
  ];

  return targets.flatMap((target) => {
    if (!fs.existsSync(target)) throw new Error(`Falta un recurso requerido del hero: ${target}`);
    return fs.statSync(target).isDirectory() ? walk(target) : [target];
  });
}

function remoteKey(filePath) {
  const relative = path.relative(sourceRoot, filePath).split(path.sep).join("/");
  if (!/^(manifest\.json|posters\/hfc-hero-poster-(1920|2560)\.(avif|webp)|frames\/(1280-avif|1920-webp|2560-avif)\/hfc-hero-frame-\d{2}\.(avif|webp))$/.test(relative)) {
    throw new Error(`Ruta del paquete no reconocida: ${relative}`);
  }
  return `${remoteRoot}/${relative}`;
}

async function upload(filePath) {
  const body = fs.readFileSync(filePath);
  const digest = sha256(body);
  const key = remoteKey(filePath);
  const signed = signedRequest("PUT", key, digest);
  const response = await fetch(signed.url, {
    method: "PUT",
    headers: {
      ...signed.headers,
      "Cache-Control": immutableCache,
      "Content-Type": contentType(filePath)
    },
    body
  });

  if (!response.ok) {
    const details = (await response.text()).slice(0, 300);
    throw new Error(`R2 rechazo ${key}: HTTP ${response.status} ${details}`);
  }

  return { filePath, key, bytes: body.length, digest };
}

async function verify(asset) {
  const emptyHash = sha256("");
  const signed = signedRequest("GET", asset.key, emptyHash);
  const response = await fetch(signed.url, { headers: signed.headers });
  if (!response.ok) throw new Error(`No se pudo verificar ${asset.key}: HTTP ${response.status}`);

  const remote = Buffer.from(await response.arrayBuffer());
  const remoteDigest = sha256(remote);
  if (remote.length !== asset.bytes || remoteDigest !== asset.digest) {
    throw new Error(`La verificacion de integridad fallo para ${asset.key}`);
  }
}

async function mapConcurrent(items, limit, action) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await action(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main() {
  requireConfiguration();
  const files = sourceFiles();
  const uploaded = await mapConcurrent(files, uploadConcurrency, upload);
  await mapConcurrent(uploaded, uploadConcurrency, verify);
  const totalBytes = uploaded.reduce((total, item) => total + item.bytes, 0);
  console.log(`Hero R2 verificado: ${uploaded.length} objetos, ${totalBytes} bytes, prefijo ${remoteRoot}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
