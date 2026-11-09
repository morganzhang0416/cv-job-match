import { getDocumentProxy } from 'unpdf';
import { AppError } from '../errors.ts';

export const MAX_PDF_PAGES = 20;
const MAX_PDF_MILLISECONDS = 20_000;

function unreadable(error: unknown): AppError {
  if ((error as { name?: string } | null)?.name === 'PasswordException') {
    return new AppError(422, 'password_protected', 'This PDF is password-protected. Remove the password, or paste the text instead.');
  }
  return new AppError(422, 'unreadable_file', 'I could not read this PDF. It may be damaged.');
}

/**
 * Reads the text of a PDF, page by page. Only text is read: no scripts run and nothing is drawn.
 * The page limit and the time limit stop a large or tricky file from keeping the server busy.
 */
export async function pdfToText(data: Uint8Array): Promise<{ text: string; pages: number }> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // PDF.js can take over the memory of the array it is given, so it gets a copy.
    pdf = await getDocumentProxy(new Uint8Array(data), { verbosity: 0, enableXfa: false });
  } catch (error) {
    throw unreadable(error);
  }

  try {
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new AppError(422, 'too_many_pages', `This PDF has ${pdf.numPages} pages. The limit is ${MAX_PDF_PAGES}. Paste the text instead.`);
    }
    const deadline = Date.now() + MAX_PDF_MILLISECONDS;
    const pages: string[] = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      if (Date.now() > deadline) {
        throw new AppError(422, 'file_too_complex', 'This PDF took too long to read. Paste the text instead.');
      }
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : '')).join(''));
      page.cleanup();
    }
    return { text: pages.join('\n\n'), pages: pdf.numPages };
  } catch (error) {
    throw error instanceof AppError ? error : unreadable(error);
  } finally {
    await pdf.loadingTask.destroy().catch(() => undefined);
  }
}
