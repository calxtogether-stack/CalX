export const APP_NAME = 'CalX';

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;

export const MAX_FAILED_PIN_ATTEMPTS = 5;
export const PIN_LOCKOUT_BASE_SECONDS = 30;

export const DEFAULT_AUTO_LOCK_SECONDS = 300; // 5 minutes

export const ATTACHMENT_LIMITS = {
  MAX_FILE_SIZE_BYTES: 25 * 1024 * 1024, // 25 MB (safe within Supabase Free 50 MB object limit)
  MAX_VOICE_DURATION_MS: 5 * 60 * 1000, // 5 minutes
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  ALLOWED_VIDEO_TYPES: ['video/mp4', 'video/webm', 'video/quicktime'],
  ALLOWED_AUDIO_TYPES: [
    'audio/mpeg',
    'audio/mp4',
    'audio/ogg',
    'audio/webm',
    'audio/wav',
    'audio/aac',
  ],
  ALLOWED_DOCUMENT_TYPES: [
    'application/pdf',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip',
  ],
} as const;

export const DISAPPEARING_OPTIONS = [
  { label: 'Off', seconds: null },
  { label: '10 seconds', seconds: 10 },
  { label: '30 seconds', seconds: 30 },
  { label: '1 minute', seconds: 60 },
  { label: '5 minutes', seconds: 300 },
  { label: '1 hour', seconds: 3600 },
  { label: '24 hours', seconds: 86400 },
  { label: '7 days', seconds: 604800 },
] as const;

export const CLEANUP_OPTIONS = [
  { label: 'Disabled', seconds: null },
  { label: 'Every 24 hours', seconds: 86400 },
  { label: 'Every 7 days', seconds: 604800 },
  { label: 'Every 30 days', seconds: 2592000 },
] as const;

export const EDIT_WINDOW_SECONDS = 15 * 60; // 15 minutes

export const ACCENT_PRESETS = [
  { name: 'Obsidian', hex: '#18181B' },
  { name: 'Slate', hex: '#334155' },
  { name: 'Emerald', hex: '#065F46' },
  { name: 'Indigo', hex: '#3730A3' },
  { name: 'Crimson', hex: '#991B1B' },
] as const;

export const WALLPAPER_PRESETS = [
  { id: 'default', label: 'Default', type: 'default' as const, value: '' },
  { id: 'stone', label: 'Stone', type: 'solid' as const, value: '#F4F4F5' },
  { id: 'obsidian', label: 'Obsidian', type: 'solid' as const, value: '#111113' },
  {
    id: 'mist',
    label: 'Mist',
    type: 'gradient' as const,
    value: 'linear-gradient(180deg, #FAFAFA 0%, #E4E4E7 100%)',
  },
  {
    id: 'midnight',
    label: 'Midnight',
    type: 'gradient' as const,
    value: 'linear-gradient(180deg, #09090B 0%, #18181B 100%)',
  },
] as const;
