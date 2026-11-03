// The people sheet's query key (components/PeopleSheet.tsx), apart from the
// component so the rating flow can invalidate it without importing the sheet.
// The same key web uses (frontend/src/lib/peopleSheet.ts).
export const PEOPLE_SHEET_KEY = ['people-sheet'] as const
