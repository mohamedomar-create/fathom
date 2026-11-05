/**
 * The fingerprint of the files an upload came from (acceptance test 2): the SHA-256 of one file's bytes, or of the
 * sorted SHA-256s of several, so the same files picked in another order give the same fingerprint. The database
 * refuses adding a file it already saved for the company, instead of counting every row twice.
 */
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (b: ArrayBuffer | Uint8Array) => hex(await crypto.subtle.digest("SHA-256", b as BufferSource));

export async function filesFingerprint(files: ArrayBuffer[]): Promise<string> {
  const each = await Promise.all(files.map(sha256));
  if (each.length === 1) return each[0];
  return sha256(new TextEncoder().encode(each.sort().join("\n")));
}
