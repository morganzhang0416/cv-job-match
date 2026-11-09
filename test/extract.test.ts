import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { extractBullets } from '../src/analyze/bullets.ts';
import { normalizeText } from '../src/analyze/text.ts';
import { docxToText, xmlToText } from '../src/extract/docx.ts';
import { extractResume, MAX_PDF_PAGES } from '../src/extract/index.ts';
import { pdfToText } from '../src/extract/pdf.ts';
import { decodeText, sniffKind } from '../src/extract/sniff.ts';
import { listZipEntries, readZipEntry, type ZipEntry } from '../src/extract/zip.ts';
import { docxFile, documentXml, para } from './helpers/docx.ts';
import { makePdf } from './helpers/pdf.ts';
import { makeZip } from './helpers/zip.ts';

const MB = 1024 * 1024;

function entryOf(zip: Buffer, name: string): ZipEntry {
  const found = listZipEntries(zip).find((entry) => entry.name === name);
  assert.ok(found, `entry ${name}`);
  return found;
}

describe('sniffKind', () => {
  it('knows a file by its first bytes', () => {
    assert.equal(sniffKind(Buffer.from('%PDF-1.7\n')), 'pdf');
    assert.equal(sniffKind(makeZip([{ name: 'a.txt', data: 'hi' }])), 'zip');
    assert.equal(sniffKind(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0])), 'legacy-doc');
    assert.equal(sniffKind(Buffer.from('{\\rtf1\\ansi Hello')), 'rtf');
  });

  it('finds a PDF that has a few stray bytes before its header', () => {
    assert.equal(sniffKind(Buffer.from('\r\n\r\n%PDF-1.4\n1 0 obj')), 'pdf');
    assert.equal(sniffKind(Buffer.from(`${' '.repeat(2000)}%PDF-1.4`)), 'text');
  });

  it('calls plain text, in any common encoding, text', () => {
    assert.equal(sniffKind(Buffer.from('Alex Taylor\nSoftware Engineer\n')), 'text');
    assert.equal(sniffKind(Buffer.from('\uFEFFHello', 'utf16le')), 'text');
    assert.equal(sniffKind(Buffer.from('Caf\u00E9 \u2022 jobs', 'latin1')), 'text');
  });

  it('does not call binary data text', () => {
    assert.equal(sniffKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d])), 'unknown');
    assert.equal(sniffKind(Uint8Array.from({ length: 300 }, (_, index) => index % 7)), 'unknown');
  });
});

describe('decodeText', () => {
  it('reads UTF-8, with or without a byte order mark', () => {
    assert.equal(decodeText(Buffer.from('Caf\u00E9 \u2022 Alex')), 'Caf\u00E9 \u2022 Alex');
    assert.equal(decodeText(Buffer.from('\uFEFFCaf\u00E9')), 'Caf\u00E9');
  });

  it('reads UTF-16 with a byte order mark', () => {
    assert.equal(decodeText(Buffer.from('\uFEFFAlex \u2022 Taylor', 'utf16le')), 'Alex \u2022 Taylor');
    const bigEndian = Buffer.from('\uFEFFAlex', 'utf16le').swap16();
    assert.equal(decodeText(bigEndian), 'Alex');
  });

  it('falls back to Windows-1252 for old files', () => {
    assert.equal(decodeText(Buffer.from([0x43, 0x61, 0x66, 0xe9, 0x20, 0x95, 0x20, 0x74])), 'Caf\u00E9 \u2022 t');
  });
});

describe('zip reader', () => {
  const zip = makeZip([
    { name: 'a.txt', data: 'hello world', method: 'stored' },
    { name: 'dir/b.txt', data: 'x'.repeat(5000) },
  ]);

  it('lists the entries', () => {
    assert.deepEqual(
      listZipEntries(zip).map((entry) => [entry.name, entry.size, entry.method, entry.encrypted]),
      [
        ['a.txt', 11, 0, false],
        ['dir/b.txt', 5000, 8, false],
      ],
    );
  });

  it('unpacks stored and deflated entries', () => {
    assert.equal(readZipEntry(zip, entryOf(zip, 'a.txt'), MB).toString(), 'hello world');
    assert.equal(readZipEntry(zip, entryOf(zip, 'dir/b.txt'), MB).toString(), 'x'.repeat(5000));
  });

  it('finds the end of the file when the ZIP has a comment', () => {
    const comment = Buffer.from('a short comment');
    const withComment = Buffer.concat([zip, comment]);
    withComment.writeUInt16LE(comment.length, zip.length - 2);
    assert.equal(listZipEntries(withComment).length, 2);
  });

  it('refuses an entry that says it is too big', () => {
    assert.throws(() => readZipEntry(zip, entryOf(zip, 'dir/b.txt'), 1000), { status: 422, code: 'file_too_complex' });
  });

  it('refuses an entry that says it is small but unpacks to a lot', () => {
    const bomb = makeZip([{ name: 'bomb.txt', data: Buffer.alloc(25 * MB), declaredSize: 1000 }]);
    assert.ok(bomb.length < MB, 'the bomb file is small');
    assert.throws(() => readZipEntry(bomb, entryOf(bomb, 'bomb.txt'), 20 * MB), { status: 422, code: 'file_too_complex' });
  });

  it('refuses an entry when the real size is not the size it says', () => {
    const lying = makeZip([{ name: 'a.txt', data: 'x'.repeat(100), declaredSize: 5000 }]);
    assert.throws(() => readZipEntry(lying, entryOf(lying, 'a.txt'), MB), { status: 422, code: 'unreadable_file' });
  });

  it('refuses a password-protected entry', () => {
    const locked = makeZip([{ name: 'a.txt', data: 'secret', flags: 1 }]);
    assert.throws(() => readZipEntry(locked, entryOf(locked, 'a.txt'), MB), { status: 422, code: 'password_protected' });
  });

  it('refuses a damaged or cut ZIP file', () => {
    assert.throws(() => listZipEntries(zip.subarray(0, zip.length - 10)), { status: 422, code: 'unreadable_file' });
    assert.throws(() => listZipEntries(Buffer.from('PK\x03\x04 and then nothing useful at all')), { status: 422, code: 'unreadable_file' });

    const brokenDirectory = Buffer.from(zip);
    brokenDirectory.writeUInt32LE(0, zip.length - 22 + 16);
    assert.throws(() => listZipEntries(brokenDirectory), { status: 422, code: 'unreadable_file' });
  });

  it('refuses a ZIP file that is split into several parts', () => {
    const split = Buffer.from(zip);
    split.writeUInt16LE(1, zip.length - 22 + 4);
    assert.throws(() => listZipEntries(split), { status: 415, code: 'unsupported_file' });
  });
});

describe('xmlToText', () => {
  const text = (body: string): string => xmlToText(documentXml(body));

  it('puts each paragraph on its own line', () => {
    assert.equal(text(para('Alex Taylor') + para('Software Engineer')), 'Alex Taylor\nSoftware Engineer');
  });

  it('starts list paragraphs with a bullet', () => {
    assert.equal(text(para('Built the thing', { list: true }) + para('Not a list')), '\u2022 Built the thing\nNot a list');
  });

  it('knows list styles, and a list that is switched off', () => {
    const styled = '<w:p><w:pPr><w:pStyle w:val="ListBullet"/></w:pPr><w:r><w:t>Led the team</w:t></w:r></w:p>';
    const custom = '<w:p><w:pPr><w:pStyle w:val="ResumeBullet"/></w:pPr><w:r><w:t>Ran the demos</w:t></w:r></w:p>';
    const off =
      '<w:p><w:pPr><w:pStyle w:val="ListBullet"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr></w:pPr><w:r><w:t>Plain line</w:t></w:r></w:p>';
    const indented = '<w:p><w:pPr><w:pStyle w:val="ListParagraph"/></w:pPr><w:r><w:t>Only indented</w:t></w:r></w:p>';
    assert.equal(text(styled + custom + off + indented), '\u2022 Led the team\n\u2022 Ran the demos\nPlain line\nOnly indented');
  });

  it('joins the runs of a paragraph and keeps tabs and line breaks apart', () => {
    const runs = '<w:p><w:r><w:t>Acme</w:t></w:r><w:r><w:t xml:space="preserve"> Ltd</w:t></w:r><w:r><w:tab/><w:t>2020-2024</w:t></w:r></w:p>';
    const broken = '<w:p><w:r><w:t>Line one</w:t><w:br/><w:t>Line two</w:t></w:r></w:p>';
    assert.equal(text(runs + broken), 'Acme Ltd 2020-2024\nLine one\nLine two');
  });

  it('ignores deleted text and field codes', () => {
    const body =
      '<w:p><w:del><w:r><w:delText>old words</w:delText></w:r></w:del><w:r><w:t>new words</w:t></w:r></w:p>' +
      '<w:p><w:r><w:instrText> HYPERLINK "mailto:alex@example.com" </w:instrText></w:r><w:r><w:t>alex@example.com</w:t></w:r></w:p>';
    assert.equal(text(body), 'new words\nalex@example.com');
  });

  it('reads a text box once, not twice', () => {
    const box = '<w:txbxContent><w:p><w:r><w:t>Inside box</w:t></w:r></w:p></w:txbxContent>';
    const body =
      `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>${box}</w:drawing></mc:Choice>` +
      `<mc:Fallback><w:pict>${box}</w:pict></mc:Fallback></mc:AlternateContent></w:r><w:r><w:t>Outer text</w:t></w:r></w:p>`;
    assert.equal(text(body), 'Inside box\nOuter text');
  });

  it('decodes the XML entities and drops invalid characters', () => {
    const body = '<w:p><w:r><w:t>R&amp;D &lt;b&gt; &quot;x&quot; &#8226; &#x2013; &#0;a&#xD800;b&#x110000;c</w:t></w:r></w:p>';
    assert.equal(text(body), 'R&D <b> "x" \u2022 \u2013 abc');
  });

  it('does not run anything that looks like markup inside the text', () => {
    assert.equal(text(para('<script>alert(1)</script> & more')), '<script>alert(1)</script> & more');
  });

  it('separates table cells with a blank line', () => {
    const cell = (value: string): string => `<w:tc>${para(value)}</w:tc>`;
    const table = `<w:tbl><w:tr>${cell('Skills')}${cell('TypeScript, Node.js')}</w:tr></w:tbl>`;
    assert.equal(normalizeText(text(table)), 'Skills\n\nTypeScript, Node.js');
  });
});

describe('docxToText', () => {
  it('reads a Word file', () => {
    assert.equal(docxToText(docxFile(para('Alex Taylor') + para('Built APIs', { list: true }))), 'Alex Taylor\n\u2022 Built APIs');
  });

  it('refuses a ZIP file that is not a Word file', () => {
    const other = makeZip([{ name: 'xl/workbook.xml', data: '<workbook/>' }]);
    assert.throws(() => docxToText(other), { status: 415, code: 'unsupported_file' });
  });

  it('refuses a Word file that unpacks to more than 20 MB', () => {
    const honest = makeZip([{ name: 'word/document.xml', data: Buffer.alloc(25 * MB) }]);
    assert.throws(() => docxToText(honest), { status: 422, code: 'file_too_complex' });

    const lying = makeZip([{ name: 'word/document.xml', data: Buffer.alloc(25 * MB), declaredSize: 4096 }]);
    assert.throws(() => docxToText(lying), { status: 422, code: 'file_too_complex' });
  });
});

describe('pdfToText', () => {
  it('reads the lines of a page, and the bullet symbol', async () => {
    const { text, pages } = await pdfToText(makePdf([['Alex Taylor', 'Software Engineer', '\u2022 Built the thing (v2) with care', '- Led a team of 5']]));
    assert.equal(pages, 1);
    assert.equal(text, 'Alex Taylor\nSoftware Engineer\n\u2022 Built the thing (v2) with care\n- Led a team of 5');
  });

  it('puts a blank line between pages', async () => {
    const { text, pages } = await pdfToText(makePdf([['Page one line a', 'Page one line b'], ['Page two line']]));
    assert.equal(pages, 2);
    assert.equal(text, 'Page one line a\nPage one line b\n\nPage two line');
  });

  it('accepts a PDF with the most pages allowed, and refuses one more', async () => {
    const exact = await pdfToText(makePdf(Array.from({ length: MAX_PDF_PAGES }, (_, index) => [`Line ${index + 1}`])));
    assert.equal(exact.pages, MAX_PDF_PAGES);
    await assert.rejects(pdfToText(makePdf(Array.from({ length: MAX_PDF_PAGES + 1 }, () => ['x']))), { status: 422, code: 'too_many_pages' });
  });

  it('refuses a damaged PDF', async () => {
    await assert.rejects(pdfToText(Buffer.from('%PDF-1.4\nthis is not a real pdf at all')), { status: 422, code: 'unreadable_file' });
  });
});

describe('extractResume', () => {
  const resumeText = normalizeText(readFileSync(new URL('../public/samples/resume.txt', import.meta.url), 'utf8'));

  it('refuses an empty file', async () => {
    await assert.rejects(extractResume(new Uint8Array(0)), { status: 400, code: 'empty_file' });
  });

  it('reads a text file and cleans the line endings', async () => {
    const result = await extractResume(Buffer.from('Alex Taylor\r\nEngineer\r\n\r\n\r\n\r\nSkills\r\n'));
    assert.deepEqual(result, { text: 'Alex Taylor\nEngineer\n\nSkills', source: 'text', pages: null });
  });

  it('reads text in UTF-16 and in an old Windows encoding', async () => {
    assert.equal((await extractResume(Buffer.from('\uFEFFAlex \u2022 Taylor', 'utf16le'))).text, 'Alex \u2022 Taylor');
    assert.equal((await extractResume(Buffer.from([0x43, 0x61, 0x66, 0xe9, 0x20, 0x95, 0x20, 0x74]))).text, 'Caf\u00E9 \u2022 t');
  });

  it('reads a Word file and a PDF file', async () => {
    const lines = ['Alex Taylor', 'Software Engineer in Auckland with six years of experience building web products.'];
    const word = await extractResume(docxFile(lines.map((line) => para(line)).join('')));
    assert.deepEqual(word, { text: lines.join('\n'), source: 'docx', pages: null });

    const pdf = await extractResume(makePdf([lines]));
    assert.deepEqual(pdf, { text: lines.join('\n'), source: 'pdf', pages: 1 });
  });

  it('gives the same bullets from the text, the Word file and the PDF of the sample resume', async () => {
    const expected = extractBullets(resumeText);
    assert.equal(expected.length, 12);

    const lines = resumeText.split('\n');
    const word = await extractResume(docxFile(lines.map((line) => (line.startsWith('- ') ? para(line.slice(2), { list: true }) : para(line))).join('')));
    const pdf = await extractResume(makePdf([lines.map((line) => (line.startsWith('- ') ? `\u2022 ${line.slice(2)}` : line))]));

    assert.deepEqual(extractBullets(word.text), expected);
    assert.deepEqual(extractBullets(pdf.text), expected);
  });

  it('asks for pasted text when a file has no text', async () => {
    await assert.rejects(extractResume(makePdf([[]])), { status: 422, code: 'no_text' });
    await assert.rejects(extractResume(docxFile(para('Hi'))), { status: 422, code: 'no_text' });
  });

  it('refuses file types that it cannot read', async () => {
    await assert.rejects(extractResume(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0])), { status: 415, code: 'unsupported_file' });
    await assert.rejects(extractResume(Buffer.from('{\\rtf1\\ansi Hello')), { status: 415, code: 'unsupported_file' });
    await assert.rejects(extractResume(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0x0d])), { status: 415, code: 'unsupported_file' });
    await assert.rejects(extractResume(makeZip([{ name: 'notes.txt', data: 'hello' }])), { status: 415, code: 'unsupported_file' });
  });
});
