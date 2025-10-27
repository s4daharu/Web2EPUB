import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { EpubGenerationConfig } from '../../services/epub.service';
import { IconSpinnerComponent } from '../../icons/icon-spinner.component';
import { IconWandComponent } from '../../icons/icon-wand.component';

@Component({
  selector: 'app-config-step',
  imports: [CommonModule, ReactiveFormsModule, IconSpinnerComponent, IconWandComponent],
  templateUrl: './config-step.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfigStepComponent {
  configForm = input.required<FormGroup>();
  defaultPresets = input.required<{name: string, config: Partial<EpubGenerationConfig>}[]>();
  isDetecting = input.required<boolean>();
  detectionStatus = input<{type: 'success' | 'error', message: string} | null>();
  isLoading = input.required<boolean>();
  error = input<string | null>();

  loadDefaultPreset = output<Partial<EpubGenerationConfig>>();
  autoDetectSelectors = output<void>();
  fetchDetails = output<void>();
}
