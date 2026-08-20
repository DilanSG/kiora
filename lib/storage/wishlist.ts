import { WishItem } from "./types";

import { getDb } from "./db";
import { generateId } from "./helpers";

type WishItemRow = {
  id: string;
  title: string;
  link: string;
  amount: number | null;
  image: string | null;
  description: string | null;
  category: string;
  created_at: string;
};

export type LinkMetadata = {
  title?: string;
  description?: string;
  image?: string;
  price?: number;
};

// Normaliza por prefijo para tolerar variantes truncadas persistidas en
// versiones anteriores (ej. "obje" → "objeto").
export function normalizeWishCategory(rawCategory: string): string {
  const normalized = (rawCategory ?? "").trim().toLowerCase();

  if (normalized.startsWith("obj")) return "objeto";
  if (normalized.startsWith("conc")) return "concierto";
  if (normalized.startsWith("gust")) return "gusto";
  if (normalized.startsWith("otr")) return "otro";

  return normalized || "objeto";
}

export async function getWishlist(): Promise<WishItem[]> {
  const db = getDb();
  const rows = await db.getAllAsync<WishItemRow>(
    "SELECT * FROM wish_items ORDER BY created_at DESC"
  );

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    link: r.link,
    amount: r.amount ?? undefined,
    image: r.image ?? undefined,
    description: r.description ?? undefined,
    category: normalizeWishCategory(r.category ?? ""),
    createdAt: r.created_at,
  }));
}

export async function addWishItem(
  item: Omit<WishItem, "id" | "createdAt">
): Promise<void> {
  const db = getDb();
  const rawCategory = normalizeWishCategory(item.category ?? "");
  await db.runAsync(
    "INSERT INTO wish_items (id, title, link, amount, image, description, category, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      generateId(),
      item.title,
      item.link ?? "",
      item.amount ?? null,
      item.image ?? null,
      item.description ?? null,
      rawCategory,
      new Date().toISOString(),
    ]
  );
}

export async function updateWishItem(
  id: string,
  item: Omit<WishItem, "id" | "createdAt">
): Promise<void> {
  const db = getDb();
  const rawCategory = normalizeWishCategory(item.category ?? "");
  await db.runAsync(
    "UPDATE wish_items SET title = ?, link = ?, amount = ?, image = ?, description = ?, category = ? WHERE id = ?",
    [
      item.title,
      item.link ?? "",
      item.amount ?? null,
      item.image ?? null,
      item.description ?? null,
      rawCategory,
      id,
    ]
  );
}

export async function deleteWishItem(id: string): Promise<void> {
  const db = getDb();
  await db.runAsync("DELETE FROM wish_items WHERE id = ?", id);
}

type MetaEntry = {
  key: string;
  content: string;
};

const URL_WITH_PROTOCOL_REGEX = /https?:\/\/[^\s<>"'`]+/i;
const DOMAIN_LIKE_REGEX =
  /(?:www\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?:\/[^\s<>"'`]*)?/i;

const REDIRECT_QUERY_PARAM_KEYS = [
  "url",
  "u",
  "q",
  "target",
  "dest",
  "destination",
  "redirect",
  "redirect_url",
  "redir",
  "r",
];

const TRACKING_QUERY_PARAM_PATTERNS: RegExp[] = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^dclid$/i,
  /^igshid$/i,
  /^mc_cid$/i,
  /^mc_eid$/i,
  /^mkt_tok$/i,
  /^vero_conv$/i,
  /^vero_id$/i,
  /^spm$/i,
  /^si$/i,
  /^srsltid$/i,
];

// Limpia puntuación alrededor de URLs pegadas desde chats o mensajes
// (ej. "https://ejemplo.com," o "(https://ejemplo.com)").
function trimUrlCandidate(value: string): string {
  let output = value.trim();
  output = output.replace(/^["'""'(<[]+/, "");
  output = output.replace(/["'""'>\]]+$/, "");

  while (/[.,;!?]$/.test(output)) {
    output = output.slice(0, -1);
  }

  // Balanceo de parentesis: solo elimina el ultimo si hay mas de cierre que de apertura.
  while (output.endsWith(")") && output.split("(").length <= output.split(")").length) {
    output = output.slice(0, -1);
  }

  while (output.endsWith("}") && output.split("{").length <= output.split("}").length) {
    output = output.slice(0, -1);
  }

  return output.trim();
}

// Extrae el primer enlace del texto: protocolo explícito → // → dominio,
// para tolerar texto con contexto adicional pegado por el usuario.
function extractFirstLinkFromText(rawInput: string): string | undefined {
  const compact = rawInput.replace(/\s+/g, " ").trim();
  if (!compact) {
    return undefined;
  }

  const directMatch = compact.match(URL_WITH_PROTOCOL_REGEX);
  if (directMatch?.[0]) {
    return trimUrlCandidate(directMatch[0]);
  }

  const protocolRelative = compact.match(/\/\/[^\s<>"'`]+/);
  if (protocolRelative?.[0]) {
    return trimUrlCandidate(`https:${protocolRelative[0]}`);
  }

  const domainMatch = compact.match(DOMAIN_LIKE_REGEX);
  if (domainMatch?.[0]) {
    return trimUrlCandidate(domainMatch[0]);
  }

  return trimUrlCandidate(compact);
}

// Asume https:// si falta protocolo y descarta ftp:/javascript: por seguridad.
function parseHttpUrl(value: string): URL | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function isLikelyEmbeddedUrl(value: string): boolean {
  return parseHttpUrl(value) !== undefined;
}

// Desenreda redirecciones explorando query params (url, redirect, u…) hasta
// 4 niveles, para llegar a la URL final de servicios como t.co.
function unwrapRedirectUrl(initialUrl: URL): URL {
  let current = new URL(initialUrl.toString());

  for (let i = 0; i < 4; i += 1) {
    let nested: string | undefined;
    for (const key of REDIRECT_QUERY_PARAM_KEYS) {
      const value = current.searchParams.get(key);
      if (!value) continue;
      const decoded = safeDecodeURIComponent(value.trim());
      if (isLikelyEmbeddedUrl(decoded)) {
        nested = decoded;
        break;
      }
    }

    if (!nested) {
      break;
    }

    const parsedNested = parseHttpUrl(nested);
    if (!parsedNested) {
      break;
    }

    current = parsedNested;
  }

  return current;
}

// Elimina parámetros de tracking (utm_*, fbclid, gclid…) para enlaces
// limpios y consistentes entre sesiones.
function stripTrackingParams(url: URL): URL {
  const cleaned = new URL(url.toString());

  const keys = Array.from(cleaned.searchParams.keys());
  for (const key of keys) {
    if (TRACKING_QUERY_PARAM_PATTERNS.some((pattern) => pattern.test(key))) {
      cleaned.searchParams.delete(key);
    }
  }

  return cleaned;
}

export function normalizeWishlistLink(rawUrl: string): string {
  const extracted = extractFirstLinkFromText(rawUrl);
  if (!extracted) {
    throw new Error("La URL no puede estar vacía.");
  }

  const parsed = parseHttpUrl(extracted);
  if (!parsed) {
    throw new Error("URL inválida.");
  }

  const unwrapped = unwrapRedirectUrl(parsed);
  const sanitized = stripTrackingParams(unwrapped);
  sanitized.hash = "";

  return sanitized.toString();
}

// Título legible de respaldo derivado del slug o dominio del enlace.
export function deriveWishTitleFromLink(rawUrl: string): string {
  try {
    const parsed = new URL(normalizeWishlistLink(rawUrl));
    const titleQueryKeys = ["title", "name", "product", "item", "q", "query"];
    for (const key of titleQueryKeys) {
      const rawQueryValue = parsed.searchParams.get(key);
      if (!rawQueryValue) continue;

      const decodedValue = safeDecodeURIComponent(rawQueryValue);
      const cleanedValue = normalizeExtractedText(decodedValue.replace(/[-_]+/g, " "));
      if (cleanedValue.length >= 3) {
        return titleCase(cleanedValue);
      }
    }

    const segments = parsed.pathname
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean);
    const rawSlug = segments.length > 0 ? segments[segments.length - 1] : "";
    const slugWithoutExtension = rawSlug.replace(/\.[a-z0-9]{1,5}$/i, "");
    const decodedSlug = safeDecodeURIComponent(slugWithoutExtension);
    const cleanedSlug = normalizeExtractedText(decodedSlug.replace(/[-_]+/g, " "));

    if (cleanedSlug && cleanedSlug.length >= 3) {
      return titleCase(cleanedSlug);
    }

    const hostLabel = parsed.hostname.replace(/^www\./i, "").split(".")[0] ?? "";
    const cleanedHostLabel = normalizeExtractedText(hostLabel.replace(/[-_]+/g, " "));
    if (cleanedHostLabel) {
      return titleCase(cleanedHostLabel);
    }

    return "Nuevo deseo";
  } catch {
    return "Nuevo deseo";
  }
}

// Decodifica entidades HTML de los metadatos (&#8212;, &amp;…): sin esto la
// UI mostraría el texto codificado de los sitios.
function decodeHtmlEntities(input: string): string {
  const namedEntities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };

  return input
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isNaN(code) ? _ : String.fromCodePoint(code);
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isNaN(code) ? _ : String.fromCodePoint(code);
    })
    .replace(/&([a-z]+);/gi, (match, name: string) => namedEntities[name.toLowerCase()] ?? match);
}

function normalizeExtractedText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function titleCase(value: string): string {
  return value
    .split(" ")
    .map((word) => {
      if (!word) return "";
      if (word.length <= 2) return word.toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ")
    .trim();
}

// Parser regex simple de atributos: no cubre todos los bordes del HTML,
// pero basta para las etiquetas <meta> y <link> del <head>.
function parseTagAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z_:.-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match: RegExpExecArray | null;

  while ((match = attrRegex.exec(tag)) !== null) {
    const name = (match[1] ?? "").toLowerCase();
    const rawValue = match[3] ?? match[4] ?? match[5] ?? "";
    attrs[name] = rawValue;
  }

  return attrs;
}

// Convierte <meta> en pares (key, content) con property/name/itemprop, para
// consultarlos por prioridad OG > Twitter > HTML clásico.
function parseMetaEntries(html: string): MetaEntry[] {
  const entries: MetaEntry[] = [];
  const metaRegex = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = metaRegex.exec(html)) !== null) {
    const attrs = parseTagAttributes(match[0]);
    const key = (attrs.property ?? attrs.name ?? attrs.itemprop ?? "").toLowerCase();
    const content = normalizeExtractedText(attrs.content ?? "");
    if (key && content) {
      entries.push({ key, content });
    }
  }

  return entries;
}

function pickMetaByPriority(metaEntries: MetaEntry[], keys: string[]): string | undefined {
  for (const key of keys) {
    const found = metaEntries.find((entry) => entry.key === key);
    if (found?.content) {
      return found.content;
    }
  }
  return undefined;
}

// Precios de web: formato impredecible (coma/punto decimal, NBSP). Usa el
// último separador para normalizar a punto; solo acepta positivos finitos.
function parsePriceCandidate(rawValue: string): number | undefined {
  const cleaned = rawValue
    .replace(/\s|\u00A0/g, "")
    .replace(/[^\d.,-]/g, "")
    .trim();

  if (!cleaned) return undefined;

  const unsigned = cleaned.replace(/-/g, "");
  if (!unsigned) return undefined;

  const lastComma = unsigned.lastIndexOf(",");
  const lastDot = unsigned.lastIndexOf(".");

  let normalized = unsigned;

  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) {
      normalized = unsigned.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = unsigned.replace(/,/g, "");
    }
  } else if (lastComma >= 0) {
    normalized = /,\d{1,2}$/.test(unsigned)
      ? unsigned.replace(/\./g, "").replace(",", ".")
      : unsigned.replace(/,/g, "");
  } else if (lastDot >= 0) {
    normalized = /\.\d{1,2}$/.test(unsigned)
      ? unsigned.replace(/,/g, "")
      : unsigned.replace(/\./g, "");
  }

  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

function pickTwitterCardPrice(metaEntries: MetaEntry[]): number | undefined {
  for (let index = 1; index <= 4; index += 1) {
    const label = pickMetaByPriority(metaEntries, [`twitter:label${index}`]);
    const data = pickMetaByPriority(metaEntries, [`twitter:data${index}`]);
    if (!label || !data) continue;

    const normalizedLabel = label.toLowerCase();
    if (!normalizedLabel.includes("price") && !normalizedLabel.includes("precio")) {
      continue;
    }

    const parsed = parsePriceCandidate(data);
    if (parsed) {
      return parsed;
    }
  }

  return undefined;
}

// Bloques application/ld+json: datos de producto más precisos que OG; ignora
// JSON inválido para no romper la extracción del resto.
function extractJsonLdObjects(html: string): Record<string, unknown>[] {
  const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const results: Record<string, unknown>[] = [];
  let match: RegExpExecArray | null;

  while ((match = scriptRegex.exec(html)) !== null) {
    const raw = (match[1] ?? "").trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      collectJsonLdObjects(parsed, results);
    } catch {
    }
  }

  return results;
}

function collectJsonLdObjects(value: unknown, collector: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectJsonLdObjects(item, collector);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  const objectValue = value as Record<string, unknown>;
  collector.push(objectValue);

  const graph = objectValue["@graph"];
  if (graph) {
    collectJsonLdObjects(graph, collector);
  }
}

function readJsonLdImage(imageValue: unknown): string | undefined {
  if (typeof imageValue === "string") {
    const normalized = normalizeExtractedText(imageValue);
    return normalized || undefined;
  }

  if (Array.isArray(imageValue)) {
    for (const entry of imageValue) {
      const found = readJsonLdImage(entry);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  if (imageValue && typeof imageValue === "object") {
    const asRecord = imageValue as Record<string, unknown>;
    const urlCandidate = asRecord.url;
    if (typeof urlCandidate === "string") {
      const normalized = normalizeExtractedText(urlCandidate);
      return normalized || undefined;
    }
  }

  return undefined;
}

function toAbsoluteUrl(candidate: string, baseUrl: string): string | undefined {
  const normalizedCandidate = normalizeExtractedText(candidate);
  if (!normalizedCandidate) return undefined;

  try {
    return new URL(normalizedCandidate, baseUrl).toString();
  } catch {
    return undefined;
  }
}

// Filtra títulos bloqueados y separa sufijos de marca (| · • -) del resto.
function sanitizeTitleCandidate(rawValue: string | undefined): string | undefined {
  if (!rawValue) return undefined;

  const normalized = normalizeExtractedText(rawValue);
  if (!normalized) return undefined;

  const blockedPatterns = [
    "access denied",
    "just a moment",
    "attention required",
    "forbidden",
    "not found",
    "página no encontrada",
    "error 403",
  ];
  const lowered = normalized.toLowerCase();
  if (blockedPatterns.some((pattern) => lowered.includes(pattern))) {
    return undefined;
  }

  const parts = normalized
    .split(/\s+[|·•-]\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  let selected = normalized;
  if (parts.length > 1) {
    const candidate = parts.find((part) => part.length >= 4 && part.length <= 120);
    if (candidate) {
      selected = candidate;
    }
  }

  if (selected.length > 160) {
    selected = `${selected.slice(0, 157).trim()}...`;
  }

  return selected;
}

function sanitizeDescriptionCandidate(rawValue: string | undefined): string | undefined {
  if (!rawValue) return undefined;

  const normalized = normalizeExtractedText(rawValue);
  if (normalized.length < 12) {
    return undefined;
  }

  if (normalized.length > 320) {
    return `${normalized.slice(0, 317).trim()}...`;
  }

  return normalized;
}

// Descarta data-URLs e imágenes vacías; el resto se resuelve a absoluta.
function sanitizeImageCandidate(rawValue: string | undefined, baseUrl: string): string | undefined {
  if (!rawValue) return undefined;

  const normalized = normalizeExtractedText(rawValue);
  if (!normalized || normalized.startsWith("data:")) {
    return undefined;
  }

  return toAbsoluteUrl(normalized, baseUrl);
}

function extractOEmbedEndpoint(html: string, baseUrl: string): string | undefined {
  const linkRegex = /<link\b[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(html)) !== null) {
    const attrs = parseTagAttributes(match[0]);
    const rel = (attrs.rel ?? "").toLowerCase();
    const type = (attrs.type ?? "").toLowerCase();
    const href = attrs.href ?? "";

    if (!href || !rel.includes("alternate")) {
      continue;
    }

    if (!type.includes("json+oembed")) {
      continue;
    }

    const absolute = toAbsoluteUrl(href, baseUrl);
    if (absolute) {
      return absolute;
    }
  }

  return undefined;
}

// Timeout con AbortController y UA de navegador desktop: evita que un sitio
// lento bloquee la UI y que los endpoints oEmbed rechacen la petición.
async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<Record<string, unknown> | undefined> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json,text/plain,*/*",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return undefined;
    }

    const payload = (await response.json()) as unknown;
    if (!payload || Array.isArray(payload) || typeof payload !== "object") {
      return undefined;
    }

    return payload as Record<string, unknown>;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchOEmbedMetadata(sourceUrl: string, html: string): Promise<LinkMetadata> {
  const endpoints: string[] = [];
  const pageOEmbed = extractOEmbedEndpoint(html, sourceUrl);
  if (pageOEmbed) {
    endpoints.push(pageOEmbed);
  }
  endpoints.push(`https://noembed.com/embed?url=${encodeURIComponent(sourceUrl)}`);

  for (const endpoint of endpoints) {
    const payload = await fetchJsonWithTimeout(endpoint, 4500);
    if (!payload) {
      continue;
    }

    const title = sanitizeTitleCandidate(
      typeof payload.title === "string" ? payload.title : undefined
    );
    const description = sanitizeDescriptionCandidate(
      typeof payload.description === "string" ? payload.description : undefined
    );

    const thumbnailUrl =
      typeof payload.thumbnail_url === "string"
        ? payload.thumbnail_url
        : typeof payload.thumbnailUrl === "string"
          ? payload.thumbnailUrl
          : undefined;

    const image = sanitizeImageCandidate(thumbnailUrl, sourceUrl);

    if (title || description || image) {
      return {
        title,
        description,
        image,
      };
    }
  }

  return {};
}

async function fetchHtmlWithTimeout(
  url: string,
  timeoutMs: number,
  headers: Record<string, string>
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Error de red: ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeoutId);
  }
}

// Extrae título, descripción, imagen y precio combinando OG, Twitter y JSON-LD
// con fallback de regex.
export async function fetchLinkMetadata(url: string): Promise<LinkMetadata> {
  try {
    const formattedUrl = normalizeWishlistLink(url);
    // Dos perfiles de UA (desktop/móvil) para sortear bot detection: algunos
    // sitios devuelven HTML distinto según el agente.
    const headerCandidates: Record<string, string>[] = [
      {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
      },
      {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
      },
    ];

    let html = "";
    for (const headers of headerCandidates) {
      try {
        html = await fetchHtmlWithTimeout(formattedUrl, 6500, headers);
        if (html) {
          break;
        }
      } catch {
        // intenta con otro perfil de headers
      }
    }

    if (!html) {
// Sitio rechazado (bot o error de servidor): igual se rescata título/imagen
    // por oEmbed (no requiere HTML) y en el peor caso el título se deriva del
    // propio enlace.
      const oEmbedMetadata = await fetchOEmbedMetadata(formattedUrl, "");
      return {
        title: sanitizeTitleCandidate(oEmbedMetadata.title) || deriveWishTitleFromLink(formattedUrl),
        description: oEmbedMetadata.description,
        image: oEmbedMetadata.image,
      };
    }

    const metaEntries = parseMetaEntries(html);
    const jsonLdObjects = extractJsonLdObjects(html);

    const titleFromMeta = pickMetaByPriority(metaEntries, [
      "og:title",
      "twitter:title",
      "title",
      "name",
      "product:name",
    ]);
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const titleFromTag = normalizeExtractedText(titleMatch?.[1] ?? "");

    let titleFromJsonLd: string | undefined;
    for (const node of jsonLdObjects) {
      const nodeName = node.name;
      if (typeof nodeName === "string") {
        const normalized = normalizeExtractedText(nodeName);
        if (normalized) {
          titleFromJsonLd = normalized;
          break;
        }
      }
    }

    let title = sanitizeTitleCandidate(titleFromMeta || titleFromJsonLd || titleFromTag || undefined);

    const descriptionFromMeta = pickMetaByPriority(metaEntries, [
      "og:description",
      "twitter:description",
      "description",
    ]);

    let descriptionFromJsonLd: string | undefined;
    for (const node of jsonLdObjects) {
      const nodeDescription = node.description;
      if (typeof nodeDescription === "string") {
        const normalized = normalizeExtractedText(nodeDescription);
        if (normalized) {
          descriptionFromJsonLd = normalized;
          break;
        }
      }
    }

    let description = sanitizeDescriptionCandidate(descriptionFromMeta || descriptionFromJsonLd || undefined);

    const imageFromMeta = pickMetaByPriority(metaEntries, [
      "og:image",
      "twitter:image",
      "og:image:url",
      "product:image",
      "image",
    ]);

    let imageFromJsonLd: string | undefined;
    for (const node of jsonLdObjects) {
      const found = readJsonLdImage(node.image);
      if (found) {
        imageFromJsonLd = found;
        break;
      }
    }

    const imageCandidate = imageFromMeta || imageFromJsonLd;
    let image = sanitizeImageCandidate(imageCandidate, formattedUrl);

    const priceFromMetaCandidate = pickMetaByPriority(metaEntries, [
      "product:price:amount",
      "og:price:amount",
      "price",
      "product:price",
      "twitter:data1",
    ]);

    const twitterCardPrice = pickTwitterCardPrice(metaEntries);
    let price = twitterCardPrice ?? (priceFromMetaCandidate ? parsePriceCandidate(priceFromMetaCandidate) : undefined);

    if (!price) {
      for (const node of jsonLdObjects) {
        const nodePrice = node.price;
        if (typeof nodePrice === "string" || typeof nodePrice === "number") {
          const parsed = parsePriceCandidate(String(nodePrice));
          if (parsed) {
            price = parsed;
            break;
          }
        }

        const offers = node.offers;
        if (offers && typeof offers === "object") {
          const offerCandidates = Array.isArray(offers) ? offers : [offers];
          for (const offerCandidate of offerCandidates) {
            if (!offerCandidate || typeof offerCandidate !== "object") continue;
            const offer = offerCandidate as Record<string, unknown>;
            const offerPrice = offer.price;
            if (typeof offerPrice === "string" || typeof offerPrice === "number") {
              const parsed = parsePriceCandidate(String(offerPrice));
              if (parsed) {
                price = parsed;
                break;
              }
            }
          }
          if (price) break;
        }
      }
    }

    if (!price) {
      const priceRegexes = [
        /(?:US\$|\$|€|£|CLP\$|ARS\$|COP\$)\s*([\d][\d.,\s]{1,15})/i,
        /([\d][\d.,\s]{1,15})\s*(?:US\$|\$|€|£|CLP|ARS|COP)/i,
      ];

      for (const regex of priceRegexes) {
        const match = html.match(regex);
        if (!match) continue;
        const parsed = parsePriceCandidate(match[1] ?? "");
        if (parsed) {
          price = parsed;
          break;
        }
      }
    }

    if (!title || !description || !image) {
      const oEmbedMetadata = await fetchOEmbedMetadata(formattedUrl, html);
      if (!title && oEmbedMetadata.title) {
        title = oEmbedMetadata.title;
      }
      if (!description && oEmbedMetadata.description) {
        description = oEmbedMetadata.description;
      }
      if (!image && oEmbedMetadata.image) {
        image = oEmbedMetadata.image;
      }
    }

    if (!title) {
      title = deriveWishTitleFromLink(formattedUrl);
    }

    return {
      title,
      description,
      image,
      price,
    };
  } catch (err: unknown) {
    console.error("fetchLinkMetadata: error fetching metadata", err);
    return {};
  }
}
