import { Component, signal, type OnDestroy } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { PreferencesSchema } from '@klaro/contracts';
import { ApiOperationClient, ApiReferenceClient, EditorSession, WorkspaceShellComponent, ProcessingConsent, ProcessingConsentComponent, ProcessingDetailsComponent } from '@klaro/editor';
import { UK_UI, type Language } from '@klaro/language-profiles';
import { ExtensionAuth } from './auth';
import { browserIdentity } from './identity-port';
import { BACKEND_ORIGIN } from './config';
import { PanelLifecycle, observePanelClose } from './lifecycle';

@Component({
  selector: 'klaro-root',
  imports: [WorkspaceShellComponent, MatButtonModule, ProcessingConsentComponent, ProcessingDetailsComponent],
  template: '@if (auth) { <header>@if (signedIn()) { <button matButton (click)="signOut()">{{ labels.signOut }}</button> } @else { <button matButton (click)="signIn()" [disabled]="busy()">{{ labels.signIn }}</button> }<p role="status">{{ status() }}</p></header> }<klaro-processing-consent [consent]="consent" [revision]="consentRevision()" /><details><summary>Приватність</summary><button matButton (click)="loadPrivacy()">Показати налаштування обробки</button><klaro-processing-details [disclosure]="consent.disclosure" /></details><aside [attr.aria-label]="labels.shortcutSettings"><p>{{ labels.shortcutSettings }} <code>{{ shortcutSettings }}</code></p></aside><klaro-workspace-shell [session]="session" [port]="operations" [referencePort]="reference" surface="panel" [disabled]="busy() || !signedIn()" (languageChange)="switchLanguage($event)" />',
})
class AppComponent implements OnDestroy {
  readonly labels = UK_UI;
  readonly shortcutSettings = this.browserShortcutSettings();
  readonly busy = signal(false);
  readonly signedIn = signal(false);
  readonly status = signal('');
  readonly auth: ExtensionAuth | undefined;
  readonly session = new EditorSession();
  readonly operations = new ApiOperationClient(BACKEND_ORIGIN, () => ({ Authorization: this.auth?.authorization() ?? '' }));
  readonly reference = new ApiReferenceClient(BACKEND_ORIGIN, () => ({ Authorization: this.auth?.authorization() ?? '' }));
  readonly consentRevision = signal(0);
  readonly consent = new ProcessingConsent(BACKEND_ORIGIN, () => this.consentRevision.update(value => value + 1));
  async loadPrivacy(): Promise<void> { const { ProcessingDisclosureSchema } = await import('@klaro/contracts'); try { const response = await fetch(`${BACKEND_ORIGIN}/v1/privacy/processing`, { cache: 'no-store', credentials: 'omit' }); if (!response.ok) throw new Error('Unavailable'); this.consent.disclosure = ProcessingDisclosureSchema.parse(await response.json()); this.consentRevision.update(value => value + 1); } catch { this.status.set('Не вдалося завантажити налаштування обробки.'); } }
  private readonly lifecycle: PanelLifecycle;
  private removeCloseListener: () => void = () => {};
  private generation = 0;
  private readonly pageHidden = () => this.lifecycle.close();

  private browserShortcutSettings(): string {
    const browser = (globalThis as typeof globalThis & { KLARO_BROWSER?: string }).KLARO_BROWSER;
    if (browser === 'firefox') return this.labels.firefoxShortcutSettings;
    return browser === 'edge' ? 'edge://extensions/shortcuts' : 'chrome://extensions/shortcuts';
  }

  constructor() {
    this.operations.authorize = signal => this.consent.authorize(signal);
    const identity = browserIdentity();
    // The backend origin is packaged configuration, never remote executable code.
    this.auth = identity ? new ExtensionAuth(identity, BACKEND_ORIGIN) : undefined;
    this.lifecycle = new PanelLifecycle({ clearText: () => { this.consent.reset(); this.session.clear(); }, disposeOperations: () => (this.operations.dispose(), this.reference.suspend()), clearAuthentication: () => this.auth?.dispose(), notifyClosed: () => { this.generation++; this.signedIn.set(false); this.busy.set(false); } });
    window.addEventListener('pagehide', this.pageHidden, { once: true });
    void observePanelClose(() => this.lifecycle.close()).then(remove => { if (this.lifecycle.closed) remove(); else this.removeCloseListener = remove; }).catch(() => {});
  }

  ngOnDestroy(): void { this.lifecycle.close(); this.removeCloseListener(); window.removeEventListener('pagehide', this.pageHidden); }

  async signIn(): Promise<void> {
    if (this.lifecycle.closed) return;
    const generation = ++this.generation;
    this.busy.set(true);
    this.status.set('');
    try {
      await this.auth?.signIn();
      if (generation !== this.generation) return;
      const authorization = this.auth?.authorization();
      if (authorization) {
        const response = await fetch(`${BACKEND_ORIGIN}/v1/me/preferences`, { headers: { Authorization: authorization }, credentials: 'omit', cache: 'no-store' });
        if (!response.ok) throw new Error('Preferences unavailable');
        const preferences = PreferencesSchema.parse(await response.json());
        if (generation !== this.generation) return;
        this.session.setPreferences(preferences);
      }
      this.signedIn.set(Boolean(authorization));
    } catch { if (generation === this.generation) this.status.set(this.labels.authFailed); }
    finally { if (generation === this.generation) this.busy.set(false); }
  }

  async switchLanguage(language: Language): Promise<void> {
    const generation = this.generation;
    const previous = structuredClone(this.session.preferences);
    const updated = { ...previous, activeWritingLanguage: language };
    const authorization = this.auth?.authorization();
    if (!authorization || this.busy()) return;
    this.busy.set(true);
    this.session.setPreferences(updated);
    try {
      const response = await fetch(`${BACKEND_ORIGIN}/v1/me/preferences`, { method: 'PUT', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(updated), credentials: 'omit', cache: 'no-store' });
      if (!response.ok) throw new Error('Preferences unavailable');
      const preferences = PreferencesSchema.parse(await response.json());
      if (generation === this.generation) this.session.setPreferences(preferences);
    } catch { if (generation === this.generation) { this.session.setPreferences(previous); this.status.set(this.labels.saveFailed); } }
    finally { if (generation === this.generation) this.busy.set(false); }
  }

  async signOut(): Promise<void> {
    this.generation++;
    this.signedIn.set(false);
    this.busy.set(false);
    this.consent.reset(); this.operations.suspend(); this.reference.suspend();
    this.session.clear();
    await this.auth?.signOut();
  }
}

bootstrapApplication(AppComponent).catch(() => {
  console.error('Application bootstrap failed');
});
