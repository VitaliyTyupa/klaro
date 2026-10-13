import { ChangeDetectorRef, Component, effect, inject, type OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatCardModule } from '@angular/material/card';
import { ProcessingDisclosureSchema, type ProcessingDisclosure, PreferencesSchema, type Preferences } from '@klaro/contracts';
import { WorkspaceShellComponent, ProcessingDetailsComponent } from '@klaro/editor';
import { ReferenceComponent } from '@klaro/editor/reference';
import { SUPPORTED_LANGUAGES, UK_UI, type Language } from '@klaro/language-profiles';
import { AccountStore } from './account';

@Component({
  selector: 'klaro-editor-page',
  imports: [WorkspaceShellComponent],
  template: '<klaro-workspace-shell [session]="account.session" [port]="account.operations" [referencePort]="account.reference" [disabled]="account.busy() || !account.userId()" (languageChange)="switchLanguage($event)" />',
})
export class EditorPageComponent implements OnDestroy {
  readonly account = inject(AccountStore);
  switchLanguage(language: Language): void { void this.account.save({ ...this.account.preferences(), activeWritingLanguage: language }); }
  ngOnDestroy(): void { this.account.session.clear(); }
}

@Component({
  selector: 'klaro-profile-page',
  imports: [MatCardModule, MatButtonModule, RouterLink, FormsModule],
  template: '<main><mat-card><mat-card-header><mat-card-title>{{ labels.profile }}</mat-card-title></mat-card-header><mat-card-content>@if (account.userId(); as userId) { <p>{{ labels.userId }}: {{ userId }}</p><p>{{ labels.nativeLanguage }}: {{ labels.languages[account.preferences().nativeLanguage] }}</p><p>{{ labels.writingLanguage }}: {{ labels.languages[account.preferences().activeWritingLanguage] }}</p><a matButton routerLink="/settings">{{ labels.settings }}</a><h2>Дані акаунта</h2><button matButton (click)="account.exportData()" [disabled]="account.busy()">Експортувати дані</button><details><summary>Видалити акаунт</summary><p>Сесії буде відкликано негайно. Очищення активних даних — до 7 днів; резервних копій — до 30 днів. Введіть DELETE для повторного підтвердження.</p><label>Підтвердження видалення <input [(ngModel)]="deletionConfirmation" autocomplete="off" /></label><button matButton (click)="account.deleteAccount(deletionConfirmation)" [disabled]="deletionConfirmation !== \'DELETE\' || account.busy()">Підтвердити видалення акаунта</button></details><h2>{{ labels.usage }}</h2><button matButton (click)="account.loadUsage()">{{ labels.refresh }}</button>@if (account.usage(); as usage) { <p>{{ usage.day }}</p><dl><dt>{{ labels.operations }}</dt><dd>{{ usage.operations }}</dd><dt>{{ labels.providerAttempts }}</dt><dd>{{ usage.providerAttempts }}</dd><dt>{{ labels.actualTokens }}</dt><dd>{{ usage.actual.inputTokens }} / {{ usage.actual.outputTokens }}</dd><dt>{{ labels.estimatedTokens }}</dt><dd>{{ usage.estimated.inputTokens }} / {{ usage.estimated.outputTokens }}</dd><dt>{{ labels.heldTokens }}</dt><dd>{{ usage.heldTokens }}</dd></dl> }<p role="status">{{ account.usageStatus() }}</p> } @else { <p>{{ labels.signInRequired }}</p> }</mat-card-content></mat-card></main>',
})
export class ProfilePageComponent {
  deletionConfirmation = '';
  readonly account = inject(AccountStore);
  readonly labels = UK_UI;
  constructor() { effect(() => { if (this.account.userId()) void this.account.loadUsage(); }); }
}

@Component({
  selector: 'klaro-settings-page',
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatSelectModule, MatCardModule],
  template: '<main><mat-card><mat-card-header><mat-card-title>{{ labels.settings }}</mat-card-title></mat-card-header><mat-card-content>@if (account.userId()) { <form (ngSubmit)="save()"><mat-form-field><mat-label>{{ labels.nativeLanguage }}</mat-label><mat-select name="nativeLanguage" [ngModel]="draft.nativeLanguage" (ngModelChange)="changeNative($event)" [disabled]="account.busy()">@for (language of languages; track language) { <mat-option [value]="language">{{ labels.languages[language] }}</mat-option> }</mat-select></mat-form-field><mat-form-field><mat-label>{{ labels.writingLanguages }}</mat-label><mat-select name="writingLanguages" multiple [(ngModel)]="draft.writingLanguages" [disabled]="account.busy()">@for (language of availableWritingLanguages(); track language) { <mat-option [value]="language">{{ labels.languages[language] }}</mat-option> }</mat-select></mat-form-field><mat-form-field><mat-label>{{ labels.writingLanguage }}</mat-label><mat-select name="activeWritingLanguage" [(ngModel)]="draft.activeWritingLanguage" [disabled]="account.busy()">@for (language of draft.writingLanguages; track language) { <mat-option [value]="language">{{ labels.languages[language] }}</mat-option> }</mat-select></mat-form-field><mat-form-field><mat-label>{{ labels.style }}</mat-label><mat-select name="style" [(ngModel)]="draft.style" [disabled]="account.busy()"><mat-option value="neutral">{{ labels.styles.neutral }}</mat-option><mat-option value="formal">{{ labels.styles.formal }}</mat-option></mat-select></mat-form-field><mat-form-field><mat-label>{{ labels.proficiency }}</mat-label><mat-select name="proficiency" [(ngModel)]="draft.proficiency" [disabled]="account.busy()"><mat-option [value]="null">{{ labels.unspecified }}</mat-option>@for (level of levels; track level) { <mat-option [value]="level">{{ level }}</mat-option> }</mat-select></mat-form-field>@if (!valid()) { <p role="status">{{ labels.chooseWritingLanguage }}</p> }<button matButton type="submit" [disabled]="!valid() || account.busy()">{{ labels.save }}</button></form> } @else { <p>{{ labels.signInRequired }}</p> }</mat-card-content></mat-card></main>',
  styles: ['mat-form-field { display: block; }'],
})
export class SettingsPageComponent {
  readonly account = inject(AccountStore);
  readonly labels = UK_UI;
  readonly languages = SUPPORTED_LANGUAGES;
  readonly levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  draft: Preferences = structuredClone(this.account.preferences());

  constructor() { effect(() => { this.draft = structuredClone(this.account.preferences()); }); }

  availableWritingLanguages(): Language[] { return this.languages.filter(language => language !== this.draft.nativeLanguage); }
  changeNative(language: Language): void {
    this.draft.nativeLanguage = language;
    this.draft.writingLanguages = this.draft.writingLanguages.filter(writing => writing !== language);
  }
  valid(): boolean { return PreferencesSchema.safeParse(this.draft).success; }
  async save(): Promise<void> { if (await this.account.save(this.draft)) this.draft = structuredClone(this.account.preferences()); }
}

@Component({ selector: 'klaro-reference-page', imports: [ReferenceComponent], template: '<main><klaro-reference [port]="account.reference" [operations]="account.operations" [preferences]="account.preferences()" [disabled]="!account.userId()" /></main>' })
export class ReferencePageComponent { readonly account = inject(AccountStore); }

@Component({ selector: 'klaro-privacy-page', imports: [ProcessingDetailsComponent], template: '<main><h1>Приватність</h1><klaro-processing-details [disclosure]="disclosure" /><p role="status">{{ status }}</p></main>' })
export class PrivacyPageComponent {
  disclosure: ProcessingDisclosure | undefined;
  status = '';
  private readonly changes = inject(ChangeDetectorRef);
  constructor() { void fetch('/v1/privacy/processing', { cache: 'no-store' }).then(async response => { if (!response.ok) throw new Error('Unavailable'); this.disclosure = ProcessingDisclosureSchema.parse(await response.json()); }).catch(() => { this.status = 'Не вдалося завантажити фактичні налаштування обробки.'; }).finally(() => this.changes.markForCheck()); }
}
