/** Sentence corpus for version 8/9 index encoding. */

import { cleanSentenceSurface, normalizeSentenceKey } from "./sentence-normalize.js";

const MIN_CORPUS_SIZE = 2 ** 14;

/**
 * @typedef {object} CorpusJsonPayload
 * @property {number} corpus_size
 * @property {number} bits_per_sentence
 * @property {string[]} sentences
 */

/**
 * Bidirectional mapping between sentence indices and real Russian sentences.
 */
export class SentenceCorpus {
  /**
   * @param {string[]} sentences
   */
  constructor(sentences) {
    if (!sentences.length) {
      throw new Error("expected at least one sentence");
    }
    const sentenceCount = sentences.length;
    if (sentenceCount < MIN_CORPUS_SIZE) {
      throw new Error(`expected at least ${MIN_CORPUS_SIZE} sentences, got ${sentenceCount}`);
    }
    if ((sentenceCount & (sentenceCount - 1)) !== 0) {
      throw new Error(`expected power-of-two corpus size, got ${sentenceCount}`);
    }

    /** @type {string[]} */
    this._sentences = [];
    /** @type {Map<string, number>} */
    this._indexByNormalizedKey = new Map();
    let maxSentenceLength = 0;
    let minSentenceLength = Number.POSITIVE_INFINITY;

    for (let sentenceIndex = 0; sentenceIndex < sentences.length; sentenceIndex += 1) {
      const cleanedSentence = cleanSentenceSurface(sentences[sentenceIndex]);
      const normalizedKey = normalizeSentenceKey(cleanedSentence);
      if (!cleanedSentence) {
        throw new Error(`expected non-empty cleaned sentence for ${JSON.stringify(sentences[sentenceIndex])}`);
      }
      if (this._indexByNormalizedKey.has(normalizedKey)) {
        throw new Error(`duplicate normalized sentence key ${JSON.stringify(normalizedKey)}`);
      }
      this._indexByNormalizedKey.set(normalizedKey, sentenceIndex);
      this._sentences.push(cleanedSentence);
      maxSentenceLength = Math.max(maxSentenceLength, cleanedSentence.length);
      minSentenceLength = Math.min(minSentenceLength, cleanedSentence.length);
    }

    this.corpusSize = sentenceCount;
    this.bitsPerSentence = Math.floor(Math.log2(sentenceCount));
    this._maxSentenceLength = maxSentenceLength;
    this._minSentenceLength = minSentenceLength;
  }

  /**
   * @param {number} sentenceIndex
   * @returns {string}
   */
  sentenceAt(sentenceIndex) {
    if (sentenceIndex < 0 || sentenceIndex >= this.corpusSize) {
      throw new Error(`expected 0 <= sentenceIndex < ${this.corpusSize}, got ${sentenceIndex}`);
    }
    return this._sentences[sentenceIndex];
  }

  /**
   * @param {string} sentenceText
   * @returns {number}
   */
  indexOf(sentenceText) {
    const normalizedKey = normalizeSentenceKey(sentenceText);
    const sentenceIndex = this._indexByNormalizedKey.get(normalizedKey);
    if (sentenceIndex === undefined) {
      throw new Error(`unknown sentence ${JSON.stringify(sentenceText)}`);
    }
    return sentenceIndex;
  }

  /**
   * @param {string} text
   * @returns {{ matchedSentence: string, consumedLength: number }}
   */
  matchLongestPrefix(text) {
    if (!text) {
      throw new Error("expected non-empty text");
    }
    const leadingWhitespaceCount = text.length - text.trimStart().length;
    const remainingText = text.slice(leadingWhitespaceCount);
    if (!remainingText) {
      throw new Error("expected non-whitespace after leading whitespace");
    }
    const upperBound = Math.min(remainingText.length, this._maxSentenceLength);
    for (let candidateLength = upperBound; candidateLength >= this._minSentenceLength; candidateLength -= 1) {
      const candidateText = remainingText.slice(0, candidateLength);
      const normalizedKey = normalizeSentenceKey(candidateText);
      const sentenceIndex = this._indexByNormalizedKey.get(normalizedKey);
      if (sentenceIndex === undefined) {
        continue;
      }
      const matchedSentence = this._sentences[sentenceIndex];
      let consumedLength = leadingWhitespaceCount + candidateLength;
      while (consumedLength < text.length && /\s/.test(text[consumedLength])) {
        consumedLength += 1;
      }
      return { matchedSentence, consumedLength };
    }
    throw new Error(`cannot match corpus sentence at start of ${JSON.stringify(text)}`);
  }

  /**
   * @param {CorpusJsonPayload} payload
   * @returns {SentenceCorpus}
   */
  static fromJsonPayload(payload) {
    const corpus = new SentenceCorpus(payload.sentences);
    if (corpus.corpusSize !== payload.corpus_size) {
      throw new Error(`expected corpus_size ${payload.corpus_size}, got ${corpus.corpusSize}`);
    }
    if (corpus.bitsPerSentence !== payload.bits_per_sentence) {
      throw new Error(
        `expected bits_per_sentence ${payload.bits_per_sentence}, got ${corpus.bitsPerSentence}`,
      );
    }
    return corpus;
  }

  /**
   * @param {string} corpusUrl
   * @returns {Promise<SentenceCorpus>}
   */
  static async loadFromUrl(corpusUrl) {
    const response = await fetch(corpusUrl);
    if (!response.ok) {
      throw new Error(`failed to load corpus from ${corpusUrl}: ${response.status}`);
    }
    /** @type {CorpusJsonPayload} */
    const payload = await response.json();
    return SentenceCorpus.fromJsonPayload(payload);
  }
}
