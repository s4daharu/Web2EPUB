import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { EpubGenerationConfig } from '../services/epub.service';
import { IconInfoComponent } from '../icons/icon-info.component';
import { IconSpinnerComponent } from '../icons/icon-spinner.component';

@Component({
  selector: 'app-selector-tester',
  imports: [CommonModule, ReactiveFormsModule, IconInfoComponent, IconSpinnerComponent],
  templateUrl: './selector-tester.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SelectorTesterComponent {
  control = input.required<FormControl>();
  selectorKey = input.required<keyof EpubGenerationConfig>();
  title = input.required<string>();
  placeholder = input<string>('');
  help = input<string>('');
  state = input<{ isLoading: boolean; result: any; error: string | null; }>();

  testRequested = output<{ selectorKey: keyof EpubGenerationConfig, title: string }>();

  isArray = computed(() => Array.isArray(this.state()?.result));

  testSelector() {
    this.testRequested.emit({ selectorKey: this.selectorKey(), title: this.title() });
  }
}
