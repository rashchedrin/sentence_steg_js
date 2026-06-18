/** Vitest unit tests for grammar steg v9 JS port. */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { preprocessPayloadBits, postprocessPayloadBits } from "../src/bit-preprocess.js";
import { generateText, parseText } from "../src/codec.js";
import { SentenceCorpus } from "../src/corpus.js";
import { gpgSymmetricDecrypt, gpgSymmetricEncrypt } from "../src/gpg-crypto.js";
import { GrammarV9 } from "../src/grammar-v9.js";
import {
  createPythonRandom,
  randomFloat,
  shuffleIndices,
} from "../src/python-random.js";
import { paragraphLengthForStart } from "../src/paragraph.js";
import {
  encodeTextToCoverText,
  decodeCoverTextToBytes,
} from "../src/payload-codec.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const corpusPath = path.resolve(moduleDirectory, "../../data/corpora/v9/sentences.json");

/**
 * @returns {Promise<GrammarV9>}
 */
async function loadTestGrammar() {
  const corpusJson = await readFile(corpusPath, "utf-8");
  const payload = JSON.parse(corpusJson);
  return new GrammarV9(SentenceCorpus.fromJsonPayload(payload));
}

describe("python-random", () => {
  it("matches CPython random outputs for iv_gamma_1:8", () => {
    const randomState = createPythonRandom(12836112672204128411n);
    expect(randomFloat(randomState)).toBeCloseTo(0.3882637946190579, 12);
    expect(randomFloat(randomState)).toBeCloseTo(0.5553803011060326, 12);
    const gammaState = createPythonRandom(12836112672204128411n);
    let rebuiltGamma = "";
    for (let bitIndex = 0; bitIndex < 8; bitIndex += 1) {
      rebuiltGamma += randomFloat(gammaState) < 0.5 ? "1" : "0";
    }
    expect(rebuiltGamma).toBe("10101010");
  });

  it("matches CPython shuffle for iv_permutation_1:8", async () => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("iv_permutation_1:8"));
    const digestBytes = new Uint8Array(digest);
    let seedValue = 0n;
    for (let byteIndex = 0; byteIndex < 8; byteIndex += 1) {
      seedValue = (seedValue << 8n) | BigInt(digestBytes[byteIndex]);
    }
    const randomState = createPythonRandom(seedValue);
    const indexList = [0, 1, 2, 3, 4, 5, 6, 7];
    shuffleIndices(randomState, indexList);
    expect(indexList).toEqual([0, 4, 2, 1, 6, 5, 3, 7]);
  });
});

describe("paragraph", () => {
  it("returns lengths within 1..20", () => {
    const anchorSentence = "Я уверена, что есть какая-то связь.";
    const paragraphLength = paragraphLengthForStart(0, anchorSentence);
    expect(paragraphLength).toBeGreaterThanOrEqual(1);
    expect(paragraphLength).toBeLessThanOrEqual(20);
  });
});

describe("bit-preprocess", () => {
  it("matches Python preprocess vectors", async () => {
    expect(await preprocessPayloadBits("10110101")).toBe("01111100");
    expect(await preprocessPayloadBits("1")).toBe("0");
    expect(await preprocessPayloadBits("11")).toBe("00");
    expect(await preprocessPayloadBits("11111111")).toBe("00111010");
  });

  it("roundtrips preprocess", async () => {
    const payloadBits = "10110101";
    expect(await postprocessPayloadBits(await preprocessPayloadBits(payloadBits))).toBe(payloadBits);
  });
});

describe("codec v9", () => {
  it("roundtrips known bit payload", async () => {
    const grammar = await loadTestGrammar();
    const payloadBits = "110010";
    const coverText = await generateText(payloadBits, grammar);
    expect(await parseText(coverText, grammar)).toBe(payloadBits);
  });

  it("roundtrips utf-8 text without password", async () => {
    const grammar = await loadTestGrammar();
    const secretText = "Привет";
    const coverText = await encodeTextToCoverText(secretText, grammar);
    const { payloadBytes } = await decodeCoverTextToBytes(coverText, grammar);
    expect(new TextDecoder().decode(payloadBytes)).toBe(secretText);
  });
});

describe("gpg", () => {
  it("roundtrips symmetric encryption", async () => {
    const payloadBytes = new TextEncoder().encode("Ваш секретный текст");
    const password = "test-password";
    const ciphertextBytes = await gpgSymmetricEncrypt(payloadBytes, password);
    const restoredBytes = await gpgSymmetricDecrypt(ciphertextBytes, password);
    expect(restoredBytes).toEqual(payloadBytes);
  });
});
