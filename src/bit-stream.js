/** Bit stream reading and writing with implicit zero padding suffix. */

export const PAYLOAD_SENTINEL_BIT = "1";

/**
 * Read explicit bits, then implicit infinite zeros after exhaustion.
 */
export class BitReader {
  /**
   * @param {string} encodedBits
   */
  constructor(encodedBits) {
    if (![...encodedBits].every((bitCharacter) => bitCharacter === "0" || bitCharacter === "1")) {
      throw new Error(`expected only 0/1, got ${JSON.stringify(encodedBits)}`);
    }
    /** @type {string} */
    this._encodedBits = encodedBits;
    /** @type {number} */
    this._position = 0;
  }

  /** @returns {number} */
  get encodedLength() {
    return this._encodedBits.length;
  }

  /** @returns {boolean} */
  get hasExplicitRemaining() {
    return this._position < this.encodedLength;
  }

  /** @returns {number} */
  readBit() {
    if (this._position < this.encodedLength) {
      const bitValue = Number(this._encodedBits[this._position]);
      this._position += 1;
      return bitValue;
    }
    return 0;
  }

  /**
   * @param {number} bitCount
   * @returns {string}
   */
  readBits(bitCount) {
    if (bitCount < 0) {
      throw new Error(`expected non-negative bitCount, got ${bitCount}`);
    }
    let resultBits = "";
    for (let bitIndex = 0; bitIndex < bitCount; bitIndex += 1) {
      resultBits += String(this.readBit());
    }
    return resultBits;
  }

  /**
   * @param {number} bitCount
   * @returns {number}
   */
  bitsToIndex(bitCount) {
    if (bitCount <= 0) {
      throw new Error(`expected positive bitCount, got ${bitCount}`);
    }
    return Number.parseInt(this.readBits(bitCount), 2);
  }
}

/** Append bits while generating text from parsed sentences. */
export class BitWriter {
  constructor() {
    /** @type {string[]} */
    this._bits = [];
  }

  /**
   * @param {number} bitValue
   * @returns {void}
   */
  writeBit(bitValue) {
    if (bitValue !== 0 && bitValue !== 1) {
      throw new Error(`expected 0 or 1, got ${bitValue}`);
    }
    this._bits.push(String(bitValue));
  }

  /**
   * @param {string} bits
   * @returns {void}
   */
  writeBits(bits) {
    if (![...bits].every((bitCharacter) => bitCharacter === "0" || bitCharacter === "1")) {
      throw new Error(`expected only 0/1, got ${JSON.stringify(bits)}`);
    }
    this._bits.push(...bits);
  }

  /**
   * @param {number} indexValue
   * @param {number} bitCount
   * @returns {void}
   */
  writeIndex(indexValue, bitCount) {
    const maxIndex = 2 ** bitCount;
    if (indexValue < 0 || indexValue >= maxIndex) {
      throw new Error(`expected 0 <= index < ${maxIndex}, got index=${indexValue}`);
    }
    this.writeBits(indexValue.toString(2).padStart(bitCount, "0"));
  }

  /** @returns {string} */
  toString() {
    return this._bits.join("");
  }
}

/**
 * Strip padding zeros and the payload sentinel.
 * @param {string} reconstructedBits
 * @returns {string}
 */
export function decodePayloadFromReconstructed(reconstructedBits) {
  const withoutZeros = reconstructedBits.replace(/0+$/, "");
  if (!withoutZeros) {
    throw new Error(`expected sentinel bit after padding zeros, got ${JSON.stringify(reconstructedBits)}`);
  }
  if (withoutZeros.at(-1) !== PAYLOAD_SENTINEL_BIT) {
    throw new Error(`expected sentinel ${PAYLOAD_SENTINEL_BIT}, got last bit of ${JSON.stringify(withoutZeros)}`);
  }
  return withoutZeros.slice(0, -1);
}
