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
export type TableDef = { real: string; hidden?: string[]; rels: Record<string, Rel> };
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
