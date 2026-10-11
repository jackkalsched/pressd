// Reading the address book for "find friends from your contacts".
//
// Only names and phone numbers are read, and only the numbers leave the
// phone: they go to POST /users/me/contacts/match, which hashes each one in
// memory, compares it against numbers people have verified, and keeps nothing
// (backend/routers/users.py). Phone only, never email — a number is what people
// agreed to be found by when they added theirs.
//
// The legacy entry point because it reads every contact's numbers in one call,
// which is all this needs; the new object API fetches per contact.
import * as Contacts from 'expo-contacts/legacy'
import { toE164 } from '@pressd/shared/api'

export type ContactsAccess = 'undetermined' | 'denied' | 'granted'

export interface AddressBookEntry {
  id: string
  name: string
  /** E.164, deduplicated, in the contact's own order. */
  numbers: string[]
  /** As the contact stores them, for addressing an invite text. */
  rawNumbers: string[]
}

export async function contactsAccess(): Promise<ContactsAccess> {
  const { status } = await Contacts.getPermissionsAsync()
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined'
}

export async function requestContactsAccess(): Promise<ContactsAccess> {
  const { status } = await Contacts.requestPermissionsAsync()
  return status === 'granted' ? 'granted' : 'denied'
}

/** Everyone in the address book with at least one usable number, by name.
 *  A number without a country code is read as US (toE164). */
export async function readAddressBook(): Promise<AddressBookEntry[]> {
  const { data } = await Contacts.getContactsAsync({
    fields: [Contacts.Fields.Name, Contacts.Fields.FirstName, Contacts.Fields.LastName, Contacts.Fields.PhoneNumbers],
    sort: Contacts.SortTypes.FirstName,
  })
  const out: AddressBookEntry[] = []
  for (const c of data) {
    const raw = (c.phoneNumbers ?? []).map((p) => p.number ?? p.digits ?? '').filter(Boolean)
    const numbers = [...new Set(raw.map(toE164).filter((n): n is string => !!n))]
    if (numbers.length === 0) continue
    const name = c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || raw[0]
    out.push({ id: c.id ?? name, name, numbers, rawNumbers: raw })
  }
  return out
}
