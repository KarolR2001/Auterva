import { crc32, deflateRawSync } from "node:zlib";

export type ZipEntry = { name: string; data: Buffer };

/**
 * Minimal ZIP writer (no zip64, no encryption, UTF-8 names, deflate). Enough for a few files below the export size
 * limit; the archive is encrypted as a whole before it is stored. Entry names are fixed ASCII chosen by the code.
 */
export function createZip(entries: ZipEntry[], modified: Date): Buffer {
  if (entries.length > 1000) throw new Error("ZIP_TOO_MANY_ENTRIES");
  const stamp = Math.max(modified.getUTCFullYear(), 1980);
  const dosDate = ((stamp - 1980) << 9) | ((modified.getUTCMonth() + 1) << 5) | modified.getUTCDate();
  const dosTime = (modified.getUTCHours() << 11) | (modified.getUTCMinutes() << 5) | (modified.getUTCSeconds() >> 1);
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(entry.name)) throw new Error("ZIP_INVALID_NAME");
    const name = Buffer.from(entry.name, "utf8");
    const packed = deflateRawSync(entry.data);
    const checksum = crc32(entry.data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(dosTime, 10);
    header.writeUInt16LE(dosDate, 12);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(packed.length, 18);
    header.writeUInt32LE(entry.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    locals.push(header, name, packed);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(8, 10);
    record.writeUInt16LE(dosTime, 12);
    record.writeUInt16LE(dosDate, 14);
    record.writeUInt32LE(checksum, 16);
    record.writeUInt32LE(packed.length, 20);
    record.writeUInt32LE(entry.data.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += header.length + name.length + packed.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}
