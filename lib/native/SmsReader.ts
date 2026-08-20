import { NativeModules, PermissionsAndroid, Platform, Linking } from "react-native";

export type SmsPermissionResult = "granted" | "denied" | "never_ask_again" | "unavailable";

export type SmsMessage = {
  address: string;
  body: string;
  date: number;
};

export type ParsedMovement = {
  id: string;
  type: "expense" | "income";
  amount: number;
  // Mensaje completo formateado (comercio incluido si aparece en el texto).
  description: string;
  date: Date;
  sender: string;
  // Nombre del remitente resuelto para mostrar (banco conocido o label).
  senderLabel: string;
  // Comercio extraído del texto de forma aislada (ej. "D1", "Éxito").
  store: string;
  rawBody: string;
};

// Solicita permiso READ_SMS en Android. En iOS retorna "unavailable".
// El catch devuelve "denied" para que la UI pueda mostrar un estado
// consistente incluso si el dialogo del SO falla.
export async function requestSmsPermission(): Promise<SmsPermissionResult> {
  if (Platform.OS !== "android") return "unavailable";

  try {
    const already = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.READ_SMS
    );
    if (already) return "granted";

    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.READ_SMS,
      {
        title: "Permiso para leer mensajes",
        message:
          "Kiora necesita acceder a tus mensajes SMS para detectar compras automáticamente. No se almacena ningún mensaje.",
        buttonPositive: "Permitir",
        buttonNegative: "Cancelar",
      }
    );

    if (result === PermissionsAndroid.RESULTS.GRANTED) return "granted";
    if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) return "never_ask_again";
    return "denied";
  } catch {
    return "denied";
  }
}

// Abre los ajustes del sistema para que el usuario active permisos manualmente.
// Util cuando el permiso fue denegado con "never ask again".
export function openAppSettings(): void {
  Linking.openSettings();
}

// En Android 14+ el sistema bloquea READ_SMS para apps instaladas fuera de
// Play Store y no hay dialogo que lo conceda. Este helper salta directo a la
// pantalla "Ajustes restringidos" de Kiora (via modulo nativo SmsReader);
// sin modulo nativo o en versiones viejas, abre los ajustes de la app.
export function openRestrictedSettings(): void {
  if (Platform.OS === "android" && (NativeModules.SmsReader as any)?.openRestrictedSettings) {
    (NativeModules.SmsReader as any).openRestrictedSettings();
    return;
  }
  Linking.openSettings();
}

// Lee los ultimos N SMS de la bandeja de entrada Android via el modulo
// nativo SmsReader (registrado en MainApplication.kt).
// Lanza error si el modulo no esta disponible (build sin recompilar).
export async function readSmsInbox(limit = 300): Promise<SmsMessage[]> {
  if (Platform.OS !== "android") return [];

  if (!NativeModules.SmsReader) {
    throw new Error(
      "El módulo nativo SmsReader no está disponible. " +
      "Revisa que esté registrado en MainApplication.kt y que la app haya sido recompilada."
    );
  }

  try {
    return ((await NativeModules.SmsReader.readInbox(limit)) as SmsMessage[]) ?? [];
  } catch {
    throw new Error("Error desconocido al leer SMS");
  }
}

const PURCHASE_RE =
  /compra|gasto|pago|transacci[oó]n|d[eé]bito|cr[eé]dito|retiro|cobro|cargo|consumo|factura|mov/i;

// Palabras que indican entrada de dinero. "Pago" aparece en ambos sentidos
// ("pago recibido" = ingreso), por eso se detecta la direccion con senales
// fuertes en vez de un diccionario unico.
const INCOME_RE =
  /\b(?:abon[oa]mos|abono|acreditamos|acreditaci[oó]n|consignaci[oó]n|consignaste|dep[oó]sitos?|depositaste|recibiste|recargas?|reintegro|devoluci[oó]n|reembolso|pago\s+recibido|transferencias?\s+(?:recibida|recibidas|entrante|de\s)|ingresos?|ingresad[oa]s?|ingresaron|a\s+favor|saldo\s+a\s+favor)\b/i;

// Senales inconfundibles de gasto. Si coexisten con terminos de ingreso,
// gana el gasto (ej. "abono a tu tarjeta de credito" es un pago y
// "transferencia a" indica dinero enviado por el usuario).
const EXPENSE_STRONG_RE =
  /\b(?:compra|gasto|cargo|consumo|retiro|factura|d[eé]bito|giro|cotizaci[oó]n|pago\s+(?:a|en|de|por|realizado)|abono\s+a\s+(?:tu|su)\s+tarjeta|transferencias?\s+(?:a\s|enviada|realizada|por\b))\b/i;

const AMOUNT_RE =
  /\$\s*([\d]{1,3}(?:[.,][\d]{3})*(?:[.,][\d]{0,2})?|\d{4,12})(?!\d)/;

const SPAM_KEYWORDS_RE =
  /ganaste|premio|sorteo|participa|gira|felicidades|bono\s+regalo|totalmente\s+gratis|curso|marketing|inversi[oó]n\s+segura|hazte\s+rico|retiro\s+de\s+dinero\s+(sin|gratis)|pr[eé]stamo\s+f[aá]cil/i;

// Normaliza montos escritos con notacion colombiana, donde el punto separa
// miles y la coma separa decimales (ej. "$1.500.000,50" → 1500000.50).
// La heuristica distingue entre coma decimal (2 digitos despues, monto
// pequeno) y coma de miles (muchos digitos despues o monto grande).
// Ver README §6.11: solo funciona con formato numerico colombiano.
function normalizeColombianAmount(raw: string): number {
  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");
  const commaIndex = raw.lastIndexOf(",");
  const dotIndex = raw.lastIndexOf(".");

  let normalized: string;

  if (hasComma && hasDot) {
    if (commaIndex > dotIndex) {
      normalized = raw.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = raw.replace(/,/g, "");
    }
  } else if (hasComma && !hasDot) {
    const afterLastComma = raw.slice(commaIndex + 1);
    if (afterLastComma.length <= 2 && raw.length <= 6) {
      normalized = raw.replace(",", ".");
    } else {
      normalized = raw.replace(/,/g, "");
    }
  } else if (hasDot && !hasComma) {
    const parts = raw.split(".");
    if (parts.length === 2 && parts[1].length <= 2 && raw.length <= 6) {
      normalized = raw;
    } else {
      normalized = raw.replace(/\./g, "");
    }
  } else {
    normalized = raw;
  }

  return parseFloat(normalized);
}

const BANK_SHORTCODE_RE = /^\d{3,8}$/;

const KNOWN_BANK_NAMES = [
  "bancolombia", "nequi", "davivienda", "bogotá", "bogota",
  "colpatria", "av villas", "popular", "occidente", "bbva",
  "gnb", "sudameris", "scotiabank", "citibank", "itau",
  "ban100", "banco de bogotá", "banco de bogota",
  "movii", "daviplata", "rappipay", "mercadopago",
  "addi", "nu colombia", "nubank", "lulo bank", "lulobank",
  "finandina", "jir", "coink", "vale", "sistecredito",
];

// Nombres que requieren formato especial al mostrarse (marcas con su propia
// capitalización). El resto se pone en Title Case simple.
const BANK_DISPLAY_NAMES: Record<string, string> = {
  "bancolombia": "Bancolombia",
  "davivienda": "Davivienda",
  "av villas": "Av Villas",
  "banco de bogotá": "Banco de Bogotá",
  "banco de bogota": "Banco de Bogotá",
  "nu colombia": "Nu Colombia",
  "lulo bank": "Lulo Bank",
  "lulobank": "Lulo Bank",
  "bbva": "BBVA",
  "gnb": "GNB",
  "itau": "Itaú",
  "ban100": "Ban100",
};

// Title Case simple: "banco de bogota" → "Banco De Bogota" (los nombres con
// capitalizacion propia estan en BANK_DISPLAY_NAMES).
function titleCase(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Resuelve el remitente crudo del SMS a un nombre legible para mostrar:
// codigos cortos numericos se dejan igual (son de bancos), textos en
// MAYUSCULAS se normalizan a Title Case y los nombres conocidos usan su
// capitalizacion de marca (ej. "nu colombia" → "Nu Colombia").
function resolveSenderLabel(addr: string): string {
  const clean = addr.trim();
  if (BANK_SHORTCODE_RE.test(clean)) return clean;
  const lower = clean.toLowerCase();
  const known = KNOWN_BANK_NAMES.find((name) => lower === name || lower.includes(name));
  if (known && BANK_DISPLAY_NAMES[known]) return BANK_DISPLAY_NAMES[known];
  return titleCase(clean);
}

// Formatea el cuerpo completo del SMS como descripcion de movimiento:
// quita el monto (ya se guarda aparte), unifica saltos de linea en espacios
// y colapsa espacios multiples. El texto restante se capitaliza como inicio
// de oracion, conservando el detalle completo del mensaje bancario.
function formatSmsBodyDescription(body: string, amountRaw: string): string {
  let text = body.replace(AMOUNT_RE, "");
  text = text
    .replace(/\$\s*/g, "")
    .replace(/\s*[\r\n]+\s*/g, " · ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
  if (!text) return amountRaw;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Filtra remitentes que parecen bancos o servicios financieros colombianos.
// Banco: codigo corto numerico de 3-8 digitos o nombre en la lista blanca.
// Esto reduce falsos positivos con SMS promocionales o personales.
function looksLikeBankOrService(addr: string): boolean {
  const clean = addr.trim().toLowerCase();
  if (BANK_SHORTCODE_RE.test(clean)) return true;
  return KNOWN_BANK_NAMES.some((name) => clean.includes(name));
}

const MERCHANT_PATTERNS: RegExp[] = [
  /compra\s+en\s+([a-záéíóúñ0-9][a-záéíóúñ0-9\s\-\.&/]{1,40}?)(?:\s+x\s|\s+por\s|\s+el\s|\s+del\s|\s+a\s+las|\s+de\s+\$|\s+\$|\.|$)/i,
  /pago\s+(?:a\s+|en\s+|por\s+)?([a-záéíóúñ0-9][a-záéíóúñ0-9\s\-\.&/]{1,40}?)(?:\s+x\s|\s+por\s|\s+de\s+\$|\s+el\s|\s+a\s+las|\s+\$|\.|$)/i,
  /cargo\s+(?:a\s+|en\s+|por\s+)?([a-záéíóúñ0-9][a-záéíóúñ0-9\s\-\.&/]{1,40}?)(?:\s+x\s|\s+por\s|\s+de\s+\$|\s+\$|\.|$)/i,
  /consumo\s+(?:en\s+|por\s+)?([a-záéíóúñ0-9][a-záéíóúñ0-9\s\-\.&/]{1,40}?)(?:\s+x\s|\s+por\s|\s+de\s+\$|\s+\$|\.|$)/i,
  /factura\s+(?:de\s+|en\s+)?([a-záéíóúñ0-9][a-záéíóúñ0-9\s\-\.&/]{1,40}?)(?:\s+x\s|\s+por\s|\s+de\s+\$|\s+\$|\.|$)/i,
  /retiro\s+(?:en\s+|por\s+)?([a-záéíóúñ0-9][a-záéíóúñ0-9\s\-\.&/]{1,40}?)(?:\s+x\s|\s+por\s|\s+de\s+\$|\s+\$|\.|$)/i,
  /(?:en|por)\s+([a-záéíóúñ0-9][a-záéíóúñ0-9\s\-\.&/]{2,40}?)(?:\s+el\s|\s+por\s|\s+x\s|\s+de\s+\$|\s+\$|\.|$)/i,
];

// Extrae el nombre del comercio/establecimiento del cuerpo del mensaje
// (ej. "Compra en D1" → "D1"). Retorna "" si no encuentra uno claro.
function extractMerchant(body: string): string {
  for (const pattern of MERCHANT_PATTERNS) {
    const match = body.match(pattern);
    if (match?.[1]) {
      const name = match[1].trim();
      if (name.length >= 2) return name;
    }
  }
  return "";
}

// Hash simple del cuerpo normalizado para incluir en el id y evitar
// colisiones entre movimientos del mismo remitente, monto y fecha.
function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}

// Clasifica mensajes SMS en movimientos (gastos e ingresos) parseados.
// Flujo por mensaje:
// 1. Filtra por remitente bancario (looksLikeBankOrService)
// 2. Descarta spam con SPAM_KEYWORDS_RE
// 3. Extrae monto con AMOUNT_RE y normaliza notacion colombiana
// 4. Determina la direccion: ingreso si hay senales de entrada sin senales
//    de gasto; gasto si hay palabras de compra/pago; si no, se descarta
// 5. Deduplica por tipo + prefijo del cuerpo + monto (no por dia, para no
//    colapsar dos movimientos del mismo valor el mismo dia)
// 6. Extrae comercio con MERCHANT_PATTERNS o descripcion fallback
// Retorna arreglo ordenado descendente por fecha.
export function classifySmsMessages(messages: SmsMessage[]): ParsedMovement[] {
  const seen = new Set<string>();
  const results: ParsedMovement[] = [];

  for (const msg of messages) {
    const { body, address, date } = msg;

    if (!looksLikeBankOrService(address)) continue;

    if (SPAM_KEYWORDS_RE.test(body)) continue;

    const amountMatch = body.match(AMOUNT_RE);
    if (!amountMatch) continue;

    const rawNum = amountMatch[1];
    const amount = normalizeColombianAmount(rawNum);
    if (isNaN(amount) || amount <= 0 || amount > 999_999_999) continue;

    let type: "expense" | "income";
    if (INCOME_RE.test(body) && !EXPENSE_STRONG_RE.test(body)) {
      type = "income";
    } else if (PURCHASE_RE.test(body)) {
      type = "expense";
    } else {
      continue;
    }

    // Usar un prefijo normalizado del cuerpo como clave de dedup, en vez de
    // monto+dia, para no colapsar dos compras del mismo valor el mismo dia.
    const bodyKey = body.slice(0, 80).replace(/\s+/g, " ").toLowerCase();
    const dedupeKey = `${type}-${bodyKey}-${Math.round(amount)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    // Comercio aislado del texto (si se extrae) para mostrarlo destacado;
    // la descripcion real de la lista es el mensaje completo formateado.
    const store = extractMerchant(body);

    results.push({
      id: `${date}-${address}-${type}-${Math.round(amount)}-${hashString(bodyKey)}`,
      type,
      amount,
      description: formatSmsBodyDescription(body, rawNum),
      date: new Date(date),
      sender: address,
      // Nombre resuelto para mostrar en la lista de movimientos.
      senderLabel: resolveSenderLabel(address),
      // Comercio aislado del texto para mostrarlo destacado en la UI.
      store,
      rawBody: body,
    });
  }

  return results.sort((a, b) => b.date.getTime() - a.date.getTime());
}
