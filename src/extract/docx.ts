import { AppError } from '../errors.ts';
import { listZipEntries, readZipEntry } from './zip.ts';

const MAIN_PART = 'word/document.xml';
const MAX_XML_BYTES = 20 * 1024 * 1024;
const BULLET = '\u2022';

interface Paragraph {
  text: string;
  listed: boolean;
}

// A tag (with its name and attributes) or a run of text between tags.
const TOKEN = /<(\/?)([A-Za-z_][\w:.-]*)([^>]*)>|([^<]+)/g;
// Word's own list styles, and custom styles with "bullet" in the name.
const LIST_STYLE = /^List(?:Bullet|Number)|bullet/i;
const ENTITY = /&(?:#(\d{1,7})|#x([\da-f]{1,6})|(amp|lt|gt|quot|apos));/gi;
const NAMED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  return text.replace(ENTITY, (whole, decimal?: string, hex?: string, name?: string) => {
    if (name) return NAMED[name.toLowerCase()] ?? whole;
    const code = decimal === undefined ? Number.parseInt(hex ?? '', 16) : Number(decimal);
    const valid = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
    return valid ? String.fromCodePoint(code) : '';
  });
}

function valueOf(attributes: string | undefined): string {
  return /\bw:val="([^"]*)"/.exec(attributes ?? '')?.[1] ?? '';
}

function finish(paragraph: Paragraph): string {
  const text = paragraph.text.replace(/[ \t]+/g, ' ').trim();
  return paragraph.listed && text ? `${BULLET} ${text}` : text;
}

/**
 * Turns the XML of a Word document into plain lines of text.
 * It scans the tags in one pass. It does not resolve entities from the file or load anything else.
 * Paragraphs that are list items start with a bullet, and table cells are separated by a blank line.
 */
export function xmlToText(xml: string): string {
  // Word saves text boxes twice: once as the real content and once as a fallback copy.
  const body = xml.replace(/<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/g, '');
  const lines: string[] = [];
  // Text boxes hold paragraphs inside paragraphs, so open paragraphs are kept on a stack.
  const open: Paragraph[] = [];
  let inText = false;

  for (const match of body.matchAll(TOKEN)) {
    const [, slash, name, attributes, text] = match;
    const current = open[open.length - 1];

    if (text !== undefined) {
      if (inText && current) current.text += decodeEntities(text);
      continue;
    }
    const closing = slash === '/';
    const selfClosing = attributes?.endsWith('/') ?? false;

    switch (name) {
      case 'w:p':
        if (closing) {
          const done = open.pop();
          if (done) lines.push(finish(done));
        } else if (selfClosing) {
          lines.push('');
        } else {
          open.push({ text: '', listed: false });
        }
        break;
      case 'w:t':
        inText = !closing && !selfClosing;
        break;
      case 'w:tab':
        if (current && !closing) current.text += '\t';
        break;
      case 'w:br':
      case 'w:cr':
        if (current && !closing) current.text += '\n';
        break;
      case 'w:noBreakHyphen':
        if (current && !closing) current.text += '-';
        break;
      case 'w:pStyle':
        if (current && !closing && LIST_STYLE.test(valueOf(attributes))) current.listed = true;
        break;
      case 'w:numId':
        // numId 0 means "no list", even when the style says otherwise.
        if (current && !closing) current.listed = valueOf(attributes) !== '0';
        break;
      case 'w:tc':
      case 'w:tr':
        if (closing) lines.push('');
        break;
      default:
        break;
    }
  }
  return lines.join('\n');
}

export function docxToText(data: Buffer): string {
  const main = listZipEntries(data).find((entry) => entry.name.toLowerCase() === MAIN_PART);
  if (!main) throw new AppError(415, 'unsupported_file', 'This ZIP file is not a Word (.docx) document.');
  return xmlToText(readZipEntry(data, main, MAX_XML_BYTES).toString('utf8'));
}
