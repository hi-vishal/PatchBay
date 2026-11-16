/** Arithmetic evaluator with its own parser, so model input never reaches eval or Function. */

type Token =
  | { type: 'number'; value: number }
  | { type: 'name'; value: string }
  | { type: 'symbol'; value: string };

const MAX_LENGTH = 500;
const MAX_DEPTH = 50;

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  abs: Math.abs,
  ceil: Math.ceil,
  cos: Math.cos,
  exp: Math.exp,
  floor: Math.floor,
  ln: Math.log,
  log: Math.log10,
  max: Math.max,
  min: Math.min,
  pow: Math.pow,
  round: Math.round,
  sin: Math.sin,
  sqrt: Math.sqrt,
  tan: Math.tan,
};

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([a-zA-Z]+)|(.))/y;
  let match: RegExpExecArray | null;
  while (pattern.lastIndex < source.length && (match = pattern.exec(source))) {
    const [, number, name, symbol] = match;
    if (number !== undefined) tokens.push({ type: 'number', value: Number(number) });
    else if (name !== undefined) tokens.push({ type: 'name', value: name.toLowerCase() });
    else if (symbol !== undefined && symbol.trim()) {
      if (!'+-*/%^(),'.includes(symbol)) throw new Error(`Unexpected character: ${symbol}`);
      tokens.push({ type: 'symbol', value: symbol });
    }
  }
  return tokens;
}

class Parser {
  private position = 0;
  private depth = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): number {
    const value = this.expression();
    const extra = this.tokens[this.position];
    if (extra) throw new Error(`Unexpected token: ${extra.value}`);
    return value;
  }

  private peekSymbol(...symbols: string[]): string | undefined {
    const token = this.tokens[this.position];
    return token?.type === 'symbol' && symbols.includes(token.value) ? token.value : undefined;
  }

  private expect(symbol: string): void {
    if (!this.peekSymbol(symbol)) throw new Error(`Expected "${symbol}"`);
    this.position += 1;
  }

  private nested<T>(parse: () => T): T {
    this.depth += 1;
    if (this.depth > MAX_DEPTH) throw new Error('Expression is too deeply nested');
    const value = parse();
    this.depth -= 1;
    return value;
  }

  private expression(): number {
    let value = this.term();
    for (let op = this.peekSymbol('+', '-'); op; op = this.peekSymbol('+', '-')) {
      this.position += 1;
      const right = this.term();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  }

  private term(): number {
    let value = this.unary();
    for (let op = this.peekSymbol('*', '/', '%'); op; op = this.peekSymbol('*', '/', '%')) {
      this.position += 1;
      const right = this.unary();
      if (op === '*') value *= right;
      else if (op === '/') value /= right;
      else value %= right;
    }
    return value;
  }

  private unary(): number {
    return this.nested(() => {
      const op = this.peekSymbol('+', '-');
      if (op) {
        this.position += 1;
        const value = this.unary();
        return op === '-' ? -value : value;
      }
      return this.power();
    });
  }

  private power(): number {
    const base = this.primary();
    if (!this.peekSymbol('^')) return base;
    this.position += 1;
    return base ** this.unary();
  }

  private primary(): number {
    const token = this.tokens[this.position];
    if (!token) throw new Error('Unexpected end of expression');
    this.position += 1;

    if (token.type === 'number') return token.value;
    if (token.type === 'name') return this.nameValue(token.value);
    if (token.value === '(') {
      const value = this.nested(() => this.expression());
      this.expect(')');
      return value;
    }
    throw new Error(`Unexpected token: ${token.value}`);
  }

  private nameValue(name: string): number {
    if (!this.peekSymbol('(')) {
      if (!Object.hasOwn(CONSTANTS, name)) throw new Error(`Unknown name: ${name}`);
      return CONSTANTS[name] as number;
    }
    if (!Object.hasOwn(FUNCTIONS, name)) throw new Error(`Unknown function: ${name}`);
    this.position += 1;
    const args: number[] = [this.nested(() => this.expression())];
    while (this.peekSymbol(',')) {
      this.position += 1;
      args.push(this.nested(() => this.expression()));
    }
    this.expect(')');
    return (FUNCTIONS[name] as (...values: number[]) => number)(...args);
  }
}

export function evaluateExpression(expression: string): number {
  if (expression.length > MAX_LENGTH) throw new Error('Expression is too long');
  const tokens = tokenize(expression);
  if (tokens.length === 0) throw new Error('Expression is empty');
  const result = new Parser(tokens).parse();
  if (!Number.isFinite(result)) throw new Error('Result is not a finite number');
  return result;
}
