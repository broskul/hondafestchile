function cleanRut(value = "") {
  return String(value)
    .trim()
    .replace(/\./g, "")
    .replace(/-/g, "")
    .toUpperCase();
}

function calculateDv(numberPart) {
  let multiplier = 2;
  let sum = 0;

  for (let index = numberPart.length - 1; index >= 0; index -= 1) {
    sum += Number(numberPart[index]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }

  const remainder = 11 - (sum % 11);
  if (remainder === 11) return "0";
  if (remainder === 10) return "K";
  return String(remainder);
}

function validateRut(value) {
  const cleaned = cleanRut(value);
  if (!/^\d{7,8}[0-9K]$/.test(cleaned)) {
    return false;
  }

  const numberPart = cleaned.slice(0, -1);
  const dv = cleaned.slice(-1);
  return calculateDv(numberPart) === dv;
}

function formatRut(value) {
  const cleaned = cleanRut(value);
  if (cleaned.length < 2) return cleaned;

  const numberPart = cleaned.slice(0, -1);
  const dv = cleaned.slice(-1);
  const reversed = numberPart.split("").reverse();
  const grouped = [];

  for (let index = 0; index < reversed.length; index += 3) {
    grouped.push(reversed.slice(index, index + 3).reverse().join(""));
  }

  return `${grouped.reverse().join(".")}-${dv}`;
}

module.exports = {
  cleanRut,
  formatRut,
  validateRut
};
