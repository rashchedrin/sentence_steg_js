/** Registry of grammar steg versions (append new versions to GRAMMAR_DEFINITIONS). */

import { GrammarV11 } from "./grammar-v11.js";
import { GrammarV10 } from "./grammar-v10.js";
import { GrammarV9 } from "./grammar-v9.js";

/**
 * @typedef {import("./grammar-base.js").GrammarSteg} GrammarSteg
 * @typedef {{ versionId: string, displayName: string, create: () => GrammarSteg }} GrammarDefinition
 */

/** @type {readonly GrammarDefinition[]} */
const GRAMMAR_DEFINITIONS = [
  {
    versionId: "v9",
    displayName: "Версия 9 — XOR и перестановка",
    create: () => new GrammarV9(),
  },
  {
    versionId: "v10",
    displayName: "Версия 10 — сеть Фейстеля",
    create: () => new GrammarV10(),
  },
  {
    versionId: "v11",
    displayName: "Версия 11 — MPHF без membership oracle",
    create: () => new GrammarV11(),
  },
];

/** @type {string} */
export const DEFAULT_GRAMMAR_VERSION_ID = GRAMMAR_DEFINITIONS[GRAMMAR_DEFINITIONS.length - 1].versionId;

/**
 * @returns {readonly GrammarDefinition[]}
 */
export function listGrammarDefinitions() {
  return GRAMMAR_DEFINITIONS;
}

/**
 * @param {string} versionId
 * @returns {GrammarSteg}
 */
export function createGrammar(versionId) {
  const grammarDefinition = GRAMMAR_DEFINITIONS.find((item) => item.versionId === versionId);
  if (!grammarDefinition) {
    throw new Error(`unknown grammar version ${JSON.stringify(versionId)}, expected one of ${
      GRAMMAR_DEFINITIONS.map((item) => item.versionId).join(", ")
    }`);
  }
  return grammarDefinition.create();
}

/**
 * @param {string} versionId
 * @returns {boolean}
 */
export function isGrammarVersionId(versionId) {
  return GRAMMAR_DEFINITIONS.some((item) => item.versionId === versionId);
}
