import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { type Preferences } from '@klaro/contracts';
import { UK_UI, type Language } from '@klaro/language-profiles';

@Component({
  selector: 'klaro-language-selector',
  imports: [MatFormFieldModule, MatSelectModule],
  template: '<mat-form-field><mat-label>{{ labels.writingLanguage }}</mat-label><mat-select [value]="preferences.activeWritingLanguage" (selectionChange)="languageChange.emit($event.value)" [disabled]="disabled">@for (language of preferences.writingLanguages; track language) { <mat-option [value]="language">{{ labels.languages[language] }}</mat-option> }</mat-select></mat-form-field>',
})
export class LanguageSelectorComponent {
  @Input({ required: true }) preferences!: Preferences;
  @Input() disabled = false;
  @Output() readonly languageChange = new EventEmitter<Language>();
  readonly labels = UK_UI;
}
