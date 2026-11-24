// Pure model of the company settings screens (ADM-11..14): which field lives in which section and API group,
// how a protected snapshot becomes form values, and how a section becomes the PATCH calls of D-01.
// Authorization stays on the server; this only shapes the form and never decides who may write.

export const settingsSections = ["dane", "kontakt", "wyglad", "prezentacja", "prawne"] as const;
export type SettingsSection = (typeof settingsSections)[number];

export const sectionTitles: Record<SettingsSection, string> = {
  dane: "Dane firmy",
  kontakt: "Kanały kontaktu",
  wyglad: "Wygląd publiczny",
  prezentacja: "Prezentacja i SEO",
  prawne: "Treści prawne",
};

/** Page header and section card copy of the read-only admin view (ADM-11–14): trail, title, lead, card heading. */
export const sectionPages: Record<SettingsSection, { trail: string; title: string; lead: string; heading: string; description: string }> = {
  dane: {
    trail: "Dane firmy", title: "Ustawienia", lead: "Dane firmy widoczne w publicznym serwisie i kontakcie.",
    heading: "Dane firmy", description: "Te dane zasilają stopkę, stronę kontaktową i metadane organizacji.",
  },
  kontakt: {
    trail: "Kontakt", title: "Kanały kontaktu", lead: "Kolejność kanałów odpowiada publicznym akcjom kontaktowym.",
    heading: "Kanały na stronie firmy", description: "Kanał domyślny jest pierwszą akcją kontaktu; kanał bez wartości jest nieaktywny.",
  },
  wyglad: {
    trail: "Wygląd publiczny", title: "Wygląd publiczny", lead: "Logo, zdjęcia i tekst strony głównej firmy.",
    heading: "Strona główna", description: "Kolory, fonty i ikony strony publicznej są stałe.",
  },
  prezentacja: {
    trail: "Prezentacja i SEO", title: "Prezentacja i SEO", lead: "Widoczność cen, wyróżnienia i metadane publiczne.",
    heading: "Prezentacja oferty", description: "Te ustawienia wpływają na stronę główną, listę pojazdów i wyniki wyszukiwania.",
  },
  prawne: {
    trail: "Treści prawne", title: "Treści prawne", lead: "Polityka prywatności i regulamin strony firmy.",
    heading: "Treści prawne", description: "Dokument, źródło publikacji i podgląd treści.",
  },
};

export function parseSection(value: string | string[] | undefined): SettingsSection {
  const raw = Array.isArray(value) ? value[0] : value;
  return (settingsSections as readonly string[]).includes(raw ?? "") ? (raw as SettingsSection) : "dane";
}

export type SettingsGroup = "profile" | "contact" | "address" | "seo" | "legal" | "display" | "branding";

export type FieldKind = "text" | "textarea" | "phone" | "email" | "link" | "number" | "boolean" | "channel";

export type FieldDef = {
  name: string;
  group: SettingsGroup;
  label: string;
  kind: FieldKind;
  hint?: string;
  max?: number;
  required?: boolean;
};

export const fieldDefs: Record<SettingsSection, FieldDef[]> = {
  dane: [
    { name: "name", group: "profile", label: "Nazwa firmy", kind: "text", max: 120, required: true },
    { name: "publicName", group: "profile", label: "Nazwa publiczna", kind: "text", max: 120,
      hint: "Gdy puste, strona używa nazwy firmy." },
    { name: "shortDescription", group: "profile", label: "Krótki opis", kind: "textarea", max: 500 },
    { name: "serviceArea", group: "profile", label: "Obszar działania", kind: "text", max: 200 },
    { name: "addressLine", group: "address", label: "Ulica i numer", kind: "text", max: 200 },
    { name: "postalCode", group: "address", label: "Kod pocztowy", kind: "text", max: 16 },
    { name: "city", group: "address", label: "Miejscowość", kind: "text", max: 100 },
    { name: "country", group: "address", label: "Kraj", kind: "text", max: 100 },
    { name: "mapLatitude", group: "address", label: "Szerokość geograficzna mapy", kind: "number",
      hint: "Od −90 do 90. Podaj razem z długością." },
    { name: "mapLongitude", group: "address", label: "Długość geograficzna mapy", kind: "number",
      hint: "Od −180 do 180. Podaj razem z szerokością." },
    { name: "contactHours", group: "address", label: "Godziny kontaktu", kind: "textarea", max: 500 },
  ],
  kontakt: [
    { name: "phone", group: "contact", label: "Telefon", kind: "phone", hint: "Np. +48 600 100 200." },
    { name: "whatsapp", group: "contact", label: "WhatsApp", kind: "phone", hint: "Numer w formacie międzynarodowym." },
    { name: "email", group: "contact", label: "E-mail kontaktowy", kind: "email",
      hint: "Publiczny kontakt; nie jest adresem logowania administratora." },
    { name: "contactChannel", group: "contact", label: "Kanał domyślny", kind: "channel" },
  ],
  wyglad: [
    { name: "heroText", group: "branding", label: "Tekst hero na stronie głównej", kind: "textarea", max: 500,
      hint: "Zwykły tekst. Kolory, fonty i ikony są stałe i nie podlegają edycji." },
  ],
  prezentacja: [
    { name: "seoTitle", group: "seo", label: "Tytuł SEO", kind: "text", max: 120 },
    { name: "seoDescription", group: "seo", label: "Opis SEO", kind: "textarea", max: 320 },
    { name: "featuredVehicleCount", group: "display", label: "Liczba wyróżnionych pojazdów", kind: "number",
      hint: "Liczba całkowita od 0 do 12." },
    { name: "showPrices", group: "display", label: "Pokazuj ceny na stronie publicznej", kind: "boolean" },
    { name: "availabilityNotice", group: "legal", label: "Zastrzeżenie dostępności", kind: "textarea", max: 1000,
      hint: "Krótka informacja o charakterze wyniku dostępności; nie rezerwuje terminu." },
  ],
  prawne: [
    { name: "privacyText", group: "legal", label: "Polityka prywatności — treść", kind: "textarea", max: 20000 },
    { name: "privacyUrl", group: "legal", label: "Polityka prywatności — link", kind: "link",
      hint: "Adres https://. Treść ma pierwszeństwo przed linkiem." },
    { name: "termsText", group: "legal", label: "Regulamin — treść", kind: "textarea", max: 20000 },
    { name: "termsUrl", group: "legal", label: "Regulamin — link", kind: "link",
      hint: "Adres https://. Regulamin jest opcjonalny." },
  ],
};

export const channelLabels = { PHONE: "Telefon", WHATSAPP: "WhatsApp", EMAIL: "E-mail" } as const;

export type PublicMediaItem = {
  id: string;
  kind: string;
  alt: string | null;
  position?: number;
  width: number | null;
  height: number | null;
  version?: number;
};

export const mediaKinds = [
  { kind: "LOGO", title: "Logo", limit: 1, hint: "Jedno logo; nowe zastępuje poprzednie." },
  { kind: "HERO", title: "Zdjęcia hero", limit: 5, hint: "Do 5 zdjęć na stronę główną." },
  { kind: "BRAND", title: "Zdjęcia marki", limit: 12, hint: "Do 12 zdjęć firmy." },
] as const;

export type SettingsSnapshot = {
  organizationId: string;
  version: number;
  archived: boolean;
  hosts: { hostname: string; area: string; kind: string; status: string }[];
  settings: {
    profile: Record<string, unknown>;
    contact: Record<string, unknown>;
    address: Record<string, unknown>;
    seo: Record<string, unknown>;
    legal: Record<string, unknown>;
    display: Record<string, unknown>;
    branding: Record<string, unknown>;
  };
  media: PublicMediaItem[];
};

export type FormValues = Record<string, string | boolean>;

function raw(snapshot: SettingsSnapshot, field: FieldDef): unknown {
  return snapshot.settings[field.group][field.name];
}

export function valuesFor(snapshot: SettingsSnapshot, section: SettingsSection): FormValues {
  const values: FormValues = {};
  for (const field of fieldDefs[section]) {
    const value = raw(snapshot, field);
    values[field.name] = field.kind === "boolean" ? value === true : value === null || value === undefined ? "" : String(value);
  }
  return values;
}

export function displayValue(snapshot: SettingsSnapshot, field: FieldDef): string | null {
  const value = raw(snapshot, field);
  if (field.kind === "boolean") return value === true ? "Tak" : "Nie";
  if (value === null || value === undefined || value === "") return null;
  if (field.kind === "channel") return channelLabels[value as keyof typeof channelLabels] ?? String(value);
  return String(value);
}

export function isPlausiblePhone(text: string): boolean {
  const digits = text.replace(/\D/g, "");
  return /^\+?[0-9][0-9 ()-]{4,23}$/.test(text) && digits.length >= 6 && digits.length <= 15;
}

/** Same rules as the server's parseSafeLink: https only, no credentials, a dotted host without a trailing dot. */
export function isHttpsLink(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length > 2048 || /[\u0000- \u007F\\]/.test(trimmed)) return false;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }
  return url.protocol === "https:" && !url.username && !url.password && url.hostname.includes(".") && !url.hostname.endsWith(".");
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Light client checks for early feedback; the server remains the authority and repeats every rule. */
export function validate(section: SettingsSection, values: FormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fieldDefs[section]) {
    const value = values[field.name];
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (field.required && text === "") errors[field.name] = "Wpisz nazwę firmy.";
    else if (field.max && text.length > field.max) errors[field.name] = `Najwyżej ${field.max} znaków.`;
    else if (field.kind === "phone" && text !== "" && !isPlausiblePhone(text)) errors[field.name] = "Podaj poprawny numer telefonu (6–15 cyfr).";
    else if (field.kind === "email" && text !== "" && !emailPattern.test(text)) errors[field.name] = "Podaj poprawny adres e-mail.";
    else if (field.kind === "link" && text !== "" && !isHttpsLink(text)) errors[field.name] = "Podaj bezpieczny adres https:// z domeną, bez nazwy użytkownika i hasła.";
    else if (field.kind === "number" && text !== "") {
      const number = Number(text.replace(",", "."));
      if (!Number.isFinite(number)) errors[field.name] = "Podaj liczbę.";
      else if (field.name === "featuredVehicleCount" && (!Number.isInteger(number) || number < 0 || number > 12))
        errors[field.name] = "Podaj liczbę całkowitą od 0 do 12.";
      else if (field.name === "mapLatitude" && Math.abs(number) > 90) errors[field.name] = "Szerokość mieści się w zakresie od −90 do 90.";
      else if (field.name === "mapLongitude" && Math.abs(number) > 180) errors[field.name] = "Długość mieści się w zakresie od −180 do 180.";
    }
  }
  const latitude = String(values.mapLatitude ?? "").trim();
  const longitude = String(values.mapLongitude ?? "").trim();
  if (section === "dane" && (latitude === "") !== (longitude === "")) {
    errors[latitude === "" ? "mapLatitude" : "mapLongitude"] = "Podaj obie współrzędne albo żadnej.";
  }
  const channel = String(values.contactChannel ?? "");
  if (section === "kontakt" && channel) {
    const source = { PHONE: "phone", WHATSAPP: "whatsapp", EMAIL: "email" }[channel];
    if (source && String(values[source] ?? "").trim() === "") errors.contactChannel = "Kanał domyślny wymaga uzupełnionej wartości tego kanału.";
  }
  return errors;
}

export const serverErrorMessages: Record<string, string> = {
  REQUIRED: "To pole jest wymagane.",
  TOO_LONG: "Wartość jest za długa.",
  CONTROL_CHARACTERS: "Usuń znaki sterujące.",
  MARKUP_NOT_ALLOWED: "Znaczniki HTML nie są dozwolone; wpisz zwykły tekst.",
  INVALID_PHONE: "Podaj poprawny numer telefonu.",
  INVALID_EMAIL: "Podaj poprawny adres e-mail.",
  INVALID_LINK: "Podaj bezpieczny adres https:// bez danych logowania.",
  OUT_OF_RANGE: "Wartość jest poza dozwolonym zakresem.",
  INVALID_TYPE: "Nieprawidłowy typ wartości.",
  CHANNEL_VALUE_MISSING: "Kanał domyślny wymaga uzupełnionej wartości tego kanału.",
  MAP_PAIR_REQUIRED: "Podaj obie współrzędne albo żadnej.",
  NOT_WRITABLE: "Tego pola nie można zmieniać.",
  UNKNOWN_FIELD: "Nieznane pole.",
};

export function serverErrorMessage(code: string): string {
  return serverErrorMessages[code] ?? "Wartość jest nieprawidłowa.";
}

function toPayloadValue(field: FieldDef, value: string | boolean): string | number | boolean | null {
  if (field.kind === "boolean") return value === true;
  const text = String(value).trim();
  if (field.kind === "number") return text === "" ? null : Number(text.replace(",", "."));
  if (field.kind === "channel") return text === "" ? null : text;
  return text;
}

export type GroupPatch = { group: SettingsGroup; fields: Record<string, string | number | boolean | null> };

/** Only changed fields, grouped by API group in declaration order; the server validates each group atomically. */
export function changedGroups(section: SettingsSection, initial: FormValues, current: FormValues): GroupPatch[] {
  const patches = new Map<SettingsGroup, GroupPatch>();
  for (const field of fieldDefs[section]) {
    if (initial[field.name] === current[field.name]) continue;
    const patch = patches.get(field.group) ?? { group: field.group, fields: {} };
    patch.fields[field.name] = toPayloadValue(field, current[field.name]);
    patches.set(field.group, patch);
  }
  return [...patches.values()];
}

export function legalStatus(text: unknown, url: unknown): "TEXT" | "LINK" | "MISSING" {
  const present = (value: unknown) => typeof value === "string" && value.trim() !== "";
  return present(text) ? "TEXT" : present(url) ? "LINK" : "MISSING";
}

export function hasContactChannel(snapshot: SettingsSnapshot): boolean {
  const { phone, whatsapp, email } = snapshot.settings.contact;
  return [phone, whatsapp, email].some((value) => typeof value === "string" && value !== "");
}

/** crypto.randomUUID exists only in secure contexts; getRandomValues also works on plain-http fixture hosts. */
export function newEventKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
