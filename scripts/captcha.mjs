import { createHash } from "node:crypto";

const purposes = {
  "/auth/login": "login",
  "/auth/register": "register",
  "/teams": "team-create",
  "/team/join": "team-join",
};
export const captchaPurpose = (path) => purposes[path];

// CLI fixtures solve the same challenge as browsers; there is no bypass token.
export function solveCaptcha(challenge) {
  if (
    !/^[a-f0-9]{64}$/.test(challenge.salt) ||
    !/^[a-f0-9]{64}$/.test(challenge.target) ||
    !Number.isInteger(challenge.max_nonce) ||
    challenge.max_nonce < 0 ||
    challenge.max_nonce > 16383
  )
    throw Error("Invalid captcha challenge");
  const input = Buffer.alloc(40);
  Buffer.from(challenge.salt, "hex").copy(input);
  const target = Buffer.from(challenge.target, "hex");
  for (let nonce = 0; nonce <= challenge.max_nonce; nonce++) {
    input.writeUInt32BE(nonce, 36);
    if (createHash("sha256").update(input).digest().equals(target))
      return {
        token: challenge.token,
        nonce: nonce.toString(16).padStart(16, "0"),
      };
  }
  throw Error("Captcha computation exhausted");
}
