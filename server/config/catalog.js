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
    description: "Acceso a galeria de Honda Fest Chile. Estacionamiento en galeria incluido sin costo.",
    entryType: "attendee",
    netPrice: 5000,
    price: 6664,
    maxQuantity: 6,
    eventIds: ["honda-fest-chile-2026"],
    parkingNote: "Estacionamiento galeria: gratis."
  },
  {
    id: "hfc-2026-parque-cerrado",
    name: "Entrada Parque Cerrado",
    description: "Acceso a parque cerrado de Honda Fest Chile.",
    entryType: "attendee",
    netPrice: 10000,
    price: 13328,
    maxQuantity: 6,
    eventIds: ["honda-fest-chile-2026"],
    parkingNote: "Estacionamiento parque cerrado: $15.000, pago directo en el recinto."
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
