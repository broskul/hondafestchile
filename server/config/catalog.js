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
    accent: "japon"
  }
];

const ticketTypes = [
  {
    id: "general",
    name: "Entrada General",
    description: "Acceso al recinto, paddock publico, exhibiciones, stands y food trucks.",
    entryType: "attendee",
    price: 8000,
    maxQuantity: 6
  },
  {
    id: "club",
    name: "Entrada Club",
    description: "Acceso general mas cupo para estacionamiento de exhibicion sujeto a validacion.",
    entryType: "attendee",
    price: 12000,
    maxQuantity: 4
  },
  {
    id: "piloto-track",
    name: "Piloto Track Day",
    description: "Inscripcion de piloto, briefing, numero de participante y acceso a manga asignada.",
    entryType: "pilot",
    price: 45000,
    maxQuantity: 1
  },
  {
    id: "stand",
    name: "Stand Emprendedor",
    description: "Reserva inicial de stand; produccion confirmara metraje y requerimientos.",
    entryType: "attendee",
    price: 60000,
    maxQuantity: 2
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
