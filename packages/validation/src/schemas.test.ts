import { describe, expect, it } from 'vitest';
import {
  attachmentValidationSchema,
  pinChangeSchema,
  pinSetupSchema,
  registerSchema,
} from './schemas.js';

describe('Validation Schemas', () => {
  it('validates PIN setup and matching confirmation', () => {
    expect(pinSetupSchema.safeParse({ pin: '1234', confirmPin: '1234' }).success).toBe(true);
    expect(pinSetupSchema.safeParse({ pin: '123', confirmPin: '123' }).success).toBe(false);
    expect(pinSetupSchema.safeParse({ pin: '1234', confirmPin: '5678' }).success).toBe(false);
  });

  it('prevents changing PIN to the same PIN', () => {
    expect(
      pinChangeSchema.safeParse({ currentPin: '1234', newPin: '1234', confirmNewPin: '1234' })
        .success,
    ).toBe(false);
    expect(
      pinChangeSchema.safeParse({ currentPin: '1234', newPin: '4321', confirmNewPin: '4321' })
        .success,
    ).toBe(true);
  });

  it('validates user registration and normalizes username', () => {
    const res = registerSchema.parse({
      email: 'alice@example.com',
      password: 'strong-password-123',
      username: 'Alice_01',
      displayName: 'Alice',
    });
    expect(res.username).toBe('alice_01');
  });

  it('enforces attachment size limits and allowed MIME types', () => {
    expect(
      attachmentValidationSchema.safeParse({ mimeType: 'image/png', byteSize: 1024 }).success,
    ).toBe(true);
    expect(
      attachmentValidationSchema.safeParse({
        mimeType: 'application/x-msdownload',
        byteSize: 1024,
      }).success,
    ).toBe(false);
    expect(
      attachmentValidationSchema.safeParse({
        mimeType: 'image/png',
        byteSize: 30 * 1024 * 1024,
      }).success,
    ).toBe(false);
  });
});
