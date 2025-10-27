import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { EpubService, EpubGenerationConfig, GenerationProgress, ChapterPreview, Chapter, TestSelectorConfig, DetectedSelectors } from './services/epub.service';
import { finalize, Subscription, forkJoin, of, switchMap, map, catchError } from 'rxjs';

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

// Define presets directly in the file to avoid HTTP loading issues.
const INLINED_DEFAULT_PRESETS: {name: string, config: Partial<EpubGenerationConfig>}[] = [
  {
    name: "Novel543.com (Example)",
    config: {
      proxyUrl: "https://api.allorigins.win/raw?url=",
      tocUrl: "https://www.novel543.com/1218631547/dir",
      firstChapterUrl: "https://www.novel543.com/1218631547/8096_1.html",
      novelTitle: "幼崽讀心：全家除我都是穿越大佬 章節列表",
      author: "作者 / 三百",
      synopsis: "",
      publisher: "",
      genres: "",
      tocLinkSelector: "body > div > div.chaplist > ul > li > a",
      paginatedToc: false,
      tocNextPageSelector: "",
      chapterContainerSelector: "#chapterWarp > div.chapter-content.px-3 > div",
      chapterTitleSelector: "",
      elementsToRemoveSelector: "script, style, iframe, nav, .nav, #nav, footer, .footer, #footer, .sidebar, #sidebar, .comments, #comments, .ad, .ads,#chapterWarp > div.chapter-content.px-3 > div > div:nth-child(64)",
      textToRemove: [
        "溫馨提示: 登錄用戶跨設備永久保存書架的數據, 建議大家登錄使用",
        "溫馨提示: 如果覺得本書不錯, 避免下次找不到, 請記得加入書架哦"
      ],
      coverImageUrl: "https://picsum.photos/600/800",
      coverImageSelector: "img.novel-cover, .cover img, #cover img",
      novelTitleSelector: "h1.title.is-2",
      authorSelector: "body > div > section > h2",
      synopsisSelector: ".synopsis, .description, .entry-content p",
      nextPageLinkSelector: "#read > div > div.warp.my-5.foot-nav > a:nth-child(5)",
      requestDelay: 800,
      concurrentDownloads: 1,
      includeTitleInContent: true,
      coverImageBase64: "",
      maxRetries: 2,
      retryDelay: 500
    }
  },
  {
    name: "shuhaige.net (Example)",
    config: {
      proxyUrl: "https://api.allorigins.win/raw?url=",
      tocUrl: "https://m.shuhaige.net/397861_1",
      firstChapterUrl: "https://m.shuhaige.net/397861/135960994.html",
      tocLinkSelector: "#read > div.main > ul.read > li > a",
      paginatedToc: true,
      tocNextPageSelector: "#read > div.main > div.pagelist > a:nth-child(3)",
      chapterContainerSelector: "#chapter > div.content",
      chapterTitleSelector: "h1.headline",
      textToRemove: [
        "喜欢幼崽读心：全家除我都是穿越大佬请大家收藏：(m.shuhaige.net)幼崽读心：全家除我都是穿越大佬书海阁小说网更新速度全网最快。"
      ],
      coverImageSelector: "#read > div.main > div.detail > img",
      novelTitleSelector: "div.header > h1",
      authorSelector: "p.author",
      nextPageLinkSelector: "div.pager > a:nth-of-type(3)",
      requestDelay: 600,
      concurrentDownloads: 1
    }
  }
];

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule]
})
export class AppComponent {
  private epubService = inject(EpubService);
  private http = inject(HttpClient);
  private generationSubscription: Subscription | null = null;

  proxies = [
    { name: 'CORSProxy.io', url: 'https://corsproxy.io/?' },
    { name: 'AllOrigins', url: 'https://api.allorigins.win/raw?url=' },
    { name: 'ThingProxy', url: 'https://thingproxy.freeboard.io/fetch/' },
    { name: 'Render-tron (Headless)', url: 'https://render-tron.appspot.com/render/'},
    { name: 'No Proxy (for CORS-enabled sites)', url: '' }
  ];
  
  defaultConfig: EpubGenerationConfig = {
    proxyUrl: this.proxies[1].url,
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
    coverImageBase64: '',
    maxRetries: 2,
    retryDelay: 500,
  };

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

  // New Features State
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

  selectedPreset = signal<string>('');
  presetName = signal<string>('');
  
  saveButtonText = computed(() => {
    const currentName = this.presetName();
    if (!currentName) {
      return 'Save Preset';
    }
    return this.userPresets().some(p => p.name === currentName) ? 'Update Preset' : 'Save Preset';
  });

  // Chapter Management State
  chapterFilter = signal('');
  isRangeSelectorVisible = signal(false);
  isTitleTransformVisible = signal(false);
  findText = signal('');
  replaceText = signal('');
  rangeStartChapterId = signal<string>('');
  rangeEndChapterId = signal<string>('');
  newTextToRemove = signal('');

  filteredChapters = computed(() => {
    const filter = this.chapterFilter().toLowerCase();
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

    effect(() => {
      // Auto-save config changes
      localStorage.setItem('epub-gen-last-config', JSON.stringify(this.config()));
    });
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

        // Ensure all default keys exist on the loaded config
        this.config.set({ ...this.defaultConfig, ...parsedConfig });
      } catch (e) {
        console.error("Failed to parse last config", e);
        this.config.set(this.defaultConfig);
      }
    }
  }

  loadUserPresets() {
    const savedPresets = localStorage.getItem('epub-gen-presets');
    const userPresetsFromStorage: {name: string, config: EpubGenerationConfig}[] = savedPresets ? JSON.parse(savedPresets) : [];
    this.userPresets.set(userPresetsFromStorage);
  }

  savePreset() {
    if (!this.presetName()) {
      alert('Please enter a name for the preset.');
      return;
    }
    if (this.isDefaultPreset(this.presetName())) {
      alert('Cannot overwrite a default preset. Please choose a different name.');
      return;
    }

    const newPreset = { name: this.presetName(), config: this.config() };
    const currentUserPresets = this.userPresets();
    const existingIndex = currentUserPresets.findIndex(p => p.name === this.presetName());
    
    let updatedUserPresets;
    if (existingIndex !== -1) {
       updatedUserPresets = currentUserPresets.map((p, i) => i === existingIndex ? newPreset : p);
    } else {
       updatedUserPresets = [...currentUserPresets, newPreset];
    }
    
    localStorage.setItem('epub-gen-presets', JSON.stringify(updatedUserPresets));
    this.userPresets.set(updatedUserPresets);
    this.presetName.set('');
    
    this.savePresetSuccess.set(true);
    setTimeout(() => this.savePresetSuccess.set(false), 2000);
  }

  loadSelectedPreset() {
    const preset = this.presets().find(p => p.name === this.selectedPreset());
    if (preset) {
      const currentProxy = this.config().proxyUrl;
      const presetConfig = { ...preset.config };
      // Backward compatibility for presets saved by user in old format
      if (typeof presetConfig.textToRemove === 'string') {
        (presetConfig as any).textToRemove = (presetConfig.textToRemove as string).split(',').map((s: string) => s.trim()).filter(Boolean);
      }
      this.config.set({ ...this.defaultConfig, ...presetConfig, proxyUrl: currentProxy });
      this.presetName.set(preset.name); // Pre-fill name for easy updating
    }
  }

  loadDefaultPreset(presetConfig: Partial<EpubGenerationConfig>) {
    const currentProxy = this.config().proxyUrl;
    this.config.set({ ...this.defaultConfig, ...presetConfig, proxyUrl: currentProxy });
  }

  deleteSelectedPreset() {
    const presetToDelete = this.selectedPreset();
    if (!presetToDelete || this.isDefaultPreset(presetToDelete)) return;
    
    const updatedUserPresets = this.userPresets().filter(preset => preset.name !== presetToDelete);
    localStorage.setItem('epub-gen-presets', JSON.stringify(updatedUserPresets));
    this.userPresets.set(updatedUserPresets);
    this.selectedPreset.set('');
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
        
        // Backward compatibility for textToRemove
        if (typeof importedConfig.textToRemove === 'string') {
            importedConfig.textToRemove = importedConfig.textToRemove.split(',').map((s: string) => s.trim()).filter(Boolean);
        }

        this.config.set({ ...this.defaultConfig, ...importedConfig });
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
    if (!this.findText()) return;
    this.processedChapters.update(chapters =>
      chapters.map(c => ({
        ...c,
        title: c.title.replace(new RegExp(this.findText(), 'g'), this.replaceText())
      }))
    );
    this.isTitleTransformVisible.set(false);
  }

  selectChapterRange() {
    const startId = this.rangeStartChapterId();
    const endId = this.rangeEndChapterId();
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
          this.config.update(c => ({ ...c, ...detectedSelectors }));
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
          this.config.update(c => ({
            ...c,
            novelTitle: details.novelTitle || c.novelTitle,
            author: details.author || c.author,
            synopsis: details.synopsis || c.synopsis,
          }));
          
          if (details.scrapedCoverUrl && !this.config().coverImageBase64) {
             this.config.update(c => ({ ...c, coverImageUrl: details.scrapedCoverUrl! }));
          }

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
  
  isArray(value: any): value is any[] {
    return Array.isArray(value);
  }

  updateConfigField(field: keyof EpubGenerationConfig, value: string | number) {
    this.config.update(c => ({ ...c, [field]: value }));
     if (field === 'coverImageUrl' && value) {
        this.coverImagePreview.set(null);
        this.config.update(c => ({ ...c, coverImageBase64: '' }));
        const fileInput = document.getElementById('coverImageFile') as HTMLInputElement;
        if(fileInput) fileInput.value = '';
    }
  }

  updateConfigRadio(field: keyof EpubGenerationConfig, value: 'html' | 'json') {
    this.config.update(c => ({ ...c, [field]: value }));
  }
  
  updateConfigCheckbox(field: keyof EpubGenerationConfig, event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    this.config.update(c => ({ ...c, [field]: checked }));
  }
  
  onCoverFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
        const file = input.files[0];
        const reader = new FileReader();
        reader.onload = (e) => {
            const base64 = e.target?.result as string;
            this.coverImagePreview.set(base64);
            this.config.update(c => ({...c, coverImageBase64: base64, coverImageUrl: ''}));
        };
        reader.readAsDataURL(file);
    }
  }

  clearCoverImage(): void {
    this.coverImagePreview.set(null);
    this.config.update(c => ({...c, coverImageBase64: '', coverImageUrl: 'https://picsum.photos/600/800'}));
    const fileInput = document.getElementById('coverImageFile') as HTMLInputElement;
    if(fileInput) fileInput.value = '';
  }

  addTextToRemove() {
    const newPhrase = this.newTextToRemove().trim();
    if (newPhrase && !this.config().textToRemove.includes(newPhrase)) {
      this.config.update(c => ({
        ...c,
        textToRemove: [...c.textToRemove, newPhrase]
      }));
      this.newTextToRemove.set('');
    }
  }

  removeTextToRemove(indexToRemove: number) {
    this.config.update(c => ({
      ...c,
      textToRemove: c.textToRemove.filter((_, index) => index !== indexToRemove)
    }));
  }

  toggleSideMenu() {
    this.isSideMenuVisible.update(v => !v);
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
