'use client';

import React, { useState } from 'react';
import type { Conversation, Message } from '@calx/shared';
import { X } from 'lucide-react';

export type ActiveComposerModal =
  | null
  | 'location'
  | 'contact'
  | 'event'
  | 'checklist'
  | 'schedule'
  | 'forward';

interface RichComposerModalsProps {
  modal: ActiveComposerModal;
  conversations: Conversation[];
  forwardSource: Message | null;
  onClose: () => void;
  onSendLocation: (params: {
    lat: number;
    lng: number;
    label?: string;
    liveSeconds?: number;
  }) => Promise<void>;
  onSendContactCard: (params: {
    name: string;
    phone?: string;
    email?: string;
    fieldsShared: string[];
  }) => Promise<void>;
  onSendEvent: (params: {
    title: string;
    description?: string;
    startsAt: string;
    locationOrLink?: string;
  }) => Promise<void>;
  onSendChecklist: (params: { title: string; initialItems: string[] }) => Promise<void>;
  onScheduleMessage: (params: {
    plaintext: string;
    scheduledForIso: string;
  }) => Promise<void>;
  onForwardToConversation: (destConvId: string) => Promise<void>;
}

export function RichComposerModals({
  modal,
  conversations,
  forwardSource,
  onClose,
  onSendLocation,
  onSendContactCard,
  onSendEvent,
  onSendChecklist,
  onScheduleMessage,
  onForwardToConversation,
}: RichComposerModalsProps) {
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [locLabel, setLocLabel] = useState('');
  const [liveSec, setLiveSec] = useState<number>(0);
  const [locError, setLocError] = useState<string | null>(null);

  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [sharePhone, setSharePhone] = useState(true);
  const [shareEmail, setShareEmail] = useState(true);

  const [eventTitle, setEventTitle] = useState('');
  const [eventDesc, setEventDesc] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventLoc, setEventLoc] = useState('');

  const [checkTitle, setCheckTitle] = useState('');
  const [checkItemsRaw, setCheckItemsRaw] = useState('');

  const [schedText, setSchedText] = useState('');
  const [schedDate, setSchedDate] = useState('');

  const [destConvId, setDestConvId] = useState('');

  if (!modal) return null;

  const requestCurrentLocation = () => {
    setLocError(null);
    if (!('geolocation' in navigator)) {
      setLocError('Geolocation is not supported in this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
      },
      (err) => {
        setLocError(`Location access denied (${err.message}). Enter coordinates manually.`);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 text-sm shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold capitalize">{modal.replace('_', ' ')}</h3>
          <button type="button" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {modal === 'location' && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const numLat = Number(lat);
              const numLng = Number(lng);
              if (Number.isNaN(numLat) || Number.isNaN(numLng)) {
                setLocError('Valid latitude & longitude required.');
                return;
              }
              await onSendLocation({
                lat: numLat,
                lng: numLng,
                label: locLabel || undefined,
                liveSeconds: liveSec > 0 ? liveSec : undefined,
              });
              onClose();
            }}
            className="space-y-3"
          >
            <button
              type="button"
              onClick={requestCurrentLocation}
              className="w-full rounded-xl border border-[var(--border-subtle)] py-2 text-xs font-medium hover:bg-[var(--bg-secondary)]"
            >
              Use Current GPS Location
            </button>
            {locError && <p className="text-xs text-red-500">{locError}</p>}
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="Latitude"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-xs outline-none"
                required
              />
              <input
                type="text"
                placeholder="Longitude"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-xs outline-none"
                required
              />
            </div>
            <input
              type="text"
              placeholder="Label (optional)"
              value={locLabel}
              onChange={(e) => setLocLabel(e.target.value)}
              className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-xs outline-none"
            />
            <select
              value={liveSec}
              onChange={(e) => setLiveSec(Number(e.target.value))}
              className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-xs outline-none"
            >
              <option value={0}>Static Location (One-time)</option>
              <option value={900}>Live Location — 15 minutes</option>
              <option value={3600}>Live Location — 1 hour</option>
              <option value={28800}>Live Location — 8 hours</option>
            </select>
            <button
              type="submit"
              className="w-full rounded-xl bg-[var(--accent)] py-2 text-xs font-medium text-[var(--accent-fg)]"
            >
              Send Encrypted Location
            </button>
          </form>
        )}

        {modal === 'contact' && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const fields = ['name'];
              if (sharePhone && contactPhone) fields.push('phone');
              if (shareEmail && contactEmail) fields.push('email');
              await onSendContactCard({
                name: contactName,
                phone: sharePhone && contactPhone ? contactPhone : undefined,
                email: shareEmail && contactEmail ? contactEmail : undefined,
                fieldsShared: fields,
              });
              onClose();
            }}
            className="space-y-3"
          >
            <input
              type="text"
              placeholder="Contact Name"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-xs outline-none"
              required
            />
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={sharePhone}
                onChange={(e) => setSharePhone(e.target.checked)}
              />
              <input
                type="text"
                placeholder="Phone (optional)"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                className="flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-xs outline-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={shareEmail}
                onChange={(e) => setShareEmail(e.target.checked)}
              />
              <input
                type="email"
                placeholder="Email (optional)"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className="flex-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-xs outline-none"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-xl bg-[var(--accent)] py-2 text-xs font-medium text-[var(--accent-fg)]"
            >
              Share Contact Card
            </button>
          </form>
        )}

        {modal === 'event' && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await onSendEvent({
                title: eventTitle,
                description: eventDesc || undefined,
                startsAt: new Date(eventDate).toISOString(),
                locationOrLink: eventLoc || undefined,
              });
              onClose();
            }}
            className="space-y-3"
          >
            <input
              type="text"
              placeholder="Event Title"
              value={eventTitle}
              onChange={(e) => setEventTitle(e.target.value)}
              className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-xs outline-none"
              required
            />
            <input
              type="datetime-local"
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-xs outline-none"
              required
            />
            <input
              type="text"
              placeholder="Location or Meeting Link"
              value={eventLoc}
              onChange={(e) => setEventLoc(e.target.value)}
              className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-xs outline-none"
            />
            <textarea
              placeholder="Description (optional)"
              value={eventDesc}
              onChange={(e) => setEventDesc(e.target.value)}
              rows={2}
              className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-xs outline-none"
            />
            <button
              type="submit"
              className="w-full rounded-xl bg-[var(--accent)] py-2 text-xs font-medium text-[var(--accent-fg)]"
            >
              Send Event Invite
            </button>
          </form>
        )}

        {modal === 'checklist' && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const initialItems = checkItemsRaw
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean);
              await onSendChecklist({ title: checkTitle, initialItems });
              onClose();
            }}
            className="space-y-3"
          >
            <input
              type="text"
              placeholder="Checklist Title (e.g. Packing List)"
              value={checkTitle}
              onChange={(e) => setCheckTitle(e.target.value)}
              className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-xs outline-none"
              required
            />
            <textarea
              placeholder="Initial items (one per line)"
              value={checkItemsRaw}
              onChange={(e) => setCheckItemsRaw(e.target.value)}
              rows={4}
              className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-xs outline-none"
            />
            <button
              type="submit"
              className="w-full rounded-xl bg-[var(--accent)] py-2 text-xs font-medium text-[var(--accent-fg)]"
            >
              Create Shared Checklist
            </button>
          </form>
        )}

        {modal === 'schedule' && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await onScheduleMessage({
                plaintext: schedText,
                scheduledForIso: new Date(schedDate).toISOString(),
              });
              onClose();
            }}
            className="space-y-3"
          >
            <textarea
              placeholder="Encrypted message to schedule..."
              value={schedText}
              onChange={(e) => setSchedText(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-xs outline-none"
              required
            />
            <input
              type="datetime-local"
              value={schedDate}
              onChange={(e) => setSchedDate(e.target.value)}
              className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-xs outline-none"
              required
            />
            <button
              type="submit"
              className="w-full rounded-xl bg-[var(--accent)] py-2 text-xs font-medium text-[var(--accent-fg)]"
            >
              Schedule Encrypted Message
            </button>
          </form>
        )}

        {modal === 'forward' && forwardSource && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!destConvId) return;
              await onForwardToConversation(destConvId);
              onClose();
            }}
            className="space-y-3"
          >
            <p className="text-xs text-[var(--text-secondary)]">
              Message will be re-encrypted for the destination conversation.
            </p>
            <select
              value={destConvId}
              onChange={(e) => setDestConvId(e.target.value)}
              className="w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-xs outline-none"
              required
            >
              <option value="">Select destination...</option>
              {conversations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title ?? (c.type === 'direct' ? `Direct (${c.id.slice(0, 6)})` : 'Group')}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="w-full rounded-xl bg-[var(--accent)] py-2 text-xs font-medium text-[var(--accent-fg)]"
            >
              Forward Message
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
