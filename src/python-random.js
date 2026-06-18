/** Python 3.10 compatible Mersenne Twister (MT19937) from CPython _randommodule.c. */

const N = 624;
const M = 397;
const MATRIX_A = 0x9908b0df;
const UPPER_MASK = 0x80000000;
const LOWER_MASK = 0x7fffffff;

/**
 * @typedef {object} PythonRandomState
 * @property {number} index
 * @property {Uint32Array} state
 */

/**
 * 32-bit multiply using 16-bit limbs (required for JS Number precision).
 * @param {number} leftValue
 * @param {number} rightValue
 * @returns {number}
 */
function multiplyUint32(leftValue, rightValue) {
  const leftHigh = (leftValue & 0xffff0000) >>> 16;
  const leftLow = leftValue & 0x0000ffff;
  return (((leftHigh * rightValue) << 16) + leftLow * rightValue) >>> 0;
}

/**
 * @param {PythonRandomState} randomState
 * @param {number} seedValue
 * @returns {void}
 */
function initGenrand(randomState, seedValue) {
  const stateArray = randomState.state;
  stateArray[0] = seedValue >>> 0;
  for (let stateIndex = 1; stateIndex < N; stateIndex += 1) {
    const mixedSeed = stateArray[stateIndex - 1] ^ (stateArray[stateIndex - 1] >>> 30);
    stateArray[stateIndex] = (multiplyUint32(mixedSeed, 1812433253) + stateIndex) >>> 0;
  }
  randomState.index = N;
}

/**
 * @param {PythonRandomState} randomState
 * @param {Uint32Array} initKey
 * @returns {void}
 */
function initByArray(randomState, initKey) {
  const stateArray = randomState.state;
  initGenrand(randomState, 19650218);
  const keyLength = initKey.length;
  let stateIndex = 1;
  let keyIndex = 0;
  let remainingCount = Math.max(N, keyLength);
  while (remainingCount > 0) {
    const mixedSeed = stateArray[stateIndex - 1] ^ (stateArray[stateIndex - 1] >>> 30);
    stateArray[stateIndex] = (
      (stateArray[stateIndex] ^ multiplyUint32(mixedSeed, 1664525))
      + initKey[keyIndex]
      + keyIndex
    ) >>> 0;
    stateIndex += 1;
    keyIndex += 1;
    if (stateIndex >= N) {
      stateArray[0] = stateArray[N - 1];
      stateIndex = 1;
    }
    if (keyIndex >= keyLength) {
      keyIndex = 0;
    }
    remainingCount -= 1;
  }
  for (remainingCount = N - 1; remainingCount > 0; remainingCount -= 1) {
    const mixedSeed = stateArray[stateIndex - 1] ^ (stateArray[stateIndex - 1] >>> 30);
    stateArray[stateIndex] = (
      (stateArray[stateIndex] ^ multiplyUint32(mixedSeed, 1566083941))
      - stateIndex
    ) >>> 0;
    stateIndex += 1;
    if (stateIndex >= N) {
      stateArray[0] = stateArray[N - 1];
      stateIndex = 1;
    }
  }
  stateArray[0] = 0x80000000;
}

/**
 * @returns {PythonRandomState}
 */
function createRandomState() {
  return {
    index: N,
    state: new Uint32Array(N),
  };
}

/**
 * @param {PythonRandomState} randomState
 * @param {bigint | number} seedValue
 * @returns {void}
 */
export function seedRandom(randomState, seedValue) {
  const absoluteSeed = typeof seedValue === "bigint"
    ? seedValue
    : BigInt(Math.trunc(Math.abs(seedValue)));
  const bitCount = absoluteSeed === 0n
    ? 1n
    : BigInt(absoluteSeed.toString(2).length);
  const keyUsed = Number((bitCount - 1n) / 32n + 1n);
  const initKey = new Uint32Array(keyUsed);
  for (let keyIndex = 0; keyIndex < keyUsed; keyIndex += 1) {
    initKey[keyIndex] = Number((absoluteSeed >> BigInt(32 * keyIndex)) & 0xffffffffn) >>> 0;
  }
  initByArray(randomState, initKey);
}

/**
 * @param {PythonRandomState} randomState
 * @returns {number}
 */
function genrandUint32(randomState) {
  const stateArray = randomState.state;
  let randomValue;
  if (randomState.index >= N) {
    for (let stateIndex = 0; stateIndex < N - M; stateIndex += 1) {
      randomValue = (stateArray[stateIndex] & UPPER_MASK) | (stateArray[stateIndex + 1] & LOWER_MASK);
      stateArray[stateIndex] = stateArray[stateIndex + M] ^ (randomValue >>> 1)
        ^ (randomValue & 1 ? MATRIX_A : 0);
    }
    for (let stateIndex = N - M; stateIndex < N - 1; stateIndex += 1) {
      randomValue = (stateArray[stateIndex] & UPPER_MASK) | (stateArray[stateIndex + 1] & LOWER_MASK);
      stateArray[stateIndex] = stateArray[stateIndex + (M - N)] ^ (randomValue >>> 1)
        ^ (randomValue & 1 ? MATRIX_A : 0);
    }
    randomValue = (stateArray[N - 1] & UPPER_MASK) | (stateArray[0] & LOWER_MASK);
    stateArray[N - 1] = stateArray[M - 1] ^ (randomValue >>> 1) ^ (randomValue & 1 ? MATRIX_A : 0);
    randomState.index = 0;
  }
  randomValue = stateArray[randomState.index];
  randomState.index += 1;
  randomValue ^= randomValue >>> 11;
  randomValue ^= (randomValue << 7) & 0x9d2c5680;
  randomValue ^= (randomValue << 15) & 0xefc60000;
  randomValue ^= randomValue >>> 18;
  return randomValue >>> 0;
}

/**
 * @param {PythonRandomState} randomState
 * @returns {number}
 */
export function randomFloat(randomState) {
  const highPart = genrandUint32(randomState) >>> 5;
  const lowPart = genrandUint32(randomState) >>> 6;
  return (highPart * 67108864.0 + lowPart) * (1.0 / 9007199254740992.0);
}

/**
 * @param {bigint | number} seedValue
 * @returns {PythonRandomState}
 */
export function createPythonRandom(seedValue) {
  const randomState = createRandomState();
  seedRandom(randomState, seedValue);
  return randomState;
}

/**
 * @param {PythonRandomState} randomState
 * @param {number} bitCount
 * @returns {number}
 */
export function getRandBits(randomState, bitCount) {
  if (bitCount < 0) {
    throw new Error("number of bits must be non-negative");
  }
  if (bitCount === 0) {
    return 0;
  }
  if (bitCount <= 32) {
    return genrandUint32(randomState) >>> (32 - bitCount);
  }
  const wordCount = Math.floor((bitCount - 1) / 32) + 1;
  let remainingBits = bitCount;
  let resultValue = 0;
  for (let wordIndex = wordCount - 1; wordIndex >= 0; wordIndex -= 1) {
    let wordValue = genrandUint32(randomState);
    if (remainingBits < 32) {
      wordValue >>>= 32 - remainingBits;
    }
    resultValue = (resultValue << Math.min(32, remainingBits)) + wordValue;
    remainingBits -= 32;
  }
  return resultValue;
}

/**
 * @param {PythonRandomState} randomState
 * @param {number} upperBound
 * @returns {number}
 */
export function randBelow(randomState, upperBound) {
  if (upperBound <= 0) {
    return 0;
  }
  const bitWidth = upperBound.toString(2).length;
  let randomValue = getRandBits(randomState, bitWidth);
  while (randomValue >= upperBound) {
    randomValue = getRandBits(randomState, bitWidth);
  }
  return randomValue;
}

/**
 * Python random.shuffle using _randbelow (not random() * n).
 * @param {PythonRandomState} randomState
 * @param {number[]} indexList
 * @returns {void}
 */
export function shuffleIndices(randomState, indexList) {
  for (let currentIndex = indexList.length - 1; currentIndex > 0; currentIndex -= 1) {
    const swapIndex = randBelow(randomState, currentIndex + 1);
    const temporaryValue = indexList[currentIndex];
    indexList[currentIndex] = indexList[swapIndex];
    indexList[swapIndex] = temporaryValue;
  }
}
