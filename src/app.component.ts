import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, FormArray, FormControl } from '@angular/forms';
import { EpubService, EpubGenerationConfig, GenerationProgress, ChapterPreview, Chapter, TestSelectorConfig, DetectedSelectors } from './services/epub.service';
import { finalize, Subscription, forkJoin, of, switchMap, map, catchError, debounceTime } from 'rxjs';
import { INLINED_DEFAULT_PRESETS } from './presets.const';
import { SelectorTesterComponent } from './selector-tester/selector-tester.component';
import { IconBookComponent } from './icons/icon-book.component';
import { IconCogComponent } from './icons/icon-cog.component';
import { IconSunComponent } from './icons/icon-sun.component';
import { IconMoonComponent } from './icons/icon-moon.component';
import { IconSpinnerComponent } from './icons/icon-spinner.component';
import { IconWandComponent } from './icons/icon-wand.component';
import { IconSearchComponent } from './icons/icon-search.component';
import { IconDragHandleComponent } from './icons/icon-drag-handle.component';
import { IconChevronDownComponent } from './icons/icon-chevron-down.component';
import { IconInfoComponent } from './icons/icon-info.component';
import { ConfigStepComponent } from './steps/config-step/config-step.component';

// FIX: Declare saveAs to inform TypeScript it's available globally.
declare var saveAs: any;

type ChapterStatus = 'pending' | 'downloading' | 'success' | 'error';
interface ProcessedChapter extends ChapterPreview {
  selected: boolean;
  status: ChapterStatus;
  error?: string;
  content?: string;
}

type AccordionSection = 'general' | 'dataSource' | 'metadata' | 'parsing' | 'cleanup' | 'performance' | '';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, 
    FormsModule, 
    ReactiveFormsModule, 
    SelectorTesterComponent,
    IconBookComponent,
    IconCogComponent,
    IconSunComponent,
    IconMoonComponent,
    IconSpinnerComponent,
    IconWandComponent,
    IconSearchComponent,
    IconDragHandleComponent,
    IconChevronDownComponent,
    IconInfoComponent,
    ConfigStepComponent
  ]
})
export class AppComponent {
  private epubService = inject(EpubService);
  private http = inject(HttpClient);
  // FIX: Replaced `inject(FormBuilder)` with direct instantiation. `inject` was failing to resolve the type correctly, causing `this.fb` to be `unknown`.
  private fb = new FormBuilder();
  private generationSubscription: Subscription | null = null;
  
  defaultConfig: EpubGenerationConfig = {
    proxyUrl: 'https://api.allorigins.win/raw?url=',
    tocUrl: '',
    firstChapterUrl: '',
    novelTitle: 'My Awesome Novel',
    author: 'An Author',
    synopsis: '',
    publisher: '',
    genres: '',
    dataSourceType: 'html',
    tocLinkSelector: 'a',
    paginatedToc: false,
    tocNextPageSelector: '',
    jsonChapterListPath: '',
    jsonChapterUrlPath: '',
    jsonChapterTitlePath: '',
    jsonNextPagePath: '',
    chapterContainerSelector: 'body',
    chapterTitleSelector: '',
    elementsToRemoveSelector: 'script, style, iframe, nav, .nav, #nav, footer, .footer, #footer, .sidebar, #sidebar, .comments, #comments, .ad, .ads',
    textToRemove: [],
    coverImageUrl: 'https://picsum.photos/600/800',
    coverImageSelector: 'img.novel-cover, .cover img, #cover img',
    novelTitleSelector: 'h1, .post-title, .entry-title',
    authorSelector: '.author, .author-name, a[rel="author"]',
    synopsisSelector: '.synopsis, .description, .entry-content p',
    nextPageLinkSelector: 'a[rel="next"], a.next-page, a.next',
    requestDelay: 200,
    concurrentDownloads: 4,
    includeTitleInContent: true,
    includeTitleInTxt: true,
    coverImageBase64: '',
    maxRetries: 2,
    retryDelay: 500,
  };

  configForm: FormGroup;
  uiStateForm: FormGroup;
  config = signal<EpubGenerationConfig>(this.defaultConfig);
  
  coverImagePreview = signal<string | null>(null);

  appStep = signal<'config' | 'details' | 'chapters' | 'generating' | 'finished'>('config');
  isLoading = signal(false);
  progress = signal<GenerationProgress>({ message: '', percentage: 0 });
  error = signal<string | null>(null);
  isSideMenuVisible = signal(false);
  
  processedChapters = signal<ProcessedChapter[]>([]);
  selectedChaptersCount = computed(() => this.processedChapters().filter(c => c.selected).length);
  successfulChaptersCount = computed(() => this.processedChapters().filter(c => c.status === 'success').length);
  failedChaptersCount = computed(() => this.processedChapters().filter(c => c.status === 'error').length);
  
  // Chapter Preview State
  previewingChapter = signal<ProcessedChapter | null>(null);
  previewContent = signal<{ title: string; content: string } | null>(null);
  previewError = signal<string | null>(null);
  isFetchingPreview = signal(false);

  // Selector Tester State (Inline)
  selectorTestStates = signal<Record<string, {
    isLoading: boolean;
    result: string | string[] | number | null;
    error: string | null;
    title: string;
  }>>({});

  // Auto-Detect State
  isDetecting = signal(false);
  detectionStatus = signal<{type: 'success' | 'error', message: string} | null>(null);

  // Presets State
  defaultPresets = signal<{name: string, config: Partial<EpubGenerationConfig>}[]>(INLINED_DEFAULT_PRESETS);
  userPresets = signal<{name: string, config: EpubGenerationConfig}[]>([]);
  presets = computed(() => {
    const presetMap = new Map<string, {name: string, config: EpubGenerationConfig}>();
    const fullDefaultPresets = this.defaultPresets().map(p => ({
        name: p.name,
        config: { ...this.defaultConfig, ...p.config }
    }));
    fullDefaultPresets.forEach(p => presetMap.set(p.name, p));
    this.userPresets().forEach(p => presetMap.set(p.name, p));
    return Array.from(presetMap.values());
  });
  
  saveButtonText = computed(() => {
    const currentName = this.uiStateForm.get('presetName')?.value;
    if (!currentName) {
      return 'Save Preset';
    }
    return this.userPresets().some(p => p.name === currentName) ? 'Update Preset' : 'Save Preset';
  });

  // Chapter Management UI State
  isRangeSelectorVisible = signal(false);
  isTitleTransformVisible = signal(false);

  filteredChapters = computed(() => {
    const filter = (this.uiStateForm.get('chapterFilter')?.value || '').toLowerCase();
    if (!filter) {
      return this.processedChapters();
    }
    return this.processedChapters().filter(c => c.title.toLowerCase().includes(filter));
  });
  
  // Stateful Buttons
  savePresetSuccess = signal(false);
  exportSettingsSuccess = signal(false);

  // UI State
  isDarkMode = signal<boolean>(false);
  draggedChapterId = signal<string | null>(null);
  activeAccordionSection = signal<AccordionSection>('general');

  constructor() {
    this.configForm = this.fb.group({
      proxyUrl: [this.defaultConfig.proxyUrl],
      tocUrl: [this.defaultConfig.tocUrl],
      firstChapterUrl: [this.defaultConfig.firstChapterUrl],
      novelTitle: [this.defaultConfig.novelTitle],
      author: [this.defaultConfig.author],
      synopsis: [this.defaultConfig.synopsis],
      publisher: [this.defaultConfig.publisher],
      genres: [this.defaultConfig.genres],
      dataSourceType: [this.defaultConfig.dataSourceType],
      tocLinkSelector: [this.defaultConfig.tocLinkSelector],
      paginatedToc: [this.defaultConfig.paginatedToc],
      tocNextPageSelector: [this.defaultConfig.tocNextPageSelector],
      jsonChapterListPath: [this.defaultConfig.jsonChapterListPath],
      jsonChapterUrlPath: [this.defaultConfig.jsonChapterUrlPath],
      jsonChapterTitlePath: [this.defaultConfig.jsonChapterTitlePath],
      jsonNextPagePath: [this.defaultConfig.jsonNextPagePath],
      chapterContainerSelector: [this.defaultConfig.chapterContainerSelector],
      chapterTitleSelector: [this.defaultConfig.chapterTitleSelector],
      elementsToRemoveSelector: [this.defaultConfig.elementsToRemoveSelector],
      textToRemove: this.fb.array([]),
      coverImageUrl: [this.defaultConfig.coverImageUrl],
      coverImageSelector: [this.defaultConfig.coverImageSelector],
      novelTitleSelector: [this.defaultConfig.novelTitleSelector],
      authorSelector: [this.defaultConfig.authorSelector],
      synopsisSelector: [this.defaultConfig.synopsisSelector],
      nextPageLinkSelector: [this.defaultConfig.nextPageLinkSelector],
      requestDelay: [this.defaultConfig.requestDelay],
      concurrentDownloads: [this.defaultConfig.concurrentDownloads],
      includeTitleInContent: [this.defaultConfig.includeTitleInContent],
      includeTitleInTxt: [this.defaultConfig.includeTitleInTxt],
      coverImageBase64: [this.defaultConfig.coverImageBase64],
      maxRetries: [this.defaultConfig.maxRetries],
      retryDelay: [this.defaultConfig.retryDelay],
    });

    this.uiStateForm = this.fb.group({
      presetName: [''],
      selectedPreset: [''],
      chapterFilter: [''],
      findText: [''],
      replaceText: [''],
      rangeStartChapterId: [''],
      rangeEndChapterId: [''],
      newTextToRemove: [''],
    });

    this.loadUserPresets();
    this.loadLastConfig();

    // Initialize dark mode
    const storedTheme = localStorage.getItem('theme');
    if (storedTheme) {
      this.isDarkMode.set(storedTheme === 'dark');
    } else {
      this.isDarkMode.set(window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    
    // Effect to apply dark mode class and save preference
    effect(() => {
      if (this.isDarkMode()) {
        document.documentElement.classList.add('dark');
        localStorage.setItem('theme', 'dark');
      } else {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('theme', 'light');
      }
    });

    // Sync form changes to the config signal and save to local storage
    this.configForm.valueChanges.pipe(
      debounceTime(300)
    ).subscribe(formValue => {
      this.config.set(formValue);
      localStorage.setItem('epub-gen-last-config', JSON.stringify(formValue));
    });
  }

  get textToRemoveControls() {
    return (this.configForm.get('textToRemove') as FormArray).controls;
  }
  
  loadLastConfig() {
    const lastConfig = localStorage.getItem('epub-gen-last-config');
    if (lastConfig) {
      try {
        const parsedConfig = JSON.parse(lastConfig);
        
        // Backward compatibility for textToRemove
        if (typeof parsedConfig.textToRemove === 'string') {
            parsedConfig.textToRemove = parsedConfig.textToRemove.split(',').map((s: string) => s.trim()).filter(Boolean);
        }

        const configToSet = { ...this.defaultConfig, ...parsedConfig };
        this.config.set(configToSet);

        // Update form
        this.configForm.patchValue(configToSet, { emitEvent: false });
        const textToRemoveArray = this.configForm.get('textToRemove') as FormArray;
        textToRemoveArray.clear();
        (configToSet.textToRemove || []).forEach((phrase: string) => {
            textToRemoveArray.push(this.fb.control(phrase));
        });

      } catch (e) {
        console.error("Failed to parse last config", e);
        this.config.set(this.defaultConfig);
        this.configForm.reset(this.defaultConfig, { emitEvent: false });
      }
    }
  }

  loadUserPresets() {
    const savedPresets = localStorage.getItem('epub-gen-presets');
    const userPresetsFromStorage: {name: string, config: EpubGenerationConfig}[] = savedPresets ? JSON.parse(savedPresets) : [];
    this.userPresets.set(userPresetsFromStorage);
  }

  savePreset() {
    const presetName = this.uiStateForm.get('presetName')?.value;
    if (!presetName) {
      alert('Please enter a name for the preset.');
      return;
    }
    if (this.isDefaultPreset(presetName)) {
      alert('Cannot overwrite a default preset. Please choose a different name.');
      return;
    }

    const newPreset = { name: presetName, config: this.config() };
    const currentUserPresets = this.userPresets();
    const existingIndex = currentUserPresets.findIndex(p => p.name === presetName);
    
    let updatedUserPresets;
    if (existingIndex !== -1) {
       updatedUserPresets = currentUserPresets.map((p, i) => i === existingIndex ? newPreset : p);
    } else {
       updatedUserPresets = [...currentUserPresets, newPreset];
    }
    
    localStorage.setItem('epub-gen-presets', JSON.stringify(updatedUserPresets));
    this.userPresets.set(updatedUserPresets);
    this.uiStateForm.get('presetName')?.setValue('');
    
    this.savePresetSuccess.set(true);
    setTimeout(() => this.savePresetSuccess.set(false), 2000);
  }

  loadSelectedPreset() {
    const selectedPreset = this.uiStateForm.get('selectedPreset')?.value;
    const preset = this.presets().find(p => p.name === selectedPreset);
    if (preset) {
      const currentProxy = this.configForm.get('proxyUrl')?.value;
      const presetConfig = { ...preset.config };
      // Backward compatibility for presets saved by user in old format
      if (typeof presetConfig.textToRemove === 'string') {
        (presetConfig as any).textToRemove = (presetConfig.textToRemove as string).split(',').map((s: string) => s.trim()).filter(Boolean);
      }
      
      const configToSet = { ...this.defaultConfig, ...presetConfig, proxyUrl: currentProxy };
      this.config.set(configToSet);
      
      this.configForm.patchValue(configToSet, { emitEvent: false });
      const textToRemoveArray = this.configForm.get('textToRemove') as FormArray;
      textToRemoveArray.clear();
      (configToSet.textToRemove || []).forEach((phrase: string) => {
          textToRemoveArray.push(this.fb.control(phrase));
      });
      this.configForm.updateValueAndValidity(); // Manually trigger update

      this.uiStateForm.get('presetName')?.setValue(preset.name); // Pre-fill name for easy updating
    }
  }

  loadDefaultPreset(presetConfig: Partial<EpubGenerationConfig>) {
    const currentProxy = this.configForm.get('proxyUrl')?.value;
    const configToSet = { ...this.defaultConfig, ...presetConfig, proxyUrl: currentProxy };
    this.config.set(configToSet);

    this.configForm.patchValue(configToSet, { emitEvent: false });
    const textToRemoveArray = this.configForm.get('textToRemove') as FormArray;
    textToRemoveArray.clear();
    (configToSet.textToRemove || []).forEach((phrase: string) => {
        textToRemoveArray.push(this.fb.control(phrase));
    });
    this.configForm.updateValueAndValidity(); // Manually trigger update
  }

  deleteSelectedPreset() {
    const presetToDelete = this.uiStateForm.get('selectedPreset')?.value;
    if (!presetToDelete || this.isDefaultPreset(presetToDelete)) return;
    
    const updatedUserPresets = this.userPresets().filter(preset => preset.name !== presetToDelete);
    localStorage.setItem('epub-gen-presets', JSON.stringify(updatedUserPresets));
    this.userPresets.set(updatedUserPresets);
    this.uiStateForm.get('selectedPreset')?.setValue('');
  }
  
  isDefaultPreset(name: string): boolean {
    return this.defaultPresets().some(p => p.name === name);
  }

  exportSettings() {
    const blob = new Blob([JSON.stringify(this.config(), null, 2)], { type: 'application/json' });
    const filename = `epub-generator-settings-${this.config().novelTitle.replace(/\s/g, '_') || 'export'}.json`;
    saveAs(blob, filename);
    
    this.exportSettingsSuccess.set(true);
    setTimeout(() => this.exportSettingsSuccess.set(false), 2000);
  }

  importSettings(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const importedConfig = JSON.parse(reader.result as string);
        
        if (typeof importedConfig.textToRemove === 'string') {
            importedConfig.textToRemove = importedConfig.textToRemove.split(',').map((s: string) => s.trim()).filter(Boolean);
        }

        const configToSet = { ...this.defaultConfig, ...importedConfig };
        this.config.set(configToSet);

        this.configForm.patchValue(configToSet, { emitEvent: false });
        const textToRemoveArray = this.configForm.get('textToRemove') as FormArray;
        textToRemoveArray.clear();
        (configToSet.textToRemove || []).forEach((phrase: string) => {
            textToRemoveArray.push(this.fb.control(phrase));
        });
        this.configForm.updateValueAndValidity();

        alert('Settings imported successfully!');
      } catch (e) {
        alert('Failed to import settings. The file may be invalid.');
        console.error(e);
      }
    };
    reader.readAsText(file);
    input.value = ''; // Reset input
  }

  applyTitleTransform() {
    const findText = this.uiStateForm.get('findText')?.value;
    if (!findText) return;
    const replaceText = this.uiStateForm.get('replaceText')?.value;
    this.processedChapters.update(chapters =>
      chapters.map(c => ({
        ...c,
        title: c.title.replace(new RegExp(findText, 'g'), replaceText)
      }))
    );
    this.isTitleTransformVisible.set(false);
  }

  selectChapterRange() {
    const startId = this.uiStateForm.get('rangeStartChapterId')?.value;
    const endId = this.uiStateForm.get('rangeEndChapterId')?.value;
    if (!startId || !endId) return;

    const chapters = this.processedChapters();
    const startIndex = chapters.findIndex(c => c.id === startId);
    const endIndex = chapters.findIndex(c => c.id === endId);

    if (startIndex === -1 || endIndex === -1) return;

    const minIndex = Math.min(startIndex, endIndex);
    const maxIndex = Math.max(startIndex, endIndex);
    
    this.processedChapters.update(chaps => 
      chaps.map((c, index) => ({
        ...c,
        selected: index >= minIndex && index <= maxIndex
      }))
    );
    this.isRangeSelectorVisible.set(false);
  }

  autoDetectSelectors() {
    this.isDetecting.set(true);
    this.detectionStatus.set(null);
    this.error.set(null);
    const { tocUrl, firstChapterUrl, proxyUrl } = this.config();

    this.epubService.autoDetectSelectors(tocUrl, firstChapterUrl, proxyUrl)
      .pipe(finalize(() => this.isDetecting.set(false)))
      .subscribe({
        next: (detectedSelectors: DetectedSelectors) => {
          this.configForm.patchValue(detectedSelectors);
          this.detectionStatus.set({ type: 'success', message: 'Selectors detected! Please review and test them in Advanced Settings before continuing.' });
          this.isSideMenuVisible.set(true);
          this.activeAccordionSection.set('metadata'); // Open the relevant section
        },
        error: (err) => {
          this.detectionStatus.set({ type: 'error', message: err.message || 'An unknown error occurred during detection.' });
        }
      });
  }

  fetchDetails() {
    this.isLoading.set(true);
    this.error.set(null);
    this.detectionStatus.set(null);

    this.epubService.getNovelDetailsAndChapterList(this.config())
      .pipe(finalize(() => this.isLoading.set(false)))
      .subscribe({
        next: ({ details, chapters }) => {
          const updates: Partial<EpubGenerationConfig> = {
            novelTitle: details.novelTitle || this.config().novelTitle,
            author: details.author || this.config().author,
            synopsis: details.synopsis || this.config().synopsis,
          };
          
          if (details.scrapedCoverUrl && !this.config().coverImageBase64) {
             updates.coverImageUrl = details.scrapedCoverUrl;
          }

          this.configForm.patchValue(updates);
          this.processedChapters.set(chapters.map(c => ({...c, selected: true, status: 'pending'})));
          this.appStep.set('details');
        },
        error: (err) => this.error.set(err.message || 'An unknown error occurred while fetching chapters.')
      });
  }

  startOrRetryGeneration(retryFailed = false) {
    const chaptersToProcess = this.processedChapters().filter(c => 
      c.selected && (retryFailed ? c.status === 'error' : true)
    );

    if (chaptersToProcess.length === 0) {
      this.error.set(retryFailed ? 'No failed chapters to retry.' : 'No chapters selected.');
      return;
    }
    
    // Reset status for the chapters we are about to process
    this.processedChapters.update(allChapters => allChapters.map(c => {
      if (chaptersToProcess.some(p => p.id === c.id)) {
        return { ...c, status: 'pending', error: undefined };
      }
      return c;
    }));

    this.appStep.set('generating');
    this.error.set(null);
    this.progress.set({ message: 'Starting download...', percentage: 0 });

    this.generationSubscription = this.epubService.fetchAllChapters(chaptersToProcess, this.processedChapters(), this.config())
      .subscribe({
        next: (processedChapter: Chapter & { status: ChapterStatus; error?: string }) => {
          this.processedChapters.update(allChapters => allChapters.map(c => 
            c.id === processedChapter.id ? { ...c, ...processedChapter } : c
          ));
          const totalSelected = this.selectedChaptersCount();
          const doneCount = this.successfulChaptersCount() + this.failedChaptersCount();
          const percentage = totalSelected > 0 ? (doneCount / totalSelected) * 100 : 0;
          this.progress.set({ message: `Processed ${doneCount}/${totalSelected} chapters...`, percentage });
        },
        error: (err) => {
          this.error.set(err.message || 'An unexpected error stopped the generation process.');
          this.appStep.set('finished');
        },
        complete: () => {
          this.progress.set({ message: 'All chapters processed!', percentage: 100 });
          this.appStep.set('finished');
        }
      });
  }

  downloadEpub() {
    this.isLoading.set(true);
    this.error.set(null);
    this.progress.set({ message: 'Building EPUB file...', percentage: 0 });
    
    const successfulChapters = this.processedChapters().filter(c => c.status === 'success') as Chapter[];
    
    this.epubService.buildAndZipEpub(successfulChapters, this.config())
      .pipe(finalize(() => this.isLoading.set(false)))
      .subscribe({
        next: () => {
          this.progress.set({ message: 'EPUB successfully downloaded!', percentage: 100 });
          setTimeout(() => {
            this.progress.set({ message: '', percentage: 0 });
          }, 3000);
        },
        error: (err) => this.error.set(err.message || 'Failed to build the EPUB file.')
      });
  }

  downloadTxt() {
    const successfulChapters = this.processedChapters().filter(c => c.status === 'success') as Chapter[];
    if (successfulChapters.length === 0) return;

    const txtContent = this.epubService.buildTxt(successfulChapters, this.config());
    const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' });
    const filename = `${this.config().novelTitle.replace(/ /g, '_')}.txt`;
    saveAs(blob, filename);
  }
  
  cancelGeneration() {
    if (this.generationSubscription) {
      this.generationSubscription.unsubscribe();
      this.generationSubscription = null;
      this.appStep.set('finished');
      this.progress.set({ message: 'Generation cancelled.', percentage: 0 });
    }
  }

  testChapterPreview() {
    const firstChapterUrl = this.config().firstChapterUrl;
    if (!firstChapterUrl) {
      return;
    }

    const testChapter: ProcessedChapter = {
      id: 'test-preview-chapter',
      title: 'Test Chapter Preview',
      url: firstChapterUrl,
      order: 0,
      selected: true,
      status: 'pending'
    };

    this.previewingChapter.set(testChapter);
    this.isFetchingPreview.set(true);
    this.previewContent.set(null);
    this.previewError.set(null);

    // Note: We don't have the full chapter list here, so pagination testing might be inaccurate
    this.epubService.fetchAndCleanChapter(testChapter, this.config())
      .pipe(finalize(() => this.isFetchingPreview.set(false)))
      .subscribe({
        next: (data) => this.previewContent.set(data),
        error: (err) => this.previewError.set(err.message || 'Failed to fetch or parse chapter for preview.')
      });
  }

  previewChapter(chapterId: string) {
    const chapter = this.processedChapters().find(c => c.id === chapterId);
    if (!chapter) return;

    this.previewingChapter.set(chapter);
    this.isFetchingPreview.set(true);
    this.previewContent.set(null);
    this.previewError.set(null);

    this.epubService.fetchAndCleanChapter(chapter, this.config(), this.processedChapters())
      .pipe(finalize(() => this.isFetchingPreview.set(false)))
      .subscribe({
        next: (data) => this.previewContent.set(data),
        error: (err) => this.previewError.set(err.message || 'Failed to fetch or parse chapter for preview.')
      });
  }

  closePreview() {
    this.previewingChapter.set(null);
  }
  
  testSelector(selectorKey: keyof EpubGenerationConfig, title: string) {
    this.selectorTestStates.update(states => ({
        ...states,
        [selectorKey]: { isLoading: true, error: null, result: null, title }
    }));

    const currentConfig = this.config();
    const selector = currentConfig[selectorKey] as string;

    let testConfig: Omit<TestSelectorConfig, 'proxyUrl'> | null = null;
    const tocUrl = currentConfig.tocUrl;
    const firstChapterUrl = currentConfig.firstChapterUrl;
    
    const setError = (message: string) => {
        this.selectorTestStates.update(states => ({
            ...states,
            [selectorKey]: { ...states[selectorKey], isLoading: false, error: message }
        }));
    };

    switch (selectorKey) {
        case 'novelTitleSelector':
        case 'authorSelector':
        case 'synopsisSelector':
            if (!tocUrl) { setError('Table of Contents URL is required.'); return; }
            testConfig = { url: tocUrl, selector, returnType: 'text', multi: false };
            break;
        case 'coverImageSelector':
            if (!tocUrl) { setError('Table of Contents URL is required.'); return; }
            testConfig = { url: tocUrl, selector, returnType: 'attribute', attribute: 'src', multi: false };
            break;
        case 'tocLinkSelector':
            if (!tocUrl) { setError('Table of Contents URL is required.'); return; }
            testConfig = { url: tocUrl, selector, returnType: 'text', multi: true };
            break;
        case 'chapterTitleSelector':
        case 'nextPageLinkSelector':
        case 'chapterContainerSelector':
             if (!firstChapterUrl) { setError('First Chapter URL is required.'); return; }
             if (selectorKey === 'chapterContainerSelector') {
                 testConfig = { url: firstChapterUrl, selector, returnType: 'html', multi: false };
             } else if (selectorKey === 'nextPageLinkSelector') {
                 testConfig = { url: firstChapterUrl, selector, returnType: 'attribute', attribute: 'href', multi: false };
             } else {
                 testConfig = { url: firstChapterUrl, selector, returnType: 'text', multi: false };
             }
             break;
    }

    if (!testConfig || !selector) {
        setError(selector ? 'This selector cannot be tested.' : 'Selector is empty.');
        return;
    }

    const fullTestConfig: TestSelectorConfig = {
        ...testConfig,
        proxyUrl: currentConfig.proxyUrl
    };

    this.epubService.testSelector(fullTestConfig)
        .pipe(finalize(() => {
             this.selectorTestStates.update(states => ({
                ...states,
                [selectorKey]: { ...states[selectorKey], isLoading: false }
            }));
        }))
        .subscribe({
            next: (data) => {
                 this.selectorTestStates.update(states => ({
                    ...states,
                    [selectorKey]: { ...states[selectorKey], result: data.result }
                }));
            },
            error: (err) => {
                this.selectorTestStates.update(states => ({
                    ...states,
                    [selectorKey]: { ...states[selectorKey], error: err.message }
                }));
            }
        });
  }
  
  onCoverFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
        const file = input.files[0];
        const reader = new FileReader();
        reader.onload = (e) => {
            const base64 = e.target?.result as string;
            this.coverImagePreview.set(base64);
            this.configForm.patchValue({ coverImageBase64: base64, coverImageUrl: '' });
        };
        reader.readAsDataURL(file);
    }
  }

  clearCoverImage(): void {
    this.coverImagePreview.set(null);
    this.configForm.patchValue({ coverImageBase64: '', coverImageUrl: 'https://picsum.photos/600/800'});
    const fileInput = document.getElementById('coverImageFile') as HTMLInputElement;
    if(fileInput) fileInput.value = '';
  }

  addTextToRemove() {
    const newPhrase = (this.uiStateForm.get('newTextToRemove')?.value || '').trim();
    if (newPhrase) {
      const textToRemoveArray = this.configForm.get('textToRemove') as FormArray;
      if (!textToRemoveArray.value.includes(newPhrase)) {
        textToRemoveArray.push(this.fb.control(newPhrase));
      }
      this.uiStateForm.get('newTextToRemove')?.setValue('');
    }
  }

  removeTextToRemove(indexToRemove: number) {
    const textToRemoveArray = this.configForm.get('textToRemove') as FormArray;
    textToRemoveArray.removeAt(indexToRemove);
  }

  toggleSideMenu() {
    this.isSideMenuVisible.update(v => !v);
  }
  
  toggleProxy() {
    const proxyControl = this.configForm.get('proxyUrl');
    if (proxyControl) {
      if (proxyControl.value) {
        // It has a value, so disable it by clearing
        proxyControl.setValue('');
      } else {
        // It's empty, so restore default
        proxyControl.setValue(this.defaultConfig.proxyUrl);
      }
    }
  }

  toggleDarkMode() {
    this.isDarkMode.update(value => !value);
  }

  toggleAccordion(section: AccordionSection) {
    this.activeAccordionSection.update(current => current === section ? '' : section);
  }

  toggleAllChapters(select: boolean) {
    this.processedChapters.update(chapters => 
      chapters.map(c => ({ ...c, selected: select }))
    );
  }

  invertSelection() {
    this.processedChapters.update(chapters =>
      chapters.map(c => ({ ...c, selected: !c.selected }))
    );
  }

  toggleChapterSelection(chapterId: string) {
    this.processedChapters.update(chapters =>
      chapters.map(c => c.id === chapterId ? { ...c, selected: !c.selected } : c)
    );
  }
  
  // Drag and Drop Handlers
  onDragStart(event: DragEvent, chapterId: string): void {
    this.draggedChapterId.set(chapterId);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault(); // Crucial to allow dropping
  }

  onDrop(event: DragEvent, targetChapterId: string): void {
    event.preventDefault();
    const draggedId = this.draggedChapterId();
    if (!draggedId || draggedId === targetChapterId) {
      this.draggedChapterId.set(null);
      return;
    }

    this.processedChapters.update(chapters => {
      const draggedIndex = chapters.findIndex(c => c.id === draggedId);
      const targetIndex = chapters.findIndex(c => c.id === targetChapterId);
      if (draggedIndex === -1 || targetIndex === -1) return chapters;
      
      const newChapters = [...chapters];
      const [draggedItem] = newChapters.splice(draggedIndex, 1);
      newChapters.splice(targetIndex, 0, draggedItem);
      
      // Re-assign order based on new position
      return newChapters.map((c, index) => ({ ...c, order: index + 1 }));
    });

    this.draggedChapterId.set(null);
  }

  onDragEnd(): void {
    this.draggedChapterId.set(null);
  }


  goBackToConfig() {
    this.appStep.set('config');
    this.processedChapters.set([]);
    this.error.set(null);
  }
  
  goToChapters() {
    this.appStep.set('chapters');
  }

  goBackToDetails() {
    this.appStep.set('details');
    this.error.set(null);
  }
  
  goBackToChapters() {
    this.appStep.set('chapters');
    this.error.set(null);
    this.progress.set({ message: '', percentage: 0 });
  }
}
