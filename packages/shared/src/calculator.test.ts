import { describe, expect, it } from 'vitest';
import {
  allClear,
  applyPercentage,
  clearEntry,
  createInitialCalculatorState,
  deleteLast,
  evaluateEquals,
  evaluateTokens,
  extractPureDigitSequence,
  inputDecimal,
  inputDigit,
  inputOperator,
  toggleSign,
} from './calculator.js';

describe('Calculator Engine', () => {
  it('handles basic arithmetic and operator precedence', () => {
    expect(evaluateTokens(['2', '+', '3', '×', '4'])).toBe(14);
    expect(evaluateTokens(['10', '-', '6', '÷', '2'])).toBe(7);
  });

  it('handles IEEE-754 decimal precision cleanly', () => {
    let s = createInitialCalculatorState();
    s = inputDigit(s, '0');
    s = inputDecimal(s);
    s = inputDigit(s, '1');
    s = inputOperator(s, '+');
    s = inputDigit(s, '0');
    s = inputDecimal(s);
    s = inputDigit(s, '2');
    s = evaluateEquals(s);
    expect(s.display).toBe('0.3');
  });

  it('handles division by zero gracefully', () => {
    let s = createInitialCalculatorState();
    s = inputDigit(s, '9');
    s = inputOperator(s, '÷');
    s = inputDigit(s, '0');
    s = evaluateEquals(s);
    expect(s.display).toBe('Error');
    expect(s.error).toBe('Cannot divide by zero');
  });

  it('supports percentage, sign toggle, backspace, C, and AC', () => {
    let s = createInitialCalculatorState();
    s = inputDigit(s, '2');
    s = inputDigit(s, '0');
    s = inputDigit(s, '0');
    s = inputOperator(s, '+');
    s = inputDigit(s, '1');
    s = inputDigit(s, '0');
    s = applyPercentage(s);
    expect(s.display).toBe('20');
    s = evaluateEquals(s);
    expect(s.display).toBe('220');

    s = toggleSign(s);
    expect(s.display).toBe('-220');
    s = deleteLast(s);
    expect(s.display).toBe('-22');
    s = clearEntry(s);
    expect(s.display).toBe('0');
    s = allClear();
    expect(s.display).toBe('0');
    expect(s.tokens).toEqual([]);
  });

  it('extracts pure digit sequences for PIN check only when no operators are present', () => {
    let s = createInitialCalculatorState();
    s = inputDigit(s, '1');
    s = inputDigit(s, '3');
    s = inputDigit(s, '3');
    s = inputDigit(s, '7');
    expect(extractPureDigitSequence(s)).toBe('1337');

    s = inputOperator(s, '+');
    s = inputDigit(s, '1');
    expect(extractPureDigitSequence(s)).toBeNull();
  });
});
