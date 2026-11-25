import { BadRequestException } from '@nestjs/common';
import { inflateSync } from 'node:zlib';
import { DOCUMENT_MIME_BY_EXT, DocumentExtension } from './storage-paths';

export type DetectedImageFormat = 'jpeg' | 'png' | 'webp';

export interface DetectedDocument {
  extension: DocumentExtension;
  mimeType: string;
}

export const UNREADABLE_IMAGE_MESSAGE =
  'This image could not be read. Use a JPG, PNG or WebP file.';

export const ACTIVE_PDF_MESSAGE =
  'This PDF contains active content and cannot be uploaded.';

export const INVALID_DOCUMENT_MESSAGE =
  'Only valid PDF and DOCX files are allowed.';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const ZIP_LOCAL_HEADER = 0x04034b50;
const ZIP_DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIR_SIGNATURE = 0x02014b50;
const ZIP_EOCD_MIN_SIZE = 22;
const ZIP_LOCAL_HEADER_MIN_SIZE = 30;
const ZIP_CD_HEADER_MIN_SIZE = 46;
const ZIP_FLAG_ENCRYPTED = 0x0001;
const ZIP_FLAG_DATA_DESCRIPTOR = 0x0008;
const ZIP_UINT32_MAX = 0xffffffff;
const MAX_ZIP_ENTRIES_TO_SCAN = 10_000;

// PDF structure rules: real header version, %%EOF near the end with no trailing garbage,
// and at least one PDF object so HTML/SVG/binary polyglots are rejected.
const PDF_HEADER_PATTERN = /^%PDF-(?:1\.[0-7]|2\.0)\r?\n/;
const PDF_EOF_TAIL_BYTES = 1024;
const PDF_EOF_PATTERN = /(?:^|[\r\n])%%EOF[\r\n\t ]*$/;
const PDF_OBJ_PATTERN = /(?:^|[\r\n\t ])\d+\s+\d+\s+obj(?:[\r\n\t <[/%(]|$)/;
const PDF_ENDOBJ_PATTERN = /(?:^|[\r\n\t \]>)/])endobj(?:[\r\n\t ]|$)/;

// Hard limits when unpacking /FlateDecode streams so decompression bombs are rejected with 400.
const PDF_MAX_STREAM_DECOMPRESSED_BYTES = 5 * 1024 * 1024;
const PDF_MAX_TOTAL_DECOMPRESSED_BYTES = 20 * 1024 * 1024;

// Dangerous active or embedded PDF names. /URI stays allowed so clickable CV links still work.
const PDF_FORBIDDEN_NAMES = new Set([
  '/JavaScript',
  '/JS',
  '/Launch',
  '/EmbeddedFile',
  '/EmbeddedFiles',
  '/EF',
  '/OpenAction',
  '/AA',
  '/RichMedia',
  '/XFA',
  '/GoToE',
  '/SubmitForm',
  '/ImportData',
]);

const PDF_ACTIVE_CONTENT_PATTERN =
  /(?:\/JavaScript|\/JS|\/Launch|\/EmbeddedFiles?|\/EF|\/OpenAction|\/AA|\/RichMedia|\/XFA|\/GoToE|\/SubmitForm|\/ImportData)(?![A-Za-z0-9_.-])/;

// Reject macro parts, ActiveX controls, embedded packages and executable/script files in DOCX.
const DOCX_FORBIDDEN_ENTRY_PATTERNS = [
  /vbaProject\.bin$/i,
  /vbaData\.xml$/i,
  /^word\/activeX\//i,
  /^word\/embeddings\//i,
  /\.(?:bin|exe|dll|js|vbs|ps1|bat|cmd|sh|html?|svg)$/i,
];

/**
 * Inspect the leading magic bytes of an image buffer.
 * Only JPEG, PNG and WebP are accepted; the client MIME type and file name are ignored.
 */
export function detectImageSignature(
  buffer: Buffer | undefined,
): DetectedImageFormat | null {
  if (!buffer || buffer.length < 12) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (buffer.subarray(0, 8).equals(PNG_MAGIC)) {
    return 'png';
  }
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

/** Decode PDF `#XX` hex escapes inside name tokens so `/J#53` becomes `/JS`. */
function decodePdfHexNames(text: string): string {
  if (!text.includes('#')) return text;
  return text.replace(/#([0-9A-Fa-f]{2})/g, (_match, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

/**
 * Check raw or decompressed PDF bytes for active or embedded content
 * (scripts, actions, forms, launches, rich media, XFA, embedded files),
 * including hex-escaped PDF names such as `/J#53` or `/Open#41ction`.
 */
export function hasActivePdfContent(buffer: Buffer): boolean {
  const text = buffer.toString('latin1');
  if (PDF_ACTIVE_CONTENT_PATTERN.test(text)) {
    return true;
  }

  const nameTokens = text.match(/\/[A-Za-z0-9#._+-]{2,128}/g);
  if (!nameTokens) return false;

  for (const token of nameTokens) {
    if (!token.includes('#')) continue;
    const decoded = decodePdfHexNames(token);
    if (PDF_FORBIDDEN_NAMES.has(decoded)) {
      return true;
    }
  }
  return false;
}

function isZlibOutputLimitError(error: unknown): boolean {
  if (error instanceof RangeError) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ERR_BUFFER_TOO_LARGE'
  );
}

/**
 * Decompress every `/FlateDecode` stream in a PDF with strict per-stream and total byte caps,
 * and scan the unpacked bytes for hidden active content (for example inside `/ObjStm`).
 */
/** The dictionary text of the object that owns the stream starting at `streamIndex`. */
export function ownStreamDictionary(text: string, streamIndex: number): string {
  const objHeader = /\d+\s+\d+\s+obj\b/g;
  // Search a bounded window, then keep the LAST object header before the stream keyword.
  const windowStart = Math.max(0, streamIndex - 8192);
  objHeader.lastIndex = windowStart;
  let start = -1;
  let found: RegExpExecArray | null;
  while ((found = objHeader.exec(text)) !== null && found.index < streamIndex) {
    start = found.index;
  }
  return text.slice(start >= 0 ? start : windowStart, streamIndex);
}

/** Only the value of the /Filter entry (one name or a [ ... ] array), so no other key is counted. */
export function filterValue(dictionary: string): string {
  const filter = /\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9_.-]+)/.exec(dictionary);
  return filter ? filter[1] : '';
}

function scanCompressedPdfStreams(buffer: Buffer): void {
  const text = buffer.toString('latin1');
  const streamMarker = /\bstream(?:\r\n|\n)/g;
  let totalDecompressed = 0;
  let match: RegExpExecArray | null;

  while ((match = streamMarker.exec(text)) !== null) {
    const dataStart = match.index + match[0].length;
    const endIdx = text.indexOf('endstream', dataStart);
    if (endIdx === -1) break;

    let dataEnd = endIdx;
    if (dataEnd > dataStart && buffer[dataEnd - 1] === 0x0a) dataEnd--;
    if (dataEnd > dataStart && buffer[dataEnd - 1] === 0x0d) dataEnd--;

    streamMarker.lastIndex = endIdx + 'endstream'.length;
    if (dataEnd <= dataStart) continue;

    // Read only THIS stream's own /Filter value (from its "N G obj" header to "stream").
    // A fixed look-back window also caught the filters of earlier objects, so a normal
    // single-compressed stream was inflated twice and valid PDFs (Word, Google Docs exports) were rejected.
    const decodedDict = filterValue(
      decodePdfHexNames(ownStreamDictionary(text, match.index)),
    );
    const flateMatches = decodedDict.match(/\/FlateDecode(?![A-Za-z0-9_.-])/g);
    const isFlate = Boolean(flateMatches && flateMatches.length > 0);
    const hasOtherFilter =
      /\/(?:ASCIIHexDecode|ASCII85Decode|LZWDecode|RunLengthDecode|CCITTFaxDecode|JBIG2Decode|DCTDecode|JPXDecode|Crypt)(?![A-Za-z0-9_.-])/.test(
        decodedDict,
      );

    const streamSlice = buffer.subarray(dataStart, dataEnd);
    const looksLikeZlib =
      streamSlice.length >= 2 &&
      (streamSlice[0] & 0x0f) === 8 &&
      ((streamSlice[0] << 8) + streamSlice[1]) % 31 === 0;

    if (!isFlate && !looksLikeZlib) continue;

    // Handle chained `/Filter [/FlateDecode /FlateDecode]` up to 2 passes.
    const passes =
      isFlate && !hasOtherFilter ? Math.min(flateMatches!.length, 2) : 1;
    let current = streamSlice;

    for (let pass = 0; pass < passes; pass++) {
      const remaining = PDF_MAX_TOTAL_DECOMPRESSED_BYTES - totalDecompressed;
      if (remaining <= 0) {
        throw new BadRequestException(INVALID_DOCUMENT_MESSAGE);
      }
      const maxOutputLength = Math.min(
        PDF_MAX_STREAM_DECOMPRESSED_BYTES,
        remaining,
      );

      let decompressed: Buffer;
      try {
        decompressed = inflateSync(current, { maxOutputLength });
      } catch (error) {
        if (isZlibOutputLimitError(error)) {
          throw new BadRequestException(INVALID_DOCUMENT_MESSAGE);
        }
        // A stream that declares only /FlateDecode must unpack cleanly so attackers cannot hide
        // payloads behind malformed streams that lenient PDF readers still parse.
        if (isFlate && !hasOtherFilter) {
          throw new BadRequestException(INVALID_DOCUMENT_MESSAGE);
        }
        break;
      }

      totalDecompressed += decompressed.length;
      if (hasActivePdfContent(decompressed)) {
        throw new BadRequestException(ACTIVE_PDF_MESSAGE);
      }
      current = decompressed;
    }
  }
}

/** Validate PDF structure (header, objects, %%EOF trailer) and active-content rules. */
function validatePdfBuffer(buffer: Buffer): void {
  const headerSlice = buffer.subarray(0, 16).toString('latin1');
  if (!PDF_HEADER_PATTERN.test(headerSlice)) {
    throw new BadRequestException(INVALID_DOCUMENT_MESSAGE);
  }

  const tailStart = Math.max(0, buffer.length - PDF_EOF_TAIL_BYTES);
  const tailText = buffer.subarray(tailStart).toString('latin1');
  if (!PDF_EOF_PATTERN.test(tailText)) {
    throw new BadRequestException(INVALID_DOCUMENT_MESSAGE);
  }

  const fullText = buffer.toString('latin1');
  if (!PDF_OBJ_PATTERN.test(fullText) || !PDF_ENDOBJ_PATTERN.test(fullText)) {
    throw new BadRequestException(INVALID_DOCUMENT_MESSAGE);
  }

  if (hasActivePdfContent(buffer)) {
    throw new BadRequestException(ACTIVE_PDF_MESSAGE);
  }

  scanCompressedPdfStreams(buffer);
}

function isSafeZipEntryName(entryName: string): boolean {
  if (!entryName || entryName.includes('\0') || entryName.includes('\\')) {
    return false;
  }
  if (entryName.startsWith('/')) {
    return false;
  }
  const segments = entryName.split('/');
  if (segments.some((segment) => segment === '..')) {
    return false;
  }
  return true;
}

/**
 * Strictly validate a DOCX archive by parsing its entire ZIP central directory and local headers:
 * - No EOCD comment and no trailing bytes after EOCD
 * - Every central-directory entry matches a real `PK\x03\x04` local header with identical name/flags
 * - Local entry spans pack contiguously from offset 0 to the central directory (blocking gap payloads)
 * - No path traversal, duplicate names, macros (`vbaProject.bin`), ActiveX, embeddings or executables
 * - Contains both `[Content_Types].xml` and `word/document.xml`
 */
export function isValidDocxArchive(buffer: Buffer): boolean {
  if (buffer.length < ZIP_EOCD_MIN_SIZE) return false;
  if (buffer.readUInt32LE(0) !== ZIP_LOCAL_HEADER) return false;

  // Enforce zero EOCD comment length and zero trailing bytes after EOCD.
  const eocdOffset = buffer.length - ZIP_EOCD_MIN_SIZE;
  if (buffer.readUInt32LE(eocdOffset) !== ZIP_EOCD_SIGNATURE) return false;
  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const cdStartDisk = buffer.readUInt16LE(eocdOffset + 6);
  const diskEntries = buffer.readUInt16LE(eocdOffset + 8);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const cdSize = buffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
  const commentLength = buffer.readUInt16LE(eocdOffset + 20);

  if (
    commentLength !== 0 ||
    diskNumber !== 0 ||
    cdStartDisk !== 0 ||
    diskEntries !== entryCount ||
    entryCount === 0 ||
    entryCount > MAX_ZIP_ENTRIES_TO_SCAN ||
    cdSize === 0 ||
    cdSize === ZIP_UINT32_MAX ||
    cdOffset === ZIP_UINT32_MAX
  ) {
    return false;
  }

  const cdEnd = cdOffset + cdSize;
  if (cdEnd !== eocdOffset) {
    return false;
  }

  let cursor = cdOffset;
  let hasContentTypes = false;
  let hasWordDocument = false;
  const seenNames = new Set<string>();
  const spans: Array<{ start: number; end: number }> = [];

  for (let i = 0; i < entryCount; i++) {
    if (cursor + ZIP_CD_HEADER_MIN_SIZE > cdEnd) {
      return false;
    }
    if (buffer.readUInt32LE(cursor) !== ZIP_CENTRAL_DIR_SIGNATURE) {
      return false;
    }

    const cdFlags = buffer.readUInt16LE(cursor + 8);
    const cdMethod = buffer.readUInt16LE(cursor + 10);
    const cdCompSize = buffer.readUInt32LE(cursor + 20);
    const cdUncompSize = buffer.readUInt32LE(cursor + 24);
    const cdNameLen = buffer.readUInt16LE(cursor + 28);
    const cdExtraLen = buffer.readUInt16LE(cursor + 30);
    const cdCommentLen = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);

    if (
      (cdFlags & ZIP_FLAG_ENCRYPTED) !== 0 ||
      cdCompSize === ZIP_UINT32_MAX ||
      cdUncompSize === ZIP_UINT32_MAX ||
      localOffset === ZIP_UINT32_MAX
    ) {
      return false;
    }

    const entrySize =
      ZIP_CD_HEADER_MIN_SIZE + cdNameLen + cdExtraLen + cdCommentLen;
    if (cursor + entrySize > cdEnd) {
      return false;
    }

    const cdNameStart = cursor + ZIP_CD_HEADER_MIN_SIZE;
    const cdNameBytes = buffer.subarray(cdNameStart, cdNameStart + cdNameLen);
    const entryName = cdNameBytes.toString('utf8');

    if (!isSafeZipEntryName(entryName) || seenNames.has(entryName)) {
      return false;
    }
    seenNames.add(entryName);

    if (
      DOCX_FORBIDDEN_ENTRY_PATTERNS.some((pattern) => pattern.test(entryName))
    ) {
      return false;
    }

    if (entryName === '[Content_Types].xml') {
      hasContentTypes = true;
    } else if (entryName === 'word/document.xml') {
      hasWordDocument = true;
    }

    // Verify the matching local file header at `localOffset`.
    if (localOffset + ZIP_LOCAL_HEADER_MIN_SIZE > cdOffset) {
      return false;
    }
    if (buffer.readUInt32LE(localOffset) !== ZIP_LOCAL_HEADER) {
      return false;
    }
    const localFlags = buffer.readUInt16LE(localOffset + 6);
    const localMethod = buffer.readUInt16LE(localOffset + 8);
    const localCompSize = buffer.readUInt32LE(localOffset + 18);
    const localUncompSize = buffer.readUInt32LE(localOffset + 22);
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);

    if (
      localFlags !== cdFlags ||
      localMethod !== cdMethod ||
      localNameLen !== cdNameLen
    ) {
      return false;
    }

    const localNameStart = localOffset + ZIP_LOCAL_HEADER_MIN_SIZE;
    const dataStart = localNameStart + localNameLen + localExtraLen;
    if (dataStart > cdOffset) {
      return false;
    }
    if (
      !buffer
        .subarray(localNameStart, localNameStart + localNameLen)
        .equals(cdNameBytes)
    ) {
      return false;
    }

    const dataEnd = dataStart + cdCompSize;
    if (dataEnd > cdOffset) {
      return false;
    }

    let spanEnd = dataEnd;
    if ((localFlags & ZIP_FLAG_DATA_DESCRIPTOR) !== 0) {
      // Bit 3 allows a 16-byte (with signature) or 12-byte (without signature) data descriptor.
      if (
        dataEnd + 16 <= cdOffset &&
        buffer.readUInt32LE(dataEnd) === ZIP_DATA_DESCRIPTOR_SIGNATURE &&
        buffer.readUInt32LE(dataEnd + 8) === cdCompSize &&
        buffer.readUInt32LE(dataEnd + 12) === cdUncompSize
      ) {
        spanEnd = dataEnd + 16;
      } else if (
        dataEnd + 12 <= cdOffset &&
        buffer.readUInt32LE(dataEnd + 4) === cdCompSize &&
        buffer.readUInt32LE(dataEnd + 8) === cdUncompSize
      ) {
        spanEnd = dataEnd + 12;
      } else {
        return false;
      }
    } else if (
      localCompSize !== cdCompSize ||
      localUncompSize !== cdUncompSize
    ) {
      return false;
    }

    spans.push({ start: localOffset, end: spanEnd });
    cursor += entrySize;
  }

  if (cursor !== cdEnd || !hasContentTypes || !hasWordDocument) {
    return false;
  }

  // Every byte from 0 to cdOffset must belong to exactly one local entry (no gaps or overlaps).
  spans.sort((a, b) => a.start - b.start);
  if (spans[0].start !== 0) {
    return false;
  }
  for (let i = 1; i < spans.length; i++) {
    if (spans[i].start !== spans[i - 1].end) {
      return false;
    }
  }
  if (spans[spans.length - 1].end !== cdOffset) {
    return false;
  }

  return true;
}

/**
 * Inspect a CV document buffer by its magic bytes and full structure.
 * Only clean PDF and macro-free DOCX files are accepted; legacy `.doc` is rejected.
 */
export function validateAndDetectDocument(
  buffer: Buffer | undefined,
): DetectedDocument {
  if (!buffer || buffer.length < 5) {
    throw new BadRequestException(INVALID_DOCUMENT_MESSAGE);
  }

  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    validatePdfBuffer(buffer);
    return {
      extension: '.pdf',
      mimeType: DOCUMENT_MIME_BY_EXT['.pdf'],
    };
  }

  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    if (!isValidDocxArchive(buffer)) {
      throw new BadRequestException(INVALID_DOCUMENT_MESSAGE);
    }
    return {
      extension: '.docx',
      mimeType: DOCUMENT_MIME_BY_EXT['.docx'],
    };
  }

  throw new BadRequestException(INVALID_DOCUMENT_MESSAGE);
}
