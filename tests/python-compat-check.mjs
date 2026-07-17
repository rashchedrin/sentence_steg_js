#!/usr/bin/env node
/** Cross-check JS port against Python grammar-steg v9 (bits + GPG interop). */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { preprocessPayloadBits } from "../src/bit-preprocess.js";
import { generateText, parseText } from "../src/codec.js";
import { SentenceCorpus } from "../src/corpus.js";
import { gpgSymmetricDecrypt, gpgSymmetricEncrypt } from "../src/gpg-crypto.js";
import { GrammarV9 } from "../src/grammar-v9.js";
import {
  decodeCoverTextToBytes,
  encodeTextToCoverText,
} from "../src/payload-codec.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDirectory, "../..");
const corpusPath = path.join(projectRoot, "data/corpora/v9/sentences.json");

/**
 * @param {string} pythonCode
 * @returns {string}
 */
function runPython(pythonCode) {
  const result = spawnSync(
    "python3",
    ["-c", pythonCode],
    {
      cwd: projectRoot,
      encoding: "utf-8",
      env: { ...process.env, PYTHONPATH: path.join(projectRoot, "src") },
    },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "python failed");
  }
  return result.stdout.trim();
}

const corpusPayload = JSON.parse(readFileSync(corpusPath, "utf-8"));
const grammar = new GrammarV9(SentenceCorpus.fromJsonPayload(corpusPayload));

const preprocessPython = runPython(
  "from grammar_steg.bit_preprocess import preprocess_payload_bits; print(preprocess_payload_bits('10110101'))",
);
const preprocessJs = await preprocessPayloadBits("10110101");
if (preprocessPython !== preprocessJs) {
  throw new Error(`preprocess mismatch: python=${preprocessPython} js=${preprocessJs}`);
}

const bits = "110010";
const coverPython = runPython(
  `from grammar_steg.codec import generate_text; print(generate_text('${bits}', version_id='v9'))`,
);
const bitsFromPythonCover = await parseText(coverPython, grammar);
if (bitsFromPythonCover !== bits) {
  throw new Error(`decode python cover failed: ${bitsFromPythonCover}`);
}

const coverJs = await generateText(bits, grammar);
const bitsFromJsCover = runPython(
  `from grammar_steg.codec import parse_text; print(parse_text(${JSON.stringify(coverJs)}, version_id='v9'))`,
);
if (bitsFromJsCover !== bits) {
  throw new Error(`python decode js cover failed: ${bitsFromJsCover}`);
}

const gpgHex = runPython(`
from grammar_steg.gpg_crypto import gpg_symmetric_encrypt
print(gpg_symmetric_encrypt(b'Hello', 'testpass123').hex())
`);
const gpgBytes = Uint8Array.from(gpgHex.match(/.{1,2}/g).map((hexPair) => Number.parseInt(hexPair, 16)));
const decrypted = await gpgSymmetricDecrypt(gpgBytes, "testpass123");
if (new TextDecoder().decode(decrypted) !== "Hello") {
  throw new Error("failed to decrypt Python GPG ciphertext in JS");
}

const jsEncrypted = await gpgSymmetricEncrypt(new TextEncoder().encode("Hello"), "testpass123");
const pythonDecryptedJs = runPython(`
from grammar_steg.gpg_crypto import gpg_symmetric_decrypt
print(gpg_symmetric_decrypt(bytes.fromhex('${Buffer.from(jsEncrypted).toString("hex")}'), 'testpass123').decode())
`);
if (pythonDecryptedJs !== "Hello") {
  throw new Error(`python failed to decrypt JS GPG ciphertext: ${pythonDecryptedJs}`);
}

const secretText = "Hello secret";
const coverWithPassword = await encodeTextToCoverText(secretText, grammar, { password: "secret" });
const { payloadBytes } = await decodeCoverTextToBytes(coverWithPassword, grammar, { password: "secret" });
if (new TextDecoder().decode(payloadBytes) !== secretText) {
  throw new Error("JS password roundtrip failed");
}

const pythonEncodedCover = runPython(`
from grammar_steg.payload_codec import encode_text_to_cover_text
print(encode_text_to_cover_text('Hello secret', version_id='v9', password='secret'))
`);
const jsDecodedPythonPassword = await decodeCoverTextToBytes(
  pythonEncodedCover,
  grammar,
  { password: "secret" },
);
if (new TextDecoder().decode(jsDecodedPythonPassword.payloadBytes) !== secretText) {
  throw new Error("JS decode of Python password-encoded text failed");
}

const jsEncodedForPython = await encodeTextToCoverText(secretText, grammar, {
  password: "secret",
  passwordCryptoVersionId: "v1-gpg",
});
const pythonDecodedJs = runPython(`
from grammar_steg.payload_codec import decode_cover_text_to_text
_, restored = decode_cover_text_to_text(${JSON.stringify(jsEncodedForPython)}, version_id='v9', password='secret')
print(restored.decode())
`);
if (pythonDecodedJs !== secretText) {
  throw new Error(`Python decode of JS password-encoded text failed: ${pythonDecodedJs}`);
}

console.log("python-compat-check: OK");
