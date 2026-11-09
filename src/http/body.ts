import express, { type RequestHandler } from 'express';
import multer from 'multer';
import { MAX_UPLOAD_BYTES } from '../config.ts';
import { AppError } from '../errors.ts';

const MB = 1024 * 1024;
const MAX_JSON_BYTES = 512 * 1024;
// One text field holds the job description or the resume text. Each is far below this size.
const MAX_TEXT_FIELD_BYTES = 512 * 1024;

const readJson = express.json({ limit: MAX_JSON_BYTES });

const readForm = multer({
  storage: multer.memoryStorage(),
  // Browsers send file names as UTF-8.
  defParamCharset: 'utf8',
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
    fields: 6,
    parts: 8,
    fieldSize: MAX_TEXT_FIELD_BYTES,
    fieldNameSize: 100,
    fieldNestingDepth: 0,
    headerPairs: 50,
  },
}).single('resume');

function uploadError(error: unknown): AppError {
  if (error instanceof multer.MulterError) {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return new AppError(413, 'file_too_large', `The file is larger than ${MAX_UPLOAD_BYTES / MB} MB. Save a smaller file, or paste the text of the resume.`);
      case 'LIMIT_FIELD_VALUE':
        return new AppError(413, 'text_too_large', 'The text is too long. Paste only the part that you need.');
      case 'LIMIT_FILE_COUNT':
      case 'LIMIT_UNEXPECTED_FILE':
        return new AppError(400, 'bad_upload', 'Upload one file, in the field named "resume".');
    }
  }
  // The text of the error may quote the upload, so it is never shown.
  return new AppError(400, 'bad_upload', 'The upload could not be read. Try again.');
}

function jsonError(error: unknown): AppError {
  const type = typeof error === 'object' && error !== null && 'type' in error ? error.type : undefined;
  switch (type) {
    case 'entity.too.large':
      return new AppError(413, 'body_too_large', 'The request is too large. Send less text.');
    case 'charset.unsupported':
    case 'encoding.unsupported':
      return new AppError(415, 'unsupported_media_type', 'Send the request as plain UTF-8 JSON.');
    default:
      return new AppError(400, 'invalid_json', 'The request body is not valid JSON.');
  }
}

/**
 * Reads a form upload (multipart/form-data) or a JSON body into req.body, and the file into req.file.
 * Every failure becomes an AppError with a fixed message, so no part of the request is ever echoed back.
 */
export const readBody: RequestHandler = (req, res, next) => {
  if (req.is('multipart/form-data')) {
    readForm(req, res, (error?: unknown) => next(error === undefined ? undefined : uploadError(error)));
    return;
  }
  if (req.is('application/json')) {
    readJson(req, res, (error?: unknown) => next(error === undefined ? undefined : jsonError(error)));
    return;
  }
  next(new AppError(415, 'unsupported_media_type', 'Send the request as multipart/form-data or application/json.'));
};
