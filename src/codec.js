/** Encode and decode bit payloads using a grammar steg version. */

import { BitReader, BitWriter, PAYLOAD_SENTINEL_BIT, decodePayloadFromReconstructed } from "./bit-stream.js";
import { GrammarSteg } from "./grammar-base.js";

/**
 * @param {BitReader} reader
 * @param {GrammarSteg} grammar
 * @returns {string}
 */
function generateSentence(reader, grammar) {
  const sentenceIndex = reader.bitsToIndex(grammar.corpusBitsPerSentence());
  return grammar.sentenceTextForCorpusIndex(sentenceIndex);
}

/**
 * @param {string} payloadBits
 * @param {GrammarSteg} grammar
 * @returns {Promise<string>}
 */
export async function generateText(payloadBits, grammar) {
  if (![...payloadBits].every((bitCharacter) => bitCharacter === "0" || bitCharacter === "1")) {
    throw new Error(`expected only 0/1, got ${JSON.stringify(payloadBits)}`);
  }
  const processedBits = await grammar.preprocessPayloadBits(payloadBits);
  const encodedBits = processedBits + PAYLOAD_SENTINEL_BIT;
  const reader = new BitReader(encodedBits);
  const sentences = [];
  while (reader.hasExplicitRemaining) {
    sentences.push(generateSentence(reader, grammar));
  }
  return grammar.joinCoverSentences(sentences);
}

/**
 * @param {string} coverText
 * @param {GrammarSteg} grammar
 * @returns {string}
 */
function reconstructBits(coverText, grammar) {
  const writer = new BitWriter();
  for (const sentenceText of grammar.splitSentences(coverText)) {
    const sentenceIndex = grammar.corpusIndexForSentence(sentenceText);
    writer.writeIndex(sentenceIndex, grammar.corpusBitsPerSentence());
  }
  return writer.toString();
}

/**
 * @param {string} coverText
 * @param {GrammarSteg} grammar
 * @returns {Promise<string>}
 */
export async function parseText(coverText, grammar) {
  const normalizedText = grammar.normalizeCoverText(coverText);
  if (!normalizedText) {
    return "";
  }
  const reconstructedBits = reconstructBits(normalizedText, grammar);
  const processedPayloadBits = decodePayloadFromReconstructed(reconstructedBits);
  const payloadBits = await grammar.postprocessPayloadBits(processedPayloadBits);
  const regeneratedText = grammar.normalizeCoverText(await generateText(payloadBits, grammar));
  if (regeneratedText !== normalizedText) {
    throw new Error("decoded payload does not regenerate cover text");
  }
  return payloadBits;
}
