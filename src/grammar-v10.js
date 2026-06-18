/** Grammar version 10: unbalanced Feistel bit diffusion. */

import { feistelDiffusion } from "./bit-diffusion/feistel.js";
import { GRAMMAR_V9_CORPUS_URL } from "./grammar-v9.js";
import { GrammarSteg } from "./grammar-base.js";

/** @type {string} */
export const GRAMMAR_V10_ID = "v10";

/** @type {string} */
export const GRAMMAR_V10_DISPLAY_NAME = "Версия 10 — сеть Фейстеля";

/** Grammar v10: same corpus as v9, Feistel diffusion for avalanche effect. */
export class GrammarV10 extends GrammarSteg {
  /**
   * @param {import("./corpus.js").SentenceCorpus | null} [corpus]
   */
  constructor(corpus = null) {
    super({
      versionId: GRAMMAR_V10_ID,
      displayName: GRAMMAR_V10_DISPLAY_NAME,
      diffusionSummary: (
        "несбалансированная сеть Фейстеля (SHAKE-256, 4 раунда, сид feistel_iv); "
        + "изменение одного бита меняет ~половину выходных бит"
      ),
      diffusion: feistelDiffusion,
      corpusUrl: GRAMMAR_V9_CORPUS_URL,
      corpus,
    });
  }
}

/** @type {GrammarV10} */
export const grammarV10 = new GrammarV10();
