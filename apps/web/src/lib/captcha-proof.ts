import { sha256 } from "@noble/hashes/sha2.js";

export type CaptchaPurpose = "login" | "register" | "team-create" | "team-join";
export type CaptchaProof = { token: string; nonce: string };
export type CaptchaChallenge = {
  token: string;
  salt: string;
  difficulty: number;
  expires_at: string;
  expires_in: number;
};

// Runs in a dedicated worker. Pure JS hashing also works on an HTTP deployment
// where crypto.subtle is unavailable. Nothing is loaded from an external CDN.
export function solveProof(
  salt: string,
  difficulty: number,
  budget = 60000,
): string {
  if (
    !/^[a-f0-9]{64}$/.test(salt) ||
    !Number.isInteger(difficulty) ||
    difficulty < 12 ||
    difficulty > 22
  )
    throw Error("验证参数无效，请重试");
  const input = new Uint8Array(40);
  for (let i = 0; i < 32; i++)
    input[i] = Number.parseInt(salt.slice(i * 2, i * 2 + 2), 16);
  const view = new DataView(input.buffer);
  const end = performance.now() + Math.min(60000, Math.max(0, budget));
  const bytes = difficulty >> 3,
    bits = difficulty & 7;
  for (let nonce = 0; nonce <= 0xffffffff; nonce++) {
    if ((nonce & 1023) === 0 && performance.now() >= end)
      throw Error("验证超时，请重试");
    view.setUint32(36, nonce, false);
    const hash = sha256(input);
    if (
      hash.subarray(0, bytes).every((byte) => byte === 0) &&
      (bits === 0 || hash[bytes] >> (8 - bits) === 0)
    )
      return nonce.toString(16).padStart(16, "0");
  }
  throw Error("验证未完成，请重试");
}
