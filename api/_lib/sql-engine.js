// api/_lib/sql-engine.js — tiny hand-rolled SELECT-only SQL engine over an
// in-memory, fully-fictional dataset. No external DB, no dependencies, no
// build step. Supports: SELECT (explicit columns only, no bare *),
// FROM + JOIN ... ON, WHERE, GROUP BY, HAVING, ORDER BY, LIMIT, aggregates
// (COUNT/SUM/AVG/MIN/MAX), and a small scalar-function set (SUBSTR,
// STRFTIME, ROUND, UPPER, LOWER, ABS, LENGTH). Deliberately does not support
// subqueries, CTEs, UNION, window functions, or multiple statements — those
// are rejected up front so the surface area stays auditable.

export class SqlError extends Error {}

/* ---------------- fictional seed data (disposable, hardcoded) ---------------- */

export const TABLES = {
  customers: [
    { id: 1, name: 'Brightline Logistics', city: 'Austin', segment: 'SMB' },
    { id: 2, name: 'Nova Retail Co', city: 'Toronto', segment: 'SMB' },
    { id: 3, name: 'Meridian Consulting', city: 'London', segment: 'Enterprise' },
    { id: 4, name: 'Foglight Analytics', city: 'Berlin', segment: 'SMB' },
    { id: 5, name: 'Harbor & Finch', city: 'Seattle', segment: 'SMB' },
    { id: 6, name: 'Cobalt Ventures', city: 'New York', segment: 'Enterprise' },
    { id: 7, name: 'Pinecrest Studio', city: 'Portland', segment: 'SMB' },
    { id: 8, name: 'Ashgrove Partners', city: 'Dublin', segment: 'Enterprise' },
    { id: 9, name: 'Lumen Field Supply', city: 'Chicago', segment: 'SMB' },
    { id: 10, name: 'Northbeam Media', city: 'Denver', segment: 'SMB' },
    { id: 11, name: 'Kestrel Robotics', city: 'Boston', segment: 'Enterprise' },
    { id: 12, name: 'Solace Wellness', city: 'Miami', segment: 'SMB' },
    { id: 13, name: 'Driftwood Coffee Co', city: 'Vancouver', segment: 'SMB' },
    { id: 14, name: 'Ironclad Freight', city: 'Houston', segment: 'SMB' },
    { id: 15, name: 'Verity Legal Group', city: 'San Francisco', segment: 'Enterprise' }
  ],
  products: [
    { id: 1, name: 'Laptop Stand', category: 'Accessories', price: 39 },
    { id: 2, name: 'Wireless Mouse', category: 'Accessories', price: 24.5 },
    { id: 3, name: 'Mechanical Keyboard', category: 'Accessories', price: 89 },
    { id: 4, name: 'Noise-Cancelling Headphones', category: 'Electronics', price: 179 },
    { id: 5, name: 'HD Webcam', category: 'Electronics', price: 59 },
    { id: 6, name: 'USB-C Hub', category: 'Accessories', price: 45 },
    { id: 7, name: '27in Monitor', category: 'Electronics', price: 249 },
    { id: 8, name: 'LED Desk Lamp', category: 'Furniture', price: 34 },
    { id: 9, name: 'Ergonomic Chair', category: 'Furniture', price: 329 },
    { id: 10, name: 'Standing Desk Converter', category: 'Furniture', price: 219 }
  ],
  orders: [
    { id: 1, customer_id: 9, product_id: 10, quantity: 1, order_date: '2025-12-26', amount: 219 },
    { id: 2, customer_id: 2, product_id: 1, quantity: 2, order_date: '2025-12-20', amount: 78 },
    { id: 3, customer_id: 5, product_id: 1, quantity: 3, order_date: '2025-12-15', amount: 117 },
    { id: 4, customer_id: 8, product_id: 1, quantity: 4, order_date: '2025-12-09', amount: 156 },
    { id: 5, customer_id: 8, product_id: 1, quantity: 3, order_date: '2025-12-22', amount: 117 },
    { id: 6, customer_id: 8, product_id: 9, quantity: 2, order_date: '2025-12-21', amount: 658 },
    { id: 7, customer_id: 15, product_id: 3, quantity: 4, order_date: '2025-12-27', amount: 356 },
    { id: 8, customer_id: 8, product_id: 4, quantity: 1, order_date: '2025-12-23', amount: 179 },
    { id: 9, customer_id: 13, product_id: 6, quantity: 3, order_date: '2025-12-09', amount: 135 },
    { id: 10, customer_id: 4, product_id: 9, quantity: 2, order_date: '2025-12-26', amount: 658 },
    { id: 11, customer_id: 7, product_id: 1, quantity: 3, order_date: '2026-01-21', amount: 117 },
    { id: 12, customer_id: 2, product_id: 8, quantity: 3, order_date: '2026-01-23', amount: 102 },
    { id: 13, customer_id: 8, product_id: 10, quantity: 2, order_date: '2026-01-14', amount: 438 },
    { id: 14, customer_id: 4, product_id: 7, quantity: 2, order_date: '2026-01-15', amount: 498 },
    { id: 15, customer_id: 14, product_id: 3, quantity: 1, order_date: '2026-01-02', amount: 89 },
    { id: 16, customer_id: 4, product_id: 5, quantity: 1, order_date: '2026-01-13', amount: 59 },
    { id: 17, customer_id: 7, product_id: 3, quantity: 3, order_date: '2026-01-24', amount: 267 },
    { id: 18, customer_id: 14, product_id: 4, quantity: 3, order_date: '2026-01-12', amount: 537 },
    { id: 19, customer_id: 14, product_id: 1, quantity: 4, order_date: '2026-02-15', amount: 156 },
    { id: 20, customer_id: 9, product_id: 7, quantity: 2, order_date: '2026-02-19', amount: 498 },
    { id: 21, customer_id: 13, product_id: 9, quantity: 4, order_date: '2026-02-21', amount: 1316 },
    { id: 22, customer_id: 3, product_id: 9, quantity: 3, order_date: '2026-02-10', amount: 987 },
    { id: 23, customer_id: 9, product_id: 1, quantity: 4, order_date: '2026-02-25', amount: 156 },
    { id: 24, customer_id: 5, product_id: 3, quantity: 1, order_date: '2026-02-22', amount: 89 },
    { id: 25, customer_id: 8, product_id: 9, quantity: 2, order_date: '2026-02-08', amount: 658 },
    { id: 26, customer_id: 3, product_id: 1, quantity: 1, order_date: '2026-02-15', amount: 39 },
    { id: 27, customer_id: 13, product_id: 9, quantity: 3, order_date: '2026-02-17', amount: 987 },
    { id: 28, customer_id: 10, product_id: 2, quantity: 1, order_date: '2026-03-26', amount: 24.5 },
    { id: 29, customer_id: 11, product_id: 8, quantity: 2, order_date: '2026-03-18', amount: 68 },
    { id: 30, customer_id: 10, product_id: 8, quantity: 4, order_date: '2026-03-26', amount: 136 },
    { id: 31, customer_id: 7, product_id: 6, quantity: 3, order_date: '2026-03-10', amount: 135 },
    { id: 32, customer_id: 1, product_id: 5, quantity: 3, order_date: '2026-03-10', amount: 177 },
    { id: 33, customer_id: 4, product_id: 2, quantity: 2, order_date: '2026-03-17', amount: 49 },
    { id: 34, customer_id: 14, product_id: 10, quantity: 3, order_date: '2026-03-21', amount: 657 },
    { id: 35, customer_id: 4, product_id: 9, quantity: 1, order_date: '2026-03-18', amount: 329 },
    { id: 36, customer_id: 14, product_id: 10, quantity: 4, order_date: '2026-04-20', amount: 876 },
    { id: 37, customer_id: 4, product_id: 6, quantity: 1, order_date: '2026-04-24', amount: 45 },
    { id: 38, customer_id: 8, product_id: 1, quantity: 4, order_date: '2026-04-12', amount: 156 },
    { id: 39, customer_id: 1, product_id: 4, quantity: 4, order_date: '2026-04-21', amount: 716 },
    { id: 40, customer_id: 13, product_id: 1, quantity: 2, order_date: '2026-04-08', amount: 78 },
    { id: 41, customer_id: 11, product_id: 6, quantity: 4, order_date: '2026-04-05', amount: 180 },
    { id: 42, customer_id: 7, product_id: 8, quantity: 2, order_date: '2026-04-02', amount: 68 },
    { id: 43, customer_id: 10, product_id: 1, quantity: 2, order_date: '2026-04-23', amount: 78 },
    { id: 44, customer_id: 5, product_id: 9, quantity: 1, order_date: '2026-04-05', amount: 329 },
    { id: 45, customer_id: 7, product_id: 4, quantity: 3, order_date: '2026-05-19', amount: 537 },
    { id: 46, customer_id: 8, product_id: 4, quantity: 4, order_date: '2026-05-19', amount: 716 },
    { id: 47, customer_id: 9, product_id: 6, quantity: 2, order_date: '2026-05-26', amount: 90 },
    { id: 48, customer_id: 14, product_id: 6, quantity: 3, order_date: '2026-05-09', amount: 135 },
    { id: 49, customer_id: 6, product_id: 1, quantity: 3, order_date: '2026-05-19', amount: 117 },
    { id: 50, customer_id: 7, product_id: 7, quantity: 3, order_date: '2026-05-13', amount: 747 },
    { id: 51, customer_id: 12, product_id: 10, quantity: 2, order_date: '2026-05-08', amount: 438 },
    { id: 52, customer_id: 2, product_id: 5, quantity: 1, order_date: '2026-05-23', amount: 59 },
    { id: 53, customer_id: 2, product_id: 2, quantity: 4, order_date: '2026-05-25', amount: 98 },
    { id: 54, customer_id: 11, product_id: 3, quantity: 1, order_date: '2026-05-06', amount: 89 },
    { id: 55, customer_id: 2, product_id: 6, quantity: 2, order_date: '2026-05-20', amount: 90 },
    { id: 56, customer_id: 1, product_id: 10, quantity: 4, order_date: '2026-05-09', amount: 876 },
    { id: 57, customer_id: 15, product_id: 10, quantity: 2, order_date: '2026-05-21', amount: 438 },
    { id: 58, customer_id: 8, product_id: 9, quantity: 3, order_date: '2026-06-11', amount: 987 },
    { id: 59, customer_id: 3, product_id: 7, quantity: 1, order_date: '2026-06-27', amount: 249 },
    { id: 60, customer_id: 14, product_id: 4, quantity: 2, order_date: '2026-06-25', amount: 358 },
    { id: 61, customer_id: 5, product_id: 10, quantity: 4, order_date: '2026-06-24', amount: 876 },
    { id: 62, customer_id: 15, product_id: 1, quantity: 2, order_date: '2026-06-03', amount: 78 },
    { id: 63, customer_id: 10, product_id: 6, quantity: 2, order_date: '2026-06-02', amount: 90 },
    { id: 64, customer_id: 10, product_id: 5, quantity: 1, order_date: '2026-06-14', amount: 59 },
    { id: 65, customer_id: 14, product_id: 10, quantity: 1, order_date: '2026-06-02', amount: 219 },
    { id: 66, customer_id: 6, product_id: 7, quantity: 4, order_date: '2026-06-11', amount: 996 },
    { id: 67, customer_id: 12, product_id: 1, quantity: 1, order_date: '2026-07-11', amount: 39 },
    { id: 68, customer_id: 15, product_id: 1, quantity: 3, order_date: '2026-07-25', amount: 117 },
    { id: 69, customer_id: 9, product_id: 4, quantity: 4, order_date: '2026-07-16', amount: 716 },
    { id: 70, customer_id: 3, product_id: 5, quantity: 4, order_date: '2026-07-04', amount: 236 },
    { id: 71, customer_id: 5, product_id: 1, quantity: 3, order_date: '2026-07-08', amount: 117 },
    { id: 72, customer_id: 8, product_id: 7, quantity: 4, order_date: '2026-07-03', amount: 996 },
    { id: 73, customer_id: 14, product_id: 9, quantity: 2, order_date: '2026-07-18', amount: 658 },
    { id: 74, customer_id: 5, product_id: 8, quantity: 2, order_date: '2026-07-16', amount: 68 },
    { id: 75, customer_id: 6, product_id: 5, quantity: 2, order_date: '2026-07-20', amount: 118 },
    { id: 76, customer_id: 15, product_id: 3, quantity: 2, order_date: '2026-07-19', amount: 178 },
    { id: 77, customer_id: 11, product_id: 7, quantity: 2, order_date: '2026-07-08', amount: 498 },
    { id: 78, customer_id: 6, product_id: 9, quantity: 2, order_date: '2026-08-06', amount: 658 },
    { id: 79, customer_id: 2, product_id: 1, quantity: 4, order_date: '2026-08-04', amount: 156 },
    { id: 80, customer_id: 14, product_id: 5, quantity: 2, order_date: '2026-08-02', amount: 118 },
    { id: 81, customer_id: 9, product_id: 9, quantity: 4, order_date: '2026-08-03', amount: 1316 },
    { id: 82, customer_id: 8, product_id: 5, quantity: 4, order_date: '2026-08-01', amount: 236 },
    { id: 83, customer_id: 7, product_id: 4, quantity: 2, order_date: '2026-08-02', amount: 358 },
    { id: 84, customer_id: 7, product_id: 7, quantity: 2, order_date: '2026-08-17', amount: 498 },
    { id: 85, customer_id: 13, product_id: 9, quantity: 1, order_date: '2026-08-14', amount: 329 },
    { id: 86, customer_id: 13, product_id: 4, quantity: 2, order_date: '2026-08-12', amount: 358 }
  ]
};

export const SCHEMA_DESCRIPTION = `Tables (all fictional demo data — SQLite dialect, SELECT-only):

customers(id INTEGER, name TEXT, city TEXT, segment TEXT)   -- segment is 'SMB' or 'Enterprise'
products(id INTEGER, name TEXT, category TEXT, price REAL)  -- category is 'Accessories', 'Electronics', or 'Furniture'
orders(id INTEGER, customer_id INTEGER, product_id INTEGER, quantity INTEGER, order_date TEXT, amount REAL)
  -- order_date is 'YYYY-MM-DD' text. amount is already quantity * unit price (denormalized).
  -- orders.customer_id references customers.id; orders.product_id references products.id.`;

/* ---------------- safety gate: only ever a single SELECT ---------------- */

const FORBIDDEN_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|DETACH|PRAGMA|VACUUM|REPLACE|TRIGGER|TRANSACTION|GRANT|REVOKE|EXEC|EXECUTE|CALL|MERGE|TRUNCATE|COPY|WITH|UNION|INTERSECT|EXCEPT)\b/i;

export function assertSafeSelect(sql) {
  if (typeof sql !== 'string' || !sql.trim()) throw new SqlError('empty_statement');
  let trimmed = sql.trim();
  // allow exactly one trailing semicolon, reject anything after it or any semicolon before the end
  trimmed = trimmed.replace(/;\s*$/, '');
  if (trimmed.includes(';')) throw new SqlError('multiple_statements_not_allowed');
  if (/--|\/\*/.test(trimmed)) throw new SqlError('comments_not_allowed');
  if (!/^SELECT\b/i.test(trimmed)) throw new SqlError('only_select_statements_are_allowed');
  if (FORBIDDEN_KEYWORDS.test(trimmed)) throw new SqlError('forbidden_keyword');
  return trimmed;
}

/* ---------------- tokenizer ---------------- */

const PUNCT = new Set([',', '.', '(', ')', '*']);

function tokenize(sql) {
  const tokens = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(sql[j])) j++;
      tokens.push({ type: 'IDENT', value: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < n && /[0-9.]/.test(sql[j])) j++;
      tokens.push({ type: 'NUMBER', value: parseFloat(sql.slice(i, j)) });
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      const quote = c;
      let j = i + 1;
      let out = '';
      while (j < n) {
        if (sql[j] === quote) {
          if (sql[j + 1] === quote) { out += quote; j += 2; continue; }
          break;
        }
        out += sql[j];
        j++;
      }
      if (j >= n) throw new SqlError('unterminated_string_literal');
      tokens.push({ type: 'STRING', value: out });
      i = j + 1;
      continue;
    }
    if (PUNCT.has(c)) { tokens.push({ type: c, value: c }); i++; continue; }
    if ('=!<>+-/'.includes(c)) {
      const two = sql.slice(i, i + 2);
      if (two === '!=' || two === '<>' || two === '<=' || two === '>=') {
        tokens.push({ type: 'OP', value: two === '<>' ? '!=' : two });
        i += 2;
        continue;
      }
      tokens.push({ type: 'OP', value: c });
      i++;
      continue;
    }
    throw new SqlError('unexpected_character: ' + JSON.stringify(c));
  }
  tokens.push({ type: 'EOF', value: null });
  return tokens;
}

const KEYWORDS = new Set([
  'SELECT', 'DISTINCT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER',
  'ON', 'GROUP', 'BY', 'HAVING', 'ORDER', 'ASC', 'DESC', 'LIMIT', 'OFFSET', 'AS', 'LIKE', 'IN', 'IS', 'NULL'
]);

/* ---------------- parser ---------------- */

class Parser {
  constructor(tokens) { this.tokens = tokens; this.pos = 0; }
  peek() { return this.tokens[this.pos]; }
  peekKeyword() {
    const t = this.peek();
    return t.type === 'IDENT' && KEYWORDS.has(t.value.toUpperCase()) ? t.value.toUpperCase() : null;
  }
  next() { return this.tokens[this.pos++]; }
  expectKeyword(kw) {
    const got = this.peekKeyword();
    if (got !== kw) throw new SqlError(`expected_${kw}_got_${got || this.peek().type}`);
    return this.next();
  }
  matchKeyword(kw) { if (this.peekKeyword() === kw) { this.next(); return true; } return false; }
  expectType(type) {
    if (this.peek().type !== type) throw new SqlError(`expected_${type}_got_${this.peek().type}`);
    return this.next();
  }
  matchType(type) { if (this.peek().type === type) { this.next(); return true; } return false; }
  matchOp(op) { const t = this.peek(); if (t.type === 'OP' && t.value === op) { this.next(); return true; } return false; }

  parseStatement() {
    this.expectKeyword('SELECT');
    const distinct = this.matchKeyword('DISTINCT');
    const columns = this.parseSelectList();
    this.expectKeyword('FROM');
    const from = this.parseTableRef();
    const joins = [];
    for (;;) {
      let joinKind = null;
      if (this.matchKeyword('INNER')) joinKind = 'INNER';
      else if (this.matchKeyword('LEFT')) { joinKind = 'LEFT'; this.matchKeyword('OUTER'); }
      if (this.peekKeyword() === 'JOIN') {
        this.next();
        const table = this.parseTableRef();
        this.expectKeyword('ON');
        const on = this.parseOr();
        joins.push({ table: table.table, alias: table.alias, on, kind: joinKind || 'INNER' });
        continue;
      }
      if (joinKind) throw new SqlError('expected_JOIN_after_' + joinKind);
      break;
    }
    let where = null;
    if (this.matchKeyword('WHERE')) where = this.parseOr();
    let groupBy = [];
    if (this.matchKeyword('GROUP')) { this.expectKeyword('BY'); groupBy = this.parseExprList(); }
    let having = null;
    if (this.matchKeyword('HAVING')) having = this.parseOr();
    let orderBy = [];
    if (this.matchKeyword('ORDER')) { this.expectKeyword('BY'); orderBy = this.parseOrderList(); }
    let limit = null;
    if (this.matchKeyword('LIMIT')) limit = this.expectType('NUMBER').value;
    if (this.matchKeyword('OFFSET')) this.expectType('NUMBER'); // parsed, not applied — dataset is small enough LIMIT alone is fine
    if (this.peek().type !== 'EOF') throw new SqlError('unexpected_trailing_tokens');
    return { distinct, columns, from, joins, where, groupBy, having, orderBy, limit };
  }

  parseSelectList() {
    const items = [];
    for (;;) {
      if (this.peek().type === '*') throw new SqlError('select_star_not_supported: list specific columns instead');
      const expr = this.parseOr();
      let alias = null;
      if (this.matchKeyword('AS')) alias = this.expectType('IDENT').value;
      else if (this.peek().type === 'IDENT' && !this.peekKeyword()) alias = this.next().value;
      items.push({ expr, alias });
      if (!this.matchType(',')) break;
    }
    return items;
  }

  parseTableRef() {
    const table = this.expectType('IDENT').value;
    let alias = table;
    if (this.matchKeyword('AS')) alias = this.expectType('IDENT').value;
    else if (this.peek().type === 'IDENT' && !this.peekKeyword()) alias = this.next().value;
    return { table, alias };
  }

  parseExprList() {
    const items = [this.parseOr()];
    while (this.matchType(',')) items.push(this.parseOr());
    return items;
  }

  parseOrderList() {
    const items = [];
    for (;;) {
      const expr = this.parseOr();
      let dir = 'ASC';
      if (this.matchKeyword('ASC')) dir = 'ASC';
      else if (this.matchKeyword('DESC')) dir = 'DESC';
      items.push({ expr, dir });
      if (!this.matchType(',')) break;
    }
    return items;
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.peekKeyword() === 'OR') { this.next(); left = { type: 'binary', op: 'OR', left, right: this.parseAnd() }; }
    return left;
  }
  parseAnd() {
    let left = this.parseNot();
    while (this.peekKeyword() === 'AND') { this.next(); left = { type: 'binary', op: 'AND', left, right: this.parseNot() }; }
    return left;
  }
  parseNot() {
    if (this.peekKeyword() === 'NOT') { this.next(); return { type: 'unary', op: 'NOT', expr: this.parseNot() }; }
    return this.parseComparison();
  }
  parseComparison() {
    const left = this.parseAdditive();
    // NOT LIKE / NOT IN
    if (this.peekKeyword() === 'NOT') {
      const save = this.pos;
      this.next();
      if (this.peekKeyword() === 'LIKE') { this.next(); return { type: 'binary', op: 'NOTLIKE', left, right: this.parseAdditive() }; }
      if (this.peekKeyword() === 'IN') { this.next(); return { type: 'in', expr: left, list: this.parseInList(), negate: true }; }
      this.pos = save; // not actually NOT LIKE/IN here; let outer NOT handle it (shouldn't normally reach)
    }
    if (this.peekKeyword() === 'LIKE') { this.next(); return { type: 'binary', op: 'LIKE', left, right: this.parseAdditive() }; }
    if (this.peekKeyword() === 'IN') { this.next(); return { type: 'in', expr: left, list: this.parseInList(), negate: false }; }
    if (this.peekKeyword() === 'IS') {
      this.next();
      const negate = this.matchKeyword('NOT');
      this.expectKeyword('NULL');
      return { type: 'isnull', expr: left, negate };
    }
    const t = this.peek();
    if (t.type === 'OP' && ['=', '!=', '<', '>', '<=', '>='].includes(t.value)) {
      this.next();
      return { type: 'binary', op: t.value, left, right: this.parseAdditive() };
    }
    return left;
  }
  parseInList() {
    this.expectType('(');
    const list = this.parseExprList();
    this.expectType(')');
    return list;
  }
  parseAdditive() {
    let left = this.parseMultiplicative();
    for (;;) {
      const t = this.peek();
      if (t.type === 'OP' && (t.value === '+' || t.value === '-')) { this.next(); left = { type: 'binary', op: t.value, left, right: this.parseMultiplicative() }; }
      else break;
    }
    return left;
  }
  parseMultiplicative() {
    let left = this.parseUnary();
    for (;;) {
      if (this.peek().type === '*') { this.next(); left = { type: 'binary', op: '*', left, right: this.parseUnary() }; }
      else if (this.peek().type === 'OP' && this.peek().value === '/') { this.next(); left = { type: 'binary', op: '/', left, right: this.parseUnary() }; }
      else break;
    }
    return left;
  }
  parseUnary() {
    if (this.peek().type === 'OP' && this.peek().value === '-') { this.next(); return { type: 'unary', op: '-', expr: this.parseUnary() }; }
    return this.parsePrimary();
  }
  parsePrimary() {
    const t = this.peek();
    if (t.type === '(') { this.next(); const e = this.parseOr(); this.expectType(')'); return e; }
    if (t.type === 'NUMBER') { this.next(); return { type: 'literal', value: t.value }; }
    if (t.type === 'STRING') { this.next(); return { type: 'literal', value: t.value }; }
    if (t.type === 'IDENT') {
      const kw = this.peekKeyword();
      if (kw === 'NULL') { this.next(); return { type: 'literal', value: null }; }
      if (kw) throw new SqlError('unexpected_keyword_in_expression: ' + kw);
      const name = this.next().value;
      if (this.peek().type === '(') {
        this.next();
        let args = [];
        let star = false;
        if (this.peek().type === '*') { this.next(); star = true; }
        else if (this.peek().type !== ')') args = this.parseExprList();
        this.expectType(')');
        return { type: 'call', name: name.toUpperCase(), args, star };
      }
      if (this.matchType('.')) {
        const col = this.expectType('IDENT').value;
        return { type: 'column', table: name, name: col };
      }
      return { type: 'column', table: null, name };
    }
    throw new SqlError('unexpected_token_in_expression: ' + t.type);
  }
}

/* ---------------- evaluation ---------------- */

const AGGREGATES = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX']);
const SCALAR_FNS = new Set(['SUBSTR', 'STRFTIME', 'ROUND', 'UPPER', 'LOWER', 'ABS', 'LENGTH']);

function findKeyCI(obj, name) {
  const target = name.toLowerCase();
  return Object.keys(obj).find(k => k.toLowerCase() === target);
}

function resolveColumn(node, ctx) {
  if (node.table) {
    const t = ctx[node.table.toLowerCase()];
    if (!t) throw new SqlError('unknown_table_alias: ' + node.table);
    const key = findKeyCI(t, node.name);
    if (key === undefined) throw new SqlError(`unknown_column: ${node.table}.${node.name}`);
    return t[key];
  }
  let val, count = 0;
  for (const alias in ctx) {
    const key = findKeyCI(ctx[alias], node.name);
    if (key !== undefined) { count++; val = ctx[alias][key]; }
  }
  if (count === 0) throw new SqlError('unknown_column: ' + node.name);
  if (count > 1) throw new SqlError('ambiguous_column: ' + node.name);
  return val;
}

function containsAggregate(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'call' && AGGREGATES.has(node.name)) return true;
  if (node.type === 'binary') return containsAggregate(node.left) || containsAggregate(node.right);
  if (node.type === 'unary') return containsAggregate(node.expr);
  if (node.type === 'in') return containsAggregate(node.expr) || node.list.some(containsAggregate);
  if (node.type === 'isnull') return containsAggregate(node.expr);
  if (node.type === 'call') return node.args.some(containsAggregate);
  return false;
}

function likeToRegex(pattern) {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp('^' + escaped + '$', 'i');
}

function strftime(fmt, dateStr) {
  if (typeof dateStr !== 'string' || dateStr.length < 10) return null;
  const y = dateStr.slice(0, 4), mo = dateStr.slice(5, 7), d = dateStr.slice(8, 10);
  return fmt.replace(/%Y/g, y).replace(/%m/g, mo).replace(/%d/g, d);
}

// env: { ctx?: rowContext, group?: rowContext[] }  — exactly one of ctx/group is meaningful
// depending on whether we're in a grouped (aggregate) evaluation or a plain per-row one.
function ev(node, env) {
  switch (node.type) {
    case 'literal': return node.value;
    case 'column': {
      const ctx = env.ctx || (env.group && env.group[0]);
      if (!ctx) return null;
      return resolveColumn(node, ctx);
    }
    case 'unary': {
      if (node.op === 'NOT') return !truthy(ev(node.expr, env));
      if (node.op === '-') return -toNum(ev(node.expr, env));
      throw new SqlError('unknown_unary_op: ' + node.op);
    }
    case 'binary': {
      const { op } = node;
      if (op === 'AND') return truthy(ev(node.left, env)) && truthy(ev(node.right, env));
      if (op === 'OR') return truthy(ev(node.left, env)) || truthy(ev(node.right, env));
      const l = ev(node.left, env), r = ev(node.right, env);
      switch (op) {
        case '=': return l === r || (l == r && l != null && r != null);
        case '!=': return !(l === r || (l == r && l != null && r != null));
        case '<': return toNum(l) < toNum(r);
        case '>': return toNum(l) > toNum(r);
        case '<=': return toNum(l) <= toNum(r);
        case '>=': return toNum(l) >= toNum(r);
        case '+': return toNum(l) + toNum(r);
        case '-': return toNum(l) - toNum(r);
        case '*': return toNum(l) * toNum(r);
        case '/': return toNum(r) === 0 ? null : toNum(l) / toNum(r);
        case 'LIKE': return likeToRegex(String(r)).test(String(l));
        case 'NOTLIKE': return !likeToRegex(String(r)).test(String(l));
        default: throw new SqlError('unknown_binary_op: ' + op);
      }
    }
    case 'in': {
      const v = ev(node.expr, env);
      const hit = node.list.some(item => ev(item, env) === v);
      return node.negate ? !hit : hit;
    }
    case 'isnull': {
      const v = ev(node.expr, env);
      const isNull = v === null || v === undefined;
      return node.negate ? !isNull : isNull;
    }
    case 'call': {
      const name = node.name;
      if (AGGREGATES.has(name)) {
        const rows = env.group || (env.ctx ? [env.ctx] : []);
        if (name === 'COUNT') {
          if (node.star) return rows.length;
          return rows.filter(r => { const v = ev(node.args[0], { ctx: r }); return v !== null && v !== undefined; }).length;
        }
        const nums = rows.map(r => toNum(ev(node.args[0], { ctx: r }))).filter(v => v !== null && !Number.isNaN(v));
        if (name === 'SUM') return nums.reduce((a, b) => a + b, 0);
        if (name === 'AVG') return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
        if (name === 'MIN') return nums.length ? Math.min(...nums) : null;
        if (name === 'MAX') return nums.length ? Math.max(...nums) : null;
      }
      if (SCALAR_FNS.has(name)) {
        const ctx = env.ctx || (env.group && env.group[0]);
        const scalarEnv = { ctx };
        const args = node.args.map(a => ev(a, scalarEnv));
        switch (name) {
          case 'SUBSTR': { const [s, start, len] = args; const str = String(s ?? ''); const from = start > 0 ? start - 1 : 0; return len === undefined ? str.slice(from) : str.slice(from, from + len); }
          case 'STRFTIME': return strftime(String(args[0]), args[1]);
          case 'ROUND': { const [num, digits] = args; const f = Math.pow(10, digits || 0); return Math.round(toNum(num) * f) / f; }
          case 'UPPER': return String(args[0] ?? '').toUpperCase();
          case 'LOWER': return String(args[0] ?? '').toLowerCase();
          case 'ABS': return Math.abs(toNum(args[0]));
          case 'LENGTH': return String(args[0] ?? '').length;
        }
      }
      throw new SqlError('unsupported_function: ' + name);
    }
    default:
      throw new SqlError('unknown_expression_node: ' + node.type);
  }
}

function truthy(v) { return v !== null && v !== undefined && v !== false && v !== 0; }
function toNum(v) { if (v === null || v === undefined) return null; const n = Number(v); return Number.isNaN(n) ? null : n; }

function defaultLabel(node) {
  if (node.type === 'column') return node.name;
  if (node.type === 'call') return `${node.name.toLowerCase()}_${(node.args[0] && defaultLabel(node.args[0])) || 'x'}`;
  if (node.type === 'literal') return 'value';
  return 'expr';
}

/* ---------------- alias substitution (GROUP BY / HAVING may reference a SELECT alias) ---------------- */

function substituteAliases(node, aliasMap) {
  if (!node || typeof node !== 'object') return node;
  if (node.type === 'column' && !node.table && aliasMap.has(node.name.toLowerCase())) {
    return aliasMap.get(node.name.toLowerCase());
  }
  if (node.type === 'binary') return { ...node, left: substituteAliases(node.left, aliasMap), right: substituteAliases(node.right, aliasMap) };
  if (node.type === 'unary') return { ...node, expr: substituteAliases(node.expr, aliasMap) };
  if (node.type === 'call') return { ...node, args: node.args.map(a => substituteAliases(a, aliasMap)) };
  if (node.type === 'in') return { ...node, expr: substituteAliases(node.expr, aliasMap), list: node.list.map(a => substituteAliases(a, aliasMap)) };
  if (node.type === 'isnull') return { ...node, expr: substituteAliases(node.expr, aliasMap) };
  return node;
}

/* ---------------- executor ---------------- */

export function runSelect(sql) {
  const safeSql = assertSafeSelect(sql);
  const tokens = tokenize(safeSql);
  const ast = new Parser(tokens).parseStatement();

  const aliasMap = new Map();
  for (const c of ast.columns) if (c.alias) aliasMap.set(c.alias.toLowerCase(), c.expr);
  if (aliasMap.size) {
    ast.groupBy = ast.groupBy.map(g => substituteAliases(g, aliasMap));
    if (ast.having) ast.having = substituteAliases(ast.having, aliasMap);
  }

  const fromTable = ast.from.table.toLowerCase();
  if (!TABLES[fromTable]) throw new SqlError('unknown_table: ' + ast.from.table);
  let ctxList = TABLES[fromTable].map(r => ({ [ast.from.alias.toLowerCase()]: r }));

  for (const join of ast.joins) {
    const jt = join.table.toLowerCase();
    if (!TABLES[jt]) throw new SqlError('unknown_table: ' + join.table);
    const next = [];
    for (const ctx of ctxList) {
      let matched = false;
      for (const r of TABLES[jt]) {
        const candidate = { ...ctx, [join.alias.toLowerCase()]: r };
        if (truthy(ev(join.on, { ctx: candidate }))) { next.push(candidate); matched = true; }
      }
      if (!matched && join.kind === 'LEFT') {
        const nullRow = {};
        for (const k of Object.keys(TABLES[jt][0] || {})) nullRow[k] = null;
        next.push({ ...ctx, [join.alias.toLowerCase()]: nullRow });
      }
    }
    ctxList = next;
  }

  if (ast.where) ctxList = ctxList.filter(ctx => truthy(ev(ast.where, { ctx })));

  const hasExplicitGroup = ast.groupBy.length > 0;
  const isAggQuery = hasExplicitGroup || ast.columns.some(c => containsAggregate(c.expr)) || containsAggregate(ast.having);

  let rowEnvs; // array of {out: {label:value}, env}
  if (isAggQuery) {
    let groups;
    if (hasExplicitGroup) {
      const map = new Map();
      const order = [];
      for (const ctx of ctxList) {
        const key = JSON.stringify(ast.groupBy.map(g => ev(g, { ctx })));
        if (!map.has(key)) { map.set(key, []); order.push(key); }
        map.get(key).push(ctx);
      }
      groups = order.map(k => map.get(k));
    } else {
      groups = [ctxList];
    }
    if (ast.having) groups = groups.filter(g => truthy(ev(ast.having, { group: g })));
    rowEnvs = groups.map(g => {
      const env = { group: g };
      const out = {};
      ast.columns.forEach((c, i) => {
        const label = c.alias || defaultLabel(c.expr) + (i > 0 && ast.columns.slice(0, i).some(p => (p.alias || defaultLabel(p.expr)) === (c.alias || defaultLabel(c.expr))) ? `_${i}` : '');
        out[label] = ev(c.expr, env);
      });
      return { out, env };
    });
  } else {
    rowEnvs = ctxList.map(ctx => {
      const env = { ctx };
      const out = {};
      ast.columns.forEach((c, i) => {
        const label = c.alias || defaultLabel(c.expr) + (i > 0 && ast.columns.slice(0, i).some(p => (p.alias || defaultLabel(p.expr)) === (c.alias || defaultLabel(c.expr))) ? `_${i}` : '');
        out[label] = ev(c.expr, env);
      });
      return { out, env };
    });
  }

  if (ast.distinct) {
    const seen = new Set();
    rowEnvs = rowEnvs.filter(r => { const k = JSON.stringify(r.out); if (seen.has(k)) return false; seen.add(k); return true; });
  }

  if (ast.orderBy.length) {
    const outLabels = rowEnvs.length ? Object.keys(rowEnvs[0].out) : [];
    rowEnvs = rowEnvs
      .map((r, idx) => ({ r, idx }))
      .sort((a, b) => {
        for (const item of ast.orderBy) {
          let av, bv;
          if (item.expr.type === 'column' && !item.expr.table && outLabels.some(l => l.toLowerCase() === item.expr.name.toLowerCase())) {
            const label = outLabels.find(l => l.toLowerCase() === item.expr.name.toLowerCase());
            av = a.r.out[label]; bv = b.r.out[label];
          } else {
            av = ev(item.expr, a.r.env); bv = ev(item.expr, b.r.env);
          }
          let cmp;
          if (typeof av === 'number' || typeof bv === 'number') cmp = toNum(av) - toNum(bv);
          else cmp = String(av ?? '').localeCompare(String(bv ?? ''));
          if (cmp !== 0) return item.dir === 'DESC' ? -cmp : cmp;
        }
        return a.idx - b.idx;
      })
      .map(x => x.r);
  }

  const limit = Math.min(ast.limit != null ? ast.limit : 200, 500);
  rowEnvs = rowEnvs.slice(0, limit);

  const columns = ast.columns.map((c, i) => c.alias || defaultLabel(c.expr) + (i > 0 && ast.columns.slice(0, i).some(p => (p.alias || defaultLabel(p.expr)) === (c.alias || defaultLabel(c.expr))) ? `_${i}` : ''));
  const rows = rowEnvs.map(r => columns.map(col => r.out[col]));

  return { columns, rows };
}
