// Runs before "npm start", "npm run dev", "npm test" and "npm run start:dist" (see the "pre" scripts
// in package.json). It stops with a clear message when Node.js is too old.
// Without it, an old Node.js stops with: TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts"
// It prints nothing when the version is fine.
import { readFileSync } from 'node:fs';
import { isOlder, minimumFromRange, parseVersion, tooOldMessage } from './node-version.mjs';

const { engines } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const minimum = minimumFromRange(engines && engines.node);
const current = parseVersion(process.versions.node);

if (minimum && current && isOlder(current, minimum)) {
  console.error(tooOldMessage(process.versions.node, minimum.join('.')));
  // Set the exit code instead of calling process.exit(), so the message is always written in full.
  process.exitCode = 1;
}
