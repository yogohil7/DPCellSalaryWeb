/**
 * Gujarati amount-in-words — PRESENTATION ONLY.
 *
 * Used solely to render the NPS bank remittance letter, which is written in
 * Gujarati and so cannot carry the English words that utils/amountInWords.js
 * produces. This module performs NO financial calculation: it formats a number
 * that has already been totalled by the report, and nothing here can change an
 * amount, a rounding rule or a stored value.
 *
 * Indian numbering: કરોડ (crore) / લાખ (lakh) / હજાર (thousand) / સો (hundred).
 * Gujarati has a distinct word for every value from 0 to 99, so those are
 * tabulated rather than composed — composing them would produce words that do
 * not exist in the language.
 */

/* ૦-૯ — the Gujarati digits used for the numeric figure. */
const GUJARATI_DIGITS = ["૦", "૧", "૨", "૩", "૪", "૫", "૬", "૭", "૮", "૯"];

/* 0-99, each its own word. */
const UNDER_HUNDRED = [
  "શૂન્ય", "એક", "બે", "ત્રણ", "ચાર", "પાંચ", "છ", "સાત", "આઠ", "નવ",
  "દસ", "અગિયાર", "બાર", "તેર", "ચૌદ", "પંદર", "સોળ", "સત્તર", "અઢાર", "ઓગણીસ",
  "વીસ", "એકવીસ", "બાવીસ", "તેવીસ", "ચોવીસ", "પચ્ચીસ", "છવ્વીસ", "સત્તાવીસ", "અઠ્ઠાવીસ", "ઓગણત્રીસ",
  "ત્રીસ", "એકત્રીસ", "બત્રીસ", "તેત્રીસ", "ચોત્રીસ", "પાંત્રીસ", "છત્રીસ", "સાડત્રીસ", "આડત્રીસ", "ઓગણચાળીસ",
  "ચાળીસ", "એકતાળીસ", "બેતાળીસ", "તેતાળીસ", "ચુંમાળીસ", "પિસ્તાળીસ", "છેતાળીસ", "સુડતાળીસ", "અડતાળીસ", "ઓગણપચાસ",
  "પચાસ", "એકાવન", "બાવન", "ત્રેપન", "ચોપન", "પંચાવન", "છપ્પન", "સત્તાવન", "અઠ્ઠાવન", "ઓગણસાઠ",
  "સાઠ", "એકસઠ", "બાસઠ", "ત્રેસઠ", "ચોસઠ", "પાંસઠ", "છાસઠ", "સડસઠ", "અડસઠ", "ઓગણસિત્તેર",
  "સિત્તેર", "એકોતેર", "બોતેર", "તોતેર", "ચુમોતેર", "પંચોતેર", "છોતેર", "સિત્યોતેર", "ઇઠ્યોતેર", "ઓગણાએંસી",
  "એંસી", "એક્યાસી", "બ્યાસી", "ત્યાસી", "ચોર્યાસી", "પંચ્યાસી", "છ્યાસી", "સત્યાસી", "અઠ્યાસી", "નેવ્યાસી",
  "નેવું", "એકાણું", "બાણું", "ત્રાણું", "ચોરાણું", "પંચાણું", "છન્નું", "સત્તાણું", "અઠ્ઠાણું", "નવ્વાણું",
];

/* 100-999: the hundreds digit fuses with સો — ચાર + સો = ચારસો. */
const HUNDREDS = [
  "", "એકસો", "બસો", "ત્રણસો", "ચારસો", "પાંચસો",
  "છસો", "સાતસો", "આઠસો", "નવસો",
];

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.abs(Math.round(n)) : 0;
}

/** 0-999 in words. Returns "" for 0 so it can be dropped from a group. */
function underThousand(value) {
  const n = toInt(value);
  if (n === 0) return "";
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts = [];
  if (hundreds > 0) parts.push(HUNDREDS[hundreds]);
  if (rest > 0) parts.push(UNDER_HUNDRED[rest]);
  return parts.join(" ");
}

/**
 * The whole-rupee amount in Gujarati words, without any prefix or suffix.
 * Paise are not spoken: the NPS remittance is a whole-rupee figure, and the
 * report total this reads is already rounded by the report itself.
 */
function gujaratiWords(amount) {
  const n = toInt(amount);
  if (n === 0) return UNDER_HUNDRED[0];

  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;

  const parts = [];
  if (crore > 0) parts.push(`${gujaratiWords(crore)} કરોડ`);
  if (lakh > 0) parts.push(`${underThousand(lakh)} લાખ`);
  if (thousand > 0) parts.push(`${underThousand(thousand)} હજાર`);
  if (rest > 0) parts.push(underThousand(rest));

  return parts.join(" ");
}

/** The figure in Gujarati digits with Indian grouping, e.g. ૧૩,૬૯,૪૨૪. */
function gujaratiFigure(amount) {
  const n = toInt(amount);
  const grouped = n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  return grouped.replace(/\d/g, (d) => GUJARATI_DIGITS[Number(d)]);
}

/**
 * The bracketed phrase the letter prints after the figure, e.g.
 *   (અંકે તેર લાખ ઓગણસિત્તેર હજાર ચારસો ચોવીસ પૂરા /-)
 * A zero total yields a clean "(અંકે શૂન્ય પૂરા /-)" rather than malformed text.
 */
function gujaratiAmountInWords(amount) {
  return `(અંકે ${gujaratiWords(amount)} પૂરા /-)`;
}

module.exports = {
  gujaratiWords,
  gujaratiFigure,
  gujaratiAmountInWords,
  GUJARATI_DIGITS,
};
