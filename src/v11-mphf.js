/** Browser runtime for the v11 BDZ minimal perfect hash function. */

import { shake256 } from "@noble/hashes/sha3.js";
import { normalizeSentenceKey } from "./sentence-normalize.js";

const MAGIC = "V11MPHF\0";
const FORMAT_VERSION = 1;
const HEADER_BYTES = 36;
const HASH_BYTE_LENGTH = 16;
const HASH_WORD_COUNT = 4;
const G_VALUES_PER_BYTE = 4;
const RANK_STRIDE_BITS = 256;
const WORD_BITS = 32;

/**
 * @param {number} value
 * @returns {number}
 */
function mixUint32(value) {
  let mixedValue = value >>> 0;
  mixedValue = Math.imul(mixedValue ^ (mixedValue >>> 16), 0x7feb352d);
  mixedValue = Math.imul(mixedValue ^ (mixedValue >>> 15), 0x846ca68b);
  return (mixedValue ^ (mixedValue >>> 16)) >>> 0;
}

/**
 * @param {Uint32Array} hashWords shape: (4,)
 * @param {number} seed
 * @param {number} vertexCount
 * @returns {[number, number, number]}
 */
function hashVertices(hashWords, seed, vertexCount) {
  const vertex0 = mixUint32(hashWords[0] ^ seed ^ 0x243f6a88) % vertexCount;
  let vertex1 = mixUint32(hashWords[1] ^ seed ^ 0x85a308d3) % vertexCount;
  let vertex2 = mixUint32(hashWords[2] ^ seed ^ 0x13198a2e) % vertexCount;
  if (vertex1 === vertex0) {
    vertex1 = (vertex1 + 1) % vertexCount;
  }
  while (vertex2 === vertex0 || vertex2 === vertex1) {
    vertex2 = (vertex2 + 1) % vertexCount;
  }
  return [vertex0, vertex1, vertex2];
}

/**
 * @param {number} value
 * @returns {number}
 */
function popcountUint32(value) {
  let countedValue = value >>> 0;
  countedValue -= (countedValue >>> 1) & 0x55555555;
  countedValue = (countedValue & 0x33333333) + ((countedValue >>> 2) & 0x33333333);
  return Math.imul((countedValue + (countedValue >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}

/**
 * @param {Uint8Array} packedG
 * @param {number} vertexIndex
 * @returns {number}
 */
function readPackedG(packedG, vertexIndex) {
  const byteIndex = Math.floor(vertexIndex / G_VALUES_PER_BYTE);
  const shift = (vertexIndex % G_VALUES_PER_BYTE) * 2;
  return (packedG[byteIndex] >>> shift) & 0x03;
}

/**
 * @param {Uint32Array} selectedWords
 * @param {Uint32Array} rankCheckpoints
 * @param {number} vertexIndex
 * @returns {number}
 */
function rankExclusive(selectedWords, rankCheckpoints, vertexIndex) {
  const checkpointIndex = Math.floor(vertexIndex / RANK_STRIDE_BITS);
  let rank = rankCheckpoints[checkpointIndex];
  const firstWordIndex = checkpointIndex * (RANK_STRIDE_BITS / WORD_BITS);
  const targetWordIndex = Math.floor(vertexIndex / WORD_BITS);
  for (let wordIndex = firstWordIndex; wordIndex < targetWordIndex; wordIndex += 1) {
    rank += popcountUint32(selectedWords[wordIndex]);
  }
  const bitsBefore = vertexIndex % WORD_BITS;
  if (bitsBefore > 0) {
    const lowBitsMask = (2 ** bitsBefore - 1) >>> 0;
    rank += popcountUint32(selectedWords[targetWordIndex] & lowBitsMask);
  }
  return rank;
}

/**
 * @param {string} sentenceText
 * @returns {Uint32Array} shape: (4,)
 */
function hashSentenceToWords(sentenceText) {
  const normalizedKey = normalizeSentenceKey(sentenceText);
  const hashBytes = shake256(new TextEncoder().encode(normalizedKey), {
    dkLen: HASH_BYTE_LENGTH,
  });
  const hashWords = new Uint32Array(HASH_WORD_COUNT);
  for (let wordIndex = 0; wordIndex < HASH_WORD_COUNT; wordIndex += 1) {
    const byteOffset = wordIndex * 4;
    hashWords[wordIndex] = (
      hashBytes[byteOffset]
      | (hashBytes[byteOffset + 1] << 8)
      | (hashBytes[byteOffset + 2] << 16)
      | (hashBytes[byteOffset + 3] << 24)
    ) >>> 0;
  }
  return hashWords;
}

/**
 * Total sentence-to-index function. It intentionally has no membership data:
 * every sentence receives an index in [0, 2^20), including unknown text.
 */
export class V11MphfDecoder {
  /**
   * @param {number} keyCount
   * @param {number} vertexCount
   * @param {number} seed
   * @param {Uint8Array} packedG
   * @param {Uint32Array} selectedWords
   * @param {Uint32Array} rankCheckpoints
   */
  constructor(keyCount, vertexCount, seed, packedG, selectedWords, rankCheckpoints) {
    if (keyCount !== 2 ** 20) {
      throw new Error(`expected v11 key count ${2 ** 20}, got ${keyCount}`);
    }
    this.keyCount = keyCount;
    this.vertexCount = vertexCount;
    this.seed = seed;
    this.packedG = packedG;
    this.selectedWords = selectedWords;
    this.rankCheckpoints = rankCheckpoints;
  }

  /**
   * side-effects: none
   *
   * @param {string} sentenceText
   * @returns {number}
   */
  indexForSentence(sentenceText) {
    const hashWords = hashSentenceToWords(sentenceText);
    const vertices = hashVertices(hashWords, this.seed, this.vertexCount);
    const selectedPosition = (
      readPackedG(this.packedG, vertices[0])
      + readPackedG(this.packedG, vertices[1])
      + readPackedG(this.packedG, vertices[2])
    ) % 3;
    const selectedVertex = vertices[selectedPosition];
    const rank = rankExclusive(
      this.selectedWords,
      this.rankCheckpoints,
      selectedVertex,
    );
    return rank % this.keyCount;
  }

  /**
   * side-effects: fetches the MPHF binary.
   *
   * @param {string} mphfUrl
   * @returns {Promise<V11MphfDecoder>}
   */
  static async load(mphfUrl) {
    const response = await fetch(mphfUrl);
    if (!response.ok) {
      throw new Error(`failed to load v11 MPHF from ${mphfUrl}: ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return V11MphfDecoder.fromBytes(bytes);
  }

  /**
   * side-effects: none
   *
   * @param {Uint8Array} bytes
   * @returns {V11MphfDecoder}
   */
  static fromBytes(bytes) {
    if (bytes.length < HEADER_BYTES) {
      throw new Error(`expected at least ${HEADER_BYTES} MPHF bytes, got ${bytes.length}`);
    }
    const magic = String.fromCharCode(...bytes.slice(0, MAGIC.length));
    if (magic !== MAGIC) {
      throw new Error(`expected MPHF magic ${JSON.stringify(MAGIC)}, got ${JSON.stringify(magic)}`);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = view.getUint32(8, true);
    if (version !== FORMAT_VERSION) {
      throw new Error(`expected MPHF format version ${FORMAT_VERSION}, got ${version}`);
    }
    const keyCount = view.getUint32(12, true);
    const vertexCount = view.getUint32(16, true);
    const seed = view.getUint32(20, true);
    const packedGLength = view.getUint32(24, true);
    const selectedWordCount = view.getUint32(28, true);
    const rankCheckpointCount = view.getUint32(32, true);
    const expectedLength = (
      HEADER_BYTES
      + packedGLength
      + selectedWordCount * 4
      + rankCheckpointCount * 4
    );
    if (bytes.length !== expectedLength) {
      throw new Error(`expected MPHF byte length ${expectedLength}, got ${bytes.length}`);
    }
    let byteOffset = HEADER_BYTES;
    const packedG = bytes.slice(byteOffset, byteOffset + packedGLength);
    byteOffset += packedGLength;
    const selectedWords = new Uint32Array(selectedWordCount);
    for (let wordIndex = 0; wordIndex < selectedWordCount; wordIndex += 1) {
      selectedWords[wordIndex] = view.getUint32(byteOffset, true);
      byteOffset += 4;
    }
    const rankCheckpoints = new Uint32Array(rankCheckpointCount);
    for (let rankIndex = 0; rankIndex < rankCheckpointCount; rankIndex += 1) {
      rankCheckpoints[rankIndex] = view.getUint32(byteOffset, true);
      byteOffset += 4;
    }
    return new V11MphfDecoder(
      keyCount,
      vertexCount,
      seed,
      packedG,
      selectedWords,
      rankCheckpoints,
    );
  }
}
