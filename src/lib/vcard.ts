/**
 * A client-side vCard 3.0 generator — a mirror of the Rust service `services/vcard.rs`.
 *
 * Used in demo mode (browser / test mode), while in the desktop
 * serves as a fallback in case the `generate_vcard` command is unavailable.
 * The behavior is intentionally identical to the backend: CRLF, folding ≤ 74 octets,
 * escaping and normalization of +7 numbers.
 */
import type { Contact } from '@/types';

const CRLF = '\r\n';
const MAX_FIRST_LINE = 74;
const MAX_CONT_LINE = 73;

/** Escaping of vCard special characters (semicolon, comma, line break). */
export function escapeVcard(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Phone normalization: digits and a leading `+` for TEL fields. */
export function normalizePhone(phone: string): string {
  const hadPlus = phone.trimStart().startsWith('+');
  const digits = phone.replace(/\D/g, '');
  if (!digits) {
    return phone.trim();
  }
  if (hadPlus) {
    return `+${digits}`;
  }
  if (digits.length === 11 && (digits.startsWith('8') || digits.startsWith('7'))) {
    return `+7${digits.slice(1)}`;
  }
  if (digits.length === 10 && digits.startsWith('9')) {
    return `+7${digits}`;
  }
  return digits;
}

/** "Last First Middle" → components of the N field (Russian tradition). */
export function splitName(fullName: string): [last: string, first: string, middle: string] {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 3) {
    return [parts[0], parts[1], parts.slice(2).join(' ')];
  }
  if (parts.length === 2) {
    return [parts[0], parts[1], ''];
  }
  return ['', parts[0] ?? '', ''];
}

/** Folding of vCard lines to 75 octets (continuation — with a space). */
export function foldLine(line: string): string {
  if (encodedLength(line) <= MAX_FIRST_LINE) {
    return line;
  }
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;
  let budget = MAX_FIRST_LINE;
  for (const ch of line) {
    const chBytes = encodedLength(ch);
    if (currentBytes + chBytes > budget) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
      budget = MAX_CONT_LINE;
    }
    current += ch;
    currentBytes += chBytes;
  }
  if (current) {
    chunks.push(current);
  }
  return chunks.join(`${CRLF} `);
}

const encoder = new TextEncoder();

function encodedLength(value: string): number {
  return encoder.encode(value).length;
}

/** Local vCard 3.0 generation (browser mode, without a backend). */
export interface VcardOptions {
  /** Enterprise mode: the external IP telephony number instead of the internal one. */
  preferExternalPhone?: boolean;
}

export function generateVcard(contact: Contact, options: VcardOptions = {}): string {
  const lines: string[] = ['BEGIN:VCARD', 'VERSION:3.0'];

  if (contact.id && !contact.id.startsWith('dn:')) {
    lines.push(`UID:${contact.id}`);
  }

  const fullName = contact.fullName.trim();
  lines.push(`FN:${escapeVcard(fullName)}`);
  const [last, first, middle] = splitName(fullName);
  lines.push(`N:${escapeVcard(last)};${escapeVcard(first)};${escapeVcard(middle)};;`);

  const organization = contact.organization?.trim() ?? '';
  const department = contact.department?.trim() ?? '';
  if (organization || department) {
    lines.push(`ORG:${escapeVcard(organization)};${escapeVcard(department)}`);
  }
  if (contact.jobTitle?.trim()) {
    lines.push(`TITLE:${escapeVcard(contact.jobTitle.trim())}`);
  }
  // The mobile first: client phones (e.g. Samsung) take the first
  // TEL as the primary contact number; the corporate one stays second.
  if (contact.mobilePhone?.trim()) {
    lines.push(`TEL;TYPE=CELL:${escapeVcard(normalizePhone(contact.mobilePhone))}`);
  }
  // Enterprise mode: ONLY the external number, the internal one is not substituted
  // even as a fallback (the short number is not dialable from outside).
  const workPhone = options.preferExternalPhone ? contact.fullIpPhone?.trim() : contact.ipPhone?.trim();
  if (workPhone) {
    lines.push(`TEL;TYPE=WORK,VOICE:${escapeVcard(normalizePhone(workPhone))}`);
  }
  if (contact.email?.trim()) {
    lines.push(`EMAIL;TYPE=INTERNET:${escapeVcard(contact.email.trim())}`);
  }
  lines.push('END:VCARD');

  return lines.map(foldLine).join(CRLF);
}
