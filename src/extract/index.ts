import { normalizeText } from '../analyze/text.ts';
import { AppError } from '../errors.ts';
import { docxToText } from './docx.ts';
import { pdfToText } from './pdf.ts';
import { decodeText, sniffKind } from './sniff.ts';

export { MAX_PDF_PAGES } from './pdf.ts';

export interface ExtractedResume {
  text: string;
  source: 'pdf' | 'docx' | 'text';
  /** Only known for PDF files. */
  pages: number | null;
}

// A resume file with less text than this is a picture or an empty template.
const MIN_FILE_TEXT_CHARS = 50;

function noText(what: string): AppError {
  return new AppError(
    422,
    'no_text',
    `I found almost no text in this ${what}. It may be a scan or a picture. Paste the text of the resume instead.`,
  );
}

/** Reads the text of a resume file. The file type comes from the first bytes of the file, not from its name. */
export async function extractResume(data: Uint8Array): Promise<ExtractedResume> {
  if (data.length === 0) throw new AppError(400, 'empty_file', 'The file is empty.');

  switch (sniffKind(data)) {
    case 'pdf': {
      const { text, pages } = await pdfToText(data);
      const clean = normalizeText(text);
      if (clean.length < MIN_FILE_TEXT_CHARS) throw noText('PDF');
      return { text: clean, source: 'pdf', pages };
    }
    case 'zip': {
      const clean = normalizeText(docxToText(Buffer.from(data.buffer, data.byteOffset, data.byteLength)));
      if (clean.length < MIN_FILE_TEXT_CHARS) throw noText('Word file');
      return { text: clean, source: 'docx', pages: null };
    }
    case 'text':
      return { text: normalizeText(decodeText(data)), source: 'text', pages: null };
    case 'legacy-doc':
      // A Word file with a password also has this file type.
      throw new AppError(
        415,
        'unsupported_file',
        'Old Word (.doc) files and password-protected Word files are not supported. Save the resume as a .docx or PDF file without a password and try again.',
      );
    case 'rtf':
      throw new AppError(415, 'unsupported_file', 'RTF files are not supported. Save the resume as .docx or PDF and try again.');
    default:
      throw new AppError(415, 'unsupported_file', 'This file type is not supported. Upload a PDF, a Word .docx file or a plain text file.');
  }
}
