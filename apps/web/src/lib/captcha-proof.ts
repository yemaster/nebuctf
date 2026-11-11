import { sha256 } from "@noble/hashes/sha2.js";

export type CaptchaPurpose = "login" | "register" | "team-create" | "team-join";
export type CaptchaProof = { token: string; nonce: string };
export type CaptchaChallenge = {
  token: string;
  salt: string;
  target: string;
  max_nonce: number;
  expires_at: string;
  expires_in: number;
};

// Runs in a dedicated worker. Pure JS hashing also works on an HTTP deployment
// where crypto.subtle is unavailable. Nothing is loaded from an external CDN.
export function solveProof(
  salt: string,
  target: string,
  maxNonce: number,
  budget = 1000,
): string {
  if (
    !/^[a-f0-9]{64}$/.test(salt) ||
    !/^[a-f0-9]{64}$/.test(target) ||
    !Number.isInteger(maxNonce) ||
    maxNonce < 0 ||
    maxNonce > 16383
  )
    throw Error("验证参数无效，请重试");
  const input = new Uint8Array(40);
  for (let i = 0; i < 32; i++)
    input[i] = Number.parseInt(salt.slice(i * 2, i * 2 + 2), 16);
  const expected = new Uint8Array(32);
  for (let i = 0; i < 32; i++)
    expected[i] = Number.parseInt(target.slice(i * 2, i * 2 + 2), 16);
  const view = new DataView(input.buffer);
  const end = performance.now() + Math.min(1000, Math.max(0, budget));
  // The server commits to one nonce inside this finite range; no random tail.
  for (let nonce = 0; nonce <= maxNonce; nonce++) {
    if ((nonce & 255) === 0 && performance.now() >= end)
      throw Error("验证超时，请重试");
    view.setUint32(36, nonce, false);
    const hash = sha256(input);
    let valid = true;
    for (let i = 0; i < 32; i++)
      if (hash[i] !== expected[i]) {
        valid = false;
        break;
      }
    if (valid) return nonce.toString(16).padStart(16, "0");
  }
  throw Error("验证未完成，请重试");
}
