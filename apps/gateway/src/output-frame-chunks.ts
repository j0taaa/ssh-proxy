import { DATA_FRAME_MAX_DECODED_BYTES, encodeBase64 } from "@ssh-proxy/protocol";

export function encodeOutputFrameChunks(chunk: Buffer): string[] {
  const text = chunk.toString("utf8");
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;

  for (const character of text) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (currentBytes + characterBytes > DATA_FRAME_MAX_DECODED_BYTES && current.length > 0) {
      chunks.push(encodeBase64(current));
      current = "";
      currentBytes = 0;
    }

    current += character;
    currentBytes += characterBytes;
  }

  if (current.length > 0) {
    chunks.push(encodeBase64(current));
  }

  return chunks;
}
