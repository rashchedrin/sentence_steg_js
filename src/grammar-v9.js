/** Grammar version 9: XOR + permutation bit diffusion. */

import { xorPermuteDiffusion } from "./bit-diffusion/xor-permute.js";
import { GrammarSteg } from "./grammar-base.js";

/** @type {string} */
const BASE_URL = import.meta.env?.BASE_URL ?? "/";

/** @type {string} */
export const GRAMMAR_V9_CORPUS_URL = `${BASE_URL}data/corpora/v9/sentences.json`;

/** @type {string} */
export const GRAMMAR_V9_ID = "v9";

/** @type {string} */
export const GRAMMAR_V9_DISPLAY_NAME = "Версия 9 — XOR и перестановка";

/** Grammar v9 with anonymized Tatoeba corpus. */
export class GrammarV9 extends GrammarSteg {
  /**
   * @param {import("./corpus.js").SentenceCorpus | null} [corpus]
   */
  constructor(corpus = null) {
    super({
      versionId: GRAMMAR_V9_ID,
      displayName: GRAMMAR_V9_DISPLAY_NAME,
      diffusionSummary: "два раунда XOR с псевдослучайной гаммой и перестановки (MT19937)",
      diffusion: xorPermuteDiffusion,
      corpusUrl: GRAMMAR_V9_CORPUS_URL,
      corpus,
    });
  }
}

/** @type {GrammarV9} */
export const grammarV9 = new GrammarV9();
