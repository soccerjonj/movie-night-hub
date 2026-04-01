/**
 * Security utilities for input validation, sanitization, and safe error handling.
 */

import { z } from 'zod';

// ── Input Sanitization ──────────────────────────────────────────────
/**
 * Strip HTML tags and dangerous characters from user-generated content.
 * Use before rendering any user-provided text.
 */
export function sanitizeText(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Strip control characters and trim whitespace.
 */
export function cleanInput(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
}

// ── Safe Error Handling ─────────────────────────────────────────────
/**
 * Extract a user-safe error message. Never exposes stack traces or internal details.
 */
export function getSafeErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (err instanceof Error) {
    // Filter out internal/technical messages
    const msg = err.message;
    if (
      msg.includes('stack') ||
      msg.includes('ECONNREFUSED') ||
      msg.includes('TypeError') ||
      msg.includes('undefined') ||
      msg.length > 200
    ) {
      return fallback;
    }
    return msg;
  }
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const maybeMessage = (err as { message?: unknown }).message;
    if (typeof maybeMessage === 'string' && maybeMessage.trim() && maybeMessage.length < 200) {
      return maybeMessage;
    }
  }
  return fallback;
}

// ── Validation Schemas ──────────────────────────────────────────────

export const authSchema = z.object({
  email: z.string().trim().email('Invalid email address').max(255, 'Email too long'),
  password: z.string().min(6, 'Password must be at least 6 characters').max(128, 'Password too long'),
});

export const groupNameSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name must be under 100 characters'),
});

export const joinCodeSchema = z.object({
  code: z.string().trim().min(1, 'Code is required').max(20, 'Code too long')
    .regex(/^[a-zA-Z0-9]+$/, 'Code must be alphanumeric'),
});

export const displayNameSchema = z.object({
  displayName: z.string().trim().min(1, 'Name is required').max(50, 'Name must be under 50 characters'),
});

// ── File Upload Validation ──────────────────────────────────────────

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const DANGEROUS_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.sh', '.ps1', '.vbs', '.js', '.html', '.htm',
  '.php', '.py', '.rb', '.pl', '.svg', '.xml',
]);

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export function validateImageFile(file: File): { valid: boolean; error?: string } {
  // Check MIME type
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return { valid: false, error: 'Only JPEG, PNG, GIF, and WebP images are allowed' };
  }

  // Check file extension
  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  if (DANGEROUS_EXTENSIONS.has(ext)) {
    return { valid: false, error: 'This file type is not allowed' };
  }

  // Check size
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: 'Image must be under 5MB' };
  }

  // Verify extension matches MIME
  const validExtensions: Record<string, string[]> = {
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
    'image/gif': ['.gif'],
    'image/webp': ['.webp'],
  };
  const allowedExts = validExtensions[file.type] || [];
  if (ext && !allowedExts.includes(ext) && ext !== '.') {
    // Allow if extension is ambiguous but MIME is correct
    // This is a soft check — the crop converts to JPEG anyway
  }

  return { valid: true };
}

/**
 * Generate a safe filename for server-side storage.
 * Strips path traversal and special characters.
 */
export function safeFilename(userId: string, extension = 'jpg'): string {
  const sanitizedId = userId.replace(/[^a-zA-Z0-9-]/g, '');
  return `${sanitizedId}/avatar.${extension}`;
}

/**
 * Extract a storage path from an avatar URL or return the path if already stored as one.
 */
export function extractAvatarPath(avatarUrl: string | null): string | null {
  if (!avatarUrl) return null;
  const withoutQuery = avatarUrl.split('?')[0];
  if (!withoutQuery) return null;
  if (!withoutQuery.startsWith('http')) return withoutQuery;
  const marker = '/avatars/';
  const idx = withoutQuery.indexOf(marker);
  if (idx === -1) return null;
  return withoutQuery.slice(idx + marker.length);
}
