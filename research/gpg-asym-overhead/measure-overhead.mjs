/**
 * Measure OpenPGP public-key encryption size overhead for different
 * key types, compression settings and symmetric ciphers, and verify
 * that system gpg can decrypt every produced binary message.
 *
 * Usage: node research/gpg-asym-overhead/measure-overhead.mjs
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import * as openpgp from "openpgp";

/** Payload sizes representative of short steg messages. */
const PAYLOAD_SIZES_BYTES = [16, 64, 256, 1024];

/**
 * Generate one key pair of the requested type.
 *
 * @param {"rsa2048" | "rsa3072" | "curve25519" | "nistP256"} keyKind
 * @returns {Promise<{ privateKeyArmored: string, publicKeyArmored: string }>}
 */
async function generateKeyPair(keyKind) {
  /** @type {Record<string, object>} */
  const generateOptionsByKind = {
    rsa2048: { type: "rsa", rsaBits: 2048 },
    rsa3072: { type: "rsa", rsaBits: 3072 },
    curve25519: { type: "ecc", curve: "curve25519Legacy" },
    nistP256: { type: "ecc", curve: "nistP256" },
  };
  const generateOptions = generateOptionsByKind[keyKind];
  if (generateOptions === undefined) {
    throw new Error(`expected known key kind, got ${keyKind}`);
  }
  const { privateKey, publicKey } = await openpgp.generateKey({
    ...generateOptions,
    userIDs: [{ name: "Overhead Test", email: "overhead@example.org" }],
    format: "armored",
  });
  return { privateKeyArmored: privateKey, publicKeyArmored: publicKey };
}

/**
 * Encrypt payload bytes to a public key with the given config variant.
 *
 * @param {Uint8Array} payloadBytes
 * @param {string} publicKeyArmored
 * @param {{ compression: number, symmetric: number }} cipherVariant
 * @returns {Promise<Uint8Array>}
 */
async function encryptToPublicKey(payloadBytes, publicKeyArmored, cipherVariant) {
  const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored });
  const message = await openpgp.createMessage({ binary: payloadBytes });
  const encrypted = await openpgp.encrypt({
    message,
    encryptionKeys: publicKey,
    format: "binary",
    config: {
      preferredSymmetricAlgorithm: cipherVariant.symmetric,
      preferredCompressionAlgorithm: cipherVariant.compression,
      aeadProtect: false,
    },
  });
  if (!(encrypted instanceof Uint8Array)) {
    throw new Error(`expected Uint8Array ciphertext, got ${typeof encrypted}`);
  }
  return encrypted;
}

/**
 * List packet tags and lengths of a binary OpenPGP message via gpg.
 *
 * @param {string} gnupgHomeDirectory
 * @param {Uint8Array} messageBytes
 * @returns {string}
 */
function listPacketsWithGpg(gnupgHomeDirectory, messageBytes) {
  return execFileSync(
    "gpg",
    ["--homedir", gnupgHomeDirectory, "--batch", "--list-packets"],
    { input: Buffer.from(messageBytes), encoding: "utf-8" },
  );
}

/**
 * Decrypt a binary OpenPGP message with system gpg and return plaintext bytes.
 *
 * @param {string} gnupgHomeDirectory
 * @param {Uint8Array} messageBytes
 * @returns {Buffer}
 */
function decryptWithSystemGpg(gnupgHomeDirectory, messageBytes) {
  const stdout = execFileSync(
    "gpg",
    ["--homedir", gnupgHomeDirectory, "--batch", "--quiet", "--decrypt"],
    { input: Buffer.from(messageBytes) },
  );
  return stdout;
}

/**
 * Import an armored private key into an isolated gpg home.
 *
 * @param {string} gnupgHomeDirectory
 * @param {string} privateKeyArmored
 * @returns {void}
 */
function importPrivateKeyIntoGpg(gnupgHomeDirectory, privateKeyArmored) {
  const keyFilePath = path.join(gnupgHomeDirectory, "secret-key.asc");
  writeFileSync(keyFilePath, privateKeyArmored, "utf-8");
  execFileSync("gpg", [
    "--homedir",
    gnupgHomeDirectory,
    "--batch",
    "--import",
    keyFilePath,
  ]);
}

/**
 * Build deterministic-but-representative payload bytes.
 *
 * @param {number} sizeBytes
 * @param {"random" | "text"} contentKind
 * @returns {Uint8Array} shape (sizeBytes,)
 */
function buildPayload(sizeBytes, contentKind) {
  if (contentKind === "random") {
    const randomBytes = new Uint8Array(sizeBytes);
    crypto.getRandomValues(randomBytes);
    return randomBytes;
  }
  const repeatedText = "Привет, это тестовое сообщение для замера overhead. ";
  const encodedText = new TextEncoder().encode(repeatedText.repeat(64));
  return encodedText.slice(0, sizeBytes);
}

/**
 * Compare two byte buffers for equality.
 *
 * @param {Uint8Array} leftBytes
 * @param {Uint8Array} rightBytes
 * @returns {boolean}
 */
function bytesEqual(leftBytes, rightBytes) {
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }
  return leftBytes.every((byteValue, byteIndex) => byteValue === rightBytes[byteIndex]);
}

const COMPRESSION_VARIANTS = {
  zip: openpgp.enums.compression.zip,
  uncompressed: openpgp.enums.compression.uncompressed,
};

const SYMMETRIC_VARIANTS = {
  aes128: openpgp.enums.symmetric.aes128,
  aes256: openpgp.enums.symmetric.aes256,
};

const KEY_KINDS = ["curve25519", "nistP256", "rsa2048", "rsa3072"];

const gnupgHomeDirectory = mkdtempSync(path.join(tmpdir(), "gpg-overhead-"));
console.log(`gpg home: ${gnupgHomeDirectory}`);

/** @type {Array<object>} */
const measurementRows = [];

for (const keyKind of KEY_KINDS) {
  console.log(`\n=== key kind: ${keyKind} ===`);
  const { privateKeyArmored, publicKeyArmored } = await generateKeyPair(keyKind);
  importPrivateKeyIntoGpg(gnupgHomeDirectory, privateKeyArmored);
  for (const [compressionName, compressionAlgorithm] of Object.entries(COMPRESSION_VARIANTS)) {
    for (const [symmetricName, symmetricAlgorithm] of Object.entries(SYMMETRIC_VARIANTS)) {
      for (const payloadSizeBytes of PAYLOAD_SIZES_BYTES) {
        for (const contentKind of ["random", "text"]) {
          const payloadBytes = buildPayload(payloadSizeBytes, contentKind);
          const ciphertextBytes = await encryptToPublicKey(payloadBytes, publicKeyArmored, {
            compression: compressionAlgorithm,
            symmetric: symmetricAlgorithm,
          });
          const decryptedBytes = decryptWithSystemGpg(gnupgHomeDirectory, ciphertextBytes);
          const roundtripOk = bytesEqual(new Uint8Array(decryptedBytes), payloadBytes);
          if (!roundtripOk) {
            throw new Error(
              `gpg roundtrip mismatch: expected ${payloadSizeBytes} payload bytes back, `
              + `got ${decryptedBytes.length} different bytes `
              + `(${keyKind}/${compressionName}/${symmetricName}/${contentKind})`,
            );
          }
          measurementRows.push({
            keyKind,
            compression: compressionName,
            symmetric: symmetricName,
            contentKind,
            payloadSizeBytes,
            ciphertextSizeBytes: ciphertextBytes.length,
            overheadBytes: ciphertextBytes.length - payloadSizeBytes,
          });
        }
      }
    }
  }
  // Dump the packet structure once per key kind for a small random payload.
  const inspectionPayload = buildPayload(16, "random");
  const inspectionCiphertext = await encryptToPublicKey(inspectionPayload, publicKeyArmored, {
    compression: COMPRESSION_VARIANTS.uncompressed,
    symmetric: SYMMETRIC_VARIANTS.aes128,
  });
  console.log(listPacketsWithGpg(gnupgHomeDirectory, inspectionCiphertext));
}

console.log("keyKind\tcompression\tsymmetric\tcontent\tpayload\tciphertext\toverhead");
for (const row of measurementRows) {
  console.log(
    `${row.keyKind}\t${row.compression}\t${row.symmetric}\t${row.contentKind}\t`
    + `${row.payloadSizeBytes}\t${row.ciphertextSizeBytes}\t${row.overheadBytes}`,
  );
}

rmSync(gnupgHomeDirectory, { recursive: true, force: true });
console.log("done");
