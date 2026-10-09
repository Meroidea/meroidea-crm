import { randomBytes } from 'node:crypto';

// Runs before any test file is imported. Settings are read once and cached the first time the
// server code asks for them, so a throwaway encryption key has to be in place by then; this
// keeps the suite independent of a developer's own .env.local.
process.env.HR_ENCRYPTION_KEY ||= randomBytes(32).toString('base64');
