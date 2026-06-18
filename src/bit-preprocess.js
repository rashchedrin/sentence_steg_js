/** Re-export xor-permute diffusion for backward compatibility. */

export {
  applyPermutation,
  invertPermutation,
  postprocessPayloadBits,
  preprocessPayloadBits,
  pseudorandomBits,
  pseudorandomPermutation,
  xorBits,
  xorPermuteDiffusion,
} from "./bit-diffusion/xor-permute.js";
