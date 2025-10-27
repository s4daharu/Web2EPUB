import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-icon-chevron-down',
  template: `
    <svg xmlns="http://www.w3.org/2000/svg" [class]="class()" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
    </svg>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class IconChevronDownComponent {
  class = input<string>('');
}
