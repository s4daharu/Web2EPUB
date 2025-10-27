import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-icon-wand',
  template: `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
      <path fill-rule="evenodd" d="M7 2a1 1 0 00-.707.293l-4 4a1 1 0 000 1.414l4 4A1 1 0 007 12V9.414l1.293 1.293a1 1 0 001.414-1.414L8.414 8l1.293-1.293a1 1 0 00-1.414-1.414L7 6.586V4a1 1 0 00-1-1H5a1 1 0 00-.707.293l-1 1a1 1 0 000 1.414l1 1A1 1 0 005 8h1v1.586l.293.293a.997.997 0 001.414 0L13 4.586V2a1 1 0 00-1-1h-1a1 1 0 00-.707.293l-1 1a1 1 0 000 1.414l1 1A1 1 0 0012 6h1V4.586l.293-.293a.999.999 0 000-1.414L12.707 2.293A1 1 0 0012 2H7zm8 16a1 1 0 00.707-.293l4-4a1 1 0 000-1.414l-4-4a1 1 0 00-1.414 1.414L15.586 12l-1.293 1.293a1 1 0 001.414 1.414L17 13.414V16a1 1 0 001 1h1a1 1 0 00.707-.293l1-1a1 1 0 000-1.414l-1-1a1 1 0 00-1.414 0L18 14.586V13a1 1 0 00-1-1h-1a1 1 0 00-.707.293l-1 1a1 1 0 000 1.414l1 1A1 1 0 0017 16h-1v1.586l-.293.293a.999.999 0 000 1.414l.586.586A1 1 0 0015 18z" clip-rule="evenodd" />
    </svg>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class IconWandComponent {}
