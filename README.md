# Web Novel EPUB Generator

[![Client-Side Only](https://img.shields.io/badge/architecture-client--side-brightgreen)](https://shields.io/)

A powerful, browser-based tool that fetches chapters from a web novel's table of contents and compiles them into a clean, downloadable EPUB or TXT file. All processing happens directly in your browser, ensuring your data remains private and secure.

![App Screenshot](https://picsum.photos/id/24/1200/630)

---

## Key Features

-   **100% Client-Side:** No server, no data collection. Everything happens in your browser.
-   **Highly Customizable Parser:** Define specific CSS selectors to scrape content from almost any web novel website.
-   **Auto-Detect Selectors (Experimental):** Automatically analyzes the provided URLs to suggest the correct selectors, getting you started in seconds.
-   **Advanced Content Handling:**
    -   Seamlessly follows "next page" links for both multi-page tables of contents and multi-part chapters.
    -   Supports fetching chapter lists from JSON APIs for modern, dynamic websites.
-   **Content Cleanup:**
    -   Remove unwanted elements like ads, comments, and navigation bars using CSS selectors.
    -   Strip out specific recurring phrases (e.g., "Thanks for reading!", "Support the author!").
-   **Preset Management:** Save, load, import, and export configurations for your favorite novel sites so you don't have to set them up every time.
-   **Custom Cover Support:** Automatically scrapes the cover image from the site, or you can upload your own.
-   **Multiple Download Formats:** Download the compiled novel as a standard `.epub` file or a simple `.txt` file.
-   **Modern UI:** A clean, responsive interface with a dark mode for comfortable use.

## How It Works

The application follows a simple, multi-step process to generate your EPUB:

1.  **Configuration:** You provide the URL for the novel's Table of Contents and (optionally) the first chapter. The app uses this to find the content.
2.  **Selector Setup:** You tell the app where to find the data. This can be done instantly with the **Auto-Detect** feature or configured manually in the **Advanced Settings** for complex sites.
3.  **Fetch Details:** The app makes web requests (via a CORS proxy) to the Table of Contents URL. It scrapes the novel's title, author, cover, and the full list of chapter URLs.
4.  **Chapter Selection:** You are presented with the complete list of chapters. You can re-order them via drag-and-drop, filter the list, and select exactly which ones you want to include in your EPUB.
5.  **Generation:** The app downloads the HTML for each selected chapter one by one, respecting the concurrency and delay settings you've configured.
6.  **Cleaning & Parsing:** For each chapter, it removes the unwanted elements and text you specified, extracts the core content, and cleans up the HTML.
7.  **Compilation & Download:** Once all chapters are processed, it compiles them into a valid EPUB 3 file (or a single TXT file) and prompts you to save it to your device.

## Quick Start Guide

1.  **Open the application.**
2.  **Enter the URL** for the novel's main Table of Contents page (the page that lists all the chapters).
3.  **Enter the URL** for the first chapter of the novel.
4.  Click the **Auto-Detect Selectors** button. The app will attempt to find all the necessary CSS selectors automatically. You will see a success message if it works.
5.  Click **Fetch Novel Chapters**.
6.  The app will load the novel's details. Review them and click **Select Chapters &raquo;**.
7.  Select the chapters you wish to download (they are all selected by default).
8.  Click **Generate EPUB**.
9.  Wait for the process to complete, then click **Download EPUB**.

## Advanced Usage & Troubleshooting

For websites that are not compatible with the auto-detection feature, you can open the **Advanced Settings** panel (cog icon) to configure everything manually.

-   **Finding Selectors Manually:** Use your browser's Developer Tools (usually by right-clicking an element and choosing "Inspect"). Find the HTML element that contains the content you need (e.g., the main text of a chapter) and determine a unique CSS selector for it (e.g., `#content`, `.chapter-text`, `article.post`).
-   **CORS Proxy:** Web browsers have security policies (CORS) that prevent a website from fetching data from another domain. This app uses a public CORS proxy to get around this. If you are having trouble fetching chapters, the proxy might be down or blocked. You can change the proxy URL in the "General" settings tab.
-   **JSON API Mode:** Some modern websites load their chapter lists dynamically. Use your browser's Network tab in the developer tools to find the API request that returns the chapter data (often a `.json` file). You can switch the Data Source to "JSON API" and provide the paths to the data within the JSON object.
-   **Presets:** Once you have a working configuration for a site, save it as a preset! Give it a name, click save, and you can easily load it next time from the dropdown menu. You can also export your settings to a JSON file to share with others or for backup.

## Technical Stack

-   **Framework:** Angular (v20+, Zoneless)
-   **State Management:** Angular Signals
-   **Styling:** Tailwind CSS
-   **EPUB Generation:** [JSZip](https://stuk.github.io/jszip/)
-   **File Saving:** [FileSaver.js](https://github.com/eligrey/FileSaver.js)
-   **Icons:** Heroicons

---

Enjoy your reading!
