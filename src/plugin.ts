import pluginCss from './styles.scss';
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
    this.addToAllWindows();
    Zotero.Reader.registerEventListener(
      'renderToolbar',
      this.onRenderToolbar,
      this.id,
    );
    await this.handleExistingTabs();
  }

  shutdown(): void {
    this.removeFromAllWindows();
    Zotero.Reader.unregisterEventListener(
      'renderToolbar',
      this.onRenderToolbar,
    );
  }

  addToWindow(window: _ZoteroTypes.MainWindow): void {
    // this.addMenuItems(window);
  }

  addToAllWindows(): void {
    Zotero.getMainWindows().forEach((win) => {
      if (!win.ZoteroPane) return;
      this.addToWindow(win);
    });
  }

  removeFromWindow(window: _ZoteroTypes.MainWindow): void {
    // this.removeMenuItems(window);
  }

  removeFromAllWindows(): void {
    Zotero.getMainWindows().forEach((win) => {
      if (!win.ZoteroPane) return;
      this.removeFromWindow(win);
    });
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

  #observerID?: string;
  registerObserver() {
    this.log('registering tab observer');
    if (this.#observerID) {
      throw new Error(`${this.id}: observer is already registered`);
    }
    this.#observerID = Zotero.Notifier.registerObserver(
      {
        notify: async (event, type, ids, extraData) => {
          // @ts-expect-error zotero-types doesn't include 'load' in the event definition, but tabs have a load event
          if ((event === 'add' || event === 'load') && type === 'tab') {
            const tabIDs = ids.filter((id) => extraData[id].type === 'reader');
            await Promise.all(
              tabIDs.map(async (id) => {
                const reader = Zotero.Reader.getByTabID(id.toString());
                // await this.attachStylesToReader(reader);
              }),
            );
          }
        },
      },
      ['tab'],
    );
    this.log('registered observer: ' + this.#observerID);
  }

  unregisterObserver() {
    if (this.#observerID) {
      this.log('unregistering observer: ' + this.#observerID);
      Zotero.Notifier.unregisterObserver(this.#observerID);
      this.#observerID = undefined;
    }
  }

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

  addMenuItems(window: _ZoteroTypes.MainWindow): void {
    const doc = window.document;
    const menuId = `${config.addonRef}-menu-item`;
    if (doc.getElementById(menuId)) {
      this.log('toolbar menu already attached');
      return;
    }

    window.MozXULElement.insertFTLIfNeeded(`${config.addonRef}-menu.ftl`);

    const menuitem = doc.createXULElement('menuitem') as XULMenuItemElement;
    menuitem.id = menuId;
    menuitem.classList.add('menu-type-reader');
    menuitem.setAttribute('type', 'checkbox');
    menuitem.setAttribute('data-l10n-id', menuId);

    menuitem.addEventListener('command', async (_e: CommandEvent) => {
      const isChecked = menuitem.getAttribute('checked') === 'true';
      this.#isActive = isChecked;
    });

    const viewMenu = doc.getElementById('menu_viewPopup');
    const referenceNode =
      viewMenu?.querySelector('menuseparator.menu-type-library') || null;
    const inserted = viewMenu?.insertBefore(menuitem, referenceNode);

    if (inserted) {
      this.log(`successfully inserted menuitem: ${menuitem.id}`);
      this.storeAddedElement(menuitem);
    }
  }

  removeMenuItems(window: _ZoteroTypes.MainWindow): void {
    const doc = window.document;
    for (const id of this.#addedElementIDs) {
      doc.getElementById(id)?.remove();
    }
  }

  #addedElementIDs: string[] = [];
  storeAddedElement(elem: Element) {
    if (!elem.id) {
      throw new Error('Element must have an id');
    }
    this.#addedElementIDs.push(elem.id);
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
