import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { closeSync, constants, linkSync, openSync, fstatSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

export class SpotifySecrets {
  constructor(private readonly path: string) {}

  private key(create: boolean) {
    const read = () => {
      const fd = openSync(this.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = fstatSync(fd);
        if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size !== 32) throw new Error("Invalid Spotify encryption key file");
        return readFileSync(fd);
      } finally { closeSync(fd); }
    };
    try { return read(); }
    catch (error) {
      if (!create || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, randomBytes(32), { mode: 0o600, flag: "wx" });
    try {
      try { linkSync(temporary, this.path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    } finally { unlinkSync(temporary); }
    return read();
  }

  encrypt(value: string, context: string) {
    const key = this.key(true);
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from(context));
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64url");
  }

  decrypt(value: string, context: string) {
    const buffer = Buffer.from(value, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", this.key(false), buffer.subarray(0, 12));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(buffer.subarray(12, 28));
    return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString("utf8");
  }
}
