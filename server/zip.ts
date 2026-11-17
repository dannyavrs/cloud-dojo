/** Tiny "stored" (uncompressed) zip writer so lessons need no `zip` binary. Enough for Lambda uploads. */
export function makeZip(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const u16 = (n: number) => new Uint8Array([n & 255, (n >> 8) & 255])
  const u32 = (n: number) => new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255])
  const cat = (...p: Uint8Array[]) => {
    const out = new Uint8Array(p.reduce((a, b) => a + b.length, 0))
    let o = 0
    for (const x of p) { out.set(x, o); o += x.length }
    return out
  }
  for (const [name, text] of Object.entries(files)) {
    const nameB = enc.encode(name)
    const data = enc.encode(text)
    const crc = Bun.hash.crc32(data)
    const local = cat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(nameB.length), u16(0), nameB, data)
    central.push(cat(u32(0x02014b50), u16(0x031e), u16(20), u16(0), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(nameB.length), u16(0), u16(0), u16(0), u16(0), u32(0x81a40000), u32(offset), nameB))
    chunks.push(local)
    offset += local.length
  }
  const cd = cat(...central)
  const end = cat(u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(cd.length), u32(offset), u16(0))
  return cat(...chunks, cd, end)
}
