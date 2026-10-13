import { Component, inject } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, RouterLink, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { UK_UI } from '@klaro/language-profiles';
import { ProcessingConsentComponent } from '@klaro/editor/privacy';
import { AccountStore } from './account';

@Component({
  selector: 'klaro-root',
  imports: [RouterOutlet, RouterLink, MatButtonModule, ProcessingConsentComponent],
  template: '<header><nav [attr.aria-label]="labels.title"><a matButton routerLink="/">{{ labels.editor }}</a><a matButton routerLink="/reference">Довідник</a><a matButton routerLink="/profile">{{ labels.profile }}</a><a matButton routerLink="/privacy">Приватність</a><a matButton routerLink="/settings">{{ labels.settings }}</a>@if (account.userId()) { <button matButton (click)="account.signOut()">{{ labels.signOut }}</button> } @else { <a matButton href="/auth/login">{{ labels.signIn }}</a> }</nav><p role="status">{{ account.status() }}</p></header><klaro-processing-consent [consent]="account.consent" [revision]="account.consentRevision()" /><router-outlet />',
  styles: ['header { padding: 8px 16px; } nav { display: flex; flex-wrap: wrap; gap: 8px; }'],
})
class AppComponent {
  readonly labels = UK_UI;
  readonly account = inject(AccountStore);
  constructor() { void this.account.reload(); }
}

bootstrapApplication(AppComponent, { providers: [provideRouter([{ path: '', loadComponent: () => import('./pages').then(module => module.EditorPageComponent) }, { path: 'reference', loadComponent: () => import('./pages').then(module => module.ReferencePageComponent) }, { path: 'profile', loadComponent: () => import('./pages').then(module => module.ProfilePageComponent) }, { path: 'settings', loadComponent: () => import('./pages').then(module => module.SettingsPageComponent) }, { path: 'privacy', loadComponent: () => import('./pages').then(module => module.PrivacyPageComponent) }, { path: '**', redirectTo: '' }])] }).catch(() => {
  console.error('Application bootstrap failed');
});
