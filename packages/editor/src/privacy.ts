import { afterNextRender, Component, ElementRef, inject, Injector, Input, ViewChild, type OnChanges } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import type { ProcessingDisclosure } from '@klaro/contracts';
import type { ProcessingConsent } from './processing-consent';

@Component({ selector: 'klaro-processing-details', template: `@if (disclosure; as data) {
  <p>Для корекції, перекладу й доповнень ШІ Klaro передає вибраний текст і явно доданий контекст на backend та до провайдера {{ data.provider }}. Відкриття панелі не запускає обробку. Автоматичний режим вмикається окремою кнопкою «Наживо» й зупиняється кнопкою «Пауза».</p>
  <p>Приватні оригінали та результати: у пам’яті клієнта до очищення або закриття; на backend — до {{ data.backend.payloadMaximumMinutes }} хвилин від створення, після завершення — щонайбільше {{ data.backend.resultMaximumMinutes }} хвилин у межах цього строку. Вони не потрапляють у журнали, резервні копії чи спільний кеш.</p>
  <p>HMAC для повторних запитів: {{ data.backend.digestHours }} години. Метадані операцій і використання: до {{ data.backend.metadataDays }} днів. Публічні доповнення до словникового джерела без приватного контексту: до {{ data.backend.supplementDays }} днів.</p>
  <p>Провайдер: {{ data.providerRetention }}</p>
  <p>Профіль і налаштування зберігаються до видалення акаунта. Видалення негайно відкликає сесії й блокує результати; очищення активних даних — до 7 днів, резервних копій — до 30 днів. Мінімальний зашифрований журнал ідентифікаторів видалення зберігається до 35 днів, щоб застосувати видалення при відновленні. Експорт і видалення доступні у профілі.</p>
}`, })
export class ProcessingDetailsComponent { @Input() disclosure: ProcessingDisclosure | undefined; }

@Component({ selector: 'klaro-processing-consent', imports: [ProcessingDetailsComponent, MatButtonModule], template: `@if (consent?.pending) {
  <section role="region" aria-label="Підтвердження обробки тексту" class="disclosure"><h2>Передача тексту для обробки</h2>
    <klaro-processing-details [disclosure]="consent?.disclosure" />
    <button #confirm matButton (click)="consent?.decide(true)">Підтверджую передачу тексту</button><button matButton (click)="consent?.decide(false)">Скасувати передачу</button>
  </section>
}`, styles: ['.disclosure { padding: 16px; border: 2px solid #005cbb; margin: 16px; }'] })
export class ProcessingConsentComponent implements OnChanges {
  @Input() consent: ProcessingConsent | undefined;
  @Input() revision = 0;
  @ViewChild('confirm') private confirm: ElementRef<HTMLButtonElement> | undefined;
  private readonly injector = inject(Injector);
  private previous: HTMLElement | undefined;
  ngOnChanges(): void {
    if (this.consent?.pending) {
      this.previous ??= document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
      afterNextRender(() => this.confirm?.nativeElement.focus(), { injector: this.injector });
    } else if (this.previous) {
      const previous = this.previous; this.previous = undefined;
      afterNextRender(() => { if (previous.isConnected) previous.focus(); }, { injector: this.injector });
    }
  }
}
