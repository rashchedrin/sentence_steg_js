/** Vitest unit tests for grammar steg JS port. */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  feistelMixBits,
  postprocessPayloadBits as feistelPostprocess,
  preprocessPayloadBits as feistelPreprocess,
} from "../src/bit-diffusion/feistel.js";
import { preprocessPayloadBits, postprocessPayloadBits } from "../src/bit-preprocess.js";
import { generateText, parseText } from "../src/codec.js";
import { SentenceCorpus } from "../src/corpus.js";
import {
  binaryOpenPgpToArmoredMessage,
  gpgSymmetricDecrypt,
  gpgSymmetricEncrypt,
} from "../src/gpg-crypto.js";
import { GrammarV10 } from "../src/grammar-v10.js";
import { GrammarV9 } from "../src/grammar-v9.js";
import { createGrammar } from "../src/grammars.js";
import {
  createPythonRandom,
  randomFloat,
  shuffleIndices,
} from "../src/python-random.js";
import { paragraphLengthForStart } from "../src/paragraph.js";
import {
  decodeCoverTextToArmoredPgpMessage,
  decodeCoverTextToBytes,
  encodeTextToCoverText,
} from "../src/payload-codec.js";
import * as openpgp from "openpgp";
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const corpusPath = path.resolve(moduleDirectory, "../public/data/corpora/v9/sentences.json");

/**
 * @returns {Promise<GrammarV9>}
 */
async function loadTestGrammarV9() {
  const corpusJson = await readFile(corpusPath, "utf-8");
  const payload = JSON.parse(corpusJson);
  return new GrammarV9(SentenceCorpus.fromJsonPayload(payload));
}

/**
 * @returns {Promise<GrammarV10>}
 */
async function loadTestGrammarV10() {
  const corpusJson = await readFile(corpusPath, "utf-8");
  const payload = JSON.parse(corpusJson);
  return new GrammarV10(SentenceCorpus.fromJsonPayload(payload));
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

describe("feistel diffusion", () => {
  it("preserves bit length", () => {
    const payloadBits = "1".repeat(23);
    const encodedBits = feistelMixBits(payloadBits, false);
    expect(encodedBits.length).toBe(23);
  });

  it("roundtrips 23-bit payload", async () => {
    const payloadBits = "1".repeat(22) + "0";
    expect(await feistelPostprocess(await feistelPreprocess(payloadBits))).toBe(payloadBits);
  });

  it("creates avalanche between single-bit inputs", () => {
    const payloadBitsA = "1".repeat(23);
    const payloadBitsB = "1".repeat(22) + "0";
    const encodedBitsA = feistelMixBits(payloadBitsA, false);
    const encodedBitsB = feistelMixBits(payloadBitsB, false);
    const changedBitCount = [...encodedBitsA].filter(
      (bitCharacter, bitIndex) => bitCharacter !== encodedBitsB[bitIndex],
    ).length;
    expect(changedBitCount).toBeGreaterThanOrEqual(8);
  });
});

describe("codec v9", () => {
  it("roundtrips known bit payload", async () => {
    const grammar = await loadTestGrammarV9();
    const payloadBits = "110010";
    const coverText = await generateText(payloadBits, grammar);
    expect(await parseText(coverText, grammar)).toBe(payloadBits);
  });

  it("roundtrips utf-8 text without password", async () => {
    const grammar = await loadTestGrammarV9();
    const secretText = "Привет";
    const coverText = await encodeTextToCoverText(secretText, grammar);
    const { payloadBytes } = await decodeCoverTextToBytes(coverText, grammar);
    expect(new TextDecoder().decode(payloadBytes)).toBe(secretText);
  });
});

describe("codec v10", () => {
  it("roundtrips known bit payload", async () => {
    const grammar = await loadTestGrammarV10();
    const payloadBits = "110010";
    const coverText = await generateText(payloadBits, grammar);
    expect(await parseText(coverText, grammar)).toBe(payloadBits);
  });

  it("roundtrips utf-8 text without password", async () => {
    const grammar = await loadTestGrammarV10();
    const secretText = "Привет";
    const coverText = await encodeTextToCoverText(secretText, grammar);
    const { payloadBytes } = await decodeCoverTextToBytes(coverText, grammar);
    expect(new TextDecoder().decode(payloadBytes)).toBe(secretText);
  });
});

describe("grammars registry", () => {
  it("creates latest grammar by default id", () => {
    const grammar = createGrammar("v10");
    expect(grammar.versionId).toBe("v10");
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

  it("public-key encrypt embeds binary and decode yields armored PGP MESSAGE", async () => {
    const grammar = await loadTestGrammarV9();
    const { privateKey, publicKey } = await openpgp.generateKey({
      type: "ecc",
      curve: "curve25519",
      userIDs: [{ name: "Steg Test", email: "steg@example.com" }],
      format: "armored",
    });
    const secretText = "Секрет для Kleopatra";
    const coverText = await encodeTextToCoverText(secretText, grammar, {
      publicKeyArmored: publicKey,
    });
    const { armoredPgpMessage, payloadBytes } = await decodeCoverTextToArmoredPgpMessage(
      coverText,
      grammar,
    );
    expect(armoredPgpMessage).toContain("-----BEGIN PGP MESSAGE-----");
    expect(armoredPgpMessage).toContain("-----END PGP MESSAGE-----");
    expect(armoredPgpMessage).toMatch(/=[A-Za-z0-9+/]{4}\r?\n-----END PGP MESSAGE-----/);

    const message = await openpgp.readMessage({ armoredMessage: armoredPgpMessage });
    const decryptionKey = await openpgp.readPrivateKey({ armoredKey: privateKey });
    const { data } = await openpgp.decrypt({
      message,
      decryptionKeys: decryptionKey,
      format: "binary",
    });
    expect(new TextDecoder().decode(data)).toBe(secretText);
  });

  it("binaryOpenPgpToArmoredMessage rejects non-OpenPGP bytes", async () => {
    await expect(binaryOpenPgpToArmoredMessage(new TextEncoder().encode("not pgp"))).rejects.toThrow();
  });
});
