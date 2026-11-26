import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { vcardApi } from '@/api/directory';
import { devLog } from '@/lib/devlog';
import { personNameForLanguage } from '@/lib/transliteration';
import { generateVcard } from '@/lib/vcard';
import { getContactsService, isMockMode } from '@/services/ContactsService';
import { useAppStore } from '@/store/useAppStore';
import type { Contact } from '@/types';

/** Contact card: a point selection by id (faster and more precise than searching the list). */
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
 * Avatar photo for the open card, fetched lazily as a `data:` URL.
 * Returns `null` when the contact has no AD photo (letter avatar fallback).
 * Kept out of the search payload so only the visible card loads an image.
 */
export function useContactPhoto(id: string | null) {
  const testMode = useAppStore((state) => state.testMode);
  const showAvatars = useAppStore((state) => state.showAvatars);
  return useQuery({
    queryKey: ['contact-photo', id, testMode],
    queryFn: () => getContactsService().getPhoto(id as string),
    // Do not request AD photos while avatars are disabled.
    enabled: Boolean(id) && showAvatars,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/**
 * vCard for the QR code: in the desktop Rust generates it (a single canonical
 * format); in demo mode — a local generator; if the command fails
 * a local fallback is used.
 */
export function useVcard(contact: Contact | null | undefined): string {
  const { i18n } = useTranslation();
  const [vcard, setVcard] = useState('');
  const displayName = contact ? personNameForLanguage(contact.fullName, i18n.language) : '';
  // The enterprise tab of the non-global version: the QR substitutes the external
  // IP telephony number (the internal one is not dialable from outside). In the global
  // version and on the other tabs - normal behavior.
  const activeTab = useAppStore((state) => state.activeTab);
  const preferExternalPhone = activeTab === 'kmaruda';

  useEffect(() => {
    if (!contact) {
      setVcard('');
      return;
    }

    const vcardContact = { ...contact, fullName: displayName };
    const fallback = generateVcard(vcardContact, { preferExternalPhone });
    devLog('vcard', {
      mode: activeTab,
      preferExternalPhone,
      ipPhone: contact.ipPhone ?? null,
      phoneExternal: contact.fullIpPhone ?? null,
      mock: isMockMode(),
    });
    if (isMockMode()) {
      setVcard(fallback);
      return;
    }

    let cancelled = false;
    vcardApi
      .generate({
        id: contact.id,
        fullName: displayName,
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
        console.warn('[vcard] backend unavailable, using local generator', error);
        if (!cancelled) {
          setVcard(fallback);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [contact, displayName, preferExternalPhone]);

  return vcard;
}
