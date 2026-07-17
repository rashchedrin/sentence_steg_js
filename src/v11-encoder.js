/** Independent v11 encoder dictionary (no decoder membership map). */

const ENCODER_MAP_MAGIC = "V11EMAP\0";
const ENCODER_MAP_VERSION = 1;
const ENCODER_MAP_HEADER_BYTES = 16;
const TARGET_COUNT = 2 ** 20;

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
 * Parse target-index -> base-corpus-index mapping.
 *
 * @param {Uint8Array} bytes
 * @returns {Uint32Array} shape: (2^20,)
 */
function parseEncoderMap(bytes) {
  if (bytes.length < ENCODER_MAP_HEADER_BYTES) {
    throw new Error(
      `expected at least ${ENCODER_MAP_HEADER_BYTES} encoder-map bytes, got ${bytes.length}`,
    );
  }
  const magic = String.fromCharCode(...bytes.slice(0, ENCODER_MAP_MAGIC.length));
  if (magic !== ENCODER_MAP_MAGIC) {
    throw new Error(
      `expected encoder-map magic ${JSON.stringify(ENCODER_MAP_MAGIC)}, got ${JSON.stringify(magic)}`,
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(8, true);
  const targetCount = view.getUint32(12, true);
  if (version !== ENCODER_MAP_VERSION) {
    throw new Error(`expected encoder-map version ${ENCODER_MAP_VERSION}, got ${version}`);
  }
  if (targetCount !== TARGET_COUNT) {
    throw new Error(`expected encoder-map target count ${TARGET_COUNT}, got ${targetCount}`);
  }
  const expectedLength = ENCODER_MAP_HEADER_BYTES + targetCount * 4;
  if (bytes.length !== expectedLength) {
    throw new Error(`expected encoder-map byte length ${expectedLength}, got ${bytes.length}`);
  }
  const targetToSourceIndex = new Uint32Array(targetCount);
  let byteOffset = ENCODER_MAP_HEADER_BYTES;
  for (let targetIndex = 0; targetIndex < targetCount; targetIndex += 1) {
    targetToSourceIndex[targetIndex] = view.getUint32(byteOffset, true);
    byteOffset += 4;
  }
  return targetToSourceIndex;
}

/**
 * Encoder-only target-to-sentence dictionary. The decoder never receives this data.
 */
export class V11EncoderDictionary {
  /**
   * side-effects: none
   *
   * @param {string[]} baseSentences shape: (2^20,)
   * @param {Uint32Array} targetToSourceIndex shape: (2^20,)
   * @param {Map<number, string[]>} extraCandidatesByTarget
   */
  constructor(baseSentences, targetToSourceIndex, extraCandidatesByTarget) {
    if (baseSentences.length !== TARGET_COUNT) {
      throw new Error(`expected ${TARGET_COUNT} base sentences, got ${baseSentences.length}`);
    }
    if (targetToSourceIndex.length !== TARGET_COUNT) {
      throw new Error(
        `expected ${TARGET_COUNT} encoder-map entries, got ${targetToSourceIndex.length}`,
      );
    }
    this.baseSentences = baseSentences;
    this.targetToSourceIndex = targetToSourceIndex;
    this.extraCandidatesByTarget = extraCandidatesByTarget;
  }

  /**
   * Select one candidate deterministically from target and cover position.
   *
   * side-effects: none
   *
   * @param {number} targetIndex
   * @param {number} coverSentenceIndex
   * @returns {string}
   */
  sentenceForTarget(targetIndex, coverSentenceIndex) {
    if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= TARGET_COUNT) {
      throw new Error(`expected 0 <= targetIndex < ${TARGET_COUNT}, got ${targetIndex}`);
    }
    if (!Number.isInteger(coverSentenceIndex) || coverSentenceIndex < 0) {
      throw new Error(
        `expected non-negative integer coverSentenceIndex, got ${coverSentenceIndex}`,
      );
    }
    const sourceIndex = this.targetToSourceIndex[targetIndex];
    if (sourceIndex >= this.baseSentences.length) {
      throw new Error(
        `expected sourceIndex < ${this.baseSentences.length}, got ${sourceIndex}`,
      );
    }
    const extraCandidates = this.extraCandidatesByTarget.get(targetIndex) ?? [];
    const candidateCount = 1 + extraCandidates.length;
    const choice = mixUint32(
      targetIndex ^ Math.imul(coverSentenceIndex + 1, 0x9e3779b9),
    ) % candidateCount;
    if (choice === 0) {
      return this.baseSentences[sourceIndex];
    }
    return extraCandidates[choice - 1];
  }

  /**
   * side-effects: fetches base corpus, encoder map, and extra candidates.
   *
   * @param {string} baseCorpusUrl
   * @param {string} encoderMapUrl
   * @param {string} extraCandidatesUrl
   * @returns {Promise<V11EncoderDictionary>}
   */
  static async load(baseCorpusUrl, encoderMapUrl, extraCandidatesUrl) {
    const [baseResponse, mapResponse, extrasResponse] = await Promise.all([
      fetch(baseCorpusUrl),
      fetch(encoderMapUrl),
      fetch(extraCandidatesUrl),
    ]);
    if (!baseResponse.ok) {
      throw new Error(`failed to load v11 base corpus: ${baseResponse.status}`);
    }
    if (!mapResponse.ok) {
      throw new Error(`failed to load v11 encoder map: ${mapResponse.status}`);
    }
    if (!extrasResponse.ok) {
      throw new Error(`failed to load v11 extra candidates: ${extrasResponse.status}`);
    }
    const [basePayload, mapBuffer, extrasPayload] = await Promise.all([
      baseResponse.json(),
      mapResponse.arrayBuffer(),
      extrasResponse.json(),
    ]);
    return V11EncoderDictionary.fromPayloads(
      basePayload,
      new Uint8Array(mapBuffer),
      extrasPayload,
    );
  }

  /**
   * side-effects: none
   *
   * @param {{ corpus_size: number, sentences: string[] }} basePayload
   * @param {Uint8Array} mapBytes
   * @param {{ format: string, candidates: Array<[number, string]> }} extrasPayload
   * @returns {V11EncoderDictionary}
   */
  static fromPayloads(basePayload, mapBytes, extrasPayload) {
    if (basePayload.corpus_size !== TARGET_COUNT || !Array.isArray(basePayload.sentences)) {
      throw new Error(
        `expected base corpus_size ${TARGET_COUNT}, got ${basePayload.corpus_size}`,
      );
    }
    if (
      extrasPayload.format !== "v11-extra-candidates-v1"
      || !Array.isArray(extrasPayload.candidates)
    ) {
      throw new Error(
        `expected v11-extra-candidates-v1 payload, got ${extrasPayload.format}`,
      );
    }
    const extraCandidatesByTarget = new Map();
    for (const candidateEntry of extrasPayload.candidates) {
      if (!Array.isArray(candidateEntry) || candidateEntry.length !== 2) {
        throw new Error(`expected [target, sentence], got ${JSON.stringify(candidateEntry)}`);
      }
      const [targetIndex, sentence] = candidateEntry;
      if (
        !Number.isInteger(targetIndex)
        || targetIndex < 0
        || targetIndex >= TARGET_COUNT
        || typeof sentence !== "string"
      ) {
        throw new Error(`invalid extra candidate ${JSON.stringify(candidateEntry)}`);
      }
      const targetCandidates = extraCandidatesByTarget.get(targetIndex) ?? [];
      targetCandidates.push(sentence);
      extraCandidatesByTarget.set(targetIndex, targetCandidates);
    }
    return new V11EncoderDictionary(
      basePayload.sentences,
      parseEncoderMap(mapBytes),
      extraCandidatesByTarget,
    );
  }
}
