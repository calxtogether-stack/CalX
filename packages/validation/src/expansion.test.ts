import { describe, expect, it } from 'vitest';
import {
  checklistPayloadSchema,
  contactCardPayloadSchema,
  eventPayloadSchema,
  locationPayloadSchema,
  scheduleMessageSchema,
} from './schemas.js';

describe('Feature Expansion Validation Schemas', () => {
  it('validates location coordinates', () => {
    expect(locationPayloadSchema.safeParse({ kind: 'location', lat: 12.97, lng: 77.59 }).success).toBe(true);
    expect(locationPayloadSchema.safeParse({ kind: 'location', lat: 120, lng: 77.59 }).success).toBe(false);
  });

  it('validates contact card, event, checklist, and schedule schemas', () => {
    expect(
      contactCardPayloadSchema.safeParse({
        kind: 'contact_card',
        name: 'Alice',
        phone: '+15550100',
        fieldsShared: ['name', 'phone'],
      }).success,
    ).toBe(true);

    expect(
      eventPayloadSchema.safeParse({
        kind: 'event',
        title: 'Sync Call',
        startsAt: '2026-12-01T10:00:00.000Z',
      }).success,
    ).toBe(true);

    expect(checklistPayloadSchema.safeParse({ kind: 'checklist', title: 'Packing' }).success).toBe(true);

    expect(
      scheduleMessageSchema.safeParse({
        conversationId: '11111111-1111-1111-1111-111111111111',
        scheduledFor: '2026-12-01T10:00:00.000Z',
        plaintext: 'Reminder!',
      }).success,
    ).toBe(true);
  });
});
