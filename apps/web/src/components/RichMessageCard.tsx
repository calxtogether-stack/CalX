'use client';

import React, { useEffect, useState } from 'react';
import type {
  ChecklistItem,
  EventRsvp,
  LiveLocationSession,
  Message,
  RsvpStatus,
} from '@calx/shared';
import {
  MessagingService,
  parseRichContent,
  type LocalDeviceCredentials,
} from '@calx/messaging';
import {
  Calendar,
  CheckSquare,
  Copy,
  Eye,
  EyeOff,
  MapPin,
  Plus,
  Square,
  Trash2,
  UserCheck,
} from 'lucide-react';

interface RichMessageCardProps {
  message: Message;
  userId: string;
  credentials: LocalDeviceCredentials;
  service: MessagingService;
  liveSessions: LiveLocationSession[];
  onRefreshLive: () => void;
}

export function RichMessageCard({
  message,
  userId,
  credentials,
  service,
  liveSessions,
  onRefreshLive,
}: RichMessageCardProps) {
  const rich = parseRichContent(message);
  const [rsvps, setRsvps] = useState<EventRsvp[]>([]);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [newItemText, setNewItemText] = useState('');
  const [checklistErr, setChecklistErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [viewOnceModalOpen, setViewOnceModalOpen] = useState(false);
  const [viewOnceMediaUrl, setViewOnceMediaUrl] = useState<string | null>(null);
  const [viewOnceMime, setViewOnceMime] = useState<string | null>(null);
  const [openingViewOnce, setOpeningViewOnce] = useState(false);

  useEffect(() => {
    if (rich?.kind === 'event') {
      void service.listEventRsvps(message.id, credentials).then(setRsvps);
    } else if (rich?.kind === 'checklist') {
      void service.listChecklistItems(message.id, credentials).then(setItems);
    }
  }, [rich?.kind, message.id, credentials, service]);

  // WhatsApp-style View-Once wrapper
  if (message.is_view_once) {
    const isSender = message.sender_id === userId;

    const closeViewOnce = () => {
      if (viewOnceMediaUrl) {
        URL.revokeObjectURL(viewOnceMediaUrl);
      }
      setViewOnceMediaUrl(null);
      setViewOnceMime(null);
      setViewOnceModalOpen(false);
    };

    return (
      <>
        {isSender ? (
          <div className="flex items-center gap-2 text-xs opacity-85">
            {message.viewed_at ? (
              <>
                <EyeOff className="h-3.5 w-3.5" />
                <span>Opened</span>
              </>
            ) : (
              <>
                <Eye className="h-3.5 w-3.5" />
                <span>View-once message</span>
              </>
            )}
          </div>
        ) : message.viewed_at && !viewOnceModalOpen ? (
          <div className="flex items-center gap-2 text-xs italic opacity-70">
            <EyeOff className="h-3.5 w-3.5" />
            <span>Opened</span>
          </div>
        ) : (
          <button
            type="button"
            disabled={openingViewOnce}
            onClick={async () => {
              setOpeningViewOnce(true);
              try {
                const res = await service.consumeViewOnceMessage(message);
                if (res.ok) {
                  if (res.attachmentBytes && res.mimeType) {
                    const blob = new Blob([res.attachmentBytes as BlobPart], {
                      type: res.mimeType,
                    });
                    setViewOnceMediaUrl(URL.createObjectURL(blob));
                    setViewOnceMime(res.mimeType);
                  }
                  setViewOnceModalOpen(true);
                }
              } finally {
                setOpeningViewOnce(false);
              }
            }}
            className="flex items-center gap-2 rounded-lg border border-current/25 px-3 py-1.5 text-xs font-medium hover:opacity-85 disabled:opacity-50"
          >
            <Eye className="h-3.5 w-3.5" />
            <span>{openingViewOnce ? 'Opening...' : 'Tap to view once'}</span>
          </button>
        )}

        {viewOnceModalOpen && (
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-6 text-white">
            <div className="mb-4 flex w-full max-w-lg items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
                <Eye className="h-4 w-4" />
                <span>View Once — disappears when closed</span>
              </div>
              <button
                type="button"
                onClick={closeViewOnce}
                className="rounded-lg border border-white/20 px-3 py-1 text-xs font-medium hover:bg-white/10"
              >
                Close
              </button>
            </div>

            <div className="flex max-h-[75vh] w-full max-w-lg flex-col items-center justify-center overflow-auto rounded-2xl border border-white/15 bg-zinc-900 p-6">
              {viewOnceMediaUrl && viewOnceMime?.startsWith('image/') ? (
                <img
                  src={viewOnceMediaUrl}
                  alt="View once"
                  className="max-h-[65vh] rounded-xl object-contain"
                />
              ) : viewOnceMediaUrl && viewOnceMime?.startsWith('video/') ? (
                <video src={viewOnceMediaUrl} controls autoPlay className="max-h-[65vh] rounded-xl" />
              ) : viewOnceMediaUrl && viewOnceMime?.startsWith('audio/') ? (
                <audio src={viewOnceMediaUrl} controls autoPlay className="w-full" />
              ) : (
                <p className="whitespace-pre-wrap break-words text-center text-base leading-relaxed">
                  {message.decrypted_text ?? 'View-once message'}
                </p>
              )}
            </div>
          </div>
        )}
      </>
    );
  }

  if (!rich) return null;

  if (rich.kind === 'location') {
    const live = rich.sessionId
      ? liveSessions.find((s) => s.id === rich.sessionId)
      : undefined;
    const lat = live?.decrypted_coords?.lat ?? rich.lat;
    const lng = live?.decrypted_coords?.lng ?? rich.lng;
    const isStopped = rich.isLive && !live;
    const osmUrl = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=15/${lat}/${lng}`;

    return (
      <div className="min-w-[220px] space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <MapPin className="h-3.5 w-3.5" />
          <span>{rich.isLive ? (isStopped ? 'Live Location Ended' : 'Live Location') : 'Shared Location'}</span>
        </div>
        {rich.label && <div className="text-xs opacity-80">{rich.label}</div>}
        <div className="rounded-lg border border-current/15 bg-black/10 p-2 font-mono text-[11px]">
          {lat.toFixed(5)}, {lng.toFixed(5)}
        </div>
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <a
            href={osmUrl}
            target="_blank"
            rel="noreferrer"
            className="underline hover:opacity-80"
          >
            Open in OpenStreetMap
          </a>
          {rich.isLive && !isStopped && message.sender_id === userId && rich.sessionId && (
            <button
              type="button"
              onClick={async () => {
                await service.stopLiveLocation(rich.sessionId!);
                onRefreshLive();
              }}
              className="rounded border border-current/30 px-2 py-0.5 text-[10px]"
            >
              Stop Sharing
            </button>
          )}
        </div>
      </div>
    );
  }

  if (rich.kind === 'contact_card') {
    const copyText = [rich.name, rich.phone, rich.email].filter(Boolean).join(' | ');
    return (
      <div className="min-w-[220px] space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <UserCheck className="h-3.5 w-3.5" />
          <span>Contact Card</span>
        </div>
        <div className="rounded-lg border border-current/15 p-2.5 text-xs space-y-1">
          <div className="font-semibold">{rich.name}</div>
          {rich.phone && <div className="font-mono text-[11px] opacity-80">{rich.phone}</div>}
          {rich.email && <div className="text-[11px] opacity-80">{rich.email}</div>}
        </div>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Copy contact details for ${rich.name}?`)) {
              void navigator.clipboard.writeText(copyText);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }
          }}
          className="flex items-center gap-1.5 text-[11px] underline"
        >
          <Copy className="h-3 w-3" />
          <span>{copied ? 'Copied' : 'Copy Contact'}</span>
        </button>
      </div>
    );
  }

  if (rich.kind === 'event') {
    const goingCount = rsvps.filter((r) => r.decrypted_status === 'going').length;
    const maybeCount = rsvps.filter((r) => r.decrypted_status === 'maybe').length;
    const notGoingCount = rsvps.filter((r) => r.decrypted_status === 'not_going').length;
    const myStatus = rsvps.find((r) => r.user_id === userId)?.decrypted_status;

    const vote = async (status: RsvpStatus) => {
      await service.upsertEventRsvp({
        conversationId: message.conversation_id,
        messageId: message.id,
        userId,
        credentials,
        status,
      });
      const updated = await service.listEventRsvps(message.id, credentials);
      setRsvps(updated);
    };

    return (
      <div className="min-w-[240px] space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <Calendar className="h-3.5 w-3.5" />
          <span>{rich.cancelled ? `[Cancelled] ${rich.title}` : rich.title}</span>
        </div>
        <div className="text-[11px] opacity-80">
          {new Date(rich.startsAt).toLocaleString()}
          {rich.locationOrLink ? ` • ${rich.locationOrLink}` : ''}
        </div>
        {rich.description && <p className="text-xs opacity-90">{rich.description}</p>}
        <div className="flex gap-1.5 pt-1">
          {(['going', 'maybe', 'not_going'] as const).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => void vote(status)}
              className={`rounded-lg border px-2 py-1 text-[10px] font-medium capitalize ${
                myStatus === status
                  ? 'border-current bg-current/15'
                  : 'border-current/20 opacity-75 hover:opacity-100'
              }`}
            >
              {status.replace('_', ' ')}
            </button>
          ))}
        </div>
        <div className="text-[10px] opacity-70">
          Going: {goingCount} • Maybe: {maybeCount} • Not going: {notGoingCount}
        </div>
      </div>
    );
  }

  if (rich.kind === 'checklist') {
    const completedCount = items.filter((i) => i.is_completed).length;
    const totalCount = items.length;
    const pct = totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100);

    return (
      <div className="min-w-[240px] space-y-2">
        <div className="flex items-center justify-between text-xs font-semibold">
          <div className="flex items-center gap-1.5">
            <CheckSquare className="h-3.5 w-3.5" />
            <span>{rich.title}</span>
          </div>
          <span className="font-mono text-[10px] opacity-75">
            {completedCount}/{totalCount} ({pct}%)
          </span>
        </div>

        <div className="h-1 w-full overflow-hidden rounded-full bg-current/15">
          <div className="h-full bg-current transition-all" style={{ width: `${pct}%` }} />
        </div>

        {checklistErr && <div className="text-[10px] text-amber-400">{checklistErr}</div>}

        <div className="space-y-1">
          {items.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-2 text-xs">
              <button
                type="button"
                onClick={async () => {
                  setChecklistErr(null);
                  try {
                    await service.toggleChecklistItem(item, userId);
                    const updated = await service.listChecklistItems(message.id, credentials);
                    setItems(updated);
                  } catch (err) {
                    setChecklistErr(err instanceof Error ? err.message : 'Conflict');
                    const updated = await service.listChecklistItems(message.id, credentials);
                    setItems(updated);
                  }
                }}
                className="flex flex-1 items-center gap-1.5 text-left"
              >
                {item.is_completed ? (
                  <CheckSquare className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <Square className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className={item.is_completed ? 'line-through opacity-60' : ''}>
                  {item.decrypted_text ?? '...'}
                </span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  await service.deleteChecklistItem(item.id);
                  setItems((prev) => prev.filter((i) => i.id !== item.id));
                }}
                className="opacity-50 hover:opacity-100"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!newItemText.trim()) return;
            const added = await service.addChecklistItem({
              conversationId: message.conversation_id,
              messageId: message.id,
              userId,
              credentials,
              text: newItemText.trim(),
              position: items.length,
            });
            setItems((prev) => [...prev, added]);
            setNewItemText('');
          }}
          className="flex gap-1 pt-1"
        >
          <input
            type="text"
            value={newItemText}
            onChange={(e) => setNewItemText(e.target.value)}
            placeholder="Add item..."
            className="flex-1 rounded-lg border border-current/20 bg-transparent px-2 py-1 text-xs outline-none"
          />
          <button
            type="submit"
            className="rounded-lg border border-current/20 px-2 py-1 hover:bg-current/10"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </form>
      </div>
    );
  }

  return null;
}
