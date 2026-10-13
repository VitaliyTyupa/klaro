import { ChangeDetectorRef, Component, Input, inject, type OnChanges, type OnDestroy, type SimpleChanges } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import type { FeedbackReason } from '@klaro/contracts';
import type { RunPort } from './scheduler';

@Component({ selector: 'klaro-operation-feedback', imports: [MatButtonModule, MatSelectModule], template: `
  @if (operationId && port?.submitFeedback && !disabled) {
    <section aria-label="Оцінка результату">
      <p>Оцінка добровільна. Надсилаються лише категорія та ідентифікатор операції, без тексту. Оцінка зберігається до 30 днів і доступна в експорті акаунта.</p>
      @if (!sent) {
        <button matButton (click)="send('helpful')" [disabled]="busy">Корисний результат</button>
        <mat-form-field><mat-label>Причина проблеми</mat-label><mat-select [value]="reason" (selectionChange)="reason = $event.value" [disabled]="busy">
          <mat-option value="meaning">Змінився зміст</mat-option><mat-option value="grammar">Неправильна граматика</mat-option><mat-option value="translation">Невдалий переклад</mat-option><mat-option value="style">Невдалий стиль</mat-option><mat-option value="other">Інше</mat-option>
        </mat-select></mat-form-field>
        <button matButton (click)="send(reason)" [disabled]="busy">Повідомити про проблему</button>
      }
      <p role="status" aria-live="polite">{{ sent ? 'Дякуємо за оцінку.' : failed ? 'Не вдалося надіслати оцінку. Можна повторити.' : busy ? 'Надсилаємо оцінку…' : '' }}</p>
    </section>
  }
` })
export class OperationFeedbackComponent implements OnChanges, OnDestroy {
  @Input() operationId: string | undefined;
  @Input() port: RunPort | undefined;
  @Input() disabled = false;
  reason: FeedbackReason = 'meaning';
  busy = false; sent = false; failed = false;
  private controller: AbortController | undefined;
  private readonly changes = inject(ChangeDetectorRef);
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['operationId'] || changes['port'] || this.disabled) { this.controller?.abort(); this.controller = undefined; this.busy = false; }
    if (changes['operationId'] || changes['port']) { this.sent = false; this.failed = false; this.reason = 'meaning'; }
  }
  ngOnDestroy(): void { this.controller?.abort(); }
  async send(reason: FeedbackReason): Promise<void> {
    if (this.disabled || this.busy || this.sent || !this.operationId || !this.port?.submitFeedback) return;
    const controller = new AbortController(); this.controller = controller; this.busy = true; this.failed = false;
    try { await this.port.submitFeedback(this.operationId, reason, controller.signal); if (!controller.signal.aborted) this.sent = true; }
    catch { if (!controller.signal.aborted) this.failed = true; }
    finally { if (this.controller === controller) { this.busy = false; this.changes.markForCheck(); } }
  }
}
