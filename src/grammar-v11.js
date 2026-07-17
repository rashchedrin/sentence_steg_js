/** Grammar version 11: independent MPHF encoder and total decoder. */

import { decodePayloadFromReconstructed } from "./bit-stream.js";
import { feistelDiffusion } from "./bit-diffusion/feistel.js";
import { GrammarSteg } from "./grammar-base.js";
import { V11SentenceDecoder } from "./v11-decoder.js";
import { V11EncoderDictionary } from "./v11-encoder.js";

export const GRAMMAR_V11_ID = "v11";
export const GRAMMAR_V11_DISPLAY_NAME = "Версия 11 — MPHF без membership oracle";
const BASE_URL = import.meta.env?.BASE_URL ?? "/";
export const GRAMMAR_V11_RESOURCE_URL = `${BASE_URL}data/corpora/v11/extra-candidates.json`;
export const GRAMMAR_V11_MPHF_URL = `${BASE_URL}data/corpora/v11/decoder-mphf.bin`;
export const GRAMMAR_V11_ENCODER_MAP_URL = `${BASE_URL}data/corpora/v11/encoder-map.bin`;
export const GRAMMAR_V11_EXTRA_CANDIDATES_URL = (
  `${BASE_URL}data/corpora/v11/extra-candidates.json`
);
export const GRAMMAR_V11_BASE_CORPUS_URL = (
  `${BASE_URL}data/corpora/v9/sentences.json`
);

const V11_CORPUS_SIZE = 2 ** 20;
const V11_BITS_PER_SENTENCE = 20;

/** Loaded encoder and decoder resources for grammar v11. */
export class V11Resources {
  /**
   * side-effects: none
   *
   * @param {V11EncoderDictionary} encoder
   * @param {V11SentenceDecoder} decoder
   */
  constructor(encoder, decoder) {
    this.encoder = encoder;
    this.decoder = decoder;
    this.corpusSize = V11_CORPUS_SIZE;
    this.bitsPerSentence = V11_BITS_PER_SENTENCE;
  }
}

/** V11 grammar with encoder dictionary separated from total MPHF decoder. */
export class GrammarV11 extends GrammarSteg {
  /**
   * side-effects: none
   *
   * @param {V11Resources | null} [resources]
   */
  constructor(resources = null) {
    super({
      versionId: GRAMMAR_V11_ID,
      displayName: GRAMMAR_V11_DISPLAY_NAME,
      diffusionSummary: (
        "несбалансированная сеть Фейстеля (SHAKE-256, 4 раунда); "
        + "предложения декодируются через SHAKE-256/128 + BDZ MPHF"
      ),
      diffusion: feistelDiffusion,
      corpusUrl: GRAMMAR_V11_RESOURCE_URL,
      corpus: null,
    });
    /** @type {V11Resources | null} */
    this._resources = resources;
  }

  /**
   * side-effects: none
   *
   * @returns {string}
   */
  get description() {
    return (
      "Каждые 20 бит кодируют одно из реальных или мутированных предложений. "
      + "Декодер не содержит словаря membership: любое предложение получает 20-битный индекс "
      + "через SHAKE-256/128 + BDZ MPHF. "
      + `Перемешивание бит: ${this.diffusionSummary}.`
    );
  }

  /**
   * side-effects: none
   *
   * @returns {V11Resources}
   */
  activeCorpus() {
    if (!this._resources) {
      throw new Error("v11 resources are not loaded; call loadCorpus() first");
    }
    return this._resources;
  }

  /**
   * side-effects: updates active v11 resources
   *
   * @param {V11Resources} resources
   * @returns {void}
   */
  setCorpus(resources) {
    if (!(resources instanceof V11Resources)) {
      throw new Error(
        `expected V11Resources, got ${Object.prototype.toString.call(resources)}`,
      );
    }
    this._resources = resources;
  }

  /**
   * side-effects: fetches decoder MPHF and encoder dictionaries
   *
   * @param {string} [_resourceUrl]
   * @returns {Promise<void>}
   */
  async loadCorpus(_resourceUrl = GRAMMAR_V11_RESOURCE_URL) {
    const [encoder, decoder] = await Promise.all([
      V11EncoderDictionary.load(
        GRAMMAR_V11_BASE_CORPUS_URL,
        GRAMMAR_V11_ENCODER_MAP_URL,
        GRAMMAR_V11_EXTRA_CANDIDATES_URL,
      ),
      V11SentenceDecoder.load(GRAMMAR_V11_MPHF_URL),
    ]);
    this._resources = new V11Resources(encoder, decoder);
  }

  /**
   * side-effects: none
   *
   * @returns {number}
   */
  corpusBitsPerSentence() {
    return V11_BITS_PER_SENTENCE;
  }

  /**
   * side-effects: none
   *
   * @param {number} sentenceIndex
   * @param {number} [coverSentenceIndex]
   * @returns {string}
   */
  sentenceTextForCorpusIndex(sentenceIndex, coverSentenceIndex = 0) {
    return this.activeCorpus().encoder.sentenceForTarget(
      sentenceIndex,
      coverSentenceIndex,
    );
  }

  /**
   * side-effects: none
   *
   * @param {string} sentenceText
   * @returns {number}
   */
  corpusIndexForSentence(sentenceText) {
    return this.activeCorpus().decoder.mphfDecoder.indexForSentence(sentenceText);
  }

  /**
   * side-effects: none
   *
   * @param {string} coverText
   * @returns {string[]}
   */
  splitSentences(coverText) {
    return this.activeCorpus().decoder.decodeText(coverText).sentences;
  }

  /**
   * For arbitrary text that hashes to all-zero reconstructed bits, preserve
   * those bits instead of rejecting a missing sentinel. Real encoder output
   * still uses and removes the sentinel normally.
   *
   * side-effects: none
   *
   * @param {string} reconstructedBits
   * @returns {string}
   */
  decodeReconstructedBits(reconstructedBits) {
    if (!reconstructedBits.includes("1")) {
      return reconstructedBits;
    }
    return decodePayloadFromReconstructed(reconstructedBits);
  }

  /**
   * Exact regeneration would itself be a membership oracle and would reject
   * deliberate MPHF collisions, so v11 authenticates only at payload layers.
   *
   * side-effects: none
   *
   * @returns {boolean}
   */
  requiresCoverRegenerationValidation() {
    return false;
  }
}

/** @type {GrammarV11} */
export const grammarV11 = new GrammarV11();
