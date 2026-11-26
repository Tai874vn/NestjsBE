import {
  BadRequestException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type * as FsPromisesModule from 'node:fs/promises';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import sharp from 'sharp';
import {
  ACTIVE_PDF_MESSAGE,
  INVALID_DOCUMENT_MESSAGE,
  UNREADABLE_IMAGE_MESSAGE,
} from '../../utils/file-signatures';
import {
  buildDocumentUrl,
  buildImageUrl,
  DOCUMENT_MAX_BYTES,
  extractStorageKey,
  IMAGE_MAX_BYTES,
  isLocalImageUrl,
  parseAllowedOrigins,
  resolveSafeStoragePath,
  resolveUploadsDir,
  toPublicDocumentUrl,
} from '../../utils/storage-paths';
import { StorageService } from '../storage.service';
import { documentFileFilter } from '../../utils/upload-options';

const chmodCalls: Array<{ path: string; mode: number }> = [];

jest.mock('node:fs/promises', () => {
  const actual =
    jest.requireActual<typeof FsPromisesModule>('node:fs/promises');
  return {
    ...actual,
    chmod: (
      target: Parameters<typeof actual.chmod>[0],
      mode: Parameters<typeof actual.chmod>[1],
    ) => {
      chmodCalls.push({ path: String(target), mode: Number(mode) });
      return actual.chmod(target, mode);
    },
  };
});

/** Build a valid minimal ZIP archive (STORE, no compression) with real central directory entries. */
function makeZipBuffer(
  entries: Array<{ name: string; content: Buffer; dataDescriptor?: boolean }>,
  options?: {
    eocdComment?: Buffer;
    gapBetweenEntries?: Buffer;
    leadingGarbage?: Buffer;
  },
): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  if (options?.leadingGarbage) {
    localParts.push(options.leadingGarbage);
    offset += options.leadingGarbage.length;
  }

  for (let idx = 0; idx < entries.length; idx++) {
    const entry = entries[idx];
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const flags = entry.dataDescriptor ? 0x0008 : 0;

    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // local file header signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(flags, 6); // flags
    localHeader.writeUInt16LE(0, 8); // compression: store
    localHeader.writeUInt32LE(entry.dataDescriptor ? 0 : entry.content.length, 18);
    localHeader.writeUInt32LE(entry.dataDescriptor ? 0 : entry.content.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26); // file name length
    nameBuf.copy(localHeader, 30);

    const descriptor = entry.dataDescriptor
      ? (() => {
          const buf = Buffer.alloc(16);
          buf.writeUInt32LE(0x08074b50, 0);
          buf.writeUInt32LE(0, 4);
          buf.writeUInt32LE(entry.content.length, 8);
          buf.writeUInt32LE(entry.content.length, 12);
          return buf;
        })()
      : Buffer.alloc(0);

    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // central dir header signature
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(flags, 8);
    centralHeader.writeUInt32LE(entry.content.length, 20);
    centralHeader.writeUInt32LE(entry.content.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt32LE(offset, 42); // relative offset of local header
    nameBuf.copy(centralHeader, 46);

    localParts.push(localHeader, entry.content, descriptor);
    centralParts.push(centralHeader);
    offset += localHeader.length + entry.content.length + descriptor.length;

    if (options?.gapBetweenEntries && idx === 0 && entries.length > 1) {
      localParts.push(options.gapBetweenEntries);
      offset += options.gapBetweenEntries.length;
    }
  }

  const centralDir = Buffer.concat(centralParts);
  const comment = options?.eocdComment ?? Buffer.alloc(0);
  const eocd = Buffer.alloc(22 + comment.length);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(comment.length, 20);
  comment.copy(eocd, 22);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

function makePdfWithFlateStream(
  uncompressedPayload: Buffer,
  dictExtra = '/Type /ObjStm /Filter /FlateDecode',
): Buffer {
  const compressed = deflateSync(uncompressedPayload);
  return Buffer.concat([
    Buffer.from(
      `%PDF-1.7\n1 0 obj\n<< ${dictExtra} /Length ${compressed.length} >>\nstream\n`,
      'latin1',
    ),
    compressed,
    Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1'),
  ]);
}

function makeMulterFile(
  buffer: Buffer,
  overrides: Partial<Express.Multer.File> = {},
): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'upload.png',
    encoding: '7bit',
    mimetype: 'image/png',
    size: buffer.length,
    buffer,
    stream: undefined as never,
    destination: '',
    filename: '',
    path: '',
    ...overrides,
  };
}

const VALID_DOCX_ENTRIES = [
  {
    name: '[Content_Types].xml',
    content: Buffer.from(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    ),
  },
  {
    name: 'word/document.xml',
    content: Buffer.from('<w:document/>'),
  },
];

describe('StorageService', () => {
  let rootDir: string;
  let service: StorageService;

  beforeAll(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'jobaura-storage-test-'));
    service = new StorageService({
      get: (key: string) => {
        if (key === 'UPLOADS_DIR') return rootDir;
        if (key === 'NODE_ENV') return 'test';
        if (key === 'FRONTEND_URL') return 'https://jobaura.site';
        return undefined;
      },
    } as never);
  });

  afterAll(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  describe('image validation and sharp re-encoding', () => {
    it('rejects a text file renamed .png', async () => {
      const fakePng = makeMulterFile(Buffer.from('hello world, not a png'), {
        originalname: 'innocent.png',
        mimetype: 'image/png',
      });

      await expect(service.uploadImage(fakePng, 'posts')).rejects.toThrow(
        new BadRequestException(UNREADABLE_IMAGE_MESSAGE),
      );
    });

    it('rejects a file with PNG magic bytes that sharp cannot decode', async () => {
      const brokenPng = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xde, 0xad, 0xbe, 0xef,
      ]);

      await expect(
        service.uploadImage(makeMulterFile(brokenPng), 'posts'),
      ).rejects.toThrow(new BadRequestException(UNREADABLE_IMAGE_MESSAGE));
    });

    it('rejects GIF files because only JPG, PNG and WebP are allowed', async () => {
      const gifBytes = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;');

      await expect(
        service.uploadImage(
          makeMulterFile(gifBytes, {
            originalname: 'anim.gif',
            mimetype: 'image/gif',
          }),
          'posts',
        ),
      ).rejects.toThrow(new BadRequestException(UNREADABLE_IMAGE_MESSAGE));
    });

    it('re-encodes a PNG with an appended ZIP into a clean WebP file', async () => {
      const cleanPng = await sharp({
        create: {
          width: 40,
          height: 30,
          channels: 4,
          background: { r: 20, g: 120, b: 210, alpha: 1 },
        },
      })
        .png()
        .toBuffer();
      const appendedZip = makeZipBuffer([
        { name: 'payload.txt', content: Buffer.from('APPENDED_ZIP_PAYLOAD') },
      ]);
      const polyglot = Buffer.concat([cleanPng, appendedZip]);

      const result = await service.uploadImage(
        makeMulterFile(polyglot, { originalname: '../../evil.png' }),
        'posts',
      );

      expect(result.url).toMatch(
        /^\/uploads\/images\/posts\/[0-9a-f-]{36}\.webp$/,
      );
      expect(result.key).toMatch(/^images\/posts\/[0-9a-f-]{36}\.webp$/);
      expect(result.mimeType).toBe('image/webp');

      const savedPath = service.resolveSafePath('public', result.key);
      const savedBytes = await readFile(savedPath);
      expect(savedBytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
      expect(savedBytes.subarray(8, 12).toString('ascii')).toBe('WEBP');
      expect(savedBytes.includes(Buffer.from('APPENDED_ZIP_PAYLOAD'))).toBe(
        false,
      );
      expect(savedBytes.includes(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(
        false,
      );

      const meta = await sharp(savedBytes).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.exif).toBeUndefined();
    });

    it('resizes avatars to at most 512px and strips EXIF metadata', async () => {
      const largeJpeg = await sharp({
        create: {
          width: 900,
          height: 600,
          channels: 3,
          background: { r: 100, g: 50, b: 150 },
        },
      })
        .withMetadata({ exif: { IFD0: { Make: 'SecretCamera' } } })
        .jpeg()
        .toBuffer();

      const result = await service.uploadImage(
        makeMulterFile(largeJpeg, {
          originalname: 'me.jpg',
          mimetype: 'image/jpeg',
        }),
        'avatars',
      );

      const savedBytes = await readFile(
        service.resolveSafePath('public', result.key),
      );
      const meta = await sharp(savedBytes).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.width).toBe(512);
      expect(meta.height).toBeLessThanOrEqual(512);
      expect(meta.exif).toBeUndefined();
      expect(savedBytes.includes(Buffer.from('SecretCamera'))).toBe(false);
    });

    it('rejects an oversize image (> 5 MB)', async () => {
      const oversize = Buffer.alloc(IMAGE_MAX_BYTES + 1, 0xff);

      await expect(
        service.uploadImage(makeMulterFile(oversize), 'posts'),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
    });
  });

  describe('PDF streams are read per object (regression: valid PDFs were rejected)', () => {
    /** Several back-to-back objects, each with ONE FlateDecode stream, like a Word or Google Docs export. */
    function makeMultiStreamPdf(payloads: string[]): Buffer {
      const parts: Buffer[] = [Buffer.from('%PDF-1.7\n', 'latin1')];
      payloads.forEach((payload, index) => {
        const compressed = deflateSync(Buffer.from(payload, 'latin1'));
        parts.push(
          Buffer.from(
            `${index + 1} 0 obj\n<< /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`,
            'latin1',
          ),
          compressed,
          Buffer.from('\nendstream\nendobj\n', 'latin1'),
        );
      });
      parts.push(Buffer.from('%%EOF\n', 'latin1'));
      return Buffer.concat(parts);
    }

    it('accepts a PDF whose earlier objects also use /FlateDecode', async () => {
      const pdf = makeMultiStreamPdf([
        'BT /F1 12 Tf (Experience) Tj ET',
        'BT /F1 12 Tf (Education) Tj ET',
        'BT /F1 12 Tf (Skills) Tj ET',
        'BT /F1 12 Tf (Projects) Tj ET',
      ]);

      const result = await service.uploadDocument(
        makeMulterFile(pdf, { originalname: 'cv.pdf', mimetype: 'application/pdf' }),
        'resumes',
      );
      expect(result.key).toMatch(/^documents\/resumes\/[0-9a-f-]{36}\.pdf$/);
    });

    it('still rejects JavaScript hidden in a later compressed stream', async () => {
      const pdf = makeMultiStreamPdf([
        'BT /F1 12 Tf (Experience) Tj ET',
        '<< /S /JavaScript /JS (app.alert(1)) >>',
      ]);

      await expect(
        service.uploadDocument(
          makeMulterFile(pdf, { originalname: 'cv.pdf', mimetype: 'application/pdf' }),
          'resumes',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('document validation (Finding 1)', () => {
    it('accepts a clean PDF with clickable /URI links and stores it in private/documents/resumes', async () => {
      const pdf = Buffer.from(
        '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /A << /S /URI /URI (https://github.com/candidate) >> >>\nendobj\n%%EOF\n',
        'ascii',
      );

      const result = await service.uploadDocument(
        makeMulterFile(pdf, {
          originalname: 'my-cv.pdf',
          mimetype: 'application/pdf',
        }),
        'resumes',
      );

      expect(result.key).toMatch(/^documents\/resumes\/[0-9a-f-]{36}\.pdf$/);
      expect(result.url).toBe(result.key);
      expect(result.mimeType).toBe('application/pdf');
      const diskPath = service.resolveSafePath('private', result.key);
      expect((await stat(diskPath)).isFile()).toBe(true);
    });

    it.each([
      ['/JavaScript', '<< /S /JavaScript /JS (app.alert(1)) >>'],
      ['/JS', '<< /JS (alert(1)) >>'],
      ['/Launch', '<< /S /Launch /F (cmd.exe) >>'],
      ['/EmbeddedFile', '<< /Type /EmbeddedFile >>'],
      ['/EmbeddedFiles', '<< /Names << /EmbeddedFiles 3 0 R >> >>'],
      ['/EF', '<< /F (x.exe) /EF << /F 4 0 R >> >>'],
      ['/OpenAction', '<< /Type /Catalog /OpenAction 2 0 R >>'],
      ['/AA', '<< /Type /Page /AA << /O 2 0 R >> >>'],
      ['/RichMedia', '<< /Subtype /RichMedia >>'],
      ['/XFA', '<< /AcroForm << /XFA 5 0 R >> >>'],
      ['/GoToE', '<< /S /GoToE /T << /R /C >> >>'],
      ['/SubmitForm', '<< /S /SubmitForm /F (https://evil.test) >>'],
      ['/ImportData', '<< /S /ImportData /F (evil.fdf) >>'],
      ['hex-escaped /J#53', '<< /J#53 (alert(1)) >>'],
      ['hex-escaped /Open#41ction', '<< /Open#41ction 2 0 R >>'],
      ['hex-escaped /#41#41', '<< /#41#41 << /O 2 0 R >> >>'],
      ['hex-escaped /E#46', '<< /E#46 << /F 4 0 R >> >>'],
    ])('rejects a PDF containing %s with 400', async (_label, body) => {
      const pdf = Buffer.from(
        `%PDF-1.7\n1 0 obj\n${body}\nendobj\n%%EOF\n`,
        'ascii',
      );

      await expect(
        service.uploadDocument(
          makeMulterFile(pdf, {
            originalname: 'bad.pdf',
            mimetype: 'application/pdf',
          }),
          'resumes',
        ),
      ).rejects.toThrow(new BadRequestException(ACTIVE_PDF_MESSAGE));
    });

    it('rejects active content hidden inside a /FlateDecode PDF object stream', async () => {
      const hiddenJsPdf = makePdfWithFlateStream(
        Buffer.from('2 0 obj << /S /JavaScript /JS (app.alert(1)) >> endobj'),
      );

      await expect(
        service.uploadDocument(
          makeMulterFile(hiddenJsPdf, {
            originalname: 'compressed-js.pdf',
            mimetype: 'application/pdf',
          }),
          'resumes',
        ),
      ).rejects.toThrow(new BadRequestException(ACTIVE_PDF_MESSAGE));
    });

    it('rejects a PDF /FlateDecode decompression bomb with 400', async () => {
      // 6 MB of zeros compresses to ~6 KB but exceeds the 5 MB per-stream decompression cap.
      const bombPdf = makePdfWithFlateStream(Buffer.alloc(6 * 1024 * 1024, 0x41));

      await expect(
        service.uploadDocument(
          makeMulterFile(bombPdf, {
            originalname: 'bomb.pdf',
            mimetype: 'application/pdf',
          }),
          'resumes',
        ),
      ).rejects.toThrow(new BadRequestException(INVALID_DOCUMENT_MESSAGE));
    });

    it.each([
      ['bad header version', '%PDF-9.9\n1 0 obj\n<<>>\nendobj\n%%EOF\n'],
      ['HTML polyglot without objects', '%PDF-1.7\n<html><script>alert(1)</script></html>\n%%EOF\n'],
      ['SVG polyglot without newline after header', '%PDF-1.7<svg onload=alert(1)>\n%%EOF\n'],
      ['missing %%EOF', '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n'],
      [
        'trailing payload after %%EOF',
        '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n<script>evil()</script>',
      ],
    ])('rejects invalid PDF structure (%s) with 400', async (_label, raw) => {
      await expect(
        service.uploadDocument(
          makeMulterFile(Buffer.from(raw, 'ascii'), {
            originalname: 'polyglot.pdf',
            mimetype: 'application/pdf',
          }),
          'resumes',
        ),
      ).rejects.toThrow(new BadRequestException(INVALID_DOCUMENT_MESSAGE));
    });

    it('accepts a valid DOCX (including bit-3 data descriptors)', async () => {
      for (const dataDescriptor of [false, true]) {
        const docx = makeZipBuffer(
          VALID_DOCX_ENTRIES.map((entry) => ({ ...entry, dataDescriptor })),
        );

        const result = await service.uploadDocument(
          makeMulterFile(docx, {
            originalname: 'resume.docx',
            mimetype:
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          }),
          'resumes',
        );

        expect(result.key).toMatch(/^documents\/resumes\/[0-9a-f-]{36}\.docx$/);
        expect(result.mimeType).toBe(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        );
      }
    });

    it.each([
      [
        'plain ZIP without DOCX parts',
        makeZipBuffer([{ name: 'readme.txt', content: Buffer.from('hi') }]),
      ],
      [
        'non-ZIP with PK magic',
        Buffer.from('PK\x03\x04[Content_Types].xml not a zip'),
      ],
      [
        'OPC package missing word/document.xml (.xlsx/.nupkg/.vsix)',
        makeZipBuffer([
          VALID_DOCX_ENTRIES[0],
          { name: 'xl/workbook.xml', content: Buffer.from('<workbook/>') },
        ]),
      ],
      [
        'macro-enabled .docm with word/vbaProject.bin',
        makeZipBuffer([
          ...VALID_DOCX_ENTRIES,
          { name: 'word/vbaProject.bin', content: Buffer.from('VBA') },
        ]),
      ],
      [
        'macro metadata word/vbaData.xml',
        makeZipBuffer([
          ...VALID_DOCX_ENTRIES,
          { name: 'word/vbaData.xml', content: Buffer.from('<vba/>') },
        ]),
      ],
      [
        'ActiveX control entry',
        makeZipBuffer([
          ...VALID_DOCX_ENTRIES,
          { name: 'word/activeX/activeX1.xml', content: Buffer.from('<ax/>') },
        ]),
      ],
      [
        'embedded object under word/embeddings/',
        makeZipBuffer([
          ...VALID_DOCX_ENTRIES,
          { name: 'word/embeddings/oleObject1.dat', content: Buffer.from('OLE') },
        ]),
      ],
      [
        'embedded executable virus.exe after [Content_Types].xml',
        makeZipBuffer([
          ...VALID_DOCX_ENTRIES,
          { name: 'virus.exe', content: Buffer.from('MZfake') },
        ]),
      ],
      [
        'embedded script payload.js',
        makeZipBuffer([
          ...VALID_DOCX_ENTRIES,
          { name: 'word/payload.js', content: Buffer.from('alert(1)') },
        ]),
      ],
      [
        'unreferenced gap bytes between entries',
        makeZipBuffer(VALID_DOCX_ENTRIES, {
          gapBetweenEntries: Buffer.from('<script>smuggled</script>'),
        }),
      ],
      [
        'non-zero EOCD comment',
        makeZipBuffer(VALID_DOCX_ENTRIES, {
          eocdComment: Buffer.from('smuggled comment'),
        }),
      ],
      [
        'zip-slip entry with ..',
        makeZipBuffer([
          ...VALID_DOCX_ENTRIES,
          { name: '../escape.xml', content: Buffer.from('<x/>') },
        ]),
      ],
    ])('rejects unsafe or forged DOCX (%s) with 400', async (_label, payload) => {
      await expect(
        service.uploadDocument(
          makeMulterFile(payload, {
            originalname: 'bad.docx',
            mimetype:
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          }),
          'resumes',
        ),
      ).rejects.toThrow(new BadRequestException(INVALID_DOCUMENT_MESSAGE));
    });

    it('rejects legacy .doc files (OLE2 magic) and application/msword MIME type', async () => {
      const legacyDoc = Buffer.concat([
        Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
        Buffer.from('legacy-word-body'),
      ]);

      await expect(
        service.uploadDocument(
          makeMulterFile(legacyDoc, {
            originalname: 'old.doc',
            mimetype: 'application/msword',
          }),
          'resumes',
        ),
      ).rejects.toThrow(new BadRequestException(INVALID_DOCUMENT_MESSAGE));

      const filterResult = await new Promise<{ err: Error | null; ok: boolean }>(
        (resolveFilter) => {
          documentFileFilter(
            {} as never,
            makeMulterFile(legacyDoc, { mimetype: 'application/msword' }),
            (err, ok) => resolveFilter({ err, ok }),
          );
        },
      );
      expect(filterResult.ok).toBe(false);
      expect(filterResult.err).toBeInstanceOf(BadRequestException);
    });

    it('rejects an oversize document (> 10 MB)', async () => {
      const oversize = Buffer.alloc(DOCUMENT_MAX_BYTES + 1, 0x25);

      await expect(
        service.uploadDocument(
          makeMulterFile(oversize, {
            originalname: 'huge.pdf',
            mimetype: 'application/pdf',
          }),
          'resumes',
        ),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
    });
  });

  describe('symlink protection and file modes (Findings 2 & 3)', () => {
    it('applies 0755/0644 modes for public images and 0700/0600 modes for private documents', async () => {
      chmodCalls.length = 0;
      const png = await sharp({
        create: {
          width: 8,
          height: 8,
          channels: 4,
          background: { r: 10, g: 20, b: 30, alpha: 1 },
        },
      })
        .png()
        .toBuffer();

      const img = await service.uploadImage(makeMulterFile(png), 'modes_pub');
      const publicModes = chmodCalls.map((call) => call.mode);
      expect(publicModes).toContain(0o755);
      expect(publicModes).toContain(0o644);
      expect(publicModes).not.toContain(0o700);
      expect(publicModes).not.toContain(0o600);
      if (process.platform !== 'win32') {
        const imgPath = service.resolveSafePath('public', img.key);
        expect((await stat(imgPath)).mode & 0o777).toBe(0o644);
      }

      chmodCalls.length = 0;
      const pdf = Buffer.from(
        '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n',
        'ascii',
      );
      const doc = await service.uploadDocument(
        makeMulterFile(pdf, { mimetype: 'application/pdf' }),
        'modes_priv',
      );
      const privateModes = chmodCalls.map((call) => call.mode);
      expect(privateModes).toContain(0o700);
      expect(privateModes).toContain(0o600);
      expect(privateModes).not.toContain(0o755);
      expect(privateModes).not.toContain(0o644);
      if (process.platform !== 'win32') {
        const docPath = service.resolveSafePath('private', doc.key);
        expect((await stat(docPath)).mode & 0o777).toBe(0o600);
      }
    });

    it('blocks reading a document through a symlinked directory escaping private/', async () => {
      const outsideDir = await mkdtemp(join(tmpdir(), 'jobaura-outside-'));
      const uuid = '550e8400-e29b-41d4-a716-446655440099';
      const secretFile = join(outsideDir, `${uuid}.pdf`);
      await writeFile(secretFile, 'SECRET_DATA');

      const docsRoot = join(rootDir, 'private', 'documents');
      await mkdir(docsRoot, { recursive: true });
      const linkedFolder = join(docsRoot, 'escaped_read');
      await symlink(outsideDir, linkedFolder, 'junction');

      try {
        await expect(
          service.openDocumentStream(`documents/escaped_read/${uuid}.pdf`),
        ).rejects.toThrow(new NotFoundException('File not found'));
      } finally {
        await rm(linkedFolder, { recursive: true, force: true });
        await rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('blocks writing an image into a symlinked directory escaping public/', async () => {
      const outsideDir = await mkdtemp(join(tmpdir(), 'jobaura-outside-w-'));
      const imagesRoot = join(rootDir, 'public', 'images');
      await mkdir(imagesRoot, { recursive: true });
      const linkedFolder = join(imagesRoot, 'escaped_write');
      await symlink(outsideDir, linkedFolder, 'junction');

      try {
        const png = await sharp({
          create: {
            width: 8,
            height: 8,
            channels: 4,
            background: { r: 5, g: 6, b: 7, alpha: 1 },
          },
        })
          .png()
          .toBuffer();

        await expect(
          service.uploadImage(makeMulterFile(png), 'escaped_write'),
        ).rejects.toBeInstanceOf(BadRequestException);
      } finally {
        await rm(linkedFolder, { recursive: true, force: true });
        await rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('blocks deleting a file through a symlinked directory escaping public/', async () => {
      const outsideDir = await mkdtemp(join(tmpdir(), 'jobaura-outside-d-'));
      const uuid = '550e8400-e29b-41d4-a716-446655440088';
      const victimFile = join(outsideDir, `${uuid}.webp`);
      await writeFile(victimFile, 'DO_NOT_DELETE');

      const imagesRoot = join(rootDir, 'public', 'images');
      await mkdir(imagesRoot, { recursive: true });
      const linkedFolder = join(imagesRoot, 'escaped_del');
      await symlink(outsideDir, linkedFolder, 'junction');
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      try {
        await service.deleteImage(`/uploads/images/escaped_del/${uuid}.webp`);
        expect((await readFile(victimFile, 'utf8'))).toBe('DO_NOT_DELETE');
      } finally {
        warnSpy.mockRestore();
        await rm(linkedFolder, { recursive: true, force: true });
        await rm(outsideDir, { recursive: true, force: true });
      }
    });
  });

  describe('environment fallback without ConfigService (Finding 4)', () => {
    it('uses process.env.UPLOADS_DIR when constructed without ConfigService', async () => {
      const prev = process.env.UPLOADS_DIR;
      const customDir = await mkdtemp(join(tmpdir(), 'jobaura-env-uploads-'));
      process.env.UPLOADS_DIR = customDir;
      try {
        const standalone = new StorageService();
        const resolved = standalone.resolveSafePath(
          'public',
          'images/avatars/550e8400-e29b-41d4-a716-446655440000.webp',
        );
        expect(resolved.startsWith(customDir)).toBe(true);
      } finally {
        if (prev === undefined) {
          delete process.env.UPLOADS_DIR;
        } else {
          process.env.UPLOADS_DIR = prev;
        }
        await rm(customDir, { recursive: true, force: true });
      }
    });
  });

  describe('path traversal guards and deletes', () => {
    it.each([
      '../etc/passwd',
      'images/../../etc/passwd',
      'images/avatars/../../../secret.txt',
      'images\\avatars\\file.webp',
      '/etc/passwd',
      'images/avatars/file\0.webp',
      '',
    ])('blocks path traversal input: %j', (badPath) => {
      expect(() => resolveSafeStoragePath(rootDir, 'public', badPath)).toThrow(
        BadRequestException,
      );
    });

    it('rejects unsafe folder names during upload', async () => {
      const pdf = Buffer.from(
        '%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n',
        'ascii',
      );
      await expect(
        service.uploadDocument(
          makeMulterFile(pdf, { mimetype: 'application/pdf' }),
          '../escape',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('deletes a stored image and ignores missing files without throwing', async () => {
      const png = await sharp({
        create: {
          width: 8,
          height: 8,
          channels: 4,
          background: { r: 1, g: 2, b: 3, alpha: 1 },
        },
      })
        .png()
        .toBuffer();
      const uploaded = await service.uploadImage(makeMulterFile(png), 'jobs');
      const fullPath = service.resolveSafePath('public', uploaded.key);

      await service.deleteImage(uploaded.url);
      await expect(stat(fullPath)).rejects.toMatchObject({ code: 'ENOENT' });

      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      await expect(service.deleteImage(uploaded.url)).resolves.toBeUndefined();
      await expect(
        service.deleteImage('https://res.cloudinary.com/demo/v1/old.png'),
      ).resolves.toBeUndefined();
      warnSpy.mockRestore();
    });
  });

  describe('URL builders, key extractors, and case sensitivity (Finding 10)', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const upperUuid = uuid.toUpperCase();

    it('builds image and document URLs from validated lowercase keys only', () => {
      expect(buildImageUrl(`images/avatars/${uuid}.webp`)).toBe(
        `/uploads/images/avatars/${uuid}.webp`,
      );
      expect(buildDocumentUrl(`documents/resumes/${uuid}.pdf`)).toBe(
        `/api/files/documents/resumes/${uuid}.pdf`,
      );
      expect(() => buildImageUrl(`images/avatars/${upperUuid}.webp`)).toThrow(
        BadRequestException,
      );
      expect(() => buildImageUrl(`IMAGES/avatars/${uuid}.WEBP`)).toThrow(
        BadRequestException,
      );
      expect(() => buildDocumentUrl(`documents/resumes/${uuid}.PDF`)).toThrow(
        BadRequestException,
      );
      expect(() => buildDocumentUrl(`documents/resumes/${uuid}.doc`)).toThrow(
        BadRequestException,
      );
      expect(() => buildImageUrl('images/avatars/../../evil.webp')).toThrow(
        BadRequestException,
      );
      expect(() => buildDocumentUrl('documents/resumes/evil.exe')).toThrow(
        BadRequestException,
      );
    });

    it('maps stored resume keys to /api/files/documents/* while keeping legacy URLs', () => {
      expect(toPublicDocumentUrl(`documents/resumes/${uuid}.pdf`)).toBe(
        `/api/files/documents/resumes/${uuid}.pdf`,
      );
      expect(
        toPublicDocumentUrl(`/api/files/documents/resumes/${uuid}.docx`),
      ).toBe(`/api/files/documents/resumes/${uuid}.docx`);
      expect(
        toPublicDocumentUrl('https://res.cloudinary.com/demo/raw/cv.pdf'),
      ).toBe('https://res.cloudinary.com/demo/raw/cv.pdf');
      expect(toPublicDocumentUrl(null)).toBeNull();
      expect(toPublicDocumentUrl('documents/../../etc/passwd')).toBeNull();
    });

    it('extracts storage keys only for relative paths, raw keys, or configured origins and rejects uppercase/external hosts', () => {
      const allowed = parseAllowedOrigins('https://jobaura.site');

      expect(extractStorageKey(`/uploads/images/posts/${uuid}.webp`, allowed)).toBe(
        `images/posts/${uuid}.webp`,
      );
      expect(
        extractStorageKey(
          `https://jobaura.site/uploads/images/posts/${uuid}.webp`,
          allowed,
        ),
      ).toBe(`images/posts/${uuid}.webp`);
      // Foreign host with a matching path must be rejected so deleteImage cannot touch local files.
      expect(
        extractStorageKey(
          `https://evil.com/uploads/images/posts/${uuid}.webp`,
          allowed,
        ),
      ).toBeNull();
      expect(
        service.extractKey(`https://evil.com/uploads/images/posts/${uuid}.webp`),
      ).toBeNull();
      expect(
        service.extractKey(
          `https://jobaura.site/uploads/images/posts/${uuid}.webp`,
        ),
      ).toBe(`images/posts/${uuid}.webp`);
      expect(
        extractStorageKey(`/api/files/documents/resumes/${uuid}.pdf`, allowed),
      ).toBe(`documents/resumes/${uuid}.pdf`);
      // Legacy .doc keys and uppercase keys are rejected.
      expect(
        extractStorageKey(`documents/resumes/${uuid}.doc`, allowed),
      ).toBeNull();
      expect(
        extractStorageKey(`/UPLOADS/IMAGES/POSTS/${upperUuid}.WEBP`, allowed),
      ).toBeNull();
      expect(
        extractStorageKey('https://res.cloudinary.com/demo/image/v1/a.png', allowed),
      ).toBeNull();
      expect(
        extractStorageKey('/uploads/images/posts/../../secret.webp', allowed),
      ).toBeNull();

      expect(isLocalImageUrl(`/uploads/images/contracts/${uuid}.webp`)).toBe(
        true,
      );
      expect(isLocalImageUrl(`/UPLOADS/IMAGES/CONTRACTS/${upperUuid}.WEBP`)).toBe(
        false,
      );
      expect(isLocalImageUrl(`/uploads/images/contracts/${uuid}.png`)).toBe(
        false,
      );
    });

    it('resolves UPLOADS_DIR using env, production default, or local default', () => {
      expect(
        resolveUploadsDir({ uploadsDir: '/custom/uploads', nodeEnv: 'test' }),
      ).toMatch(/custom[/\\]uploads$/);
      expect(resolveUploadsDir({ nodeEnv: 'production' })).toMatch(
        /app[/\\]uploads$/,
      );
      expect(resolveUploadsDir({ nodeEnv: 'development' })).toMatch(
        /uploads$/,
      );
    });
  });
});
