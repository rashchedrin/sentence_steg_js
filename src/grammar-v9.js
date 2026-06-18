/** Grammar version 9: anonymized Tatoeba corpus. */

import { preprocessPayloadBits, postprocessPayloadBits } from "./bit-preprocess.js";
import { SentenceCorpus } from "./corpus.js";
import { paragraphLengthForStart } from "./paragraph.js";
import { cleanSentenceSurface } from "./sentence-normalize.js";

/** @type {string} */
export const GRAMMAR_V9_CORPUS_URL = `${import.meta.env.BASE_URL}data/corpora/v9/sentences.json`;

/** @type {string} */
export const GRAMMAR_V9_ID = "v9";

/** @type {string} */
export const GRAMMAR_V9_DISPLAY_NAME = "Корпус без имён персонажей";

/**
 * Encode each sentence index into an anonymized real Russian sentence.
 */
export class GrammarV9 {
  /**
   * @param {SentenceCorpus | null} corpus
   */
  constructor(corpus = null) {
    /** @type {SentenceCorpus | null} */
    this._corpus = corpus;
  }

  /** @returns {string} */
  get versionId() {
    return GRAMMAR_V9_ID;
  }

  /** @returns {string} */
  get displayName() {
    return GRAMMAR_V9_DISPLAY_NAME;
  }

  /** @returns {string} */
  get description() {
    if (this._corpus) {
      return (
        `Каждые ${this._corpus.bitsPerSentence} бит кодируют одно из `
        + `${this._corpus.corpusSize} реальных предложений; имена персонажей `
        + "заменены случайными русскими именами."
      );
    }
    return (
      "Каждые 20 бит кодируют одно из реальных предложений; "
      + "имена персонажей заменены случайными русскими именами."
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
   * @param {string} corpusUrl
   * @returns {Promise<void>}
   */
  async loadCorpus(corpusUrl = GRAMMAR_V9_CORPUS_URL) {
    this._corpus = await SentenceCorpus.loadFromUrl(corpusUrl);
  }

  /** @returns {number} */
  corpusBitsPerSentence() {
    return this.activeCorpus().bitsPerSentence;
  }

  /**
   * @param {number} sentenceIndex
   * @returns {string}
   */
  sentenceTextForCorpusIndex(sentenceIndex) {
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
    return preprocessPayloadBits(payloadBits);
  }

  /**
   * @param {string} processedPayloadBits
   * @returns {Promise<string>}
   */
  async postprocessPayloadBits(processedPayloadBits) {
    return postprocessPayloadBits(processedPayloadBits);
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

/** @type {GrammarV9} */
export const grammarV9 = new GrammarV9();
