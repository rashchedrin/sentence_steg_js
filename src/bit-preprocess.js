/** Pseudo-random bit-stream preprocessing for grammar version 3+. */

import {
  createPythonRandom,
  randomFloat,
  shuffleIndices,
} from "./python-random.js";

const GAMMA_SEED_1 = "iv_gamma_1";
const PERMUTATION_SEED_1 = "iv_permutation_1";
const GAMMA_SEED_2 = "iv_gamma_2";
const PERMUTATION_SEED_2 = "iv_permutation_2";

/**
 * Create a deterministic RNG from a seed string.
 * @param {string} seedMaterial
 * @returns {import("./python-random.js").PythonRandomState}
 */
async function seedToRandom(seedMaterial) {
  const encodedSeed = new TextEncoder().encode(seedMaterial);
  const digestBuffer = await crypto.subtle.digest("SHA-256", encodedSeed);
  const digestBytes = new Uint8Array(digestBuffer);
  let seedValue = 0n;
  for (let byteIndex = 0; byteIndex < 8; byteIndex += 1) {
    seedValue = (seedValue << 8n) | BigInt(digestBytes[byteIndex]);
  }
  return createPythonRandom(seedValue);
}

/**
 * @param {number} bitCount
 * @param {string} seedLabel
 * @returns {Promise<string>}
 */
export async function pseudorandomBits(bitCount, seedLabel) {
  if (bitCount < 0) {
    throw new Error(`expected non-negative bitCount, got ${bitCount}`);
  }
  if (bitCount === 0) {
    return "";
  }
  const randomState = await seedToRandom(`${seedLabel}:${bitCount}`);
  let resultBits = "";
  for (let bitIndex = 0; bitIndex < bitCount; bitIndex += 1) {
    resultBits += randomFloat(randomState) < 0.5 ? "1" : "0";
  }
  return resultBits;
}

/**
 * @param {string} leftBits
 * @param {string} rightBits
 * @returns {string}
 */
export function xorBits(leftBits, rightBits) {
  if (leftBits.length !== rightBits.length) {
    throw new Error(`expected equal lengths, got ${leftBits.length} and ${rightBits.length}`);
  }
  let resultBits = "";
  for (let bitIndex = 0; bitIndex < leftBits.length; bitIndex += 1) {
    resultBits += leftBits[bitIndex] !== rightBits[bitIndex] ? "1" : "0";
  }
  return resultBits;
}

/**
 * @param {number} bitCount
 * @param {string} seedLabel
 * @returns {Promise<number[]>}
 */
export async function pseudorandomPermutation(bitCount, seedLabel) {
  if (bitCount < 0) {
    throw new Error(`expected non-negative bitCount, got ${bitCount}`);
  }
  const indexList = Array.from({ length: bitCount }, (_, indexValue) => indexValue);
  const randomState = await seedToRandom(`${seedLabel}:${bitCount}`);
  shuffleIndices(randomState, indexList);
  return indexList;
}

/**
 * @param {number[]} permutation
 * @returns {number[]}
 */
export function invertPermutation(permutation) {
  const inversePermutation = new Array(permutation.length);
  for (let destinationIndex = 0; destinationIndex < permutation.length; destinationIndex += 1) {
    const sourceIndex = permutation[destinationIndex];
    if (sourceIndex < 0 || sourceIndex >= permutation.length) {
      throw new Error(`expected 0 <= sourceIndex < ${permutation.length}, got ${sourceIndex}`);
    }
    inversePermutation[sourceIndex] = destinationIndex;
  }
  return inversePermutation;
}

/**
 * @param {string} payloadBits
 * @param {number[]} permutation
 * @returns {string}
 */
export function applyPermutation(payloadBits, permutation) {
  if (payloadBits.length !== permutation.length) {
    throw new Error(`expected permutation length ${payloadBits.length}, got ${permutation.length}`);
  }
  let resultBits = "";
  for (let destinationIndex = 0; destinationIndex < payloadBits.length; destinationIndex += 1) {
    resultBits += payloadBits[permutation[destinationIndex]];
  }
  return resultBits;
}

/**
 * @param {string} payloadBits
 * @returns {Promise<string>}
 */
export async function preprocessPayloadBits(payloadBits) {
  if (![...payloadBits].every((bitCharacter) => bitCharacter === "0" || bitCharacter === "1")) {
    throw new Error(`expected only 0/1, got ${JSON.stringify(payloadBits)}`);
  }
  const bitCount = payloadBits.length;
  if (bitCount === 0) {
    return "";
  }
  let transformedBits = xorBits(payloadBits, await pseudorandomBits(bitCount, GAMMA_SEED_1));
  transformedBits = applyPermutation(
    transformedBits,
    await pseudorandomPermutation(bitCount, PERMUTATION_SEED_1),
  );
  transformedBits = xorBits(transformedBits, await pseudorandomBits(bitCount, GAMMA_SEED_2));
  transformedBits = applyPermutation(
    transformedBits,
    await pseudorandomPermutation(bitCount, PERMUTATION_SEED_2),
  );
  return transformedBits;
}

/**
 * @param {string} processedBits
 * @returns {Promise<string>}
 */
export async function postprocessPayloadBits(processedBits) {
  if (![...processedBits].every((bitCharacter) => bitCharacter === "0" || bitCharacter === "1")) {
    throw new Error(`expected only 0/1, got ${JSON.stringify(processedBits)}`);
  }
  const bitCount = processedBits.length;
  if (bitCount === 0) {
    return "";
  }
  let transformedBits = applyPermutation(
    processedBits,
    invertPermutation(await pseudorandomPermutation(bitCount, PERMUTATION_SEED_2)),
  );
  transformedBits = xorBits(transformedBits, await pseudorandomBits(bitCount, GAMMA_SEED_2));
  transformedBits = applyPermutation(
    transformedBits,
    invertPermutation(await pseudorandomPermutation(bitCount, PERMUTATION_SEED_1)),
  );
  transformedBits = xorBits(transformedBits, await pseudorandomBits(bitCount, GAMMA_SEED_1));
  return transformedBits;
}
