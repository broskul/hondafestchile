const events = [
  {
    id: "japon-fest-chile-2026",
    name: "Japon Fest Chile",
    eyebrow: "Proximo evento",
    dateLabel: "19 de julio de 2026",
    venue: "Recinto por confirmar",
    city: "Chile",
    summary:
      "Una jornada para celebrar cultura japonesa, autos preparados, clubes, cosplay, musica, stands y gastronomia el 19 de julio.",
    highlights: ["19 de julio", "Exhibicion de clubes", "Stands y cultura japonesa", "Show & shine"],
    accent: "japon"
  },
  {
    id: "honda-fest-chile-2026",
    name: "Honda Fest Chile",
    eyebrow: "Track day, comunidad y competencia",
    dateLabel: "Temporada 2026",
    venue: "Circuito por confirmar",
    city: "Chile",
    summary:
      "El punto de encuentro para pilotos, equipos, clubes y fanaticos Honda con pista, exhibiciones y experiencia familiar.",
    highlights: ["Carreras y track day", "Grilla de pilotos", "Zona paddock", "Experiencia familiar"],
    accent: "honda"
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
