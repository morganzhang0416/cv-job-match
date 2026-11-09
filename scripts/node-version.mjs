// Helpers for check-node.mjs.
// This is plain JavaScript on purpose. Old Node.js versions cannot read the TypeScript files
// of the app, so this check has to run on them without any TypeScript.

/**
 * Reads the lowest allowed version from an "engines.node" range such as ">=22.18.0".
 * Other kinds of ranges are not supported. The check is skipped for them.
 * @param {unknown} range
 * @returns {[number, number, number] | undefined}
 */
export function minimumFromRange(range) {
  if (typeof range !== 'string') return undefined;
  const match = /^\s*>=\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?\s*$/.exec(range);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)];
}

/**
 * @param {string} version For example "20.3.0" or "v22.23.4".
 * @returns {[number, number, number] | undefined}
 */
export function parseVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * True when `version` is lower than `minimum`.
 * @param {readonly number[]} version
 * @param {readonly number[]} minimum
 * @returns {boolean}
 */
export function isOlder(version, minimum) {
  for (let index = 0; index < 3; index += 1) {
    const have = version[index] || 0;
    const need = minimum[index] || 0;
    if (have !== need) return have < need;
  }
  return false;
}

/**
 * The message to show when Node.js is too old.
 * @param {string} current For example "20.3.0".
 * @param {string} required For example "22.18.0".
 * @returns {string}
 */
export function tooOldMessage(current, required) {
  const [major = required] = required.split('.');
  return [
    '',
    `This app needs Node.js ${required} or newer. You have Node.js ${current}.`,
    '',
    'The app runs its TypeScript files directly, and older Node.js versions cannot do that.',
    '',
    'How to fix it:',
    `  1. Install Node.js ${major} or newer from https://nodejs.org/`,
    `     If you use nvm, run: nvm install ${major}   and then: nvm use ${major}`,
    '  2. Open a new terminal and check the version: node --version',
    '  3. Run your command again.',
    '',
    `Node.js ${major} is already installed, but this terminal still uses an older one?`,
    'Use the newer one for this terminal window only:',
    '  PowerShell:     $env:Path = "<folder that has node.exe>;$env:Path"',
    '  macOS / Linux:  export PATH="<folder that has node>:$PATH"',
    '',
  ].join('\n');
}
