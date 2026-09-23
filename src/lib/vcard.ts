/**
 * Клиентский генератор vCard 3.0 — зеркало Rust-сервиса `services/vcard.rs`.
 *
 * Используется в демо-режиме (браузер / тестовый режим), а в десктопе
 * служит fallback на случай недоступности команды `generate_vcard`.
 * Поведение намеренно идентично бэкенду: CRLF, folding ≤ 74 октет,
 * экранирование и нормализация номеров +7.
 */
import type { Contact } from '@/types';

const CRLF = '\r\n';
const MAX_FIRST_LINE = 74;
const MAX_CONT_LINE = 73;

/** Экранирование спецсимволов vCard (точка с запятой, запятая, перенос). */
export function escapeVcard(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Нормализация телефона: цифры и ведущий `+` для полей TEL. */
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

/** «Фамилия Имя Отчество» → компоненты поля N (русская традиция). */
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

/** Фолдинг строк vCard по 75 октетов (продолжение — пробелом). */
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

/** Локальная генерация vCard 3.0 (браузерный режим, без бэкенда). */
export interface VcardOptions {
  /** Режим предприятия: внешний номер IP-телефонии вместо внутреннего. */
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
  // Мобильный — первым: телефоны-клиенты (например, Samsung) берут первый
  // TEL как основной номер контакта; корпоративный остаётся вторым.
  if (contact.mobilePhone?.trim()) {
    lines.push(`TEL;TYPE=CELL:${escapeVcard(normalizePhone(contact.mobilePhone))}`);
  }
  // Режим предприятия: ТОЛЬКО внешний номер, внутренний не подставляется
  // даже как фолбэк (короткий номер снаружи ненабираем).
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
