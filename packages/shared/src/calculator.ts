/**
 * Precision-safe arithmetic & expression evaluator for the CalX Calculator.
 * Supports +, -, *, /, %, +/- negation, decimals, operator precedence,
 * and clean formatting without floating-point artifacts (e.g. 0.1 + 0.2 = 0.3).
 */

export type CalculatorOperator = '+' | '-' | '×' | '÷';

export interface CalculatorState {
  /** Current expression tokens shown in the secondary display */
  expression: string;
  /** Primary display value */
  display: string;
  /** Whether the user just pressed '=' */
  evaluated: boolean;
  /** Error state (e.g. Division by zero) */
  error: string | null;
  /** Raw numeric/operator tokens for precedence evaluation */
  tokens: string[];
  /** Current number being typed */
  currentInput: string;
}

const MAX_DISPLAY_DIGITS = 14;

export function createInitialCalculatorState(): CalculatorState {
  return {
    expression: '',
    display: '0',
    evaluated: false,
    error: null,
    tokens: [],
    currentInput: '0',
  };
}

/**
 * Formats a JS number to avoid IEEE-754 artifacts like 0.30000000000000004
 * while keeping standard decimal precision.
 */
export function formatCalculatorNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return 'Error';
  }
  if (Object.is(value, -0)) {
    return '0';
  }

  // Round to 12 significant digits to eliminate binary floating-point noise
  const rounded = Number(value.toPrecision(12));
  const abs = Math.abs(rounded);

  if (abs !== 0 && (abs >= 1e12 || abs < 1e-9)) {
    return rounded.toExponential(6).replace(/\.?0+e/, 'e');
  }

  const str = rounded.toString();
  if (str.length > MAX_DISPLAY_DIGITS && str.includes('.')) {
    const [intPart = '0'] = str.split('.');
    const availDecimals = Math.max(0, MAX_DISPLAY_DIGITS - intPart.length - 1);
    return Number(rounded.toFixed(availDecimals)).toString();
  }
  return str;
}

/**
 * Evaluates a tokenized arithmetic expression respecting operator precedence:
 * × and ÷ before + and -.
 */
export function evaluateTokens(tokens: string[]): number {
  if (tokens.length === 0) return 0;

  // Shunting-yard / two-pass precedence evaluation
  const values: number[] = [];
  const ops: CalculatorOperator[] = [];

  const precedence = (op: CalculatorOperator): number =>
    op === '×' || op === '÷' ? 2 : 1;

  const applyTopOp = () => {
    const op = ops.pop();
    const b = values.pop();
    const a = values.pop();
    if (op === undefined || a === undefined || b === undefined) {
      throw new Error('Invalid expression');
    }
    switch (op) {
      case '+':
        values.push(a + b);
        break;
      case '-':
        values.push(a - b);
        break;
      case '×':
        values.push(a * b);
        break;
      case '÷':
        if (b === 0) {
          throw new Error('Cannot divide by zero');
        }
        values.push(a / b);
        break;
    }
  };

  for (const token of tokens) {
    if (token === '+' || token === '-' || token === '×' || token === '÷') {
      while (
        ops.length > 0 &&
        precedence(ops[ops.length - 1]!) >= precedence(token)
      ) {
        applyTopOp();
      }
      ops.push(token);
    } else {
      const num = Number(token);
      if (Number.isNaN(num)) {
        throw new Error('Invalid number');
      }
      values.push(num);
    }
  }

  while (ops.length > 0) {
    applyTopOp();
  }

  if (values.length !== 1) {
    throw new Error('Invalid expression');
  }
  return values[0]!;
}

function normalizeOperator(op: string): CalculatorOperator | null {
  switch (op) {
    case '+':
      return '+';
    case '-':
      return '-';
    case '*':
    case '×':
      return '×';
    case '/':
    case '÷':
      return '÷';
    default:
      return null;
  }
}

function buildExpressionString(tokens: string[], currentInput: string, showCurrent: boolean): string {
  const parts = [...tokens];
  if (showCurrent && currentInput !== '') {
    parts.push(currentInput);
  }
  return parts.join(' ');
}

export function inputDigit(state: CalculatorState, digit: string): CalculatorState {
  if (!/^[0-9]$/.test(digit)) return state;

  if (state.error || state.evaluated) {
    return {
      expression: '',
      display: digit,
      evaluated: false,
      error: null,
      tokens: [],
      currentInput: digit,
    };
  }

  let nextInput = state.currentInput;
  if (nextInput === '0') {
    nextInput = digit;
  } else if (nextInput === '-0') {
    nextInput = `-${digit}`;
  } else if (nextInput.replace(/[-.]/g, '').length < MAX_DISPLAY_DIGITS) {
    nextInput = nextInput + digit;
  }

  return {
    ...state,
    display: nextInput,
    currentInput: nextInput,
    expression: state.tokens.length > 0 ? buildExpressionString(state.tokens, '', false) : '',
  };
}

export function inputDecimal(state: CalculatorState): CalculatorState {
  if (state.error || state.evaluated) {
    return {
      expression: '',
      display: '0.',
      evaluated: false,
      error: null,
      tokens: [],
      currentInput: '0.',
    };
  }

  if (state.currentInput.includes('.')) {
    return state;
  }

  const nextInput = state.currentInput === '' ? '0.' : `${state.currentInput}.`;
  return {
    ...state,
    display: nextInput,
    currentInput: nextInput,
  };
}

export function inputOperator(state: CalculatorState, rawOp: string): CalculatorState {
  const op = normalizeOperator(rawOp);
  if (!op) return state;

  if (state.error) {
    return state;
  }

  if (state.evaluated) {
    const base = state.display === 'Error' ? '0' : state.display;
    const nextTokens = [base, op];
    return {
      expression: nextTokens.join(' '),
      display: base,
      evaluated: false,
      error: null,
      tokens: nextTokens,
      currentInput: '',
    };
  }

  const nextTokens = [...state.tokens];
  if (state.currentInput !== '') {
    nextTokens.push(state.currentInput);
    nextTokens.push(op);
  } else if (nextTokens.length > 0) {
    // Replace trailing operator
    nextTokens[nextTokens.length - 1] = op;
  } else {
    nextTokens.push('0', op);
  }

  // Compute running preview if we have a valid prefix
  let preview = state.display;
  try {
    const evalSlice = nextTokens.slice(0, -1);
    if (evalSlice.length > 0) {
      preview = formatCalculatorNumber(evaluateTokens(evalSlice));
    }
  } catch {
    // Keep current display if intermediate evaluation fails
  }

  return {
    expression: nextTokens.join(' '),
    display: preview,
    evaluated: false,
    error: null,
    tokens: nextTokens,
    currentInput: '',
  };
}

export function toggleSign(state: CalculatorState): CalculatorState {
  if (state.error) return state;

  if (state.evaluated) {
    const num = Number(state.display);
    if (Number.isNaN(num) || num === 0) return state;
    const negated = formatCalculatorNumber(-num);
    return {
      ...state,
      display: negated,
      currentInput: negated,
      evaluated: false,
      expression: '',
      tokens: [],
    };
  }

  if (state.currentInput === '' || state.currentInput === '0') {
    return state;
  }

  const nextInput = state.currentInput.startsWith('-')
    ? state.currentInput.slice(1)
    : `-${state.currentInput}`;

  return {
    ...state,
    display: nextInput,
    currentInput: nextInput,
  };
}

export function applyPercentage(state: CalculatorState): CalculatorState {
  if (state.error) return state;

  const target = state.currentInput !== '' ? state.currentInput : state.display;
  const num = Number(target);
  if (Number.isNaN(num)) return state;

  // Standard calculator behavior: if previous operator is + or -, percentage is relative to left operand
  let pctValue = num / 100;
  if (state.tokens.length >= 2) {
    const lastOp = state.tokens[state.tokens.length - 1];
    if (lastOp === '+' || lastOp === '-') {
      try {
        const leftVal = evaluateTokens(state.tokens.slice(0, -1));
        pctValue = (leftVal * num) / 100;
      } catch {
        pctValue = num / 100;
      }
    }
  }

  const formatted = formatCalculatorNumber(pctValue);
  return {
    ...state,
    display: formatted,
    currentInput: formatted,
    evaluated: false,
  };
}

export function deleteLast(state: CalculatorState): CalculatorState {
  if (state.error) {
    return createInitialCalculatorState();
  }
  if (state.evaluated) {
    return {
      ...state,
      expression: '',
      evaluated: false,
    };
  }

  if (state.currentInput === '' || state.currentInput === '0') {
    return state;
  }

  const sliced = state.currentInput.slice(0, -1);
  const nextInput = sliced === '' || sliced === '-' ? '0' : sliced;

  return {
    ...state,
    display: nextInput,
    currentInput: nextInput,
  };
}

export function clearEntry(state: CalculatorState): CalculatorState {
  if (state.error || state.evaluated) {
    return createInitialCalculatorState();
  }
  return {
    ...state,
    display: '0',
    currentInput: '0',
  };
}

export function allClear(): CalculatorState {
  return createInitialCalculatorState();
}

export function evaluateEquals(state: CalculatorState): CalculatorState {
  if (state.error) return state;

  if (state.evaluated) {
    return state;
  }

  const allTokens = [...state.tokens];
  if (state.currentInput !== '') {
    allTokens.push(state.currentInput);
  } else if (allTokens.length > 0) {
    // Trailing operator without second operand: drop trailing operator
    allTokens.pop();
  }

  if (allTokens.length === 0) {
    return state;
  }

  try {
    const result = evaluateTokens(allTokens);
    const formatted = formatCalculatorNumber(result);
    if (formatted === 'Error') {
      return {
        expression: `${allTokens.join(' ')} =`,
        display: 'Error',
        evaluated: true,
        error: 'Cannot divide by zero',
        tokens: [],
        currentInput: '',
      };
    }

    return {
      expression: `${allTokens.join(' ')} =`,
      display: formatted,
      evaluated: true,
      error: null,
      tokens: [],
      currentInput: formatted,
    };
  } catch (err) {
    return {
      expression: `${allTokens.join(' ')} =`,
      display: 'Error',
      evaluated: true,
      error: err instanceof Error ? err.message : 'Error',
      tokens: [],
      currentInput: '',
    };
  }
}

/**
 * Extracts the raw digit sequence if the user has typed a pure integer
 * (no operators, no decimal) before pressing '='. Used by the Vault Auth
 * layer to check whether the entered sequence matches the secret PIN.
 */
export function extractPureDigitSequence(state: CalculatorState): string | null {
  if (state.tokens.length > 0 || state.evaluated || state.error) {
    return null;
  }
  if (/^\d{4,12}$/.test(state.currentInput)) {
    return state.currentInput;
  }
  return null;
}
