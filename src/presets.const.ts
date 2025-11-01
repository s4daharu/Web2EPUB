import { EpubGenerationConfig } from "./services/epub.service";

// Define presets directly in the file to avoid HTTP loading issues.
export const INLINED_DEFAULT_PRESETS: {name: string, config: Partial<EpubGenerationConfig>}[] = [
  {
    name: "Novel543.com (Example)",
    config: {
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
  },
  {
    name: "52shuku.net (Example)",
    config: {
      tocUrl: "https://www.52shuku.net/yanqing/pm/h5nx.html",
      firstChapterUrl: "https://www.52shuku.net/yanqing/pm/h5nx_2.html",
      novelTitle: "碰瓷翻了车_含胭【完结+番外】",
      author: "含胭",
      tocLinkSelector: "article > ul > li > a",
      chapterContainerSelector: "#text",
      elementsToRemoveSelector: "script, style, iframe, nav, .nav, #nav, footer, .footer, #footer, .sidebar, #sidebar, .comments, #comments, .ad, .ads , #lineCorrect , button",
      novelTitleSelector: "h1.article-title",
      nextPageLinkSelector: "div.pagination2 > ul > a:nth-of-type(3)",
      concurrentDownloads: 1,
    }
  },
  {
    name: "xbanxia.cc (Example)",
    config: {
      tocUrl: "https://www.xbanxia.cc/books/390961.html",
      firstChapterUrl: "https://www.xbanxia.cc/books/390961/69068842.html",
      tocLinkSelector: "#content-list > div.book-list.clearfix > ul > li > a",
      chapterContainerSelector: "#nr1",
      chapterTitleSelector: "#nr_title",
      elementsToRemoveSelector: "script, style, iframe, nav, .nav, #nav, footer, .footer, #footer, .sidebar, #sidebar, .comments, #comments, .ad, .ads ,span",
      coverImageSelector: "#content-list > div.book-intro.clearfix > div.book-img > img",
      authorSelector: "#content-list > div.book-intro.clearfix > div.book-describe > p > a",
      synopsisSelector: "#content-list > div.book-intro.clearfix > div.book-describe > div",
      concurrentDownloads: 1
    }
  }
];