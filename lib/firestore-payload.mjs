import { gzipSync, gunzipSync } from "node:zlib";

const CHUNK_BYTES = 512 * 1024;
const MAX_COMPRESSED_BYTES = 8 * 1024 * 1024;

export function payloadChunks(ref) {
  return ref.collection("payload").orderBy("index");
}

export function decodePayload(snapshot) {
  if (snapshot.empty) return null;
  const buffers = snapshot.docs.map((chunk, index) => {
    const data = chunk.data();
    if (data.index !== index || data.count !== snapshot.size || !Buffer.isBuffer(data.bytes)) {
      throw new Error("Incomplete Firestore payload");
    }
    return data.bytes;
  });
  return JSON.parse(gunzipSync(Buffer.concat(buffers), { maxOutputLength: 32 * 1024 * 1024 }).toString("utf8"));
}

export function writePayload(writer, ref, value, previousChunks = []) {
  const bytes = gzipSync(JSON.stringify(value));
  if (bytes.length > MAX_COMPRESSED_BYTES) throw new Error("Firestore payload exceeds the transaction limit");
  const count = Math.ceil(bytes.length / CHUNK_BYTES);
  const collection = ref.collection("payload");
  for (let index = 0; index < count; index += 1) {
    const start = index * CHUNK_BYTES;
    writer.set(collection.doc(String(index)), {
      index,
      count,
      bytes: bytes.subarray(start, start + CHUNK_BYTES),
    });
  }
  for (const chunk of previousChunks) {
    if (chunk.data().index >= count) writer.delete(chunk.ref);
  }
}
