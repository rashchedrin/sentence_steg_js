#!/usr/bin/env node
/** Build reproducible MPHF, encoder map, and collision candidates for v11. */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import path from "node:path";
import process from "node:process";
import { shake256 } from "@noble/hashes/sha3.js";
import { cleanSentenceSurface, normalizeSentenceKey } from "../../src/sentence-normalize.js";
import {
  buildBdzMphf,
  evaluateBdzMphf,
  serializeBdzMphf,
  verifyBdzMphf,
} from "./bdz-mphf.mjs";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../..");
const BASE_CORPUS_PATH = path.join(
  PROJECT_ROOT,
  "public/data/corpora/v9/sentences.json",
);
const TATOEBA_TAIL_PATH = path.join(
  PROJECT_ROOT,
  "research/v11/cache/tatoeba-tail.json",
);
const OUTPUT_DIRECTORY = path.join(PROJECT_ROOT, "public/data/corpora/v11");
const RESULTS_DIRECTORY = path.join(PROJECT_ROOT, "research/v11/results");
const MPHF_OUTPUT_PATH = path.join(OUTPUT_DIRECTORY, "decoder-mphf.bin");
const ENCODER_MAP_OUTPUT_PATH = path.join(OUTPUT_DIRECTORY, "encoder-map.bin");
const EXTRA_CANDIDATES_OUTPUT_PATH = path.join(
  OUTPUT_DIRECTORY,
  "extra-candidates.json",
);
const METRICS_OUTPUT_PATH = path.join(RESULTS_DIRECTORY, "build-metrics.json");
const BASE_KEY_COUNT = 2 ** 20;
const HASH_BYTE_LENGTH = 16;
const HASH_WORD_COUNT = HASH_BYTE_LENGTH / 4;
const TARGET_MUTATION_COUNT = 65_536;
const ENCODER_MAP_MAGIC = "V11EMAP\0";
const ENCODER_MAP_VERSION = 1;
const ENCODER_MAP_HEADER_BYTES = 16;

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
 * @param {string} sentence
 * @returns {Uint32Array} shape: (4,)
 */
function hashSentence(sentence) {
  const normalizedSentence = normalizeSentenceKey(sentence);
  const hashBytes = shake256(new TextEncoder().encode(normalizedSentence), {
    dkLen: HASH_BYTE_LENGTH,
  });
  const hashWords = new Uint32Array(HASH_WORD_COUNT);
  writeHashWords(hashBytes, hashWords, 0);
  return hashWords;
}

/**
 * @param {string[]} sentences shape: (n_sentences,)
 * @returns {Uint32Array} shape: (n_sentences * 4,)
 */
function hashSentences(sentences) {
  const hashWords = new Uint32Array(sentences.length * HASH_WORD_COUNT);
  const encoder = new TextEncoder();
  for (let sentenceIndex = 0; sentenceIndex < sentences.length; sentenceIndex += 1) {
    const normalizedSentence = normalizeSentenceKey(sentences[sentenceIndex]);
    const hashBytes = shake256(encoder.encode(normalizedSentence), {
      dkLen: HASH_BYTE_LENGTH,
    });
    writeHashWords(hashBytes, hashWords, sentenceIndex * HASH_WORD_COUNT);
  }
  return hashWords;
}

/**
 * Generate common typo/punctuation-error variants while preserving terminal punctuation.
 *
 * @param {string} sentence
 * @returns {string[]}
 */
function mutationCandidates(sentence) {
  const terminalMatch = sentence.match(/[.!?]+$/u);
  if (!terminalMatch) {
    throw new Error(`expected terminal punctuation in ${JSON.stringify(sentence)}`);
  }
  const terminalPunctuation = terminalMatch[0];
  const body = sentence.slice(0, -terminalPunctuation.length);
  const candidates = [];

  const yoIndex = body.search(/[Ёё]/u);
  if (yoIndex >= 0) {
    const replacement = body[yoIndex] === "Ё" ? "Е" : "е";
    candidates.push(`${body.slice(0, yoIndex)}${replacement}${body.slice(yoIndex + 1)}${terminalPunctuation}`);
  }

  const commaIndex = body.indexOf(",");
  if (commaIndex >= 0) {
    const afterComma = body.slice(commaIndex + 1).replace(/^\s+/u, " ");
    candidates.push(`${body.slice(0, commaIndex)}${afterComma}${terminalPunctuation}`);
  }

  const wordMatches = [...body.matchAll(/[А-ЯЁа-яё]{5,}/gu)];
  for (const wordMatch of wordMatches.slice(0, 3)) {
    const word = wordMatch[0];
    const wordStart = wordMatch.index;
    if (wordStart === undefined) {
      throw new Error(`expected word match index in ${JSON.stringify(sentence)}`);
    }
    let swapIndex = Math.max(1, Math.floor(word.length / 2) - 1);
    while (swapIndex + 1 < word.length - 1 && word[swapIndex] === word[swapIndex + 1]) {
      swapIndex += 1;
    }
    if (swapIndex + 1 < word.length && word[swapIndex] !== word[swapIndex + 1]) {
      const mutatedWord = (
        word.slice(0, swapIndex)
        + word[swapIndex + 1]
        + word[swapIndex]
        + word.slice(swapIndex + 2)
      );
      candidates.push(
        `${body.slice(0, wordStart)}${mutatedWord}${body.slice(wordStart + word.length)}${terminalPunctuation}`,
      );
    }
    if (word.length >= 6) {
      const omittedIndex = Math.max(1, Math.floor(word.length / 2));
      const mutatedWord = word.slice(0, omittedIndex) + word.slice(omittedIndex + 1);
      candidates.push(
        `${body.slice(0, wordStart)}${mutatedWord}${body.slice(wordStart + word.length)}${terminalPunctuation}`,
      );
    }
  }
  return candidates.map((candidate) => cleanSentenceSurface(candidate));
}

/**
 * @param {string[]} baseSentences shape: (2^20,)
 * @param {Set<string>} seenNormalizedKeys
 * @returns {string[]}
 */
function generateUniqueMutations(baseSentences, seenNormalizedKeys) {
  const mutations = [];
  for (
    let sentenceIndex = 0;
    sentenceIndex < baseSentences.length && mutations.length < TARGET_MUTATION_COUNT;
    sentenceIndex += 1
  ) {
    const candidates = mutationCandidates(baseSentences[sentenceIndex]);
    for (const candidate of candidates) {
      if (mutations.length >= TARGET_MUTATION_COUNT) {
        break;
      }
      const normalizedKey = normalizeSentenceKey(candidate);
      if (!normalizedKey || seenNormalizedKeys.has(normalizedKey)) {
        continue;
      }
      seenNormalizedKeys.add(normalizedKey);
      mutations.push(candidate);
      break;
    }
  }
  if (mutations.length !== TARGET_MUTATION_COUNT) {
    throw new Error(
      `expected ${TARGET_MUTATION_COUNT} unique mutations, got ${mutations.length}`,
    );
  }
  return mutations;
}

/**
 * @param {Uint32Array} targetToSourceIndex shape: (2^20,)
 * @returns {Uint8Array}
 */
function serializeEncoderMap(targetToSourceIndex) {
  if (targetToSourceIndex.length !== BASE_KEY_COUNT) {
    throw new Error(
      `expected encoder map length ${BASE_KEY_COUNT}, got ${targetToSourceIndex.length}`,
    );
  }
  const outputBytes = new Uint8Array(
    ENCODER_MAP_HEADER_BYTES + targetToSourceIndex.byteLength,
  );
  const outputView = new DataView(outputBytes.buffer);
  for (
    let characterIndex = 0;
    characterIndex < ENCODER_MAP_MAGIC.length;
    characterIndex += 1
  ) {
    outputBytes[characterIndex] = ENCODER_MAP_MAGIC.charCodeAt(characterIndex);
  }
  outputView.setUint32(8, ENCODER_MAP_VERSION, true);
  outputView.setUint32(12, BASE_KEY_COUNT, true);
  let byteOffset = ENCODER_MAP_HEADER_BYTES;
  for (const sourceIndex of targetToSourceIndex) {
    outputView.setUint32(byteOffset, sourceIndex, true);
    byteOffset += 4;
  }
  return outputBytes;
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

const totalStartedNs = process.hrtime.bigint();
const packageJson = JSON.parse(readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8"));
const basePayload = JSON.parse(readFileSync(BASE_CORPUS_PATH, "utf8"));
const baseSentences = basePayload.sentences;
if (!Array.isArray(baseSentences) || baseSentences.length !== BASE_KEY_COUNT) {
  throw new Error(
    `expected ${BASE_KEY_COUNT} base sentences, got ${baseSentences?.length}`,
  );
}

const hashStartedNs = process.hrtime.bigint();
const baseHashWords = hashSentences(baseSentences);
const hashElapsedMs = Number(process.hrtime.bigint() - hashStartedNs) / 1e6;

const buildStartedNs = process.hrtime.bigint();
const mphf = buildBdzMphf(baseHashWords, { vertexRatio: 1.23, maxAttempts: 128 });
const buildElapsedMs = Number(process.hrtime.bigint() - buildStartedNs) / 1e6;

const verifyStartedNs = process.hrtime.bigint();
verifyBdzMphf(mphf, baseHashWords);
const verifyElapsedMs = Number(process.hrtime.bigint() - verifyStartedNs) / 1e6;

const unassignedSourceIndex = 0xffffffff;
const targetToSourceIndex = new Uint32Array(BASE_KEY_COUNT);
targetToSourceIndex.fill(unassignedSourceIndex);
for (let sourceIndex = 0; sourceIndex < BASE_KEY_COUNT; sourceIndex += 1) {
  const wordOffset = sourceIndex * HASH_WORD_COUNT;
  const targetIndex = evaluateBdzMphf(
    mphf,
    baseHashWords.subarray(wordOffset, wordOffset + HASH_WORD_COUNT),
  );
  if (targetToSourceIndex[targetIndex] !== unassignedSourceIndex) {
    throw new Error(
      `expected unassigned target ${targetIndex}, got source ${targetToSourceIndex[targetIndex]}`,
    );
  }
  targetToSourceIndex[targetIndex] = sourceIndex;
}

const seenNormalizedKeys = new Set(baseSentences.map(normalizeSentenceKey));
const tailPayload = JSON.parse(readFileSync(TATOEBA_TAIL_PATH, "utf8"));
if (!Array.isArray(tailPayload.sentences)) {
  throw new Error(`expected tail sentences array in ${TATOEBA_TAIL_PATH}`);
}
const extraSentences = [];
for (const tailSentence of tailPayload.sentences) {
  const normalizedKey = normalizeSentenceKey(tailSentence);
  if (seenNormalizedKeys.has(normalizedKey)) {
    continue;
  }
  seenNormalizedKeys.add(normalizedKey);
  extraSentences.push(tailSentence);
}
const mutations = generateUniqueMutations(baseSentences, seenNormalizedKeys);
extraSentences.push(...mutations);

/** @type {Array<[number, string]>} */
const extraCandidates = extraSentences.map((sentence) => [
  evaluateBdzMphf(mphf, hashSentence(sentence)),
  sentence,
]);
extraCandidates.sort(
  (left, right) => left[0] - right[0] || left[1].localeCompare(right[1], "ru"),
);

const candidateCounts = new Uint16Array(BASE_KEY_COUNT);
candidateCounts.fill(1);
for (const [targetIndex] of extraCandidates) {
  candidateCounts[targetIndex] += 1;
}
let collisionTargetCount = 0;
let maximumCandidatesPerTarget = 0;
for (const candidateCount of candidateCounts) {
  if (candidateCount > 1) {
    collisionTargetCount += 1;
  }
  maximumCandidatesPerTarget = Math.max(maximumCandidatesPerTarget, candidateCount);
}

mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
mkdirSync(RESULTS_DIRECTORY, { recursive: true });
const mphfBytes = serializeBdzMphf(mphf);
const encoderMapBytes = serializeEncoderMap(targetToSourceIndex);
const extraCandidatesJson = JSON.stringify(
  {
    format: "v11-extra-candidates-v1",
    baseCorpusUrl: "../v9/sentences.json",
    candidateCount: extraCandidates.length,
    candidates: extraCandidates,
  },
  null,
  2,
);
writeFileSync(MPHF_OUTPUT_PATH, mphfBytes);
writeFileSync(ENCODER_MAP_OUTPUT_PATH, encoderMapBytes);
writeFileSync(EXTRA_CANDIDATES_OUTPUT_PATH, extraCandidatesJson, "utf8");

const memoryUsage = process.memoryUsage();
const peakRssBytes = process.resourceUsage().maxRSS * 1024;
const metrics = {
  experiment: "v11-artifact-build",
  startedAt: new Date().toISOString(),
  environment: {
    platform: process.platform,
    architecture: process.arch,
    nodeVersion: process.version,
    nobleHashesVersion: packageJson.dependencies["@noble/hashes"],
    cpuCount: cpus().length,
    nvidiaDriverVersion: readNvidiaDriverVersion(),
    gpuUsed: false,
    vramPeakBytes: 0,
  },
  inputs: {
    baseCorpusPath: path.relative(PROJECT_ROOT, BASE_CORPUS_PATH),
    baseKeyCount: BASE_KEY_COUNT,
    tatoebaTailPath: path.relative(PROJECT_ROOT, TATOEBA_TAIL_PATH),
    tatoebaTailCandidateCount: extraSentences.length - mutations.length,
    mutationCount: mutations.length,
    hashAlgorithm: "SHAKE-256/128",
    mphfAlgorithm: "BDZ",
    vertexRatio: 1.23,
  },
  outputs: {
    vertexCount: mphf.vertexCount,
    seed: mphf.seed,
    mphfBytes: mphfBytes.length,
    mphfMiB: toMiB(mphfBytes.length),
    mphfBitsPerKey: (mphfBytes.length * 8) / BASE_KEY_COUNT,
    encoderMapBytes: encoderMapBytes.length,
    extraCandidatesBytes: Buffer.byteLength(extraCandidatesJson, "utf8"),
    totalSentenceCandidateCount: BASE_KEY_COUNT + extraCandidates.length,
    extraCandidateCount: extraCandidates.length,
    collisionTargetCount,
    maximumCandidatesPerTarget,
  },
  timingMs: {
    hash: hashElapsedMs,
    mphfBuild: buildElapsedMs,
    mphfVerify: verifyElapsedMs,
    total: Number(process.hrtime.bigint() - totalStartedNs) / 1e6,
  },
  memory: {
    peakRssBytes,
    peakRssMiB: toMiB(peakRssBytes),
    finalRssBytes: memoryUsage.rss,
    heapUsedBytes: memoryUsage.heapUsed,
    externalBytes: memoryUsage.external,
  },
};
writeFileSync(METRICS_OUTPUT_PATH, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
console.log(JSON.stringify(metrics, null, 2));
