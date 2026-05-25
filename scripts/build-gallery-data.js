const fs = require("fs");
const path = require("path");

const sourcePath = path.join(process.cwd(), "HFC_R2_upload_ready", "_manifest.json");
const outputPath = path.join(process.cwd(), "public", "gallery-data.json");

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function galleryItem(row) {
  return {
    id: slugify(row.r2_key),
    index: row.index,
    r2Key: row.r2_key,
    category: row.category || "Sin categoria",
    categorySlug: slugify(row.category || "Sin categoria"),
    collection: row.collection || "",
    mediaType: row.media_type || "image",
    title: row.title || row.original_name || row.r2_key,
    description: row.description || "",
    keywords: row.keywords || "",
    originalName: row.original_name || "",
    width: row.width || null,
    height: row.height || null,
    orientation: row.orientation || "",
    capturedAt: row.captured_at || "",
    modifiedAt: row.modified_at || ""
  };
}

const manifest = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const items = manifest.filter((row) => row.media_type === "image").map(galleryItem);
const categoryMap = new Map();

for (const item of items) {
  const category = categoryMap.get(item.category) || {
    name: item.category,
    slug: item.categorySlug,
    count: 0
  };
  category.count += 1;
  categoryMap.set(item.category, category);
}

const categoryPriority = [
  "Autos en pista",
  "Exhibicion y paddock",
  "Premiacion",
  "Publico y comunidad",
  "Acceso y ambiente",
  "Marca y detalles",
  "Motos y movilidad",
  "Presentacion y animacion",
  "Stands y activaciones",
  "Charlas y reuniones",
  "Servicios y seguridad"
];

const categories = Array.from(categoryMap.values()).sort((a, b) => {
  const priorityA = categoryPriority.indexOf(a.name);
  const priorityB = categoryPriority.indexOf(b.name);
  if (priorityA !== -1 || priorityB !== -1) {
    return (priorityA === -1 ? 999 : priorityA) - (priorityB === -1 ? 999 : priorityB);
  }
  return a.name.localeCompare(b.name, "es");
});

const payload = {
  generatedAt: new Date().toISOString(),
  source: "HFC_R2_upload_ready/_manifest.json",
  totalImages: items.length,
  categories,
  items
};

fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Gallery data written: ${outputPath}`);
console.log(`Images: ${items.length}`);
console.log(`Categories: ${categories.length}`);
