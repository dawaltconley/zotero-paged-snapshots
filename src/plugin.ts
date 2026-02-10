import { config, version as packageVersion } from '../package.json';

export interface PluginOptions {
  id: string;
  version: string;
  rootURI: string;
  stylesId?: string;
}

export class Plugin {
  readonly id: string;
  readonly stylesId: string;
  readonly version: string;
  readonly rootURI: string;

  #isActive: boolean = true;
  get isActive(): boolean {
    return this.#isActive;
  }

  constructor({
    id = config.addonID,
    stylesId = `${config.addonRef}__pluginStyles`,
    version = packageVersion,
    rootURI,
  }: PluginOptions) {
    this.id = id;
    this.stylesId = stylesId;
    this.version = version;
    this.rootURI = rootURI;
  }

  async startup(): Promise<void> {
    Zotero.Reader.registerEventListener(
      'renderToolbar',
      this.onRenderToolbar,
      this.id,
    );
    await this.handleExistingTabs();
  }

  shutdown(): void {
    Zotero.Reader.unregisterEventListener(
      'renderToolbar',
      this.onRenderToolbar,
    );
  }

  async handleExistingTabs() {
    this.log('adding styles to existing tabs');
    const readers = Zotero.Reader._readers.filter(isSnapshotReader);
    this.log(
      `found ${readers.length} snapshot reader tabs: ${readers.map((r) => r.tabID).join(', ')}`,
    );
    await Promise.all(readers.map((r) => this.attachButtonsToReader(r)));
    this.log('done adding styles to existing tabs');
  }

  onRenderToolbar = (e: _ZoteroTypes.Reader.EventParams<'renderToolbar'>) => {
    const reader = e.reader;
    if (isSnapshotReader(reader)) {
      this.attachButtonsToReader(reader);
    }
  };

  #updatedTabs = new Set<string | number>();
  async attachButtonsToReader(
    reader: _ZoteroTypes.ReaderInstance<'snapshot'>,
  ): Promise<void> {
    if (this.#updatedTabs.has(reader.tabID)) {
      return;
    }
    await reader._waitForReader();
    await reader._initPromise;
    const doc = reader?._iframeWindow?.document;
    const iframe = doc?.querySelector<HTMLIFrameElement>(
      '.primary-view iframe',
    );
    if (!doc || !iframe || !isIframe(iframe)) {
      this.log(`couldn't attach styles; tab ${reader.tabID} not ready`);
      return;
    }
    const win = await Plugin.getIFrameWindow(iframe);
    if (!win) {
      this.log(`couldn't get iframe window for tab ${reader.tabID}`);
      return;
    }
    const toolbarSection = doc.querySelector('div.toolbar .start');
    if (!toolbarSection) {
      this.log(`couldn't get toolbar for tab ${reader.tabID}`);
      return;
    }
    if (
      toolbarSection.querySelector('#next') ||
      toolbarSection.querySelector('#previous')
    ) {
      this.log(`aborting; already added buttons to tab ${reader.tabID}`);
      return;
    }

    const btnNext = this.getButton(doc, 'next');
    const btnPrev = this.getButton(doc, 'previous');
    btnNext.addEventListener('click', () => win.scrollByPages(1));
    btnPrev.addEventListener('click', () => win.scrollByPages(-1));
    toolbarSection.appendChild(btnPrev);
    toolbarSection.appendChild(btnNext);

    this.#updatedTabs.add(reader.tabID);
  }

  getButton(doc: Document, type: 'next' | 'previous'): HTMLButtonElement {
    // Create button
    const button = doc.createElement('button');
    button.classList.add('toolbar-button', 'pageUp');
    button.tabIndex = -1;
    // button.setAttribute("aria-describedby", "numPages");

    // Create SVG
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(svgNS, 'svg');
    svg.setAttribute('xmlns', svgNS);
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('fill', 'none');

    // Create path
    const path = doc.createElementNS(svgNS, 'path');
    path.setAttribute('fill', 'currentColor');

    // Distinguish next/previous
    if (type === 'next') {
      button.title = 'Next Page';
      button.id = 'next';
      path.setAttribute('d', 'm17.116 6 .884.884-8 8-8-8L2.884 6 10 13.116z');
    } else {
      button.title = 'Previous Page';
      button.id = 'previous';
      path.setAttribute('d', 'M2.884 14 2 13.116l8-8 8 8-.884.884L10 6.884z');
    }

    // Assemble
    svg.appendChild(path);
    button.appendChild(svg);

    return button;
  }

  log(msg: string) {
    const message = `[${config.addonName}] ${msg}`;
    Zotero.debug(message);
    Zotero.log(message);
  }

  static getIFrameWindow(iframe: HTMLIFrameElement): Promise<Window | null> {
    return new Promise((resolve) => {
      if (iframe?.contentWindow) {
        resolve(iframe.contentWindow);
      } else {
        iframe.addEventListener('load', () => {
          resolve(iframe.contentWindow || null);
        });
      }
    });
  }
}

const isIframe = (e: Element): e is HTMLIFrameElement =>
  e.tagName.toUpperCase() === 'IFRAME';

const isSnapshotReader = (
  r: _ZoteroTypes.ReaderInstance,
): r is _ZoteroTypes.ReaderInstance<'snapshot'> => r.type === 'snapshot';
