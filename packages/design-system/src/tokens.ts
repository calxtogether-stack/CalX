/**
 * Monochromatic minimalist design tokens for CalX (Calculator Vault).
 * Restrained palette, subtle hairline borders, crisp typography, no gradients.
 */

export const palette = {
  light: {
    bgPrimary: '#FAFAFA',
    bgSecondary: '#F2F2F3',
    bgElevated: '#FFFFFF',
    bgMuted: '#E8E8EA',
    textPrimary: '#0A0A0B',
    textSecondary: '#52525B',
    textTertiary: '#8A8A93',
    borderSubtle: '#E4E4E7',
    borderStrong: '#D4D4D8',
    accent: '#18181B',
    accentForeground: '#FAFAFA',
    bubbleOutgoing: '#18181B',
    bubbleOutgoingText: '#FAFAFA',
    bubbleIncoming: '#F0F0F2',
    bubbleIncomingText: '#0A0A0B',
    statusSuccess: '#166534',
    statusDanger: '#991B1B',
    statusWarning: '#854D0E',
    calcKeyBg: '#FFFFFF',
    calcKeyOperatorBg: '#EDEDEF',
    calcKeyEqualsBg: '#18181B',
    calcKeyEqualsText: '#FAFAFA',
  },
  dark: {
    bgPrimary: '#09090B',
    bgSecondary: '#111113',
    bgElevated: '#18181B',
    bgMuted: '#222226',
    textPrimary: '#FAFAFA',
    textSecondary: '#A1A1AA',
    textTertiary: '#71717A',
    borderSubtle: '#232327',
    borderStrong: '#34343A',
    accent: '#FAFAFA',
    accentForeground: '#09090B',
    bubbleOutgoing: '#FAFAFA',
    bubbleOutgoingText: '#09090B',
    bubbleIncoming: '#1C1C20',
    bubbleIncomingText: '#FAFAFA',
    statusSuccess: '#4ADE80',
    statusDanger: '#F87171',
    statusWarning: '#FACC15',
    calcKeyBg: '#18181B',
    calcKeyOperatorBg: '#232327',
    calcKeyEqualsBg: '#FAFAFA',
    calcKeyEqualsText: '#09090B',
  },
} as const;

export const typography = {
  fontSans:
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontMono:
    "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  sizes: {
    xs: 11,
    sm: 13,
    base: 15,
    lg: 17,
    xl: 20,
    '2xl': 26,
    calcDisplay: 52,
    calcExpression: 18,
  },
  weights: {
    regular: '400',
    medium: '500',
    semibold: '600',
  },
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
  '3xl': 48,
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 9999,
} as const;

export const shadows = {
  subtle: '0 1px 2px rgba(0, 0, 0, 0.04)',
  elevated: '0 4px 16px rgba(0, 0, 0, 0.06)',
} as const;

export type ThemeMode = 'light' | 'dark';
export type ColorTokens = (typeof palette)[ThemeMode];
