/** Normalize one sentence for corpus lookup. */

/** @type {readonly string[]} */
const ZERO_WIDTH_CHARACTERS = [
  "\u200b",
  "\u200c",
  "\u200d",
  "\ufeff",
  "\u2060",
];

const SENTENCE_WHITESPACE_PATTERN = /[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g;

/**
 * @param {string} sentenceText
 * @returns {string}
 */
export function cleanSentenceSurface(sentenceText) {
  let normalizedText = sentenceText.trim().normalize("NFKC");
  for (const zeroWidthCharacter of ZERO_WIDTH_CHARACTERS) {
    normalizedText = normalizedText.replaceAll(zeroWidthCharacter, "");
  }
  normalizedText = normalizedText.replace(SENTENCE_WHITESPACE_PATTERN, " ");
  return normalizedText.trim();
}

/**
 * @param {string} sentenceText
 * @returns {string}
 */
export function normalizeSentenceKey(sentenceText) {
  return cleanSentenceSurface(sentenceText);
}
