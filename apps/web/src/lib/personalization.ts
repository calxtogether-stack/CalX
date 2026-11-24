import type { ChatPersonalization, NotificationSoundOption } from '@calx/shared';

const STORAGE_KEY = 'calx_personalization_v1';

export const DEFAULT_PERSONALIZATION: ChatPersonalization = {
  wallpaperType: 'default',
  wallpaperValue: '',
  accentColor: '#18181B',
  fontSize: 'md',
  themeOverride: 'system',
  notificationSound: 'default',
};

interface StoredPersonalizationMap {
  global: ChatPersonalization;
  conversations: Record<string, Partial<ChatPersonalization>>;
}

function loadMap(): StoredPersonalizationMap {
  if (typeof window === 'undefined') {
    return { global: DEFAULT_PERSONALIZATION, conversations: {} };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { global: DEFAULT_PERSONALIZATION, conversations: {} };
    const parsed = JSON.parse(raw) as StoredPersonalizationMap;
    return {
      global: { ...DEFAULT_PERSONALIZATION, ...(parsed.global ?? {}) },
      conversations: parsed.conversations ?? {},
    };
  } catch {
    return { global: DEFAULT_PERSONALIZATION, conversations: {} };
  }
}

function saveMap(map: StoredPersonalizationMap): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function getGlobalPersonalization(): ChatPersonalization {
  return loadMap().global;
}

export function setGlobalPersonalization(patch: Partial<ChatPersonalization>): ChatPersonalization {
  const map = loadMap();
  map.global = { ...map.global, ...patch };
  saveMap(map);
  return map.global;
}

export function getConversationPersonalization(conversationId?: string | null): ChatPersonalization {
  const map = loadMap();
  if (!conversationId) return map.global;
  return { ...map.global, ...(map.conversations[conversationId] ?? {}) };
}

export function setConversationPersonalization(
  conversationId: string,
  patch: Partial<ChatPersonalization>,
): ChatPersonalization {
  const map = loadMap();
  map.conversations[conversationId] = { ...(map.conversations[conversationId] ?? {}), ...patch };
  saveMap(map);
  return { ...map.global, ...map.conversations[conversationId] };
}

export function resetConversationPersonalization(conversationId: string): ChatPersonalization {
  const map = loadMap();
  delete map.conversations[conversationId];
  saveMap(map);
  return map.global;
}

export function playNotificationSound(
  option: NotificationSoundOption,
  customSoundUri?: string,
): void {
  if (typeof window === 'undefined' || option === 'muted') return;

  if (option === 'custom' && customSoundUri) {
    const audio = new Audio(customSoundUri);
    void audio.play().catch(() => undefined);
    return;
  }

  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    if (option === 'chime') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.setValueAtTime(880, now + 0.08);
    } else if (option === 'pulse') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(523.25, now + 0.06);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(660, now);
    }

    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.start(now);
    osc.stop(now + 0.24);
  } catch {
    // Ignore audio context autoplay restrictions
  }
}

export function getFontSizeClass(size: ChatPersonalization['fontSize']): string {
  switch (size) {
    case 'sm':
      return 'text-xs';
    case 'lg':
      return 'text-base';
    case 'xl':
      return 'text-lg';
    default:
      return 'text-sm';
  }
}
