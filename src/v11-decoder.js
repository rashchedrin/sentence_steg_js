/** Independent v11 decoder: punctuation splitting + hash + total MPHF. */

import { cleanSentenceSurface } from "./sentence-normalize.js";
import { V11MphfDecoder } from "./v11-mphf.js";

const SENTENCE_TERMINATOR_PATTERN = /[.!?]+(?=\s|$)/gu;

/**
 * Split text after a run of .!? followed by whitespace/end.
 * A trailing unterminated fragment is still treated as a sentence so decoding
 * arbitrary text does not become a corpus-membership oracle.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function splitV11Sentences(text) {
  const cleanedText = cleanSentenceSurface(text);
  if (!cleanedText) {
    return [];
  }
  const sentences = [];
  let sentenceStart = 0;
  SENTENCE_TERMINATOR_PATTERN.lastIndex = 0;
  for (const terminatorMatch of cleanedText.matchAll(SENTENCE_TERMINATOR_PATTERN)) {
    if (terminatorMatch.index === undefined) {
      throw new Error(`expected terminator match index in ${JSON.stringify(cleanedText)}`);
    }
    const sentenceEnd = terminatorMatch.index + terminatorMatch[0].length;
    const sentence = cleanedText.slice(sentenceStart, sentenceEnd).trim();
    if (sentence) {
      sentences.push(sentence);
    }
    sentenceStart = sentenceEnd;
    while (sentenceStart < cleanedText.length && /\s/u.test(cleanedText[sentenceStart])) {
      sentenceStart += 1;
    }
  }
  const trailingSentence = cleanedText.slice(sentenceStart).trim();
  if (trailingSentence) {
    sentences.push(trailingSentence);
  }
  return sentences;
}

/** Decode every sentence through a total MPHF without membership checks. */
export class V11SentenceDecoder {
  /**
   * side-effects: none
   *
   * @param {V11MphfDecoder} mphfDecoder
   */
  constructor(mphfDecoder) {
    this.mphfDecoder = mphfDecoder;
  }

  /**
   * side-effects: none
   *
   * @param {string} text
   * @returns {{ sentences: string[], indices: number[] }}
   */
  decodeText(text) {
    const sentences = splitV11Sentences(text);
    const indices = sentences.map((sentence) => this.mphfDecoder.indexForSentence(sentence));
    return { sentences, indices };
  }

  /**
   * side-effects: fetches the MPHF binary.
   *
   * @param {string} mphfUrl
   * @returns {Promise<V11SentenceDecoder>}
   */
  static async load(mphfUrl) {
    return new V11SentenceDecoder(await V11MphfDecoder.load(mphfUrl));
  }
}
