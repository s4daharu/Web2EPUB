import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, from, of, EMPTY, forkJoin, merge, Subject, timer } from 'rxjs';
import { switchMap, map, catchError, tap, delay, expand, mergeMap, reduce, retry } from 'rxjs/operators';
import { v4 as uuidv4 } from 'uuid';

declare var JSZip: any;
declare var saveAs: any;

export interface EpubGenerationConfig {
  proxyUrl: string;
  tocUrl: string;
  firstChapterUrl: string;
  novelTitle: string;
  author: string;
  synopsis?: string;
  publisher?: string;
  genres?: string; // comma-separated
  dataSourceType: 'html' | 'json';
  tocLinkSelector: string;
  paginatedToc: boolean;
  tocNextPageSelector?: string;
  jsonChapterListPath: string;
  jsonChapterUrlPath: string;
  jsonChapterTitlePath: string;
  jsonNextPagePath: string;
  chapterContainerSelector: string;
  chapterTitleSelector?: string;
  elementsToRemoveSelector: string;
  textToRemove: string[];
  coverImageUrl: string;
  coverImageSelector?: string;
  novelTitleSelector?: string;
  authorSelector?: string;
  synopsisSelector?: string;
  nextPageLinkSelector?: string;
  coverImageBase64?: string;
  requestDelay: number;
  concurrentDownloads: number;
  includeTitleInContent: boolean;
  maxRetries: number;
  retryDelay: number;
}

export type DetectedSelectors = Partial<Pick<EpubGenerationConfig,
  'novelTitleSelector' | 'authorSelector' | 'synopsisSelector' | 'coverImageSelector' | 'tocLinkSelector' |
  'chapterContainerSelector' | 'chapterTitleSelector' | 'nextPageLinkSelector'
>>;

export interface GenerationProgress {
  message: string;
  percentage: number;
}

export interface ChapterPreview {
  id: string;
  title: string;
  url: string;
  order: number;
}

export interface Chapter extends ChapterPreview {
  content: string;
}

export interface ScrapedNovelDetails {
  novelTitle?: string;
  author?: string;
  synopsis?: string;
  scrapedCoverUrl?: string;
}

export interface TestSelectorConfig {
  proxyUrl: string;
  url: string;
  selector: string;
  returnType: 'text' | 'html' | 'attribute';
  attribute?: string;
  multi: boolean;
}

@Injectable({ providedIn: 'root' })
export class EpubService {
  private http = inject(HttpClient);

  getNovelDetailsAndChapterList(config: EpubGenerationConfig): Observable<{ details: ScrapedNovelDetails, chapters: ChapterPreview[] }> {
     // Always fetch the main TOC URL as an HTML page first to get metadata details.
    return this.fetchHtml(config.proxyUrl, config.tocUrl).pipe(
      switchMap(html => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const details = this.parseNovelDetails(doc, config.tocUrl, config);
        
        let chapters$: Observable<ChapterPreview[]>;

        if (config.dataSourceType === 'json') {
          chapters$ = this._fetchChaptersFromJsonApi(config);
        } else {
          // HTML mode (original logic)
          if (!config.paginatedToc) {
            const chapters = this.parseToc(doc, config.tocUrl, config.tocLinkSelector);
            if (chapters.length === 0) {
              throw new Error(`No chapter links found using selector: "${config.tocLinkSelector}". Please check the selector in Advanced Settings or the URL.`);
            }
            chapters$ = of(chapters);
          } else {
            chapters$ = this._fetchPaginatedHtmlToc(doc, config);
          }
        }
        
        return chapters$.pipe(
          map(chapters => ({ details, chapters }))
        );
      })
    );
  }

  private _fetchPaginatedHtmlToc(firstPageDoc: Document, config: EpubGenerationConfig): Observable<ChapterPreview[]> {
      const visitedUrls = new Set<string>([config.tocUrl]);
      const initialChapters = this.parseToc(firstPageDoc, config.tocUrl, config.tocLinkSelector);

      const fetchTocPage = (url: string): Observable<{ chapters: ChapterPreview[], nextUrl?: string }> => {
        if (visitedUrls.has(url) && url !== config.tocUrl) {
            return of({ chapters: [], nextUrl: undefined }); // Break loop
        }
        visitedUrls.add(url);

        const page$ = (url === config.tocUrl) 
            ? of(firstPageDoc) 
            : this.fetchHtml(config.proxyUrl, url).pipe(map(html => new DOMParser().parseFromString(html, 'text/html')));

        return page$.pipe(
            map(doc => {
                const chapters = (url === config.tocUrl) ? initialChapters : this.parseToc(doc, url, config.tocLinkSelector);
                let nextUrl: string | undefined;

                if (config.tocNextPageSelector) {
                    const nextLinkEl = doc.querySelector(config.tocNextPageSelector) as HTMLAnchorElement;
                    const hrefAttr = nextLinkEl?.getAttribute('href');
                    if (hrefAttr) {
                        const resolvedUrl = new URL(hrefAttr, url).href;
                        if (!visitedUrls.has(resolvedUrl)) {
                            nextUrl = resolvedUrl;
                        }
                    }
                }
                return { chapters, nextUrl };
            })
        );
    };

    return fetchTocPage(config.tocUrl).pipe(
      expand(res => res.nextUrl ? of(null).pipe(delay(config.requestDelay), switchMap(() => fetchTocPage(res.nextUrl!))) : EMPTY),
      reduce((acc, res) => acc.concat(res.chapters), [] as ChapterPreview[]),
      map(allChapters => this._finalizeChapterList(allChapters))
    );
  }

  private _fetchChaptersFromJsonApi(config: EpubGenerationConfig): Observable<ChapterPreview[]> {
     const visitedUrls = new Set<string>();

     const fetchPage = (url: string): Observable<{ chapters: ChapterPreview[], nextUrl?: string }> => {
        if (visitedUrls.has(url)) {
            return of({ chapters: [], nextUrl: undefined });
        }
        visitedUrls.add(url);

        return this.fetchJson(config.proxyUrl, url).pipe(
          map(json => {
            const chapterItems = this._getPropertyByPath(json, config.jsonChapterListPath) as any[];
            if (!Array.isArray(chapterItems)) {
              throw new Error(`JSON chapter list path "${config.jsonChapterListPath}" did not resolve to an array.`);
            }

            const chapters = chapterItems.map(item => {
              const title = this._getPropertyByPath(item, config.jsonChapterTitlePath);
              const urlPart = this._getPropertyByPath(item, config.jsonChapterUrlPath);
              if (typeof title !== 'string' || typeof urlPart !== 'string') {
                  console.warn('Skipping chapter item due to missing title or url:', item);
                  return null;
              }
              return { title: title.trim(), url: new URL(urlPart, url).href };
            }).filter((c): c is {title: string, url: string} => c !== null);

            const nextUrl = config.jsonNextPagePath ? this._getPropertyByPath(json, config.jsonNextPagePath) : undefined;
            
            return {
              chapters: chapters.map(c => ({...c, id: '', order: 0})), // temporary id/order
              nextUrl: typeof nextUrl === 'string' && !visitedUrls.has(nextUrl) ? nextUrl : undefined
            }
          })
        );
     }
     
     return fetchPage(config.tocUrl).pipe(
        expand(res => res.nextUrl ? of(null).pipe(delay(config.requestDelay), switchMap(() => fetchPage(res.nextUrl!))) : EMPTY),
        reduce((acc, res) => acc.concat(res.chapters), [] as ChapterPreview[]),
        map(allChapters => this._finalizeChapterList(allChapters))
     );
  }

  private _finalizeChapterList(chapters: ChapterPreview[]): ChapterPreview[] {
    if (chapters.length === 0) {
      throw new Error(`No chapters found. Check your TOC URL and selectors/paths.`);
    }
    // De-duplicate and re-assign order and id based on the final aggregated list
    const uniqueChapters = new Map<string, ChapterPreview>();
    chapters.forEach(c => {
        if (!uniqueChapters.has(c.url)) {
            uniqueChapters.set(c.url, c);
        }
    });

    return Array.from(uniqueChapters.values()).map((c, index) => ({
        ...c, 
        order: index + 1, 
        id: `chapter-${index + 1}`
    }));
  }
  
  fetchAndCleanChapter(chapter: ChapterPreview, config: EpubGenerationConfig, allTocChapters: ChapterPreview[] = []): Observable<{ title: string; content: string }> {
    return this.fetchFullChapterContent(chapter.url, config, allTocChapters).pipe(
        map(result => {
            const cleaned = this.cleanChapterContent(result.contentHtml, config, result.firstPageDoc);
            return {
                title: cleaned.title || chapter.title,
                content: cleaned.content
            };
        })
    );
  }

  fetchAllChapters(chaptersToProcess: ChapterPreview[], allTocChapters: ChapterPreview[], config: EpubGenerationConfig): Observable<Chapter & { status: 'success' | 'error' | 'downloading', error?: string }> {
    return from(chaptersToProcess).pipe(
      mergeMap(chapter => {
        return of(chapter).pipe(
          delay(config.requestDelay || 0), // Optional delay before starting
          switchMap(chap => {
            const start$ = of({ ...chap, content: '', status: 'downloading' as const });
            
            const fetch$ = this.fetchFullChapterContent(chap.url, config, allTocChapters).pipe(
              retry({
                count: config.maxRetries,
                delay: (error, retryCount) => {
                  console.log(`Attempt ${retryCount} failed for ${chap.title}. Retrying in ${config.retryDelay}ms...`, error);
                  return timer(config.retryDelay);
                }
              }),
              map(result => {
                const cleaned = this.cleanChapterContent(result.contentHtml, config, result.firstPageDoc);
                return {
                  ...chap,
                  title: cleaned.title || chap.title,
                  content: cleaned.content,
                  status: 'success' as const
                };
              }),
              catchError(err => {
                const errorMessage = err.message || 'Unknown fetch error';
                return of({
                  ...chap,
                  content: '',
                  status: 'error' as const,
                  error: errorMessage
                });
              })
            );

            return merge(start$, fetch$);
          })
        );
      }, config.concurrentDownloads) // Concurrency limit
    );
  }

  buildAndZipEpub(chapters: Chapter[], config: EpubGenerationConfig): Observable<void> {
    const bookId = `urn:uuid:${uuidv4()}`;
    return this.buildEpub(chapters, config, bookId).pipe(
      switchMap(zip => 
        new Observable<void>(observer => {
          zip.generateAsync({ type: 'blob' }).then((blob: Blob) => {
            const filename = `${config.novelTitle.replace(/ /g, '_')}.epub`;
            saveAs(blob, filename);
            observer.next();
            observer.complete();
          }).catch((err: any) => observer.error(err));
        })
      )
    );
  }

  buildTxt(chapters: Chapter[], config: EpubGenerationConfig): string {
    return chapters.map(ch => {
        const title = config.includeTitleInContent ? `<h1>${ch.title}</h1>\n\n` : '';
        // Basic HTML to text conversion
        const tempEl = document.createElement('div');
        tempEl.innerHTML = ch.content
            .replace(/<br\s*\/?>/gi, '\n') // Replace <br> with newlines
            .replace(/<\/p>/gi, '</p>\n'); // Add newline after paragraphs
        const textContent = tempEl.textContent || '';
        return `${title}${textContent.trim()}\n\n---\n\n`;
    }).join('');
  }

  testSelector(config: TestSelectorConfig): Observable<{ result: string | string[] | number }> {
    return this.fetchHtml(config.proxyUrl, config.url).pipe(
      map(html => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        
        if (config.multi) {
          const elements = Array.from(doc.querySelectorAll(config.selector));
          if (elements.length === 0) {
            throw new Error(`Selector "${config.selector}" not found on the page.`);
          }
          const results = elements.map(el => {
            if (config.returnType === 'text') {
              return el.textContent?.trim() || '';
            }
            if (config.returnType === 'attribute' && config.attribute) {
              const attr = el.getAttribute(config.attribute);
              return attr ? new URL(attr, config.url).href : '';
            }
            return '';
          }).filter(Boolean);
           if (results.length === 0) {
            throw new Error(`Selector "${config.selector}" found elements, but could not extract the required content.`);
          }
          return { result: results };
        } else {
          const el = doc.querySelector(config.selector);
          if (!el) {
            throw new Error(`Selector "${config.selector}" not found on the page.`);
          }
          let result: string | number | null = null;
          switch (config.returnType) {
            case 'text':
              result = el.textContent?.trim() || null;
              break;
            case 'html':
              result = el.innerHTML.trim();
              break;
            case 'attribute':
              if (config.attribute) {
                const attr = el.getAttribute(config.attribute);
                result = attr ? new URL(attr, config.url).href : null;
              }
              break;
          }
          if (result === null || result === '') {
             throw new Error(`Selector "${config.selector}" found an element, but it had no content or the required attribute.`);
          }
          return { result };
        }
      })
    );
  }

  autoDetectSelectors(tocUrl: string, firstChapterUrl: string, proxyUrl: string): Observable<DetectedSelectors> {
    const toc$ = this.fetchHtml(proxyUrl, tocUrl);
    const chapter$ = this.fetchHtml(proxyUrl, firstChapterUrl);

    return forkJoin({ toc: toc$, chapter: chapter$ }).pipe(
      map(({ toc, chapter }) => {
        const tocDoc = new DOMParser().parseFromString(toc, 'text/html');
        const chapterDoc = new DOMParser().parseFromString(chapter, 'text/html');
        
        const tocSelectors = this._analyzeTocPage(tocDoc);
        const chapterSelectors = this._analyzeChapterPage(chapterDoc);
        
        const detected = { ...tocSelectors, ...chapterSelectors };

        if (!detected.chapterContainerSelector) {
            throw new Error("Could not reliably detect the main content container. Please set it manually.");
        }
        if (!detected.tocLinkSelector) {
            throw new Error("Could not reliably detect the chapter links container. Please set it manually.");
        }

        return detected;
      })
    );
  }

  private _generateSelector(el: Element): string {
    if (el.id) {
        return `#${el.id}`;
    }
    let selector = el.tagName.toLowerCase();
    const classList = Array.from(el.classList).filter(c => !c.includes(':') && !/^\d/.test(c));
    if (classList.length > 0) {
        selector += '.' + classList.join('.');
    } else if (el.parentElement) {
        let parentSelector = this._generateSelector(el.parentElement);
        const children = Array.from(el.parentElement.children);
        const sameTagChildren = children.filter(child => child.tagName === el.tagName);
        if (sameTagChildren.length > 1) {
            const index = sameTagChildren.indexOf(el) + 1;
            selector = `${parentSelector} > ${selector}:nth-of-type(${index})`;
        } else {
            selector = `${parentSelector} > ${selector}`;
        }
    }
    return selector;
  }

  private _analyzeTocPage(doc: Document): DetectedSelectors {
    const selectors: DetectedSelectors = {};
    
    // Title
    const titleEl = doc.querySelector('h1, .post-title, .entry-title') || doc.querySelector('meta[property="og:title"]');
    if (titleEl) selectors.novelTitleSelector = this._generateSelector(titleEl);
    
    // Author
    const authorEl = doc.querySelector('.author, .author-name, a[rel="author"], .zuozhe');
    if(authorEl) selectors.authorSelector = this._generateSelector(authorEl);

    // Cover
    const coverEl = doc.querySelector('img.novel-cover, .cover img, #cover img') || doc.querySelector('meta[property="og:image"]');
    if(coverEl) selectors.coverImageSelector = this._generateSelector(coverEl);
    
    // Synopsis
    const synopsisEl = doc.querySelector('.synopsis, .description, .entry-content p, .jianjie') || doc.querySelector('meta[property="og:description"]');
    if(synopsisEl) selectors.synopsisSelector = this._generateSelector(synopsisEl);

    // Chapter Links
    let bestCandidate: Element | null = null;
    let maxLinks = 0;
    doc.querySelectorAll('ul, ol, div').forEach(container => {
        const links = container.querySelectorAll('a');
        if(links.length > maxLinks && links.length > 5) { // Heuristic: need at least 5 links
            maxLinks = links.length;
            bestCandidate = container;
        }
    });
    if(bestCandidate) {
        selectors.tocLinkSelector = `${this._generateSelector(bestCandidate)} a`;
    }

    return selectors;
  }

  private _analyzeChapterPage(doc: Document): DetectedSelectors {
    const selectors: DetectedSelectors = {};
    const body = doc.body;
    let bestContentCandidate: Element | null = null;
    let maxScore = -1;

    const candidates = body.querySelectorAll('div, article, section, main');
    candidates.forEach(el => {
        if(el.closest('nav, footer, .sidebar, #comments')) return; // ignore noisy containers

        const textLength = el.textContent?.trim().length || 0;
        const pCount = el.getElementsByTagName('p').length;
        const linkCount = el.getElementsByTagName('a').length;

        if (textLength < 200 || pCount < 2) return; // Basic filter

        let score = (pCount * 25) + (textLength / 100) - (linkCount * 5);
        
        const classAndId = `${el.className} ${el.id}`.toLowerCase();
        if(/content|chapter|entry|reading|text|neirong|zhangjie/i.test(classAndId)) score *= 1.5;
        if(/comment|meta|sidebar|nav|ad|footer/i.test(classAndId)) score *= 0.2;
        
        if(score > maxScore) {
            maxScore = score;
            bestContentCandidate = el;
        }
    });

    if (bestContentCandidate) {
        selectors.chapterContainerSelector = this._generateSelector(bestContentCandidate);
        
        // Find title within or just before the content
        const titleEl = bestContentCandidate.querySelector('h1, h2, h3') || doc.querySelector('h1, h2, h3');
        if(titleEl) selectors.chapterTitleSelector = this._generateSelector(titleEl);
    }
    
    // Next page link
    const nextLinkEl = doc.querySelector('a[rel="next"], a:is(.next-page, .nav-next, .next_page)');
    if(nextLinkEl) {
        selectors.nextPageLinkSelector = this._generateSelector(nextLinkEl);
    } else {
       const allLinks = Array.from(doc.querySelectorAll('a'));
       const nextLink = allLinks.find(a => /next|»|下一页|下一章/i.test(a.textContent || ''));
       if(nextLink) selectors.nextPageLinkSelector = this._generateSelector(nextLink);
    }

    return selectors;
  }

  private fetchFullChapterContent(url: string, config: EpubGenerationConfig, allChapters: ChapterPreview[] = []): Observable<{ contentHtml: string; firstPageDoc: Document; }> {
    const visitedUrls = new Set<string>();
    const allChapterUrlSet = new Set(allChapters.map(c => c.url));

    const fetchPage = (pageUrl: string): Observable<{ doc: Document, nextUrl?: string }> => {
        if (visitedUrls.has(pageUrl)) {
            return of({ doc: new DOMParser().parseFromString('', 'text/html'), nextUrl: undefined }); // Break loop
        }
        visitedUrls.add(pageUrl);

        return this.fetchHtml(config.proxyUrl, pageUrl).pipe(
            map(html => {
                const doc = new DOMParser().parseFromString(html, 'text/html');
                let nextUrl: string | undefined;
                if (config.nextPageLinkSelector) {
                    const nextLinkEl = doc.querySelector(config.nextPageLinkSelector) as HTMLAnchorElement;
                    const hrefAttr = nextLinkEl?.getAttribute('href');
                    if (hrefAttr) {
                        const resolvedUrl = new URL(hrefAttr, pageUrl).href;
                        // Stop if the next link is another chapter from the TOC (and not the current one)
                        if (allChapterUrlSet.has(resolvedUrl) && resolvedUrl !== url) {
                            nextUrl = undefined;
                        } else if (!visitedUrls.has(resolvedUrl)) {
                            nextUrl = resolvedUrl;
                        }
                    }
                }
                return { doc, nextUrl };
            })
        );
    };

    let firstPageDoc: Document | null = null;
    return fetchPage(url).pipe(
        tap(res => {
            if (!firstPageDoc && res.doc.body.innerHTML) {
                firstPageDoc = res.doc;
            }
        }),
        expand(res => res.nextUrl ? of(null).pipe(delay(config.requestDelay), switchMap(() => fetchPage(res.nextUrl!))) : EMPTY),
        map(res => {
            if (!res.doc.body.innerHTML) return '';
            const contentEl = res.doc.querySelector(config.chapterContainerSelector);
            return contentEl ? contentEl.innerHTML : '';
        }),
        reduce((acc, html) => acc + html, ''),
        map(contentHtml => {
             if (!firstPageDoc) {
                throw new Error(`Could not fetch or parse the first page of chapter at ${url}`);
            }
            if (!contentHtml) {
              throw new Error(`No content found for chapter at ${url} using container selector "${config.chapterContainerSelector}".`)
            }
            return { contentHtml, firstPageDoc };
        })
    );
  }

  private _getPropertyByPath(obj: any, path: string): any {
    if (!path) return undefined;
    return path.split('.').reduce((o, k) => (o && o[k] !== undefined) ? o[k] : undefined, obj);
  }
  
  private fetchHtml(proxyUrl: string, targetUrl: string): Observable<string> {
    const fetchUrl = this.buildProxyUrl(proxyUrl, targetUrl);
    
    return this.http.get(fetchUrl, { responseType: 'text' }).pipe(
        catchError(err => {
            let errorMessage = `Failed to fetch ${targetUrl}. Status: ${err.status}.`;
            if (proxyUrl) {
                errorMessage += ' The server may be blocking the proxy, or the URL is incorrect. Try selecting a different proxy in Advanced Settings.';
            } else {
                errorMessage += ' This is likely a CORS issue. Please select a CORS proxy from the advanced settings.';
            }
            throw new Error(errorMessage);
        })
    );
  }

  private fetchJson(proxyUrl: string, targetUrl: string): Observable<any> {
    const fetchUrl = this.buildProxyUrl(proxyUrl, targetUrl);
    
    return this.http.get<any>(fetchUrl).pipe(
      catchError(err => {
        throw new Error(`Failed to fetch JSON from ${targetUrl}. Status: ${err.status}. Check the API URL and proxy settings.`);
      })
    );
  }

  private buildProxyUrl(proxyUrl: string, targetUrl: string): string {
    if (!proxyUrl) return targetUrl;
    if (proxyUrl.includes('?url=')) {
        return `${proxyUrl}${encodeURIComponent(targetUrl)}`;
    }
    // For proxies that append the URL directly
    return `${proxyUrl}${targetUrl}`;
  }

  private parseNovelDetails(doc: Document, baseUrl: string, config: EpubGenerationConfig): ScrapedNovelDetails {
    const details: ScrapedNovelDetails = {};

    if (config.novelTitleSelector) {
      const el = doc.querySelector(config.novelTitleSelector);
      if (el) details.novelTitle = el.textContent?.trim();
    }
    if (config.authorSelector) {
      const el = doc.querySelector(config.authorSelector);
      if (el) details.author = el.textContent?.trim();
    }
    if (config.synopsisSelector) {
      const el = doc.querySelector(config.synopsisSelector);
      if (el) details.synopsis = el.textContent?.trim();
    }
    if (config.coverImageSelector) {
        const coverEl = doc.querySelector(config.coverImageSelector) as HTMLImageElement;
        const srcAttr = coverEl?.getAttribute('src');
        if (srcAttr) {
            details.scrapedCoverUrl = new URL(srcAttr, baseUrl).href;
        }
    }
    return details;
  }

  private parseToc(doc: Document, baseUrl: string, selector: string): ChapterPreview[] {
    const links = Array.from(doc.querySelectorAll(selector)) as HTMLAnchorElement[];
    const uniqueLinks = new Map<string, string>();

    links.forEach(link => {
        const hrefAttr = link.getAttribute('href');
        if (!hrefAttr || hrefAttr.startsWith('javascript:')) return;

        try {
          const url = new URL(hrefAttr, baseUrl).href;
          const title = link.textContent?.trim() || 'Untitled Chapter';
          if (url && !uniqueLinks.has(url)) {
              uniqueLinks.set(url, title);
          }
        } catch (e) {
          console.warn(`Skipping invalid URL found in TOC: href="${hrefAttr}", base="${baseUrl}"`);
        }
    });

    return Array.from(uniqueLinks.entries()).map(([url, title], index) => ({
      id: `chapter-${index + 1}`,
      title,
      url,
      order: index + 1,
    }));
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
  }

  private cleanChapterContent(html: string, config: EpubGenerationConfig, firstPageDoc: Document): { content: string, title?: string } {
    let newTitle: string | undefined = undefined;
    if (config.chapterTitleSelector) {
        const titleEl = firstPageDoc.querySelector(config.chapterTitleSelector);
        if (titleEl) {
            newTitle = titleEl.textContent?.trim();
        }
    }

    const tempEl = document.createElement('div');
    tempEl.innerHTML = html;
    
    if(config.elementsToRemoveSelector) {
        tempEl.querySelectorAll(config.elementsToRemoveSelector).forEach(el => el.remove());
    }

    if (config.textToRemove && config.textToRemove.length > 0) {
        let currentHtml = tempEl.innerHTML;
        config.textToRemove.forEach(phrase => {
            currentHtml = currentHtml.replace(new RegExp(this.escapeRegExp(phrase), 'g'), '');
        });
        tempEl.innerHTML = currentHtml;
    }

    let contentHtml = tempEl.innerHTML;
    contentHtml = contentHtml.replace(/&nbsp;/g, '&#160;');

    const voidElements = ['br', 'hr', 'img', 'input', 'link', 'meta'];
    voidElements.forEach(tag => {
        const regex = new RegExp(`<${tag}([^>]*?)(?<!/)>`, 'gi');
        contentHtml = contentHtml.replace(regex, `<${tag}$1 />`);
    });

    return { content: contentHtml, title: newTitle };
  }

  private fetchCoverImage(config: EpubGenerationConfig): Observable<{ data: string; type: string } | null> {
    if (config.coverImageBase64) {
      const match = config.coverImageBase64.match(/^data:(image\/[a-z]+);base64,(.+)$/);
      if(match) {
        return of({ data: match[2], type: match[1] });
      }
    }

    if (config.coverImageUrl) {
       const url = this.buildProxyUrl(config.proxyUrl, config.coverImageUrl);
        return this.http.get(url, { responseType: 'blob' }).pipe(
            switchMap(blob => new Observable<{ data: string; type: string }>(observer => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const base64data = (reader.result as string).split(',')[1];
                    observer.next({ data: base64data, type: blob.type });
                    observer.complete();
                };
                reader.onerror = (error) => observer.error(error);
                reader.readAsDataURL(blob);
            })),
            catchError(() => of(null)) // Ignore cover fetch errors
        );
    }
    return of(null);
  }
  
  private buildEpub(chapters: Chapter[], config: EpubGenerationConfig, bookId: string): Observable<any> {
    return this.fetchCoverImage(config).pipe(
      switchMap(cover => {
        const zip = new JSZip();
        zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

        const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
        zip.file('META-INF/container.xml', containerXml);

        const oebps = zip.folder('OEBPS');
        
        const chapterManifestItems = chapters.map(ch => `<item id="${ch.id}" href="${ch.id}.xhtml" media-type="application/xhtml+xml"/>`).join('\n');
        const chapterSpineItems = chapters.map(ch => `<itemref idref="${ch.id}"/>`).join('\n');
        chapters.forEach(ch => {
            const chapterTitleHtml = config.includeTitleInContent ? `<h1>${ch.title}</h1>\n` : '';
            const chapterXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
<head>
  <title>${ch.title}</title>
  <link href="style.css" rel="stylesheet" type="text/css"/>
</head>
<body>
  ${chapterTitleHtml}
  ${ch.content}
</body>
</html>`;
            oebps!.file(`${ch.id}.xhtml`, chapterXhtml);
        });

        const stylesheet = `body { font-family: sans-serif; line-height: 1.5; } h1, h2, h3 { margin-top: 1.5em; } img { max-width: 100%; height: auto; }`;
        oebps!.file('style.css', stylesheet);

        let coverManifest = '';
        let coverMetadata = '';
        if (cover) {
          const coverFilename = `cover.${cover.type.split('/')[1] || 'jpeg'}`;
          oebps!.file(coverFilename, cover.data, { base64: true });
          coverManifest = `<item id="cover" href="${coverFilename}" media-type="${cover.type}" properties="cover-image"/>`;
          coverMetadata = `<meta name="cover" content="cover"/>`;
        }

        const genres = (config.genres || '').split(',').map(g => g.trim()).filter(g => g).map(g => `<dc:subject>${g}</dc:subject>`).join('\n');

        const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${config.novelTitle}</dc:title>
    <dc:creator>${config.author}</dc:creator>
    <dc:identifier id="bookid">${bookId}</dc:identifier>
    <dc:language>en</dc:language>
    ${config.synopsis ? `<dc:description>${config.synopsis.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</dc:description>` : ''}
    ${config.publisher ? `<dc:publisher>${config.publisher}</dc:publisher>` : ''}
    ${genres}
    <meta property="dcterms:modified">${new Date().toISOString()}</meta>
    ${coverMetadata}
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
    ${coverManifest}
    ${chapterManifestItems}
  </manifest>
  <spine>
    ${chapterSpineItems}
  </spine>
</package>`;
        oebps!.file('content.opf', contentOpf);
        
        const navListItems = chapters.map(ch => `<li><a href="${ch.id}.xhtml">${ch.title}</a></li>`).join('\n');
        const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
<head>
  <title>Table of Contents</title>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Table of Contents</h1>
    <ol>
      ${navListItems}
    </ol>
  </nav>
</body>
</html>`;
        oebps!.file('nav.xhtml', navXhtml);

        return of(zip);
      })
    );
  }

}
