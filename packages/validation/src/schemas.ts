import { z } from 'zod';
import { ATTACHMENT_LIMITS, PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '@calx/shared';

export const pinSchema = z
  .string()
  .regex(
    new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`),
    `PIN must be ${PIN_MIN_LENGTH} to ${PIN_MAX_LENGTH} digits`,
  );

export const pinSetupSchema = z
  .object({
    pin: pinSchema,
    confirmPin: pinSchema,
  })
  .refine((data) => data.pin === data.confirmPin, {
    message: 'PINs do not match',
    path: ['confirmPin'],
  });

export const pinChangeSchema = z
  .object({
    currentPin: pinSchema,
    newPin: pinSchema,
    confirmNewPin: pinSchema,
  })
  .refine((data) => data.newPin === data.confirmNewPin, {
    message: 'New PINs do not match',
    path: ['confirmNewPin'],
  })
  .refine((data) => data.currentPin !== data.newPin, {
    message: 'New PIN must differ from current PIN',
    path: ['newPin'],
  });

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters')
  .max(32, 'Username must be at most 32 characters')
  .regex(/^[a-zA-Z0-9_]+$/, 'Username may only contain letters, numbers, and underscores')
  .transform((val) => val.toLowerCase());

export const registerSchema = z.object({
  email: z.string().trim().email('Valid email required'),
  password: z
    .string()
    .min(10, 'Password must be at least 10 characters')
    .max(128, 'Password too long'),
  username: usernameSchema,
  displayName: z.string().trim().min(1, 'Display name is required').max(64),
});

export const loginSchema = z.object({
  email: z.string().trim().email('Valid email required'),
  password: z.string().min(1, 'Password is required'),
});

export const profileUpdateSchema = z.object({
  display_name: z.string().trim().min(1).max(64).optional(),
  status_text: z.string().trim().max(140).optional(),
  avatar_url: z.string().url().nullable().optional(),
});

export const createDirectConversationSchema = z.object({
  peerUserId: z.string().uuid(),
});

export const createGroupConversationSchema = z.object({
  title: z.string().trim().min(1, 'Group name is required').max(80),
  memberIds: z.array(z.string().uuid()).min(1, 'Select at least one member').max(100),
});

export const encryptedPayloadSchema = z.object({
  ciphertext: z.string().min(1),
  iv: z.string().min(1),
  sender_device_id: z.string().uuid(),
  key_version: z.number().int().positive(),
  algorithm: z.string().min(1),
  wrapped_keys: z.record(z.string(), z.string()).optional(),
});

export const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  clientMessageId: z.string().uuid(),
  messageType: z.enum([
    'text',
    'image',
    'video',
    'audio',
    'voice',
    'document',
    'system',
    'location',
    'live_location',
    'contact_card',
    'event',
    'checklist',
  ]),
  encryptedPayload: encryptedPayloadSchema,
  replyToId: z.string().uuid().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  isViewOnce: z.boolean().optional(),
});

export const locationPayloadSchema = z.object({
  kind: z.literal('location'),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  label: z.string().trim().max(160).optional(),
  isLive: z.boolean().optional(),
  sessionId: z.string().uuid().optional(),
  expiresAt: z.string().datetime().optional(),
});

export const contactCardPayloadSchema = z.object({
  kind: z.literal('contact_card'),
  name: z.string().trim().min(1).max(100),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().email().optional(),
  avatarUrl: z.string().url().optional(),
  fieldsShared: z.array(z.string()).min(1),
});

export const eventPayloadSchema = z.object({
  kind: z.literal('event'),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(600).optional(),
  startsAt: z.string().min(1),
  locationOrLink: z.string().trim().max(240).optional(),
  imageUrl: z.string().url().optional(),
  cancelled: z.boolean().optional(),
});

export const checklistPayloadSchema = z.object({
  kind: z.literal('checklist'),
  title: z.string().trim().min(1).max(120),
});

export const scheduleMessageSchema = z.object({
  conversationId: z.string().uuid(),
  scheduledFor: z.string().datetime(),
  plaintext: z.string().trim().min(1).max(4000),
  expiresAfterSeconds: z.number().int().positive().nullable().optional(),
});

export const reactionSchema = z.object({
  messageId: z.string().uuid(),
  emoji: z.string().trim().min(1).max(16),
});

const allAllowedMimeTypes: readonly string[] = [
  ...ATTACHMENT_LIMITS.ALLOWED_IMAGE_TYPES,
  ...ATTACHMENT_LIMITS.ALLOWED_VIDEO_TYPES,
  ...ATTACHMENT_LIMITS.ALLOWED_AUDIO_TYPES,
  ...ATTACHMENT_LIMITS.ALLOWED_DOCUMENT_TYPES,
];

export const attachmentValidationSchema = z.object({
  mimeType: z
    .string()
    .refine((m) => allAllowedMimeTypes.includes(m), 'Unsupported file type'),
  byteSize: z
    .number()
    .int()
    .positive()
    .max(ATTACHMENT_LIMITS.MAX_FILE_SIZE_BYTES, 'File exceeds 25 MB limit'),
  durationMs: z
    .number()
    .int()
    .nonnegative()
    .max(ATTACHMENT_LIMITS.MAX_VOICE_DURATION_MS)
    .nullable()
    .optional(),
});

export const userSettingsUpdateSchema = z.object({
  last_seen_visibility: z.enum(['everyone', 'contacts', 'nobody']).optional(),
  read_receipts_enabled: z.boolean().optional(),
  notification_preview_enabled: z.boolean().optional(),
  default_disappearing_seconds: z.number().int().positive().nullable().optional(),
  auto_lock_seconds: z.number().int().min(15).max(86400).optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
});
