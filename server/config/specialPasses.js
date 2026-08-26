const SPECIAL_PASS_SETTING_ID = "special_pass_config";

const DEFAULT_SPECIAL_PASS_CONFIG = {
  id: SPECIAL_PASS_SETTING_ID,
  active: true,
  campaignId: "hfc-2026-special-pass",
  eventId: "honda-fest-chile-2026",
  name: "Pase HFC 2026",
  shortName: "Pase",
  eventName: "Honda Fest Chile 2026",
  eventDate: "2026-11-29",
  eventDateLabel: "29 de noviembre de 2026",
  physicalFormat: "Lanyard con credencial impresa",
  notEntryLabel: "NO ES VÁLIDO COMO ENTRADA",
  purchaseNotice:
    "Puedes comprarlo sin una entrada asociada. Para ingresar al evento debes contar además con una entrada válida; es responsabilidad del comprador.",
  pickup: {
    eventDay: "Retiro disponible el día del evento presentando el QR y la identificación del titular.",
    preEvent: "Punto de retiro previo al evento: por confirmar."
  },
  commonBenefits: [
    "Lanyard y credencial impresa de Pase",
    "Acceso a experiencias especiales el día del evento",
    "Un refresco extra durante la jornada",
    "Pistones registrados para el sorteo del Honda y otros premios, sujeto a bases",
    "Mientras más Pistones, más posibilidades tienes de ganar"
  ],
  levels: [
    { id: "piston-1", pistons: 1, name: "Pase de 1 Pistón", price: 5000, accent: "steel" },
    { id: "piston-3", pistons: 3, name: "Pase de 3 Pistones", price: 10000, accent: "bronze" },
    { id: "piston-5", pistons: 5, name: "Pase de 5 Pistones", price: 15000, accent: "red", featured: true },
    { id: "piston-7", pistons: 7, name: "Pase de 7 Pistones", price: 20000, accent: "graphite" },
    { id: "piston-9", pistons: 9, name: "Pase de 9 Pistones", price: 25000, accent: "gold" }
  ]
};

function cleanText(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function normalizeLevel(level = {}, fallback = {}, index = 0) {
  const pistons = Math.max(1, Math.min(99, Math.floor(Number(level.pistons ?? fallback.pistons ?? 1))));
  const price = Math.max(0, Math.round(Number(level.price ?? fallback.price ?? 0)));
  return {
    id: cleanText(level.id, fallback.id || `piston-${pistons}-${index + 1}`),
    pistons,
    name: cleanText(level.name, fallback.name || `Pase de ${pistons} ${pistons === 1 ? "Pistón" : "Pistones"}`),
    price,
    accent: cleanText(level.accent, fallback.accent || "steel"),
    featured: Boolean(level.featured ?? fallback.featured),
    active: level.active !== false
  };
}

function normalizeSpecialPassConfig(config = {}) {
  const fallback = DEFAULT_SPECIAL_PASS_CONFIG;
  const sourceLevels = Array.isArray(config.levels) && config.levels.length ? config.levels : fallback.levels;
  const fallbackById = new Map(fallback.levels.map((level) => [level.id, level]));
  return {
    ...fallback,
    ...config,
    id: SPECIAL_PASS_SETTING_ID,
    active: config.active !== false,
    campaignId: cleanText(config.campaignId, fallback.campaignId),
    eventId: cleanText(config.eventId, fallback.eventId),
    name: cleanText(config.name, fallback.name),
    shortName: cleanText(config.shortName, fallback.shortName),
    eventName: cleanText(config.eventName, fallback.eventName),
    eventDate: cleanText(config.eventDate, fallback.eventDate),
    eventDateLabel: cleanText(config.eventDateLabel, fallback.eventDateLabel),
    physicalFormat: cleanText(config.physicalFormat, fallback.physicalFormat),
    notEntryLabel: cleanText(config.notEntryLabel, fallback.notEntryLabel),
    purchaseNotice: cleanText(config.purchaseNotice, fallback.purchaseNotice),
    pickup: {
      eventDay: cleanText(config.pickup?.eventDay, fallback.pickup.eventDay),
      preEvent: cleanText(config.pickup?.preEvent, fallback.pickup.preEvent)
    },
    commonBenefits: (Array.isArray(config.commonBenefits) ? config.commonBenefits : fallback.commonBenefits)
      .map((benefit) => cleanText(benefit))
      .filter(Boolean),
    levels: sourceLevels
      .map((level, index) => normalizeLevel(level, fallbackById.get(level.id) || fallback.levels[index] || {}, index))
      .filter((level) => level.active)
      .sort((left, right) => left.pistons - right.pistons)
  };
}

function specialPassConfigFromState(state) {
  const setting = (state?.settings || []).find(
    (candidate) => candidate.id === SPECIAL_PASS_SETTING_ID || candidate.type === "special_pass"
  );
  return normalizeSpecialPassConfig(setting?.payload || {});
}

function findSpecialPassLevel(config, levelId) {
  return (config?.levels || []).find((level) => level.id === String(levelId || "").trim()) || null;
}

module.exports = {
  DEFAULT_SPECIAL_PASS_CONFIG,
  SPECIAL_PASS_SETTING_ID,
  findSpecialPassLevel,
  normalizeSpecialPassConfig,
  specialPassConfigFromState
};
