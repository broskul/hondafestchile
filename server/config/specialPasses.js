const SPECIAL_PASS_SETTING_ID = "special_pass_config";

const DEFAULT_SPECIAL_PASS_CONFIG = {
  id: SPECIAL_PASS_SETTING_ID,
  active: true,
  campaignId: "hfc-2026-special-pass",
  eventId: "honda-fest-chile-2026",
  name: "Pases de Pistones HFC 2026",
  shortName: "Pase de Pistones",
  eventName: "Honda Fest Chile 2026",
  eventDate: "2026-11-28",
  eventDateLabel: "28 y 29 de noviembre de 2026",
  physicalFormat: "Lanyard con credencial impresa",
  notEntryLabel: "UPGRADE: REQUIERE UNA ENTRADA HFC 2026",
  purchaseNotice:
    "Cada entrada HFC 2026 incluye 1 Pistón. Los Pases agregan Pistones y prestaciones a una entrada válida; no reemplazan el acceso al evento.",
  pickup: {
    eventDay: "Retiro disponible el día del evento presentando el QR y la identificación del titular.",
    preEvent: "Punto de retiro previo al evento: por confirmar."
  },
  commonBenefits: [
    "Lanyard y credencial impresa de Pase de Pistones",
    "Cada Pistón equivale a un boleto para el sorteo del automóvil",
    "Refrigerios según el Pase seleccionado",
    "Otras prestaciones serán definidas y publicadas por PyR Eventos"
  ],
  levels: [
    {
      id: "piston-1",
      pistons: 1,
      name: "Pase de 1 Pistón",
      netPrice: 5000,
      accent: "steel",
      benefits: ["1 refrigerio incluido", "Otras prestaciones por definir"]
    },
    {
      id: "piston-3",
      pistons: 3,
      name: "Pase de 3 Pistones",
      netPrice: 10000,
      accent: "bronze",
      benefits: ["1 refrigerio incluido", "Otras prestaciones por definir"]
    },
    {
      id: "piston-5",
      pistons: 5,
      name: "Pase de 5 Pistones",
      netPrice: 15000,
      accent: "red",
      featured: true,
      benefits: ["2 refrigerios incluidos", "Otras prestaciones por definir"]
    },
    {
      id: "piston-7",
      pistons: 7,
      name: "Pase de 7 Pistones",
      netPrice: 20000,
      accent: "graphite",
      benefits: ["Refrigerios incluidos", "Prestaciones adicionales por definir"]
    },
    {
      id: "piston-9",
      pistons: 9,
      name: "Pase de 9 Pistones",
      netPrice: 25000,
      accent: "gold",
      benefits: ["Refrigerios incluidos", "Prestaciones adicionales por definir"]
    }
  ]
};

function cleanText(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function normalizeLevel(level = {}, fallback = {}, index = 0) {
  const pistons = Math.max(1, Math.min(99, Math.floor(Number(level.pistons ?? fallback.pistons ?? 1))));
  const netPrice = Math.max(
    0,
    Math.round(Number(level.netPrice ?? level.price ?? fallback.netPrice ?? fallback.price ?? 0))
  );
  return {
    id: cleanText(level.id, fallback.id || `piston-${pistons}-${index + 1}`),
    pistons,
    name: cleanText(level.name, fallback.name || `Pase de ${pistons} ${pistons === 1 ? "Pistón" : "Pistones"}`),
    netPrice,
    accent: cleanText(level.accent, fallback.accent || "steel"),
    featured: Boolean(level.featured ?? fallback.featured),
    benefits: (Array.isArray(level.benefits) ? level.benefits : fallback.benefits || [])
      .map((benefit) => cleanText(benefit))
      .filter(Boolean),
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
