/** BDZ-style minimal perfect hash prototype for pre-hashed keys. */

const HASH_WORDS_PER_KEY = 4;
const VERTICES_PER_EDGE = 3;
const G_VALUES_PER_BYTE = 4;
const G_VALUE_MASK = 0x03;
const RANK_STRIDE_BITS = 256;
const WORD_BITS = 32;
const BINARY_MAGIC = "V11MPHF\0";
const BINARY_VERSION = 1;
const BINARY_HEADER_BYTES = 36;

/**
 * Mix one unsigned 32-bit word.
 *
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
 * Return three distinct hypergraph vertices for one key.
 *
 * @param {Uint32Array} hashWords shape: (n_keys * 4,)
 * @param {number} keyIndex
 * @param {number} seed
 * @param {number} vertexCount
 * @returns {[number, number, number]}
 */
function keyVertices(hashWords, keyIndex, seed, vertexCount) {
  const wordOffset = keyIndex * HASH_WORDS_PER_KEY;
  const vertex0 = mixUint32(hashWords[wordOffset] ^ seed ^ 0x243f6a88) % vertexCount;
  let vertex1 = mixUint32(hashWords[wordOffset + 1] ^ seed ^ 0x85a308d3) % vertexCount;
  let vertex2 = mixUint32(hashWords[wordOffset + 2] ^ seed ^ 0x13198a2e) % vertexCount;
  if (vertex1 === vertex0) {
    vertex1 = (vertex1 + 1) % vertexCount;
  }
  while (vertex2 === vertex0 || vertex2 === vertex1) {
    vertex2 = (vertex2 + 1) % vertexCount;
  }
  return [vertex0, vertex1, vertex2];
}

/**
 * Count set bits in one unsigned 32-bit word.
 *
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
  return (packedG[byteIndex] >>> shift) & G_VALUE_MASK;
}

/**
 * @param {Uint8Array} packedG
 * @param {number} vertexIndex
 * @param {number} gValue
 * @returns {void}
 */
function writePackedG(packedG, vertexIndex, gValue) {
  const byteIndex = Math.floor(vertexIndex / G_VALUES_PER_BYTE);
  const shift = (vertexIndex % G_VALUES_PER_BYTE) * 2;
  const clearMask = ~(G_VALUE_MASK << shift);
  packedG[byteIndex] = (packedG[byteIndex] & clearMask) | (gValue << shift);
}

/**
 * @param {Uint32Array} selectedWords
 * @param {number} vertexIndex
 * @returns {void}
 */
function markSelectedVertex(selectedWords, vertexIndex) {
  const wordIndex = Math.floor(vertexIndex / WORD_BITS);
  const bitIndex = vertexIndex % WORD_BITS;
  selectedWords[wordIndex] |= (1 << bitIndex) >>> 0;
}

/**
 * Build prefix popcounts at fixed-size rank checkpoints.
 *
 * @param {Uint32Array} selectedWords
 * @param {number} vertexCount
 * @returns {Uint32Array}
 */
function buildRankCheckpoints(selectedWords, vertexCount) {
  const checkpointCount = Math.ceil(vertexCount / RANK_STRIDE_BITS) + 1;
  const rankCheckpoints = new Uint32Array(checkpointCount);
  let selectedCount = 0;
  const wordsPerCheckpoint = RANK_STRIDE_BITS / WORD_BITS;
  for (let checkpointIndex = 0; checkpointIndex < checkpointCount - 1; checkpointIndex += 1) {
    rankCheckpoints[checkpointIndex] = selectedCount;
    const firstWordIndex = checkpointIndex * wordsPerCheckpoint;
    const wordLimit = Math.min(firstWordIndex + wordsPerCheckpoint, selectedWords.length);
    for (let wordIndex = firstWordIndex; wordIndex < wordLimit; wordIndex += 1) {
      selectedCount += popcountUint32(selectedWords[wordIndex]);
    }
  }
  rankCheckpoints[checkpointCount - 1] = selectedCount;
  return rankCheckpoints;
}

/**
 * Return number of selected vertices strictly before vertexIndex.
 *
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
  const bitsBeforeInTargetWord = vertexIndex % WORD_BITS;
  if (bitsBeforeInTargetWord > 0) {
    const lowBitsMask = (2 ** bitsBeforeInTargetWord - 1) >>> 0;
    rank += popcountUint32(selectedWords[targetWordIndex] & lowBitsMask);
  }
  return rank;
}

/**
 * @typedef {object} BdzMphf
 * @property {number} keyCount
 * @property {number} vertexCount
 * @property {number} seed
 * @property {Uint8Array} packedG
 * @property {Uint32Array} selectedWords
 * @property {Uint32Array} rankCheckpoints
 */

/**
 * Attempt to build one peelable BDZ hypergraph.
 *
 * @param {Uint32Array} hashWords shape: (n_keys * 4,)
 * @param {number} seed
 * @param {number} vertexRatio
 * @returns {BdzMphf | null}
 */
export function tryBuildBdzMphf(hashWords, seed, vertexRatio = 1.23) {
  if (hashWords.length === 0 || hashWords.length % HASH_WORDS_PER_KEY !== 0) {
    throw new Error(
      `expected non-empty hashWords length divisible by ${HASH_WORDS_PER_KEY}, got ${hashWords.length}`,
    );
  }
  const keyCount = hashWords.length / HASH_WORDS_PER_KEY;
  const vertexCount = Math.ceil(keyCount * vertexRatio);
  const degrees = new Uint32Array(vertexCount);
  const xorEdges = new Uint32Array(vertexCount);

  for (let keyIndex = 0; keyIndex < keyCount; keyIndex += 1) {
    const vertices = keyVertices(hashWords, keyIndex, seed, vertexCount);
    for (const vertexIndex of vertices) {
      degrees[vertexIndex] += 1;
      xorEdges[vertexIndex] ^= keyIndex;
    }
  }

  const queue = new Uint32Array(vertexCount);
  let queueReadIndex = 0;
  let queueWriteIndex = 0;
  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
    if (degrees[vertexIndex] === 1) {
      queue[queueWriteIndex] = vertexIndex;
      queueWriteIndex += 1;
    }
  }

  const peeledEdges = new Uint32Array(keyCount);
  const peeledVertices = new Uint32Array(keyCount);
  let peeledCount = 0;
  while (queueReadIndex < queueWriteIndex) {
    const peeledVertex = queue[queueReadIndex];
    queueReadIndex += 1;
    if (degrees[peeledVertex] !== 1) {
      continue;
    }
    const edgeIndex = xorEdges[peeledVertex];
    peeledEdges[peeledCount] = edgeIndex;
    peeledVertices[peeledCount] = peeledVertex;
    peeledCount += 1;
    const vertices = keyVertices(hashWords, edgeIndex, seed, vertexCount);
    for (const vertexIndex of vertices) {
      if (degrees[vertexIndex] === 0) {
        throw new Error(
          `expected positive degree while peeling edge ${edgeIndex}, got 0 at vertex ${vertexIndex}`,
        );
      }
      degrees[vertexIndex] -= 1;
      xorEdges[vertexIndex] ^= edgeIndex;
      if (degrees[vertexIndex] === 1) {
        queue[queueWriteIndex] = vertexIndex;
        queueWriteIndex += 1;
      }
    }
  }
  if (peeledCount !== keyCount) {
    return null;
  }

  const packedG = new Uint8Array(Math.ceil(vertexCount / G_VALUES_PER_BYTE));
  const selectedWords = new Uint32Array(Math.ceil(vertexCount / WORD_BITS));
  for (let peelIndex = keyCount - 1; peelIndex >= 0; peelIndex -= 1) {
    const edgeIndex = peeledEdges[peelIndex];
    const selectedVertex = peeledVertices[peelIndex];
    const vertices = keyVertices(hashWords, edgeIndex, seed, vertexCount);
    const selectedPosition = vertices.indexOf(selectedVertex);
    if (selectedPosition < 0) {
      throw new Error(
        `expected peeled vertex ${selectedVertex} in edge ${edgeIndex}, got ${vertices.join(",")}`,
      );
    }
    let otherGSum = 0;
    for (const vertexIndex of vertices) {
      if (vertexIndex !== selectedVertex) {
        otherGSum += readPackedG(packedG, vertexIndex);
      }
    }
    const selectedG = (selectedPosition - (otherGSum % VERTICES_PER_EDGE) + VERTICES_PER_EDGE)
      % VERTICES_PER_EDGE;
    writePackedG(packedG, selectedVertex, selectedG);
    markSelectedVertex(selectedWords, selectedVertex);
  }
  const rankCheckpoints = buildRankCheckpoints(selectedWords, vertexCount);
  if (rankCheckpoints[rankCheckpoints.length - 1] !== keyCount) {
    throw new Error(
      `expected ${keyCount} selected vertices, got ${rankCheckpoints[rankCheckpoints.length - 1]}`,
    );
  }
  return {
    keyCount,
    vertexCount,
    seed,
    packedG,
    selectedWords,
    rankCheckpoints,
  };
}

/**
 * Build a BDZ MPHF, retrying deterministic seeds until the graph peels.
 *
 * @param {Uint32Array} hashWords shape: (n_keys * 4,)
 * @param {{ vertexRatio?: number, maxAttempts?: number }} [options]
 * @returns {BdzMphf}
 */
export function buildBdzMphf(hashWords, options = {}) {
  const vertexRatio = options.vertexRatio ?? 1.23;
  const maxAttempts = options.maxAttempts ?? 64;
  for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
    const seed = mixUint32(0x9e3779b9 + attemptIndex);
    const mphf = tryBuildBdzMphf(hashWords, seed, vertexRatio);
    if (mphf !== null) {
      return mphf;
    }
  }
  throw new Error(
    `failed to build BDZ MPHF after ${maxAttempts} attempts at vertexRatio ${vertexRatio}`,
  );
}

/**
 * Evaluate the MPHF for any hash. For member keys this is a bijection onto
 * [0, keyCount). Non-members also receive an index (no membership oracle).
 *
 * @param {BdzMphf} mphf
 * @param {Uint32Array} hashWords shape: (4,)
 * @returns {number}
 */
export function evaluateBdzMphf(mphf, hashWords) {
  if (hashWords.length !== HASH_WORDS_PER_KEY) {
    throw new Error(
      `expected ${HASH_WORDS_PER_KEY} hash words, got ${hashWords.length}`,
    );
  }
  const vertices = keyVertices(hashWords, 0, mphf.seed, mphf.vertexCount);
  const selectedPosition = (
    readPackedG(mphf.packedG, vertices[0])
    + readPackedG(mphf.packedG, vertices[1])
    + readPackedG(mphf.packedG, vertices[2])
  ) % VERTICES_PER_EDGE;
  const selectedVertex = vertices[selectedPosition];
  const rank = rankExclusive(mphf.selectedWords, mphf.rankCheckpoints, selectedVertex);
  return rank % mphf.keyCount;
}

/**
 * Verify that every build key maps to a distinct index in [0, keyCount).
 *
 * @param {BdzMphf} mphf
 * @param {Uint32Array} hashWords shape: (n_keys * 4,)
 * @returns {void}
 */
export function verifyBdzMphf(mphf, hashWords) {
  const expectedWordCount = mphf.keyCount * HASH_WORDS_PER_KEY;
  if (hashWords.length !== expectedWordCount) {
    throw new Error(`expected ${expectedWordCount} hash words, got ${hashWords.length}`);
  }
  const seen = new Uint8Array(mphf.keyCount);
  for (let keyIndex = 0; keyIndex < mphf.keyCount; keyIndex += 1) {
    const wordOffset = keyIndex * HASH_WORDS_PER_KEY;
    const outputIndex = evaluateBdzMphf(
      mphf,
      hashWords.subarray(wordOffset, wordOffset + HASH_WORDS_PER_KEY),
    );
    if (seen[outputIndex]) {
      throw new Error(`MPHF collision at output ${outputIndex} for key ${keyIndex}`);
    }
    seen[outputIndex] = 1;
  }
}

/**
 * Return serialized runtime bytes (without hashes/build scratch data).
 *
 * @param {BdzMphf} mphf
 * @returns {number}
 */
export function serializedRuntimeByteLength(mphf) {
  return (
    mphf.packedG.byteLength
    + mphf.selectedWords.byteLength
    + mphf.rankCheckpoints.byteLength
    + BINARY_HEADER_BYTES
  );
}

/**
 * Serialize the runtime MPHF structure to a compact little-endian binary file.
 *
 * @param {BdzMphf} mphf
 * @returns {Uint8Array}
 */
export function serializeBdzMphf(mphf) {
  const outputBytes = new Uint8Array(serializedRuntimeByteLength(mphf));
  const outputView = new DataView(outputBytes.buffer);
  for (let characterIndex = 0; characterIndex < BINARY_MAGIC.length; characterIndex += 1) {
    outputBytes[characterIndex] = BINARY_MAGIC.charCodeAt(characterIndex);
  }
  outputView.setUint32(8, BINARY_VERSION, true);
  outputView.setUint32(12, mphf.keyCount, true);
  outputView.setUint32(16, mphf.vertexCount, true);
  outputView.setUint32(20, mphf.seed, true);
  outputView.setUint32(24, mphf.packedG.length, true);
  outputView.setUint32(28, mphf.selectedWords.length, true);
  outputView.setUint32(32, mphf.rankCheckpoints.length, true);
  let byteOffset = BINARY_HEADER_BYTES;
  outputBytes.set(mphf.packedG, byteOffset);
  byteOffset += mphf.packedG.byteLength;
  for (const selectedWord of mphf.selectedWords) {
    outputView.setUint32(byteOffset, selectedWord, true);
    byteOffset += 4;
  }
  for (const rankCheckpoint of mphf.rankCheckpoints) {
    outputView.setUint32(byteOffset, rankCheckpoint, true);
    byteOffset += 4;
  }
  if (byteOffset !== outputBytes.length) {
    throw new Error(`expected serialized offset ${outputBytes.length}, got ${byteOffset}`);
  }
  return outputBytes;
}
