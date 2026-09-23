import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { vcardApi } from '@/api/directory';
import { devLog } from '@/lib/devlog';
import { generateVcard } from '@/lib/vcard';
import { getContactsService, isMockMode } from '@/services/ContactsService';
import { useAppStore } from '@/store/useAppStore';
import type { Contact } from '@/types';

/** Карточка контакта: точечная выборка по id (быстрее и точнее поиска по списку). */
export function useContact(id: string | null) {
  const testMode = useAppStore((state) => state.testMode);
  return useQuery({
    queryKey: ['contact', id, testMode],
    queryFn: () => getContactsService().getById(id as string),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

/**
 * vCard для QR-кода: в десктопе генерирует Rust (единый канонический
 * формат), в демо-режиме — локальный генератор; при сбое команды
 * используется локальный fallback.
 */
export function useVcard(contact: Contact | null | undefined): string {
  const [vcard, setVcard] = useState('');
  // Вкладка предприятия не глобальной версии: в QR подставляется внешний
  // номер IP-телефонии (внутренний снаружи ненабираем). В глобальной
  // версии и на остальных вкладках — обычное поведение.
  const activeTab = useAppStore((state) => state.activeTab);
  const preferExternalPhone = activeTab === 'kmaruda';

  useEffect(() => {
    if (!contact) {
      setVcard('');
      return;
    }

    const fallback = generateVcard(contact, { preferExternalPhone });
    if (isMockMode()) {
      setVcard(fallback);
      return;
    }

    devLog('vcard', {
      mode: activeTab,
      preferExternalPhone,
      ipPhone: contact.ipPhone ?? null,
      phoneExternal: contact.fullIpPhone ?? null,
    });

    let cancelled = false;
    vcardApi
      .generate({
        id: contact.id,
        fullName: contact.fullName,
        organization: contact.organization ?? null,
        department: contact.department ?? null,
        jobTitle: contact.jobTitle ?? null,
        mobilePhone: contact.mobilePhone ?? null,
        ipPhone: contact.ipPhone ?? null,
        phoneExternal: contact.fullIpPhone ?? null,
        preferExternalPhone,
        email: contact.email ?? null,
      })
      .then((value) => {
        if (!cancelled) {
          setVcard(value);
        }
      })
      .catch((error) => {
        console.warn('[vcard] бэкенд недоступен, использую локальный генератор', error);
        if (!cancelled) {
          setVcard(fallback);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [contact, preferExternalPhone]);

  return vcard;
}
