import { db, must } from "./db";

/**
 * A small copy of PostgREST's read side, enough for what ChipChip B2B's app and the agent send:
 * `select` (columns, aliases, embedded resources incl. `!inner`), filters (eq, neq, gt, gte, lt, lte, like, ilike,
 * in, is, not.*, or=(...), and embedded `rel.col=` filters), `order`, `limit`, `offset`, the `Range` header,
 * `Prefer: count=exact` and `Accept: application/vnd.pgrst.object+json` (supabase-js `.single()`).
 * Errors come back in PostgREST's shape: { code, details, hint, message }.
 * Tables are small in the mock, so rows are read whole and filtered here.
 */

export type PgBody = { code: string | null; details: string | null; hint: string | null; message: string };
export class PgError extends Error {
  constructor(public status: number, public body: PgBody) { super(body.message); }
}
export const pgError = (status: number, code: string | null, message: string, details: string | null = null, hint: string | null = null) =>
  new PgError(status, { code, details, hint, message });

export type Rel = { table: string; kind: "one" | "many"; local: string; foreign: string };
export type TableDef = { real: string; hidden?: string[]; rels: Record<string, Rel>; insert?: InsertDef };

/** Column types the insert checks the way Postgres parses them (others are taken as text). */
export type ColType = "uuid" | "text" | "numeric" | "bigint" | "boolean" | "timestamptz";

/**
 * What POST /rest/v1/<table> may write, copied from the real table: its columns, which refuse null,
 * which have no default (omitting them = null), unique keys and foreign keys under the REAL constraint names.
 */
export type InsertDef = {
  columns: Record<string, ColType>;          // columns of the mock table, in table order
  notNull: string[];                         // NOT NULL on the real table
  noDefault: string[];                       // no default on the real table: omitted = null
  dropped?: string[];                        // real columns the mock table lacks: accepted and not stored
  generated?: Record<string, () => unknown>; // filled when omitted (the mock table has no default for them)
  unique?: { column: string; constraint: string }[];
  fks?: { column: string; constraint: string; table: string; foreign: string }[];
};
export type Schema = Record<string, TableDef>;

type Node =
  | { kind: "star" }
  | { kind: "col"; name: string; alias: string }
  | { kind: "embed"; rel: string; alias: string; inner: boolean; sub: Node[] };

/** Splits on `sep` outside parentheses and double quotes. */
function splitTop(s: string, sep = ","): string[] {
  const out: string[] = [];
  let depth = 0, q = false, cur = "";
  for (const ch of s) {
    if (ch === '"') q = !q;
    if (!q && ch === "(") depth++;
    if (!q && ch === ")") depth--;
    if (!q && depth === 0 && ch === sep) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parseSelect(s: string): Node[] {
  return splitTop(s.replace(/\s+/g, "")).filter(Boolean).map((p): Node => {
    if (p === "*") return { kind: "star" };
    const paren = p.indexOf("(");
    if (paren >= 0 && p.endsWith(")")) {
      let head = p.slice(0, paren);
      let alias = "";
      if (head.includes(":")) [alias, head] = head.split(":");
      let inner = false;
      if (head.includes("!")) {
        const [rel, ...hints] = head.split("!");
        head = rel;
        inner = hints.includes("inner");
      }
      return { kind: "embed", rel: head, alias: alias || head, inner, sub: parseSelect(p.slice(paren + 1, -1) || "*") };
    }
    let name = p.replace(/::\w+$/, "");
    let alias = "";
    if (name.includes(":")) [alias, name] = name.split(":");
    return { kind: "col", name, alias: alias || name };
  });
}

const isNum = (v: unknown) => typeof v === "number" || (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)));

function compare(a: unknown, b: string): number {
  if (a === null || a === undefined) return NaN;
  if (typeof a === "boolean") return String(a) === b.toLowerCase() ? 0 : 1;
  if (isNum(a) && isNum(b)) return Number(a) - Number(b);
  const sa = String(a);
  return sa < b ? -1 : sa > b ? 1 : 0;
}

function likeToRegex(pattern: string, flags: string) {
  const esc = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[*%]/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${esc}$`, flags);
}

function parseList(v: string): string[] {
  const inner = v.replace(/^\(/, "").replace(/\)$/, "");
  return splitTop(inner).map((x) => x.trim().replace(/^"(.*)"$/, "$1"));
}

/** One `op.value` test on a value (`not.` allowed in front). */
function testValue(v: unknown, expr: string): boolean {
  let neg = false;
  if (expr.startsWith("not.")) { neg = true; expr = expr.slice(4); }
  const dot = expr.indexOf(".");
  if (dot < 0) throw pgError(400, "PGRST100", `"failed to parse filter (${expr})" (line 1, column 1)`, "unexpected end of input expecting operator");
  const op = expr.slice(0, dot);
  const val = expr.slice(dot + 1);
  let r: boolean;
  switch (op) {
    case "eq": r = compare(v, val) === 0; break;
    case "neq": r = v !== null && v !== undefined && compare(v, val) !== 0; break;
    case "gt": r = compare(v, val) > 0; break;
    case "gte": r = compare(v, val) >= 0; break;
    case "lt": r = compare(v, val) < 0; break;
    case "lte": r = compare(v, val) <= 0; break;
    case "like": r = v != null && likeToRegex(val, "").test(String(v)); break;
    case "ilike": r = v != null && likeToRegex(val, "i").test(String(v)); break;
    case "in": r = v != null && parseList(val).some((x) => compare(v, x) === 0); break;
    case "is": {
      const w = val.toLowerCase();
      r = w === "null" ? v == null : w === "true" ? v === true : w === "false" ? v === false : w === "unknown" ? v == null : false;
      break;
    }
    default:
      throw pgError(400, "PGRST100", `"failed to parse filter (${op}.${val})" (line 1, column 1)`, `unexpected "${op}" expecting operator (eq, gt, ...)`);
  }
  return neg ? !r : r;
}

/** `or=(a.eq.1,b.ilike.*x*,and(c.gt.2,d.is.null))` against one row. */
function testLogic(row: any, body: string, mode: "or" | "and"): boolean {
  const parts = splitTop(body.replace(/^\(/, "").replace(/\)$/, ""));
  const results = parts.filter(Boolean).map((p) => {
    const m = p.match(/^(not\.)?(or|and)(\(.*\))$/);
    if (m) { const r = testLogic(row, m[3], m[2] as "or" | "and"); return m[1] ? !r : r; }
    const dot = p.indexOf(".");
    const col = p.slice(0, dot);
    return testValue(row[col], p.slice(dot + 1));
  });
  return mode === "or" ? results.some(Boolean) : results.every(Boolean);
}

const RESERVED = new Set(["select", "order", "limit", "offset", "columns", "on_conflict"]);

export async function readTable(schema: Schema, table: string, url: URL, headers: Headers) {
  const def = schema[table];
  if (!def) throw pgError(404, "PGRST205", `Could not find the table 'public.${table}' in the schema cache`);
  const cache = new Map<string, any[]>();
  const load = async (name: string) => {
    if (!cache.has(name)) cache.set(name, must(await db().from(schema[name].real).select("*").limit(1000)) as any[]);
    return cache.get(name)!;
  };

  const p = url.searchParams;
  const nodes = parseSelect(p.get("select") || "*");

  // Filters: plain (on this table) and embedded (rel.col=...).
  const plain: [string, string][] = [];
  const logic: [string, string][] = [];
  const embedded = new Map<string, [string, string][]>();
  for (const [k, v] of Array.from(p.entries())) {
    if (RESERVED.has(k)) continue;
    if (k === "or" || k === "and" || k === "not.or" || k === "not.and") { logic.push([k, v]); continue; }
    if (k.includes(".")) {
      const [rel, ...rest] = k.split(".");
      const list = embedded.get(rel) || [];
      list.push([rest.join("."), v]);
      embedded.set(rel, list);
      continue;
    }
    plain.push([k, v]);
  }

  let rows = (await load(table)).slice();
  if (rows[0]) {
    for (const [col] of plain) {
      if (!(col in rows[0])) throw pgError(400, "42703", `column ${table}.${col} does not exist`);
    }
  }
  rows = rows.filter((r) => plain.every(([c, v]) => testValue(r[c], v)));
  rows = rows.filter((r) => logic.every(([k, v]) => {
    const neg = k.startsWith("not.");
    const res = testLogic(r, v, (neg ? k.slice(4) : k) as "or" | "and");
    return neg ? !res : res;
  }));

  // Order
  const order = p.get("order");
  if (order) {
    const keys = order.split(",").map((t) => {
      const [col, ...mods] = t.split(".");
      return { col, desc: mods.includes("desc"), nullsFirst: mods.includes("nullsfirst") ? true : mods.includes("nullslast") ? false : mods.includes("desc") };
    });
    rows.sort((a, b) => {
      for (const k of keys) {
        const va = a[k.col], vb = b[k.col];
        if (va == null && vb == null) continue;
        if (va == null) return k.nullsFirst ? -1 : 1;
        if (vb == null) return k.nullsFirst ? 1 : -1;
        const c = isNum(va) && isNum(vb) ? Number(va) - Number(vb) : String(va).localeCompare(String(vb));
        if (c !== 0) return k.desc ? -c : c;
      }
      return 0;
    });
  }

  // Embed + project (before paging, so !inner can drop rows like a join would)
  const project = async (tname: string, row: any, sel: Node[], filters: Map<string, [string, string][]>): Promise<any | null> => {
    const tdef = schema[tname];
    const out: any = {};
    for (const n of sel) {
      if (n.kind === "star") {
        for (const [k, v] of Object.entries(row)) if (!tdef.hidden?.includes(k)) out[k] = v;
      } else if (n.kind === "col") {
        if (!(n.name in row) || tdef.hidden?.includes(n.name)) throw pgError(400, "42703", `column ${tname}.${n.name} does not exist`);
        out[n.alias] = row[n.name];
      } else {
        const rel = tdef.rels[n.rel];
        if (!rel) {
          throw pgError(400, "PGRST200", `Could not find a relationship between '${tname}' and '${n.rel}' in the schema cache`, null,
            `Searched for a foreign key relationship between '${tname}' and '${n.rel}' in the schema 'public', but no matches were found.`);
        }
        const targets = await load(rel.table);
        const f = filters.get(n.rel) || [];
        const ok = (t: any) => f.every(([c, v]) => testValue(t[c], v));
        if (rel.kind === "one") {
          const t = targets.find((x) => x[rel.foreign] != null && x[rel.foreign] === row[rel.local]);
          const hit = t && ok(t) ? await project(rel.table, t, n.sub, new Map()) : null;
          if (!hit && n.inner) return null;
          out[n.alias] = hit;
        } else {
          const list = [];
          for (const t of targets.filter((x) => x[rel.foreign] === row[rel.local] && ok(x))) list.push(await project(rel.table, t, n.sub, new Map()));
          if (n.inner && list.length === 0) return null;
          out[n.alias] = list;
        }
      }
    }
    return out;
  };
  const projected: any[] = [];
  for (const r of rows) {
    const o = await project(table, r, nodes, embedded);
    if (o) projected.push(o);
  }

  // Paging: limit/offset or Range: a-b
  let offset = Number(p.get("offset") || 0);
  let limit = p.get("limit") != null ? Number(p.get("limit")) : Infinity;
  const range = headers.get("range");
  if (range) {
    const m = range.match(/^(\d+)-(\d*)$/);
    if (m) { offset = Number(m[1]); if (m[2]) limit = Number(m[2]) - offset + 1; }
  }
  const total = projected.length;
  const page = projected.slice(offset, offset + limit);
  const from = page.length ? offset : 0;
  const contentRange = `${page.length ? `${from}-${from + page.length - 1}` : "*"}/${/count=exact/.test(headers.get("prefer") || "") ? total : "*"}`;

  const single = (headers.get("accept") || "").includes("application/vnd.pgrst.object+json");
  if (single) {
    if (page.length !== 1) {
      throw pgError(406, "PGRST116", "JSON object requested, multiple (or no) rows returned",
        `The result contains ${page.length} rows`);
    }
    return { body: page[0], contentRange };
  }
  return { body: page, contentRange };
}

// ------------------------------------------------------------------------------------------------ insert
const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const BOOL_TRUE = /^(t|true|y|yes|on|1)$/i, BOOL_FALSE = /^(f|false|n|no|off|0)$/i;

/** Parses one value as Postgres would for the column type; 22P02 when it cannot. */
function castValue(type: ColType, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  const bad = (t: string) => pgError(400, "22P02", `invalid input syntax for type ${t}: "${typeof v === "object" ? JSON.stringify(v) : String(v)}"`);
  switch (type) {
    case "uuid":
      if (typeof v !== "string" || !UUID_RE.test(v.trim())) throw bad("uuid");
      return v.trim().toLowerCase();
    case "numeric":
      if (typeof v === "boolean" || typeof v === "object" || String(v).trim() === "" || !isFinite(Number(v))) throw bad("numeric");
      return Number(v);
    case "bigint":
      if (typeof v === "boolean" || typeof v === "object" || !/^\s*-?\d+\s*$/.test(String(v))) throw bad("bigint");
      return Number(v);
    case "boolean":
      if (typeof v === "boolean") return v;
      if (typeof v === "string" && BOOL_TRUE.test(v.trim())) return true;
      if (typeof v === "string" && BOOL_FALSE.test(v.trim())) return false;
      throw bad("boolean");
    case "timestamptz":
      if (typeof v !== "string" || isNaN(Date.parse(v))) throw bad("timestamp with time zone");
      return v;
    default:
      return typeof v === "object" ? JSON.stringify(v) : String(v);
  }
}

const pgStatusOf = (code: string | null | undefined) =>
  code === "23503" || code === "23505" ? 409 : code === "42501" ? 403 : code === "PGRST116" ? 406 : 400;

/**
 * POST /rest/v1/<table>: PostgREST's insert. Body: one object or an array of them (all with the same keys, unless
 * `?columns=` names them; then a key missing from an object is null, or the default with `Prefer: missing=default`).
 * `Prefer: return=representation` returns the inserted rows (projected by `select`, an object with
 * `Accept: application/vnd.pgrst.object+json`); otherwise 201 with no body. Errors as Postgres raises them through
 * PostgREST: PGRST204 unknown column, 22P02 bad value, 23502 null in a NOT NULL column, 23505 duplicate key,
 * 23503 missing foreign row. The whole request is one statement: one bad row inserts nothing.
 * Not copied: upsert (`on_conflict`, `Prefer: resolution=...`), `return=headers-only` (treated as minimal).
 */
export async function insertRows(schema: Schema, table: string, url: URL, headers: Headers, raw: string):
  Promise<{ status: 201; body: unknown; contentRange: string }> {
  const def = schema[table];
  if (!def) throw pgError(404, "PGRST205", `Could not find the table 'public.${table}' in the schema cache`);
  const ins = def.insert;
  if (!ins) throw pgError(403, "42501", `permission denied for table ${table}`);

  let parsed: unknown;
  try { parsed = raw.trim() ? JSON.parse(raw) : undefined; } catch { parsed = undefined; }
  if (parsed === undefined || parsed === null || typeof parsed !== "object")
    throw pgError(400, "PGRST102", "Empty or invalid json");
  const objs = (Array.isArray(parsed) ? parsed : [parsed]) as any[];
  if (objs.some((o) => !o || typeof o !== "object" || Array.isArray(o))) throw pgError(400, "PGRST102", "Empty or invalid json");

  const prefer = headers.get("prefer") || "";
  const single = (headers.get("accept") || "").includes("application/vnd.pgrst.object+json");

  // Which columns the statement writes: ?columns=a,b or the keys of the (first) object.
  const columnsParam = url.searchParams.get("columns");
  let cols: string[];
  if (columnsParam) {
    cols = columnsParam.split(",").map((c) => c.trim().replace(/^"(.*)"$/, "$1")).filter(Boolean);
  } else {
    cols = Object.keys(objs[0] || {});
    const key = (o: object) => Object.keys(o).sort().join(",");
    if (objs.some((o) => key(o) !== key(objs[0]))) throw pgError(400, "PGRST102", "All object keys must match");
  }
  for (const c of cols) {
    if (!(c in ins.columns) && !ins.dropped?.includes(c))
      throw pgError(400, "PGRST204", `Could not find the '${c}' column of '${table}' in the schema cache`);
  }
  if (single && objs.length !== 1) {
    throw pgError(406, "PGRST116", "JSON object requested, multiple (or no) rows returned", `The result contains ${objs.length} rows`);
  }

  // Each row as Postgres would see it.
  const missingDefault = /missing=default/.test(prefer);
  const rows = objs.map((o) => {
    const row: Record<string, unknown> = {};
    for (const c of cols) {
      if (ins.dropped?.includes(c)) continue;  // a real column the mock table does not have: accepted, not stored
      if (!(c in o) && missingDefault) continue;
      row[c] = castValue(ins.columns[c], o[c]);  // missing from this object under ?columns= -> null
    }
    for (const c of ins.noDefault) if (!(c in row)) row[c] = null;
    for (const [c, gen] of Object.entries(ins.generated || {})) if (row[c] === undefined || row[c] === null) row[c] = gen();
    for (const c of ins.notNull) {
      if (c in row && row[c] === null) {
        // Postgres lists the row in the table's column order; the mock's order, close to the real one.
        const shown = Object.keys(ins.columns).map((k) => (row[k] === null || row[k] === undefined ? "null" : String(row[k])));
        throw pgError(400, "23502", `null value in column "${c}" of relation "${table}" violates not-null constraint`,
          `Failing row contains (${shown.join(", ")}).`);
      }
    }
    return row;
  });

  // Unique keys: against the table and within this request.
  for (const u of ins.unique || []) {
    const vals = rows.map((r) => r[u.column]).filter((v) => v !== null && v !== undefined);
    const seen = new Set<string>();
    let dup: unknown = undefined;
    for (const v of vals) { if (seen.has(String(v))) { dup = v; break; } seen.add(String(v)); }
    if (dup === undefined && vals.length) {
      const hit = must(await db().from(def.real).select(u.column).in(u.column, vals as any[]).limit(1)) as any[];
      if (hit[0]) dup = hit[0][u.column];
    }
    if (dup !== undefined) {
      throw pgError(409, "23505", `duplicate key value violates unique constraint "${u.constraint}"`, `Key (${u.column})=(${dup}) already exists.`);
    }
  }
  // Foreign keys.
  for (const fk of ins.fks || []) {
    const vals = Array.from(new Set(rows.map((r) => r[fk.column]).filter((v) => v !== null && v !== undefined).map(String)));
    if (!vals.length) continue;
    const found = new Set((must(await db().from(schema[fk.table].real).select(fk.foreign).in(fk.foreign, vals)) as any[])
      .map((x) => String(x[fk.foreign])));
    const miss = vals.find((v) => !found.has(v));
    if (miss) {
      throw pgError(409, "23503", `insert or update on table "${table}" violates foreign key constraint "${fk.constraint}"`,
        `Key (${fk.column})=(${miss}) is not present in table "${fk.table}".`);
    }
  }

  // One statement: all rows or none. A database error is reported under the exposed names, not the mock's.
  const res = await db().from(def.real).insert(rows).select("*");
  if (res.error) {
    const rename = (s: string | null) => {
      if (!s) return s;
      for (const [name, t] of Object.entries(schema).sort((a, b) => b[1].real.length - a[1].real.length)) s = s.split(t.real).join(name);
      return s;
    };
    const e = res.error as { code?: string; details?: string | null; hint?: string | null; message: string };
    throw pgError(pgStatusOf(e.code), e.code ?? null, rename(e.message) || "insert failed", rename(e.details ?? null), rename(e.hint ?? null));
  }
  const inserted = (res.data || []) as any[];

  if (!/return=representation/.test(prefer)) return { status: 201, body: null, contentRange: "*/*" };
  // Read each new row back through the read side, so `select` (columns, aliases, embeds) applies as on a GET.
  const out: unknown[] = [];
  const sel = url.searchParams.get("select");
  for (const r of inserted) {
    const u = new URL("http://mock/");
    if (sel) u.searchParams.set("select", sel);
    u.searchParams.set("id", `eq.${r.id}`);
    const got = await readTable(schema, table, u, new Headers());
    out.push(...(got.body as unknown[]));
  }
  return { status: 201, body: single ? out[0] ?? null : out, contentRange: "*/*" };
}
