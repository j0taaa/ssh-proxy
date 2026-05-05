import { readFile, writeFile } from "node:fs/promises";

const nextEnvPath = new URL("../apps/web/next-env.d.ts", import.meta.url);

const stableContent = `/// <reference types="next" />
/// <reference types="next/image-types/global" />

// This file is kept source-controlled so clean clones do not depend on ignored .next artifacts.
`;

const currentContent = await readFile(nextEnvPath, "utf8").catch(() => "");

if (currentContent !== stableContent) {
  await writeFile(nextEnvPath, stableContent);
}
