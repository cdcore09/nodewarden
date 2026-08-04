// NodeWarden Next (issue #16, slice 3): data-driven field groups for the
// non-login editor types. Keys map onto the flat VaultDraft; the test suite
// asserts every key exists on createEmptyDraft(type). Labels are fork-local
// strings (skin-feature precedent). Login (1) is hand-built in EditorPanel;
// secure note (2) uses common fields + notes; SSH (5) stays a classic bridge.

import type { VaultDraft } from '../../lib/types';

export interface EditorField {
  key: keyof VaultDraft;
  label: string;
  mono?: boolean;
  textarea?: boolean;
}

export const FIELD_GROUPS: Record<number, EditorField[]> = {
  3: [
    { key: 'cardholderName', label: 'Cardholder name' },
    { key: 'cardNumber', label: 'Card number', mono: true },
    { key: 'cardBrand', label: 'Brand' },
    { key: 'cardExpMonth', label: 'Expiry month', mono: true },
    { key: 'cardExpYear', label: 'Expiry year', mono: true },
    { key: 'cardCode', label: 'Security code', mono: true },
  ],
  4: [
    { key: 'identFirstName', label: 'First name' },
    { key: 'identLastName', label: 'Last name' },
    { key: 'identUsername', label: 'Username', mono: true },
    { key: 'identCompany', label: 'Company' },
    { key: 'identEmail', label: 'Email', mono: true },
    { key: 'identPhone', label: 'Phone', mono: true },
    { key: 'identSsn', label: 'SSN', mono: true },
    { key: 'identAddress1', label: 'Address' },
    { key: 'identCity', label: 'City' },
    { key: 'identState', label: 'State' },
    { key: 'identPostalCode', label: 'Postal code', mono: true },
    { key: 'identCountry', label: 'Country' },
  ],
  6: [
    { key: 'bankName', label: 'Bank name' },
    { key: 'bankNameOnAccount', label: 'Name on account' },
    { key: 'bankAccountType', label: 'Account type' },
    { key: 'bankAccountNumber', label: 'Account number', mono: true },
    { key: 'bankRoutingNumber', label: 'Routing number', mono: true },
    { key: 'bankPin', label: 'PIN', mono: true },
    { key: 'bankSwiftCode', label: 'SWIFT', mono: true },
    { key: 'bankIban', label: 'IBAN', mono: true },
  ],
  7: [
    { key: 'licenseFirstName', label: 'First name' },
    { key: 'licenseLastName', label: 'Last name' },
    { key: 'licenseNumber', label: 'License number', mono: true },
    { key: 'licenseDateOfBirth', label: 'Date of birth', mono: true },
    { key: 'licenseIssuingState', label: 'Issuing state' },
    { key: 'licenseIssueDate', label: 'Issue date', mono: true },
    { key: 'licenseExpirationDate', label: 'Expiration date', mono: true },
    { key: 'licenseClass', label: 'Class' },
  ],
  5: [
    { key: 'sshPublicKey', label: 'Public key', mono: true, textarea: true },
    { key: 'sshPrivateKey', label: 'Private key', mono: true, textarea: true },
    { key: 'sshFingerprint', label: 'Fingerprint', mono: true },
  ],
  8: [
    { key: 'passportSurname', label: 'Surname' },
    { key: 'passportGivenName', label: 'Given name' },
    { key: 'passportNumber', label: 'Passport number', mono: true },
    { key: 'passportNationality', label: 'Nationality' },
    { key: 'passportDateOfBirth', label: 'Date of birth', mono: true },
    { key: 'passportIssuingCountry', label: 'Issuing country' },
    { key: 'passportIssueDate', label: 'Issue date', mono: true },
    { key: 'passportExpirationDate', label: 'Expiration date', mono: true },
  ],
};
