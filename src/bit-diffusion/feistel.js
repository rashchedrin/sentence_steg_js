/** Unbalanced Feistel bit diffusion with SHAKE-256 (grammar v10). */

import { shake256 } from "@noble/hashes/sha3.js";

/** @type {string} */
export const FEISTEL_IV_SEED = "feistel_iv";

/** @type {number} */
export const FEISTEL_ROUND_COUNT = 4;

/** @type {Uint8Array} */
const g_seedBytes = new TextEncoder().encode(FEISTEL_IV_SEED);

/**
 * @param {string} bitString
 * @returns {void}
 */
function assertBinaryBitString(bitString) {
  if (![...bitString].every((bitCharacter) => bitCharacter === "0" || bitCharacter === "1")) {
    throw new Error(`expected only 0/1, got ${JSON.stringify(bitString)}`);
  }
}

/**
 * @param {number[]} bitValues shape: (n_bits,)
 * @returns {Uint8Array} shape: (ceil(n_bits / 8),)
 */
function bitValuesToBytes(bitValues) {
  if (bitValues.length === 0) {
    return new Uint8Array(0);
  }
  const packedBytes = new Uint8Array(Math.ceil(bitValues.length / 8));
  let byteIndex = 0;
  for (let chunkStart = 0; chunkStart < bitValues.length; chunkStart += 8) {
    const chunk = bitValues.slice(chunkStart, chunkStart + 8);
    let byteValue = 0;
    for (const bitValue of chunk) {
      byteValue = (byteValue << 1) | bitValue;
    }
    if (chunk.length < 8) {
      byteValue <<= 8 - chunk.length;
    }
    packedBytes[byteIndex] = byteValue;
    byteIndex += 1;
  }
  return packedBytes;
}

/**
 * @param {Uint8Array} shakeInputBytes shape: (n_bytes,)
 * @param {number} bitCount
 * @returns {number[]} shape: (bitCount,)
 */
function extractBitValuesFromShake(shakeInputBytes, bitCount) {
  if (bitCount < 0) {
    throw new Error(`expected non-negative bitCount, got ${bitCount}`);
  }
  if (bitCount === 0) {
    return [];
  }
  const byteCount = Math.ceil(bitCount / 8);
  const hashBytes = shake256(shakeInputBytes, { dkLen: byteCount });
  const extractedBits = [];
  for (const hashByte of hashBytes) {
    for (let bitShift = 7; bitShift >= 0; bitShift -= 1) {
      extractedBits.push((hashByte >> bitShift) & 1);
    }
  }
  return extractedBits.slice(0, bitCount);
}

/**
 * @param {number[]} rightBitValues shape: (n_right,)
 * @param {number} roundIndex
 * @returns {Uint8Array}
 */
function buildShakeInput(rightBitValues, roundIndex) {
  const rightBytes = bitValuesToBytes(rightBitValues);
  const roundByte = new Uint8Array([roundIndex]);
  const shakeInputBytes = new Uint8Array(rightBytes.length + g_seedBytes.length + 1);
  shakeInputBytes.set(rightBytes, 0);
  shakeInputBytes.set(g_seedBytes, rightBytes.length);
  shakeInputBytes.set(roundByte, rightBytes.length + g_seedBytes.length);
  return shakeInputBytes;
}

/**
 * @param {number[]} leftBitValues shape: (n_left,)
 * @param {number[]} rightBitValues shape: (n_right,)
 * @param {number} roundIndex
 * @returns {number[]} shape: (n_right,)
 */
function feistelKeystream(leftBitValues, rightBitValues, roundIndex) {
  const shakeInputBytes = buildShakeInput(rightBitValues, roundIndex);
  return extractBitValuesFromShake(shakeInputBytes, leftBitValues.length);
}

/**
 * @param {number[]} leftBitValues shape: (n_left,)
 * @param {number[]} rightBitValues shape: (n_right,)
 * @returns {number[]} shape: (n_left + n_right,)
 */
function xorBitValueArrays(leftBitValues, rightBitValues) {
  if (leftBitValues.length !== rightBitValues.length) {
    throw new Error(
      `expected equal lengths, got ${leftBitValues.length} and ${rightBitValues.length}`,
    );
  }
  return leftBitValues.map((leftBit, bitIndex) => leftBit ^ rightBitValues[bitIndex]);
}

/**
 * @param {string} bitString
 * @returns {number[]} shape: (bitString.length,)
 */
function bitStringToValues(bitString) {
  return [...bitString].map((bitCharacter) => Number(bitCharacter));
}

/**
 * @param {number[]} bitValues shape: (n_bits,)
 * @returns {string}
 */
function bitValuesToString(bitValues) {
  return bitValues.map((bitValue) => String(bitValue)).join("");
}

/**
 * @param {number[]} bitValues shape: (n_bits,)
 * @param {number} roundCount
 * @returns {number[]} shape: (n_bits,)
 */
function feistelEncryptBitValues(bitValues, roundCount) {
  const totalBits = bitValues.length;
  if (totalBits < 2) {
    return bitValues;
  }
  const splitIndex = Math.floor(totalBits / 2);
  let leftBitValues = bitValues.slice(0, splitIndex);
  let rightBitValues = bitValues.slice(splitIndex);
  for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
    const keystream = feistelKeystream(leftBitValues, rightBitValues, roundIndex);
    const leftNext = rightBitValues;
    const rightNext = xorBitValueArrays(leftBitValues, keystream);
    leftBitValues = leftNext;
    rightBitValues = rightNext;
  }
  return [...leftBitValues, ...rightBitValues];
}

/**
 * @param {number[]} bitValues shape: (n_bits,)
 * @param {number} roundCount
 * @returns {number[]} shape: (n_bits,)
 */
function feistelDecryptBitValues(bitValues, roundCount) {
  const totalBits = bitValues.length;
  if (totalBits < 2) {
    return bitValues;
  }
  const halfSizes = [];
  let leftLength = Math.floor(totalBits / 2);
  let rightLength = totalBits - leftLength;
  for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
    halfSizes.push([leftLength, rightLength]);
    const nextLeftLength = rightLength;
    rightLength = leftLength;
    leftLength = nextLeftLength;
  }
  let leftBitValues = bitValues.slice(0, leftLength);
  let rightBitValues = bitValues.slice(leftLength);
  for (let roundIndex = roundCount - 1; roundIndex >= 0; roundIndex -= 1) {
    const rightPrevious = leftBitValues;
    const [originalLeftLength] = halfSizes[roundIndex];
    const keystream = extractBitValuesFromShake(
      buildShakeInput(rightPrevious, roundIndex),
      originalLeftLength,
    );
    const leftPrevious = xorBitValueArrays(rightBitValues, keystream);
    leftBitValues = leftPrevious;
    rightBitValues = rightPrevious;
  }
  return [...leftBitValues, ...rightBitValues];
}

/**
 * @param {string} bitString
 * @param {boolean} decrypt
 * @param {number} [roundCount]
 * @returns {string}
 */
export function feistelMixBits(bitString, decrypt, roundCount = FEISTEL_ROUND_COUNT) {
  assertBinaryBitString(bitString);
  if (roundCount < 1) {
    throw new Error(`expected roundCount >= 1, got ${roundCount}`);
  }
  const bitValues = bitStringToValues(bitString);
  const mixedValues = decrypt
    ? feistelDecryptBitValues(bitValues, roundCount)
    : feistelEncryptBitValues(bitValues, roundCount);
  return bitValuesToString(mixedValues);
}

/**
 * @param {string} payloadBits
 * @returns {Promise<string>}
 */
export async function preprocessPayloadBits(payloadBits) {
  return feistelMixBits(payloadBits, false);
}

/**
 * @param {string} processedBits
 * @returns {Promise<string>}
 */
export async function postprocessPayloadBits(processedBits) {
  return feistelMixBits(processedBits, true);
}

/** @type {import("./types.js").BitDiffusion} */
export const feistelDiffusion = {
  id: "feistel",
  preprocess: preprocessPayloadBits,
  postprocess: postprocessPayloadBits,
};
