const events = [
  {
    id: "honda-fest-chile-2026",
    name: "Honda Fest Chile",
    eyebrow: "Proximo evento",
    dateLabel: "28 y 29 de noviembre de 2026",
    eventDate: "2026-11-28T00:00",
    venue: "Autodromo Huachalalume",
    city: "La Serena",
    summary:
      "Honda Fest Chile vuelve a La Serena con pista, exhibiciones, comunidad Honda y experiencia familiar en el Autodromo Huachalalume.",
    highlights: ["28 y 29 noviembre", "Autodromo Huachalalume", "La Serena", "Track day y comunidad"],
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
    id: "hfc-2026-galeria",
    name: "Entrada Galeria",
    description: "Acceso al sector exterior del autodromo. Estacionamiento en galeria incluido sin costo.",
    entryType: "attendee",
    netPrice: 7000,
    price: 8996,
    maxQuantity: 6,
    eventIds: ["honda-fest-chile-2026"],
    parkingNote: "Estacionamiento galeria: gratis.",
    phases: [
      {
        id: "preventa",
        name: "Preventa",
        kind: "preventa",
        netPrice: 7000,
        quota: null,
        startsAt: "",
        endsAt: "",
        perOrderLimit: 6,
        enabled: true,
        sortOrder: 10
      },
      {
        id: "general",
        name: "Venta general",
        kind: "general",
        netPrice: 7000,
        quota: null,
        startsAt: "",
        endsAt: "",
        perOrderLimit: 6,
        enabled: false,
        sortOrder: 20
      },
      {
        id: "puerta",
        name: "Puerta",
        kind: "puerta",
        netPrice: 10000,
        quota: null,
        startsAt: "",
        endsAt: "",
        perOrderLimit: 6,
        enabled: true,
        sortOrder: 30
      }
    ]
  },
  {
    id: "hfc-2026-parque-cerrado",
    name: "Entrada Parque Cerrado",
    description: "Acceso al sector de pilotos y a la experiencia principal de Honda Fest Chile.",
    entryType: "attendee",
    netPrice: 10000,
    price: 12852,
    maxQuantity: 6,
    eventIds: ["honda-fest-chile-2026"],
    parkingNote: "Estacionamiento parque cerrado: $15.000, pago directo en el recinto.",
    phases: [
      {
        id: "preventa",
        name: "Preventa",
        kind: "preventa",
        netPrice: 10000,
        quota: 100,
        startsAt: "",
        endsAt: "",
        perOrderLimit: 6,
        enabled: true,
        sortOrder: 10
      },
      {
        id: "general",
        name: "Venta general",
        kind: "general",
        netPrice: 10000,
        quota: null,
        startsAt: "",
        endsAt: "",
        perOrderLimit: 6,
        enabled: false,
        sortOrder: 20
      },
      {
        id: "puerta",
        name: "Puerta",
        kind: "puerta",
        netPrice: 10000,
        quota: null,
        startsAt: "",
        endsAt: "",
        perOrderLimit: 6,
        enabled: false,
        sortOrder: 30
      }
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
