#!/usr/bin/env node
/** Reproducible BDZ MPHF feasibility experiment on the sentence corpus. */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { shake256 } from "@noble/hashes/sha3.js";
import {
  buildBdzMphf,
  evaluateBdzMphf,
  serializedRuntimeByteLength,
  verifyBdzMphf,
} from "./bdz-mphf.mjs";

const HASH_BYTE_LENGTH = 16;
const HASH_WORD_COUNT = HASH_BYTE_LENGTH / 4;
const DEFAULT_CORPUS_PATH = "public/data/corpora/v9/sentences.json";
const DEFAULT_KEY_COUNT = 2 ** 20;
const SAMPLE_NONMEMBER_COUNT = 100_000;

/**
 * @param {Uint8Array} hashBytes shape: (16,)
 * @param {Uint32Array} destination shape: (n_keys * 4,)
 * @param {number} wordOffset
 * @returns {void}
 */
function writeHashWords(hashBytes, destination, wordOffset) {
  if (hashBytes.length !== HASH_BYTE_LENGTH) {
    throw new Error(`expected ${HASH_BYTE_LENGTH} hash bytes, got ${hashBytes.length}`);
  }
  for (let wordIndex = 0; wordIndex < HASH_WORD_COUNT; wordIndex += 1) {
    const byteOffset = wordIndex * 4;
    destination[wordOffset + wordIndex] = (
      hashBytes[byteOffset]
      | (hashBytes[byteOffset + 1] << 8)
      | (hashBytes[byteOffset + 2] << 16)
      | (hashBytes[byteOffset + 3] << 24)
    ) >>> 0;
  }
}

/**
 * @param {string[]} sentences shape: (n_sentences,)
 * @returns {Uint32Array} shape: (n_sentences * 4,)
 */
function hashSentences(sentences) {
  const encoder = new TextEncoder();
  const hashWords = new Uint32Array(sentences.length * HASH_WORD_COUNT);
  for (let sentenceIndex = 0; sentenceIndex < sentences.length; sentenceIndex += 1) {
    const sentenceBytes = encoder.encode(sentences[sentenceIndex]);
    const hashBytes = shake256(sentenceBytes, { dkLen: HASH_BYTE_LENGTH });
    writeHashWords(hashBytes, hashWords, sentenceIndex * HASH_WORD_COUNT);
  }
  return hashWords;
}

/**
 * @returns {string | null}
 */
function readNvidiaDriverVersion() {
  try {
    return execFileSync(
      "nvidia-smi",
      ["--query-gpu=driver_version", "--format=csv,noheader"],
      { encoding: "utf8" },
    ).trim() || null;
  } catch {
    return null;
  }
}

/**
 * @param {number} byteCount
 * @returns {number}
 */
function toMiB(byteCount) {
  return byteCount / (1024 * 1024);
}

const corpusPath = process.argv[2] ?? DEFAULT_CORPUS_PATH;
const requestedKeyCount = Number.parseInt(process.argv[3] ?? String(DEFAULT_KEY_COUNT), 10);
if (!Number.isInteger(requestedKeyCount) || requestedKeyCount <= 0) {
  throw new Error(`expected positive integer key count, got ${process.argv[3]}`);
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const startedAt = new Date().toISOString();
const totalStartedNs = process.hrtime.bigint();
const corpusPayload = JSON.parse(readFileSync(corpusPath, "utf8"));
if (!Array.isArray(corpusPayload.sentences)) {
  throw new Error(`expected sentences array in ${corpusPath}`);
}
if (requestedKeyCount > corpusPayload.sentences.length) {
  throw new Error(
    `expected key count <= ${corpusPayload.sentences.length}, got ${requestedKeyCount}`,
  );
}
const sentences = corpusPayload.sentences.slice(0, requestedKeyCount);

const hashStartedNs = process.hrtime.bigint();
const hashWords = hashSentences(sentences);
const hashElapsedMs = Number(process.hrtime.bigint() - hashStartedNs) / 1e6;

const buildStartedNs = process.hrtime.bigint();
const mphf = buildBdzMphf(hashWords, { vertexRatio: 1.23, maxAttempts: 128 });
const buildElapsedMs = Number(process.hrtime.bigint() - buildStartedNs) / 1e6;

const verifyStartedNs = process.hrtime.bigint();
verifyBdzMphf(mphf, hashWords);
const verifyElapsedMs = Number(process.hrtime.bigint() - verifyStartedNs) / 1e6;

const encoder = new TextEncoder();
const nonmemberOutputCounts = new Uint32Array(requestedKeyCount);
for (let sampleIndex = 0; sampleIndex < SAMPLE_NONMEMBER_COUNT; sampleIndex += 1) {
  const mutationText = `${sentences[sampleIndex % sentences.length]} [mutation ${sampleIndex}]`;
  const hashBytes = shake256(encoder.encode(mutationText), { dkLen: HASH_BYTE_LENGTH });
  const sampleHashWords = new Uint32Array(HASH_WORD_COUNT);
  writeHashWords(hashBytes, sampleHashWords, 0);
  const outputIndex = evaluateBdzMphf(mphf, sampleHashWords);
  nonmemberOutputCounts[outputIndex] += 1;
}
let occupiedOutputs = 0;
let collisionOutputs = 0;
let maximumSamplesPerOutput = 0;
for (const outputCount of nonmemberOutputCounts) {
  if (outputCount > 0) {
    occupiedOutputs += 1;
  }
  if (outputCount > 1) {
    collisionOutputs += 1;
  }
  maximumSamplesPerOutput = Math.max(maximumSamplesPerOutput, outputCount);
}

const totalElapsedMs = Number(process.hrtime.bigint() - totalStartedNs) / 1e6;
const memoryUsage = process.memoryUsage();
const peakRssBytes = process.resourceUsage().maxRSS * 1024;
const runtimeBytes = serializedRuntimeByteLength(mphf);
const metrics = {
  experiment: "v11-bdz-mphf-feasibility",
  startedAt,
  environment: {
    platform: process.platform,
    architecture: process.arch,
    nodeVersion: process.version,
    nobleHashesVersion: packageJson.dependencies["@noble/hashes"],
    cpuCount: (await import("node:os")).cpus().length,
    nvidiaDriverVersion: readNvidiaDriverVersion(),
    gpuUsed: false,
    vramPeakBytes: 0,
  },
  inputs: {
    corpusPath,
    corpusSize: corpusPayload.sentences.length,
    keyCount: requestedKeyCount,
    hashAlgorithm: "SHAKE-256/128",
    vertexRatio: 1.23,
    nonmemberSampleCount: SAMPLE_NONMEMBER_COUNT,
  },
  outputs: {
    vertexCount: mphf.vertexCount,
    seed: mphf.seed,
    runtimeBytes,
    runtimeMiB: toMiB(runtimeBytes),
    bitsPerKey: (runtimeBytes * 8) / requestedKeyCount,
    nonmemberOccupiedOutputs: occupiedOutputs,
    nonmemberCollisionOutputs: collisionOutputs,
    maximumNonmemberSamplesPerOutput: maximumSamplesPerOutput,
  },
  timingMs: {
    hash: hashElapsedMs,
    build: buildElapsedMs,
    verify: verifyElapsedMs,
    total: totalElapsedMs,
  },
  memory: {
    peakRssBytes,
    peakRssMiB: toMiB(peakRssBytes),
    finalRssBytes: memoryUsage.rss,
    heapUsedBytes: memoryUsage.heapUsed,
    externalBytes: memoryUsage.external,
  },
};

console.log(JSON.stringify(metrics, null, 2));
