'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  allClear,
  applyPercentage,
  clearEntry,
  createInitialCalculatorState,
  deleteLast,
  evaluateEquals,
  extractPureDigitSequence,
  inputDecimal,
  inputDigit,
  inputOperator,
  toggleSign,
  type CalculatorState,
} from '@calx/shared';
import { Delete } from 'lucide-react';

interface CalculatorViewProps {
  hasPinConfigured: boolean;
  onPinAttempt: (digits: string) => Promise<boolean>;
  onOpenSetup: () => void;
}

export function CalculatorView({
  hasPinConfigured,
  onPinAttempt,
  onOpenSetup,
}: CalculatorViewProps) {
  const [state, setState] = useState<CalculatorState>(() => createInitialCalculatorState());
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEquals = useCallback(async () => {
    const pureDigits = extractPureDigitSequence(state);
    if (pureDigits && hasPinConfigured) {
      const unlocked = await onPinAttempt(pureDigits);
      if (unlocked) {
        setState(createInitialCalculatorState());
        return;
      }
    }
    setState((prev) => evaluateEquals(prev));
  }, [state, hasPinConfigured, onPinAttempt]);

  const handleClear = useCallback(() => {
    setState((prev) => {
      if (prev.currentInput !== '' && prev.currentInput !== '0' && !prev.evaluated) {
        return clearEntry(prev);
      }
      return allClear();
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.shiftKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        onOpenSetup();
        return;
      }
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        setState((prev) => inputDigit(prev, e.key));
      } else if (e.key === '.') {
        e.preventDefault();
        setState((prev) => inputDecimal(prev));
      } else if (e.key === '+' || e.key === '-' || e.key === '*' || e.key === '/') {
        e.preventDefault();
        setState((prev) => inputOperator(prev, e.key));
      } else if (e.key === '%') {
        e.preventDefault();
        setState((prev) => applyPercentage(prev));
      } else if (e.key === 'Enter' || e.key === '=') {
        e.preventDefault();
        void handleEquals();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setState((prev) => deleteLast(prev));
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setState(allClear());
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleEquals, onOpenSetup]);

  const startLongPress = () => {
    if (hasPinConfigured) return;
    longPressTimer.current = setTimeout(() => {
      onOpenSetup();
    }, 650);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const isClearEntry =
    state.currentInput !== '' && state.currentInput !== '0' && !state.evaluated;

  return (
    <main className="flex min-h-full w-full items-center justify-center bg-[var(--bg-primary)] p-4">
      <div
        className="flex w-full max-w-[380px] flex-col rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-5 shadow-sm"
        aria-label="Calculator"
      >
        {/* Display */}
        <div className="mb-5 flex min-h-[132px] flex-col justify-end rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-4">
          <div
            className="min-h-[24px] truncate text-right font-mono text-sm text-[var(--text-tertiary)] tabular-nums"
            aria-live="polite"
          >
            {state.expression}
          </div>
          <div
            data-testid="calculator-display"
            className="mt-1 truncate text-right font-mono text-5xl font-medium tracking-tight text-[var(--text-primary)] tabular-nums"
          >
            {state.display}
          </div>
        </div>

        {/* Keypad */}
        <div className="grid grid-cols-4 gap-2.5">
          <CalcButton
            label={isClearEntry ? 'C' : 'AC'}
            variant="utility"
            onClick={handleClear}
          />
          <CalcButton
            label="+/-"
            variant="utility"
            onClick={() => setState((p) => toggleSign(p))}
          />
          <CalcButton
            label="%"
            variant="utility"
            onClick={() => setState((p) => applyPercentage(p))}
          />
          <CalcButton
            label="÷"
            variant="operator"
            onClick={() => setState((p) => inputOperator(p, '÷'))}
          />

          <CalcButton label="7" onClick={() => setState((p) => inputDigit(p, '7'))} />
          <CalcButton label="8" onClick={() => setState((p) => inputDigit(p, '8'))} />
          <CalcButton label="9" onClick={() => setState((p) => inputDigit(p, '9'))} />
          <CalcButton
            label="×"
            variant="operator"
            onClick={() => setState((p) => inputOperator(p, '×'))}
          />

          <CalcButton label="4" onClick={() => setState((p) => inputDigit(p, '4'))} />
          <CalcButton label="5" onClick={() => setState((p) => inputDigit(p, '5'))} />
          <CalcButton label="6" onClick={() => setState((p) => inputDigit(p, '6'))} />
          <CalcButton
            label="-"
            variant="operator"
            onClick={() => setState((p) => inputOperator(p, '-'))}
          />

          <CalcButton label="1" onClick={() => setState((p) => inputDigit(p, '1'))} />
          <CalcButton label="2" onClick={() => setState((p) => inputDigit(p, '2'))} />
          <CalcButton label="3" onClick={() => setState((p) => inputDigit(p, '3'))} />
          <CalcButton
            label="+"
            variant="operator"
            onClick={() => setState((p) => inputOperator(p, '+'))}
          />

          <CalcButton label="0" onClick={() => setState((p) => inputDigit(p, '0'))} />
          <CalcButton label="." onClick={() => setState((p) => inputDecimal(p))} />
          <CalcButton
            label={<Delete className="h-5 w-5" strokeWidth={1.75} />}
            ariaLabel="Backspace"
            onClick={() => setState((p) => deleteLast(p))}
          />
          <CalcButton
            label="="
            variant="equals"
            onClick={() => void handleEquals()}
            onPointerDown={startLongPress}
            onPointerUp={cancelLongPress}
            onPointerLeave={cancelLongPress}
          />
        </div>

        {!hasPinConfigured && (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={onOpenSetup}
              className="text-[11px] tracking-wide text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
            >
              Hold = or click to initialize vault
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

interface CalcButtonProps {
  label: React.ReactNode;
  ariaLabel?: string;
  variant?: 'digit' | 'utility' | 'operator' | 'equals';
  onClick: () => void;
  onPointerDown?: () => void;
  onPointerUp?: () => void;
  onPointerLeave?: () => void;
}

function CalcButton({
  label,
  ariaLabel,
  variant = 'digit',
  onClick,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
}: CalcButtonProps) {
  const base =
    'flex h-16 items-center justify-center rounded-xl text-xl font-medium transition-transform active:scale-[0.97] select-none border';

  const variants: Record<NonNullable<CalcButtonProps['variant']>, string> = {
    digit:
      'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]',
    utility:
      'border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-muted)]',
    operator:
      'border-[var(--border-subtle)] bg-[var(--bg-muted)] text-[var(--text-primary)] hover:opacity-90',
    equals:
      'border-transparent bg-[var(--accent)] text-[var(--accent-fg)] hover:opacity-90',
  };

  return (
    <button
      type="button"
      aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      className={`${base} ${variants[variant]}`}
    >
      {label}
    </button>
  );
}
