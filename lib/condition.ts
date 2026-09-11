import type { ApigeeContext } from "./apigee";

/**
 * Evaluates an Apigee condition expression against an ApigeeContext.
 *
 * Supported operators and syntax:
 * - Logical: AND, OR, NOT, &&, ||, !
 * - Comparison: ==, =, !=, <, <=, >, >=
 * - Regex: JavaRegex, ~~, Matches
 * - Path: MatchesPath
 * - Literals: "strings", 'strings', numbers, true, false, null
 * - Grouping: ( ... )
 */
export function evaluateCondition(condition?: string | null, context?: ApigeeContext): boolean {
  if (!condition || !condition.trim()) {
    return true;
  }

  const trimmed = condition.trim();
  if (trimmed.toLowerCase() === "true") return true;
  if (trimmed.toLowerCase() === "false") return false;

  try {
    const tokens = tokenize(trimmed);
    const evaluator = new ConditionParser(tokens, context);
    return evaluator.parseExpression();
  } catch (err: any) {
    // If condition evaluation fails, log warning and return true to avoid blocking execution
    console.warn(`Condition evaluation failed for "${condition}":`, err.message);
    return true;
  }
}

type TokenType =
  | "LPAREN"
  | "RPAREN"
  | "AND"
  | "OR"
  | "NOT"
  | "OP"
  | "STRING"
  | "NUMBER"
  | "BOOLEAN"
  | "NULL"
  | "IDENTIFIER";

interface Token {
  type: TokenType;
  value: string;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    // Whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Parens
    if (ch === "(") {
      tokens.push({ type: "LPAREN", value: "(" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "RPAREN", value: ")" });
      i++;
      continue;
    }

    // String literals
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let str = "";
      i++;
      while (i < input.length && input[i] !== quote) {
        if (input[i] === "\\" && i + 1 < input.length) {
          str += input[i + 1];
          i += 2;
        } else {
          str += input[i];
          i++;
        }
      }
      if (i < input.length) i++; // consume closing quote
      tokens.push({ type: "STRING", value: str });
      continue;
    }

    // Multi-char operators / symbols
    if (input.startsWith("==", i) || input.startsWith("!=", i) || input.startsWith("<=", i) || input.startsWith(">=", i) || input.startsWith("~~", i)) {
      tokens.push({ type: "OP", value: input.substring(i, i + 2) });
      i += 2;
      continue;
    }

    if (input.startsWith("&&", i)) {
      tokens.push({ type: "AND", value: "AND" });
      i += 2;
      continue;
    }

    if (input.startsWith("||", i)) {
      tokens.push({ type: "OR", value: "OR" });
      i += 2;
      continue;
    }

    if (ch === "=") {
      tokens.push({ type: "OP", value: "==" });
      i++;
      continue;
    }

    if (ch === "<" || ch === ">") {
      tokens.push({ type: "OP", value: ch });
      i++;
      continue;
    }

    if (ch === "!") {
      tokens.push({ type: "NOT", value: "NOT" });
      i++;
      continue;
    }

    // Word tokens (operators, keywords, identifiers, numbers)
    let word = "";
    while (i < input.length && !/[\s()=!<>"']/.test(input[i])) {
      word += input[i];
      i++;
    }

    const upperWord = word.toUpperCase();
    if (upperWord === "AND") {
      tokens.push({ type: "AND", value: "AND" });
    } else if (upperWord === "OR") {
      tokens.push({ type: "OR", value: "OR" });
    } else if (upperWord === "NOT") {
      tokens.push({ type: "NOT", value: "NOT" });
    } else if (upperWord === "JAVAREGEX" || upperWord === "MATCHES" || upperWord === "LIKE") {
      tokens.push({ type: "OP", value: "JavaRegex" });
    } else if (upperWord === "MATCHESPATH") {
      tokens.push({ type: "OP", value: "MatchesPath" });
    } else if (upperWord === "EQUALS") {
      tokens.push({ type: "OP", value: "==" });
    } else if (upperWord === "NOTEQUALS") {
      tokens.push({ type: "OP", value: "!=" });
    } else if (upperWord === "NULL") {
      tokens.push({ type: "NULL", value: "null" });
    } else if (upperWord === "TRUE") {
      tokens.push({ type: "BOOLEAN", value: "true" });
    } else if (upperWord === "FALSE") {
      tokens.push({ type: "BOOLEAN", value: "false" });
    } else if (/^-?\d+(\.\d+)?$/.test(word)) {
      tokens.push({ type: "NUMBER", value: word });
    } else {
      tokens.push({ type: "IDENTIFIER", value: word });
    }
  }

  return tokens;
}

class ConditionParser {
  private tokens: Token[];
  private pos = 0;
  private context?: ApigeeContext;

  constructor(tokens: Token[], context?: ApigeeContext) {
    this.tokens = tokens;
    this.context = context;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private consume(): Token | undefined {
    return this.tokens[this.pos++];
  }

  parseExpression(): boolean {
    return this.parseOr();
  }

  private parseOr(): boolean {
    let result = this.parseAnd();

    while (this.peek()?.type === "OR") {
      this.consume();
      const right = this.parseAnd();
      result = result || right;
    }

    return result;
  }

  private parseAnd(): boolean {
    let result = this.parseNot();

    while (this.peek()?.type === "AND") {
      this.consume();
      const right = this.parseNot();
      result = result && right;
    }

    return result;
  }

  private parseNot(): boolean {
    if (this.peek()?.type === "NOT") {
      this.consume();
      return !this.parseNot();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): boolean {
    const token = this.peek();
    if (!token) return true;

    if (token.type === "LPAREN") {
      this.consume();
      const result = this.parseExpression();
      if (this.peek()?.type === "RPAREN") {
        this.consume();
      }
      return result;
    }

    return this.parseComparison();
  }

  private resolveValue(tok: Token): any {
    if (tok.type === "STRING") return tok.value;
    if (tok.type === "NUMBER") return Number(tok.value);
    if (tok.type === "BOOLEAN") return tok.value.toLowerCase() === "true";
    if (tok.type === "NULL") return null;
    if (tok.type === "IDENTIFIER") {
      if (!this.context) return undefined;
      return this.context.getVariable(tok.value);
    }
    return undefined;
  }

  private parseComparison(): boolean {
    const leftTok = this.consume();
    if (!leftTok) return true;

    const opTok = this.peek();
    if (!opTok || opTok.type !== "OP") {
      const val = this.resolveValue(leftTok);
      return Boolean(val && val !== "false" && val !== 0);
    }

    this.consume();
    const rightTok = this.consume();
    if (!rightTok) return false;

    const leftVal = this.resolveValue(leftTok);
    const rightVal = this.resolveValue(rightTok);

    return this.compare(leftVal, opTok.value, rightVal);
  }

  private compare(left: any, op: string, right: any): boolean {
    const isLeftNil = left === null || left === undefined;
    const isRightNil = right === null || right === undefined;

    if (op === "==" || op === "=") {
      if (isLeftNil && isRightNil) return true;
      if (isLeftNil || isRightNil) return false;
      return String(left) === String(right);
    }

    if (op === "!=") {
      if (isLeftNil && isRightNil) return false;
      if (isLeftNil || isRightNil) return true;
      return String(left) !== String(right);
    }

    if (op === "JavaRegex" || op === "~~") {
      if (isLeftNil) return false;
      const pattern = String(right ?? "");
      try {
        const re = new RegExp(pattern);
        return re.test(String(left));
      } catch {
        return false;
      }
    }

    if (op === "MatchesPath") {
      if (isLeftNil) return false;
      const leftStr = String(left);
      const rightStr = String(right ?? "");
      return leftStr.startsWith(rightStr) || leftStr === rightStr;
    }

    if (op === "<") return Number(left) < Number(right);
    if (op === "<=") return Number(left) <= Number(right);
    if (op === ">") return Number(left) > Number(right);
    if (op === ">=") return Number(left) >= Number(right);

    return false;
  }
}
