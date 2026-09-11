import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/** A CDN/object-store adapter can return its public URL without changing processing or the DB. */
export interface ThumbnailStorage {
  put(bytes: Uint8Array, extension: string): Promise<string>;
}

export const thumbnailTypes: Record<string, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

export class FileThumbnailStorage implements ThumbnailStorage {
  constructor(private readonly directory = process.env.LISTO_THUMBNAIL_DIR || "data/thumbnails") {}

  async put(bytes: Uint8Array, extension: string) {
    if (!thumbnailTypes[extension]) throw new Error("Unsupported thumbnail format");
    const key = `${createHash("sha256").update(bytes).digest("hex")}.${extension}`;
    await mkdir(this.directory, { recursive: true });
    // Content-addressed names make concurrent writes and worker retries idempotent.
    await writeFile(resolve(this.directory, key), bytes, { flag: "wx" }).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
    return `/thumbnails/${key}`;
  }

  async read(key: string) {
    if (!/^[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(key)) return null;
    try {
      return { bytes: await readFile(resolve(this.directory, key)), contentType: thumbnailTypes[key.split(".").at(-1)!] };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
}
