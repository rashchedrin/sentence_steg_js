/** Convert between raw bytes and bit strings. */

/**
 * @param {Uint8Array} payloadBytes
 * @returns {string}
 */
export function bytesToBits(payloadBytes) {
  if (payloadBytes.length === 0) {
    return "";
  }
  return [...payloadBytes].map((byteValue) => byteValue.toString(2).padStart(8, "0")).join("");
}

/**
 * @param {string} payloadBits
 * @returns {Uint8Array}
 */
export function bitsToBytes(payloadBits) {
  const strippedBits = payloadBits.trim();
  if (!strippedBits) {
    return new Uint8Array(0);
  }
  if (![...strippedBits].every((bitCharacter) => bitCharacter === "0" || bitCharacter === "1")) {
    throw new Error(`expected only 0/1, got ${JSON.stringify(strippedBits)}`);
  }
  const completeBitCount = strippedBits.length - (strippedBits.length % 8);
  if (completeBitCount === 0) {
    return new Uint8Array(0);
  }
  const byteValues = [];
  for (let byteOffset = 0; byteOffset < completeBitCount; byteOffset += 8) {
    const byteBits = strippedBits.slice(byteOffset, byteOffset + 8);
    byteValues.push(Number.parseInt(byteBits, 2));
  }
  return Uint8Array.from(byteValues);
}

/**
 * @param {Uint8Array} payloadBytes
 * @returns {string | null}
 */
export function bytesToUtf8TextIfValid(payloadBytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes);
  } catch {
    return null;
  }
}
