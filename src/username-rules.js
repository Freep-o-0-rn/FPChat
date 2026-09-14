/* Build 141: shared username validation and protected-name rules. */
const USERNAME_MIN = 5;
const USERNAME_MAX = 32;
const USERNAME_RE = /^[a-z0-9_]+$/;

const RESERVED_EXACT = new Set([
  'admin',
  'administrator',
  'api',
  'fpchat',
  'mod',
  'moderator',
  'official',
  'root',
  'security',
  'support',
  'system'
]);

const PROTECTED_ROOTS = [
  'admin',
  'administrator',
  'support',
  'fpchat',
  'system',
  'moderator',
  'official',
  'security'
];

const LEET_MAP = Object.freeze({
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '9': 'g'
});

function normalizeUsername(value) {
  let text = String(value || '').trim();
  if (text.startsWith('@')) text = text.slice(1);
  return text.toLowerCase();
}

function protectedShape(value) {
  const normalized = normalizeUsername(value);
  let out = '';
  for (const ch of normalized) {
    if (ch === '_') continue;
    if (LEET_MAP[ch]) out += LEET_MAP[ch];
    else if (/[a-z]/.test(ch)) out += ch;
    // Other digits are separators/noise for protected-name detection.
  }
  return out.replace(/(.)\1{2,}/g, '$1$1');
}

function findProtectedRoot(value) {
  const normalized = normalizeUsername(value);
  if (RESERVED_EXACT.has(normalized)) return normalized;

  const shape = protectedShape(normalized);
  for (const root of PROTECTED_ROOTS) {
    if (shape.includes(root)) return root;
  }
  return null;
}

function validateUsernameSyntax(value) {
  const username = normalizeUsername(value);
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX || !USERNAME_RE.test(username)) {
    return {
      ok: false,
      username,
      code: 'USERNAME_INVALID',
      error: `username must be ${USERNAME_MIN}-${USERNAME_MAX} characters: a-z, 0-9 or _`
    };
  }
  return { ok: true, username };
}

function validatePublicUsername(value) {
  const syntax = validateUsernameSyntax(value);
  if (!syntax.ok) return syntax;

  const protectedRoot = findProtectedRoot(syntax.username);
  if (protectedRoot) {
    return {
      ok: false,
      username: syntax.username,
      code: 'USERNAME_RESERVED',
      error: 'username is reserved',
      protectedRoot
    };
  }
  return syntax;
}

function validateServiceUsername(value) {
  const syntax = validateUsernameSyntax(value);
  if (!syntax.ok) return syntax;
  const protectedRoot = findProtectedRoot(syntax.username);
  if (!protectedRoot) {
    return {
      ok: false,
      username: syntax.username,
      code: 'USERNAME_NOT_SERVICE',
      error: 'service username must match a protected service-name rule'
    };
  }
  return { ok: true, username: syntax.username, protectedRoot };
}

module.exports = {
  USERNAME_MIN,
  USERNAME_MAX,
  USERNAME_RE,
  RESERVED_EXACT,
  PROTECTED_ROOTS,
  normalizeUsername,
  protectedShape,
  findProtectedRoot,
  validateUsernameSyntax,
  validatePublicUsername,
  validateServiceUsername
};
