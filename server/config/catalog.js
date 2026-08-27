const events = [
  {
    id: "hfc-2026-sabado-drag-day",
    name: "Sábado Drag Day",
    eyebrow: "Honda Fest Chile · Día 1",
    dateLabel: "Sábado 28 de noviembre de 2026",
    eventDate: "2026-11-28T09:00:00-03:00",
    venue: "Autodromo Huachalalume",
    city: "La Serena",
    summary:
      "Primer día de Honda Fest Chile: aceleración, Drag Day, exhibiciones y comunidad Honda en el Autodromo Huachalalume.",
    highlights: ["Sábado 28 de noviembre", "Drag Day", "Autodromo Huachalalume", "La Serena"],
    accent: "honda"
  },
  {
    id: "hfc-2026-domingo-track-day",
    name: "Domingo Track Day",
    eyebrow: "Honda Fest Chile · Día 2",
    dateLabel: "Domingo 29 de noviembre de 2026",
    eventDate: "2026-11-29T09:00:00-03:00",
    venue: "Autodromo Huachalalume",
    city: "La Serena",
    summary:
      "Segundo día de Honda Fest Chile: Track Day, pista, exhibiciones y comunidad Honda en el Autodromo Huachalalume.",
    highlights: ["Domingo 29 de noviembre", "Track Day", "Autodromo Huachalalume", "La Serena"],
    accent: "honda"
  },
  {
    id: "japon-fest-chile-2026",
    name: "Japon Fest Chile",
    eyebrow: "Cultura japonesa y comunidad",
    dateLabel: "19 de julio de 2026",
    eventDate: "2026-07-19T00:00",
    venue: "Recinto por confirmar",
    city: "Chile",
    summary:
      "Una jornada para celebrar cultura japonesa, autos preparados, clubes, cosplay, musica, stands y gastronomia.",
    highlights: ["Cultura japonesa", "Exhibicion de clubes", "Stands y comunidad", "Show & shine"],
    accent: "japon",
    active: false
  }
];

const ticketTypes = [
  {
    id: "hfc-2026-sabado-galeria",
    name: "Entrada Galería",
    description: "Válida solo para Sábado Drag Day. Acceso al sector exterior del Autodromo.",
    entryType: "attendee",
    netPrice: 7000,
    price: 8996,
    maxQuantity: 6,
    eventIds: ["hfc-2026-sabado-drag-day"],
    parkingNote: "Estacionamiento en Galería incluido sin costo.",
    phases: [
      { id: "preventa", name: "Preventa", kind: "preventa", netPrice: 7000, quota: null, endsAt: "2026-11-28T00:00:00-03:00", perOrderLimit: 6, enabled: true, sortOrder: 10 },
      { id: "puerta", name: "Venta en puerta", kind: "puerta", netPrice: 10000, quota: null, perOrderLimit: 6, enabled: true, sortOrder: 30 }
    ]
  },
  {
    id: "hfc-2026-sabado-parque-cerrado",
    name: "Entrada Parque Cerrado",
    description: "Válida solo para Sábado Drag Day. Acceso al Parque Cerrado con estacionamiento incluido.",
    entryType: "attendee",
    netPrice: 10000,
    price: 12852,
    maxQuantity: 6,
    eventIds: ["hfc-2026-sabado-drag-day"],
    parkingNote: "Estacionamiento en Parque Cerrado incluido con tu entrada.",
    phases: [
      { id: "preventa", name: "Preventa", kind: "preventa", netPrice: 10000, quota: 100, endsAt: "2026-11-28T00:00:00-03:00", perOrderLimit: 6, enabled: true, sortOrder: 10 }
    ]
  },
  {
    id: "hfc-2026-domingo-galeria",
    name: "Entrada Galería",
    description: "Válida solo para Domingo Track Day. Acceso al sector exterior del Autodromo.",
    entryType: "attendee",
    netPrice: 7000,
    price: 8996,
    maxQuantity: 6,
    eventIds: ["hfc-2026-domingo-track-day"],
    parkingNote: "Estacionamiento en Galería incluido sin costo.",
    phases: [
      { id: "preventa", name: "Preventa", kind: "preventa", netPrice: 7000, quota: null, endsAt: "2026-11-29T00:00:00-03:00", perOrderLimit: 6, enabled: true, sortOrder: 10 },
      { id: "puerta", name: "Venta en puerta", kind: "puerta", netPrice: 10000, quota: null, perOrderLimit: 6, enabled: true, sortOrder: 30 }
    ]
  },
  {
    id: "hfc-2026-domingo-parque-cerrado",
    name: "Entrada Parque Cerrado",
    description: "Válida solo para Domingo Track Day. Acceso al Parque Cerrado con estacionamiento incluido.",
    entryType: "attendee",
    netPrice: 10000,
    price: 12852,
    maxQuantity: 6,
    eventIds: ["hfc-2026-domingo-track-day"],
    parkingNote: "Estacionamiento en Parque Cerrado incluido con tu entrada.",
    phases: [
      { id: "preventa", name: "Preventa", kind: "preventa", netPrice: 10000, quota: 100, endsAt: "2026-11-29T00:00:00-03:00", perOrderLimit: 6, enabled: true, sortOrder: 10 }
    ]
  }
];

function findEvent(eventId) {
  return events.find((event) => event.id === eventId);
}

function findTicketType(ticketTypeId) {
  return ticketTypes.find((ticket) => ticket.id === ticketTypeId);
}

module.exports = {
  events,
  ticketTypes,
  findEvent,
  findTicketType
};
