import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type SecretBox = { seal(plain: string): string; open(sealed: string): string };

export function loadSecretKey(keyFile: string, log: (line: string) => void): Buffer {
  const env = process.env.TPM_SECRET_KEY;
  if (env && /^[0-9a-f]{64}$/i.test(env)) return Buffer.from(env, "hex");
  if (existsSync(keyFile)) return Buffer.from(readFileSync(keyFile, "utf8").trim(), "hex");
  const key = randomBytes(32);
  mkdirSync(dirname(keyFile), { recursive: true });
  writeFileSync(keyFile, key.toString("hex"), { mode: 0o600 });
  log(`TPM_SECRET_KEY is not set. A new key is in ${keyFile}. Set the variable in production.`);
  return key;
}

export function secretBox(key: Buffer): SecretBox {
  return {
    seal(plain) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64")).join(".");
    },
    open(sealed) {
      const [iv, tag, body] = sealed.split(".").map((part) => Buffer.from(part, "base64"));
      if (!iv || !tag || !body) throw new Error("sealed secret has a bad format");
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    },
  };
}
