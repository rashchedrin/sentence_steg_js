/** Shared sentence-corpus steganography grammar implementation. */

import { SentenceCorpus } from "./corpus.js";
import { decodePayloadFromReconstructed } from "./bit-stream.js";
import { paragraphLengthForStart } from "./paragraph.js";
import { cleanSentenceSurface } from "./sentence-normalize.js";

/**
 * @typedef {import("./bit-diffusion/types.js").BitDiffusion} BitDiffusion
 */

/**
 * @typedef {object} GrammarConfig
 * @property {string} versionId
 * @property {string} displayName
 * @property {string} diffusionSummary
 * @property {BitDiffusion} diffusion
 * @property {string} corpusUrl
 * @property {SentenceCorpus | null} [corpus]
 */

/** Base grammar: corpus lookup, cover text layout, bit diffusion hooks. */
export class GrammarSteg {
  /**
   * @param {GrammarConfig} config
   */
  constructor(config) {
    /** @type {string} */
    this._versionId = config.versionId;
    /** @type {string} */
    this._displayName = config.displayName;
    /** @type {string} */
    this._diffusionSummary = config.diffusionSummary;
    /** @type {BitDiffusion} */
    this._diffusion = config.diffusion;
    /** @type {string} */
    this._corpusUrl = config.corpusUrl;
    /** @type {SentenceCorpus | null} */
    this._corpus = config.corpus ?? null;
  }

  /** @returns {string} */
  get versionId() {
    return this._versionId;
  }

  /** @returns {string} */
  get displayName() {
    return this._displayName;
  }

  /** @returns {string} */
  get corpusUrl() {
    return this._corpusUrl;
  }

  /** @returns {string} */
  get diffusionSummary() {
    return this._diffusionSummary;
  }

  /** @returns {string} */
  get description() {
    if (this._corpus) {
      return (
        `Каждые ${this._corpus.bitsPerSentence} бит кодируют одно из `
        + `${this._corpus.corpusSize} реальных предложений. `
        + `Перемешивание бит: ${this._diffusionSummary}.`
      );
    }
    return (
      "Каждые 20 бит кодируют одно из реальных предложений. "
      + `Перемешивание бит: ${this._diffusionSummary}.`
    );
  }

  /** @returns {SentenceCorpus} */
  activeCorpus() {
    if (!this._corpus) {
      throw new Error("corpus is not loaded; call loadCorpus() first");
    }
    return this._corpus;
  }

  /**
   * @param {SentenceCorpus} corpus
   * @returns {void}
   */
  setCorpus(corpus) {
    this._corpus = corpus;
  }

  /**
   * @param {string} [corpusUrl]
   * @returns {Promise<void>}
   */
  async loadCorpus(corpusUrl = this._corpusUrl) {
    this._corpus = await SentenceCorpus.loadFromUrl(corpusUrl);
  }

  /** @returns {number} */
  corpusBitsPerSentence() {
    return this.activeCorpus().bitsPerSentence;
  }

  /**
   * @param {number} sentenceIndex
   * @param {number} [_coverSentenceIndex]
   * @returns {string}
   */
  sentenceTextForCorpusIndex(sentenceIndex, _coverSentenceIndex = 0) {
    return this.activeCorpus().sentenceAt(sentenceIndex);
  }

  /**
   * @param {string} sentenceText
   * @returns {number}
   */
  corpusIndexForSentence(sentenceText) {
    return this.activeCorpus().indexOf(sentenceText);
  }

  /**
   * @param {string} payloadBits
   * @returns {Promise<string>}
   */
  async preprocessPayloadBits(payloadBits) {
    return this._diffusion.preprocess(payloadBits);
  }

  /**
   * @param {string} processedPayloadBits
   * @returns {Promise<string>}
   */
  async postprocessPayloadBits(processedPayloadBits) {
    return this._diffusion.postprocess(processedPayloadBits);
  }

  /**
   * Decode the sentinel/padding layer from reconstructed sentence bits.
   *
   * side-effects: none
   *
   * @param {string} reconstructedBits
   * @returns {string}
   */
  decodeReconstructedBits(reconstructedBits) {
    return decodePayloadFromReconstructed(reconstructedBits);
  }

  /**
   * Whether parsing must regenerate exactly the same cover text.
   *
   * side-effects: none
   *
   * @returns {boolean}
   */
  requiresCoverRegenerationValidation() {
    return true;
  }

  /**
   * @param {string} rawText
   * @returns {string}
   */
  normalizeCoverText(rawText) {
    const unifiedText = rawText.replace(/\r\n/g, "\n").replace(/\n\n/g, " ");
    return cleanSentenceSurface(unifiedText);
  }

  /**
   * @param {string[]} sentences
   * @returns {string}
   */
  joinCoverSentences(sentences) {
    if (!sentences.length) {
      throw new Error("expected at least one sentence");
    }
    const paragraphTexts = [];
    let sentenceIndex = 0;
    while (sentenceIndex < sentences.length) {
      const paragraphLength = paragraphLengthForStart(sentenceIndex, sentences[sentenceIndex]);
      const sentencesInParagraph = Math.min(paragraphLength, sentences.length - sentenceIndex);
      paragraphTexts.push(
        sentences.slice(sentenceIndex, sentenceIndex + sentencesInParagraph).join(" "),
      );
      sentenceIndex += sentencesInParagraph;
    }
    return paragraphTexts.join("\n\n");
  }

  /**
   * @param {string} coverText
   * @returns {string[]}
   */
  splitSentences(coverText) {
    const strippedText = coverText.trim();
    if (!strippedText) {
      throw new Error("expected non-empty cover text");
    }
    const corpus = this.activeCorpus();
    const matchedSentences = [];
    let remainingText = strippedText;
    while (remainingText) {
      const { matchedSentence, consumedLength } = corpus.matchLongestPrefix(remainingText);
      matchedSentences.push(matchedSentence);
      remainingText = remainingText.slice(consumedLength).trim();
    }
    if (!matchedSentences.length) {
      throw new Error(`expected at least one sentence in ${JSON.stringify(coverText)}`);
    }
    return matchedSentences;
  }
}
