import { Injectable, signal } from '@angular/core';
import { DEFAULT_PREFERENCES, PreferencesSchema, UsageSummarySchema, type Preferences, type UsageSummary } from '@klaro/contracts';
import { EditorSession } from '@klaro/editor/session';
import { ApiReferenceClient } from '@klaro/editor/reference-client';
import { ApiOperationClient } from '@klaro/editor/api-client';
import { ProcessingConsent } from '@klaro/editor/processing-consent';
import { UK_UI } from '@klaro/language-profiles';

function csrfToken(): string {
  const names = ['__Host-klaro_csrf', 'klaro_csrf'];
  for (const name of names) {
    const cookie = document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`));
    if (cookie) return cookie.slice(name.length + 1);
  }
  return '';
}

@Injectable({ providedIn: 'root' })
export class AccountStore {
  readonly userId = signal<string | undefined>(undefined);
  readonly preferences = signal<Preferences>(structuredClone(DEFAULT_PREFERENCES));
  readonly busy = signal(false);
  readonly status = signal('');
  readonly session = new EditorSession();
  readonly operations = new ApiOperationClient('', () => ({ 'X-CSRF-Token': csrfToken() }));
  readonly reference = new ApiReferenceClient('', () => ({ 'X-CSRF-Token': csrfToken() }));
  readonly usage = signal<UsageSummary | undefined>(undefined);
  readonly usageStatus = signal('');
  readonly consentRevision = signal(0);
  readonly consent = new ProcessingConsent('', () => this.consentRevision.update(value => value + 1));
  constructor() { this.operations.authorize = signal => this.consent.authorize(signal); }
  private generation = 0;

  async loadUsage(): Promise<void> {
    if (!this.userId()) return;
    const generation = this.generation;
    try {
      const response = await fetch('/v1/me/usage', { cache: 'no-store' });
      if (!response.ok) throw new Error('Usage unavailable');
      const summary = UsageSummarySchema.parse(await response.json());
      if (generation === this.generation && this.userId()) { this.usage.set(summary); this.usageStatus.set(''); }
    } catch { if (generation === this.generation && this.userId()) this.usageStatus.set(UK_UI.usageFailed); }
  }

  async reload(): Promise<void> {
    const generation = ++this.generation;
    try {
      const session = await fetch('/auth/session', { cache: 'no-store' });
      if (generation !== this.generation) return;
      if (!session.ok) { this.consent.reset(); this.operations.suspend(); this.reference.suspend(); this.session.clear(); this.usage.set(undefined); this.userId.set(undefined); return; }
      const identity: unknown = await session.json();
      if (!identity || typeof identity !== 'object' || !('userId' in identity) || typeof identity.userId !== 'string') throw new Error('Invalid identity');
      const response = await fetch('/v1/me/preferences', { cache: 'no-store' });
      if (!response.ok) throw new Error('Preferences unavailable');
      const preferences = PreferencesSchema.parse(await response.json());
      if (generation !== this.generation) return;
      if (this.userId() && this.userId() !== identity.userId) { this.consent.reset(); this.operations.suspend(); this.reference.suspend(); this.session.clear(); this.usage.set(undefined); }
      this.userId.set(identity.userId);
      this.preferences.set(preferences);
      this.session.setPreferences(preferences);
    } catch { if (generation === this.generation) this.status.set(UK_UI.authFailed); }
  }

  async save(preferences: Preferences): Promise<boolean> {
    if (!this.userId()) { this.status.set(UK_UI.signInRequired); return false; }
    if (this.busy()) return false;
    const generation = this.generation;
    this.busy.set(true);
    this.status.set('');
    try {
      const value = PreferencesSchema.parse(preferences);
      this.session.setPreferences(value);
      const response = await fetch('/v1/me/preferences', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() }, body: JSON.stringify(value), cache: 'no-store' });
      if (!response.ok) throw new Error('Save failed');
      const stored = PreferencesSchema.parse(await response.json());
      if (generation !== this.generation) return false;
      this.preferences.set(stored);
      this.session.setPreferences(stored);
      this.status.set(UK_UI.saved);
      return true;
    } catch { if (generation === this.generation) { this.session.setPreferences(this.preferences()); this.status.set(UK_UI.saveFailed); } return false; }
    finally { if (generation === this.generation) this.busy.set(false); }
  }

  async exportData(): Promise<void> {
    if (!this.userId() || this.busy()) return;
    this.busy.set(true); const generation = this.generation;
    try {
      const response = await fetch('/v1/me/export', { cache: 'no-store' }); if (!response.ok) throw new Error('Export unavailable');
      const data = await response.blob(); if (generation !== this.generation) return;
      const url = URL.createObjectURL(data); const link = document.createElement('a'); link.href = url; link.download = 'klaro-account.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { if (generation === this.generation) this.status.set('Не вдалося експортувати дані.'); }
    finally { if (generation === this.generation) this.busy.set(false); }
  }
  async deleteAccount(confirmation: string): Promise<void> {
    if (!this.userId() || this.busy() || confirmation !== 'DELETE') return;
    this.busy.set(true);
    try {
      const response = await fetch('/v1/me/account', { method: 'DELETE', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() }, body: JSON.stringify({ confirmation }), cache: 'no-store' });
      if (!response.ok) throw new Error('Deletion unavailable');
      this.generation++; this.consent.reset(); this.operations.suspend(); this.reference.suspend(); this.session.clear(); this.userId.set(undefined); this.usage.set(undefined);
      this.status.set('Акаунт недоступний, сесії відкликано. Активні дані очищаються до 7 днів, резервні копії — до 30 днів.');
    } catch { this.status.set('Не вдалося підтвердити видалення.'); } finally { this.busy.set(false); }
  }

  async signOut(): Promise<void> {
    this.generation++; this.usage.set(undefined); this.usageStatus.set('');
    this.consent.reset(); this.operations.suspend(); this.reference.suspend(); this.busy.set(false);
    this.session.clear();
    this.userId.set(undefined);
    const response = await fetch('/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken() }, cache: 'no-store' }).catch(() => undefined);
    if (!response?.ok) this.status.set(UK_UI.authFailed);
  }
}
