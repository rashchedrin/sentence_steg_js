/** Paragraph length distribution from grammar v7 (same buckets as Python, FNV seed). */

const MIN_PARAGRAPH_SENTENCES = 1;
const MAX_PARAGRAPH_SENTENCES = 20;
const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;

/**
 * Deterministic 32-bit seed for paragraph layout (replaces Python hash in v7).
 * @param {number} paragraphStartIndex
 * @param {string} anchorSentence
 * @returns {number}
 */
function paragraphSeed(paragraphStartIndex, anchorSentence) {
  const seedMaterial = `${paragraphStartIndex}\0${anchorSentence.toLowerCase()}`;
  let hashValue = FNV_OFFSET_BASIS;
  for (let charIndex = 0; charIndex < seedMaterial.length; charIndex += 1) {
    hashValue ^= seedMaterial.charCodeAt(charIndex);
    hashValue = Math.imul(hashValue, FNV_PRIME);
  }
  return hashValue >>> 0;
}

/**
 * @param {number} paragraphStartIndex
 * @param {string} anchorSentence
 * @returns {number}
 */
export function paragraphLengthForStart(paragraphStartIndex, anchorSentence) {
  if (paragraphStartIndex < 0) {
    throw new Error(`expected non-negative paragraphStartIndex, got ${paragraphStartIndex}`);
  }
  if (!anchorSentence) {
    throw new Error("expected non-empty anchorSentence");
  }
  const seedValue = paragraphSeed(paragraphStartIndex, anchorSentence);
  const distributionRoll = seedValue % 10_000;
  let paragraphLength;
  if (distributionRoll < 1_200) {
    paragraphLength = 1;
  } else if (distributionRoll < 3_000) {
    paragraphLength = 2;
  } else if (distributionRoll < 5_500) {
    paragraphLength = 3 + ((seedValue >> 8) % 2);
  } else if (distributionRoll < 8_000) {
    paragraphLength = 5 + ((seedValue >> 12) % 3);
  } else if (distributionRoll < 9_200) {
    paragraphLength = 8 + ((seedValue >> 16) % 5);
  } else {
    paragraphLength = 13 + ((seedValue >> 20) % 8);
  }
  if (paragraphLength < MIN_PARAGRAPH_SENTENCES || paragraphLength > MAX_PARAGRAPH_SENTENCES) {
    throw new Error(
      `expected ${MIN_PARAGRAPH_SENTENCES} <= paragraphLength <= ${MAX_PARAGRAPH_SENTENCES}, `
      + `got ${paragraphLength}`,
    );
  }
  return paragraphLength;
}
