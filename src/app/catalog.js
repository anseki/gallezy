/* eslint strict: [2, "function"] */

window.addEventListener('load', () => {
  'use strict';

  const
    electron = require('electron'),
    remote = electron.remote,
    ipc = electron.ipcRenderer,
    dialog = remote.dialog,

    fs = require('fs'),
    pathUtil = require('path'),
    filelist = require('stats-filelist'),
    $ = window.$ || window.jQuery,
    CatalogItem = require('./catalog-item.js'),
    keyEvent = require('./key-event.js'),

    META = JSON.parse(ipc.sendSync('get-meta')),
    FILE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'bmp', 'tif', 'wmf'],
    THUMB_SIZE = [50, 100, 150, 200, 250, 300, 400, 500], // Max: 9 items
    DEFAULT_THUMB_SIZE = 2,
    THEME_CLASS = ['dark', 'light'],
    DEFAULT_THEME_CLASS = 0,
    SORT_KEY_LABEL = {
      dirPath: 'Directory Path',
      name: 'File Name',
      area: 'Width x Height',
      width: 'Width',
      height: 'Height',
      extension: 'File Extension',
      mtime: 'Modified Time',
      size: 'File Size'
    };

  var ui = remote.getCurrentWindow(),
    $window = $(window), $body = $('body').plainOverlay(),
    isBusyOn = false, menuShown = false, viewOpened = false,
    stats = {}, commands, menuItems, commandDisabled = {},
    menuSortLabels = {}, $menuSortKeysAfter;

  function hideMenu() {
    if (menuShown) { $body.contextMenuCommon('hide'); }
  }

  function showError(error) {
    hideMenu();
    console.error(error);
    dialog.showMessageBox(ui, {
      type: 'error',
      buttons: ['OK'],
      title: 'Error',
      message: typeof error === 'string' ? error :
        `[${error.code || 'ERROR'}]\n${error.message || error}`
    });
  }

  function busy(bOn, ignoreComplete) {
    var op = (bOn = !!bOn) ? 'show' : 'hide';
    if (bOn !== isBusyOn) {
      isBusyOn = bOn;
      if (isBusyOn) { hideMenu(); }
      CatalogItem.keyDisabled(isBusyOn);
      $body.contextMenuCommon(!isBusyOn) // true: enable, false: disable
        .plainOverlay(op, isBusyOn ? null : ignoreComplete);
    }
  }

  /**
   * @param {number|boolean} size - true: size-up, false: size-down, number: size index
   * @param {boolean} [byMenuValue] - Don't update value of menu.
   * @returns {number} thumbSize
   */
  function updateThumbSize(size, byMenuValue) {
    if (typeof size === 'boolean') { size = stats.thumbSize + (size ? 1 : -1); }
    if (size > THUMB_SIZE.length - 1) {
      size = THUMB_SIZE.length - 1;
    } else if (size < 0) {
      size = 0;
    }

    if (size !== stats.thumbSize) {
      CatalogItem.setThumbSize(THUMB_SIZE[(stats.thumbSize = size)]);
      if (!byMenuValue) { $body.contextMenuCommon('value', 'thumbSize', size); }
      commandDisabled.thumbSizeUp = size >= THUMB_SIZE.length - 1;
      commandDisabled.thumbSizeDown = size <= 0;
    }
    return stats.thumbSize;
  }

  /**
   * @param {string} key - Sort key.
   * @param {boolean} desc - Descending order.
   * @param {boolean} [byMenuValue] - Don't update value of menu.
   * @returns {Array} sortBy
   */
  function updateSortBy(key, desc, byMenuValue) {
    var i = stats.sortBy.findIndex(keyOrder => keyOrder.key === key);
    if (i >= 1 || i === 0 && desc !== stats.sortBy[i].desc) {
      stats.sortBy = CatalogItem.sort(key, desc);
      if (!byMenuValue) {
        $body.contextMenuCommon('value', 'sortKey', key);
        $body.contextMenuCommon('value', 'sortDesc', desc);
      }

      // Menu label
      if (!$menuSortKeysAfter) { // Get insert point
        let elmMenuSortKeysAfter = menuSortLabels[`sortKey_${key}`].get(0);
        Object.keys(menuSortLabels).forEach(commandId => {
          var elm = menuSortLabels[commandId].get(0);
          if (elm !== elmMenuSortKeysAfter &&
              elm.compareDocumentPosition(elmMenuSortKeysAfter) & Node.DOCUMENT_POSITION_FOLLOWING) {
            elmMenuSortKeysAfter = elm;
          }
        });
        $menuSortKeysAfter = $(elmMenuSortKeysAfter).parent().prev();
      }
      let menuSortLabelsArray = stats.sortBy.map((keyOrder, i) => {
        var commandId = `sortKey_${keyOrder.key}`;
        return menuSortLabels[commandId]
          .text(`[${i + 1}${keyOrder.desc ? 'D' : 'A'}] ${SORT_KEY_LABEL[keyOrder.key]}`)
          .parent().attr('title',
              `Current Sort Key #${i + 1}, ${keyOrder.desc ? 'Descending' : 'Ascending'} Order`);
      });
      if ($menuSortKeysAfter.length) {
        $menuSortKeysAfter.after(menuSortLabelsArray);
      } else {
        menuSortLabels[`sortKey_${key}`].parent().parent().prepend(menuSortLabelsArray);
      }
    }
    return stats.sortBy;
  }

  function updateSortByByMenu() {
    updateSortBy($body.contextMenuCommon('value', 'sortKey'),
      $body.contextMenuCommon('value', 'sortDesc'), true);
  }

  /**
   * @param {boolean} listView - list view or not.
   * @param {boolean} [byMenuValue] - Don't update value of menu.
   * @returns {boolean} listView
   */
  function updateViewType(listView, byMenuValue) {
    if (listView !== stats.listView) {
      CatalogItem.setViewType((stats.listView = listView));
      if (!byMenuValue) { $body.contextMenuCommon('value', 'listView', listView); }
      commandDisabled.thumbSize = commandDisabled.showInfo = listView;
    }
    return stats.listView;
  }

  /**
   * @param {boolean} showInfo - show path or not.
   * @param {boolean} [byMenuValue] - Don't update value of menu.
   * @returns {boolean} showInfo
   */
  function updateShowInfo(showInfo, byMenuValue) {
    if (showInfo !== stats.showInfo) {
      CatalogItem.setShowInfo((stats.showInfo = showInfo));
      if (!byMenuValue) { $body.contextMenuCommon('value', 'showInfo', showInfo); }
    }
    return stats.showInfo;
  }

  /**
   * @param {number} theme - theme index
   * @param {boolean} [byMenuValue] - Don't update value of menu.
   * @returns {number} theme
   */
  function updateTheme(theme, byMenuValue) {
    if (theme > THEME_CLASS.length - 1) {
      theme = THEME_CLASS.length - 1;
    } else if (theme < 0) {
      theme = 0;
    }

    if (theme !== stats.theme) {
      if (THEME_CLASS[stats.theme]) { $body.removeClass(THEME_CLASS[stats.theme]); }
      $body.addClass(THEME_CLASS[(stats.theme = theme)]);
      if (!byMenuValue) { $body.contextMenuCommon('value', 'theme', theme); }
    }
    return stats.theme;
  }

  /**
   * @param {boolean|null} fullScreen - full-screen or not. null: toggle
   * @param {boolean} [byMenuValue] - Don't update value of menu.
   * @returns {boolean} fullScreen
   */
  function updateFullScreen(fullScreen, byMenuValue) {
    var curFullScreen = ui.isFullScreen(); // stats is updated by main.js
    if (fullScreen == null) { fullScreen = !curFullScreen; } // eslint-disable-line eqeqeq
    if (fullScreen !== curFullScreen) {
      ui.setFullScreen(fullScreen);
      if (!byMenuValue) { $body.contextMenuCommon('value', 'fullScreen', fullScreen); }
    }
    return fullScreen;
  }

  function open(path) {

    function receiveStats(error, targetStats) {
      if (error) {
        showError(error);
        busy(false);
        return;
      }

      if (targetStats.isFile()) {
        fs.stat((path = pathUtil.dirname(path)), receiveStats);
        return;
      }
      if (!targetStats.isDirectory()) {
        showError(new Error('Not directory: ' + path));
        busy(false);
        return;
      }

      filelist.get(path, files => {
        if (!files.length) {
          showError(new Error('Image file was not found: ' + path));
          busy(false);
          return;
        }

        ui.setTitle(`${files.length} file${files.length > 1 ? 's' : ''} - ${path}` +
          ` - ${META.winTitle.catalog}`);

        // Since `clear` make selected item be null, `addFiles` select 1st item.
        $body.plainOverlay('scrollLeft', 0).plainOverlay('scrollTop', 0); // before clear
        CatalogItem.clear();
        CatalogItem.addFiles(files, path, true, () => { busy(false); });

        stats.lastPath = path;
      },
      stats => stats.isFile() && FILE_EXTS.indexOf(stats.extension.toLowerCase()) > -1);
    }

    busy(true);
    fs.stat(path, receiveStats);
  }

  function chooseOpenPath() {
    var path;
    hideMenu();
    path = dialog.showOpenDialog(ui, {
      title: 'Open Folder',
      defaultPath: stats.lastPath,
      properties: ['openDirectory']
    });
    if (path && path[0]) { open(path[0]); }
  }

  function view(exist) {
    var items, selectedItem, i;
    if ((items = CatalogItem.items).length &&
        (selectedItem = CatalogItem.selectedItem) &&
        (i = items.indexOf(selectedItem)) > -1) {
      ipc.send('view', JSON.stringify({
        path: selectedItem.path,
        url: selectedItem.url,
        mtime: selectedItem.mtime.valueOf(),
        size: selectedItem.size,
        width: selectedItem.width,
        height: selectedItem.height,
        label: selectedItem.label,
        fileNum: i + 1,
        filesLen: items.length,
        error: selectedItem.error
      }), exist);
    }
  }

  CatalogItem.init($('#container'), $body, $window);
  CatalogItem.onItemSelected(() => { view(true); });

  // ================ App Menu & Commands
  commands = {
    openFolder: {
      eventMatch: event => event.which === 79 && event.modKeyOnlyCtrl,
      handle: chooseOpenPath
    },
    openView: {
      eventMatch: event => event.which === 32 && !event.modKey,
      handle: () => { view(); }, // avoid passing argument
      disabled: () => !CatalogItem.items.length
    },
    listView: {
      eventMatch: event => event.which === 76 && !event.modKey,
      handle: () => { updateViewType(!$body.contextMenuCommon('value', 'listView')); },
      disabled: () => !CatalogItem.items.length
    },
    thumbSizeUp: {
      eventMatch: event => event.which === 187 && event.modKeyOnlyShift ||
                      event.which === 107 && !event.modKey,
      handle: () => { updateThumbSize(true); },
      disabled: () => commandDisabled.thumbSize || commandDisabled.thumbSizeUp || !CatalogItem.items.length
    },
    thumbSizeDown: {
      eventMatch: event => event.which === 189 && !event.modKey ||
                      event.which === 109 && !event.modKey,
      handle: () => { updateThumbSize(false); },
      disabled: () => commandDisabled.thumbSize || commandDisabled.thumbSizeDown || !CatalogItem.items.length
    },
    fullScreen: {
      eventMatch: event => event.which === 122 && !event.modKey,
      handle: () => { updateFullScreen(); }
    },
    switchUi: {
      eventMatch: event => event.which === 9 && !event.modKey,
      handle: () => { ipc.send('focus-ui', 'view'); },
      disabled: () => !viewOpened
    },
    exit: {
      eventMatch: event => event.which === 115 && event.modKeyOnlyAlt,
      handle: () => { ui.close(); }
    },
    menu: {
      eventMatch: event => event.which === 112 && !event.modKey,
      handle: () => {
        $body.contextMenuCommon({x: $window.scrollLeft() + 20, y: $window.scrollTop() + 20});
      }
    }
  };
  // Specify `commands.*.handle` to `callback` if the menu item should be updated or it don't update.
  menuItems = {
    openFolder: {
      label: ['Open Folder...', 'Ctrl+O'],
      callback: commands.openFolder.handle,
      accesskey: 'o'
    },
    openView: {
      label: ['Open Viewer', 'Space'],
      callback: commands.openView.handle,
      accesskey: 'v',
      disabled: () => !CatalogItem.items.length
    },
    s01: {type: 'cm_seperator'},
    listView: {
      type: 'checkbox',
      label: ['List View', 'L'],
      callback: () => { updateViewType($body.contextMenuCommon('value', 'listView'), true); },
      disabled: () => !CatalogItem.items.length,
      accesskey: 'l'
    },
    thumbSize: {
      label: 'Thumbnail Size',
      disabled: () => commandDisabled.thumbSize || !CatalogItem.items.length,
      accesskey: 's',
      items: {
        thumbSizeUp: {
          label: ['Upsize', '+'],
          callback: commands.thumbSizeUp.handle,
          disabled: () => commandDisabled.thumbSize ||
            commandDisabled.thumbSizeUp || !CatalogItem.items.length,
          accesskey: 'u'
        },
        thumbSizeDown: {
          label: ['Downsize', '-'],
          callback: commands.thumbSizeDown.handle,
          disabled: () => commandDisabled.thumbSize ||
            commandDisabled.thumbSizeDown || !CatalogItem.items.length,
          accesskey: 'd'
        },
        s01: {type: 'cm_seperator'}
      }
    },
    sort: {
      label: 'Sort',
      disabled: () => !CatalogItem.items.length,
      accesskey: 't',
      items: {
        sortDesc: {
          type: 'checkbox',
          label: 'Descending Order',
          callback: updateSortByByMenu,
          disabled: () => !CatalogItem.items.length,
          accesskey: 'e'
        },
        s01: {type: 'cm_seperator'}
      }
    },
    showInfo: {
      type: 'checkbox',
      label: 'Show Image Information',
      callback: () => { updateShowInfo($body.contextMenuCommon('value', 'showInfo'), true); },
      disabled: () => commandDisabled.showInfo || !CatalogItem.items.length,
      accesskey: 'i'
    },
    s02: {type: 'cm_seperator'},
    theme: {
      label: 'Theme',
      items: {},
      accesskey: 'h'
    },
    fullScreen: {
      type: 'checkbox',
      label: ['Full Screen', 'F11'],
      callback: () => {
        updateFullScreen($body.contextMenuCommon('value', 'fullScreen'), true);
      },
      checked: ui.isFullScreen(),
      accesskey: 'f'
    },
    s03: {type: 'cm_seperator'},
    switchUi: {
      label: ['Switch Window', 'Tab'],
      callback: commands.switchUi.handle,
      disabled: () => !viewOpened
    },
    exit: {
      label: ['Exit', 'Alt+F4'],
      callback: commands.exit.handle,
      accesskey: 'x'
    }
  };

  THUMB_SIZE.forEach((size, i) => {
    var commandId = `thumbSizeIndex${i}`;
    commands[commandId] = {
      eventMatch: event => event.which === 49 + i && !event.modKey ||
                      event.which === 97 + i && !event.modKey,
      handle: () => { updateThumbSize(i); },
      disabled: () => commandDisabled.thumbSize || !CatalogItem.items.length
    };
    menuItems.thumbSize.items[commandId] = {
      type: 'radio',
      radiogroup: 'thumbSize',
      label: [`Size ${i + 1}`, i + 1],
      callback: () => { updateThumbSize(i, true); },
      disabled: () => commandDisabled.thumbSize || !CatalogItem.items.length,
      accesskey: i + 1 + ''
    };
  });

  THEME_CLASS.forEach((theme, i) => {
    var commandId = `themeIndex${i}`;
    commands[commandId] = {handle: () => {
      updateTheme(i);
      ipc.send('theme-changed', i);
    }};
    menuItems.theme.items[commandId] = {
      type: 'radio',
      radiogroup: 'theme',
      label: theme,
      callback: () => {
        updateTheme(i, true);
        ipc.send('theme-changed', i);
      }
    };
  });

  CatalogItem.sortBy.forEach(keyOrder => {
    var commandId = `sortKey_${keyOrder.key}`;
    menuSortLabels[commandId] = $('<span/>');
    menuItems.sort.items[commandId] = {
      type: 'radio',
      radiogroup: 'sortKey',
      value: keyOrder.key,
      label: menuSortLabels[commandId],
      callback: updateSortByByMenu,
      disabled: () => !CatalogItem.items.length
    };
  });
  menuItems.sort.items.s02 = {type: 'cm_seperator'};
  menuItems.sort.items.resetSortBy = {
    label: 'Reset',
    callback: () => {
      var desc0;
      stats.sortBy = CatalogItem.resetSortBy();
      // Update menu forcibly
      desc0 = stats.sortBy[0].desc;
      stats.sortBy[0].desc = !desc0;
      stats.sortBy = updateSortBy(stats.sortBy[0].key, desc0);
    },
    disabled: () => !CatalogItem.items.length,
    accesskey: 'r'
  };

  $(document).keydown(event => {
    if (isBusyOn) { return; }
    if (menuShown) {
      if (event.altKey) { hideMenu(); }
      return;
    }

    event = keyEvent(event);
    Object.keys(commands).some(commandId => {
      var command = commands[commandId];
      if ((!command.disabled || !command.disabled()) && command.eventMatch && command.eventMatch(event)) {
        command.handle();
        event.preventDefault();
        return true;
      }
      return false;
    });
  });

  $.contextMenuCommon({
    selector: 'body',
    items: menuItems,
    events: {
      show: () => { menuShown = true; CatalogItem.keyDisabled(true); },
      hide: () => { menuShown = false; CatalogItem.keyDisabled(false); }
    }
  });
  // ================ /App Menu & Commands

  // ================ stats
  {
    let rawStats = JSON.parse(ipc.sendSync('get-stats', 'catalog'));
    stats.thumbSize = updateThumbSize(
      typeof rawStats.thumbSize === 'number' && THUMB_SIZE[rawStats.thumbSize] ?
        rawStats.thumbSize : DEFAULT_THUMB_SIZE);
    stats.listView = updateViewType(
      typeof rawStats.listView === 'boolean' ? rawStats.listView : false);
    stats.showInfo = updateShowInfo(
      typeof rawStats.showInfo === 'boolean' ? rawStats.showInfo : false);
    stats.theme = updateTheme(
      typeof rawStats.theme === 'number' && THEME_CLASS[rawStats.theme] ?
        rawStats.theme : DEFAULT_THEME_CLASS);
    stats.lastPath = typeof rawStats.lastPath === 'string' ? rawStats.lastPath : '';

    // Sort key and desc
    if (Array.isArray(rawStats.sortBy)) {
      stats.sortBy = rawStats.sortBy.reduce((sortBy, keyOrderR) => {
        var i;
        if (keyOrderR &&
            (i = CatalogItem.sortBy.findIndex(
              keyOrderD => !!keyOrderD && keyOrderD.key === keyOrderR.key)) > -1) {
          sortBy.push({key: keyOrderR.key, desc: !!keyOrderR.desc});
          CatalogItem.sortBy[i] = null;
        }
        return sortBy;
      }, []);
      CatalogItem.sortBy.forEach(keyOrder => { if (keyOrder) { stats.sortBy.push(keyOrder); } });
      CatalogItem.sortBy = stats.sortBy;
    } else {
      stats.sortBy = CatalogItem.sortBy;
    }
    { // Update menu forcibly
      let desc0 = stats.sortBy[0].desc;
      stats.sortBy[0].desc = !desc0;
      stats.sortBy = updateSortBy(stats.sortBy[0].key, desc0);
    }
  }
  // `ui.on('close')` doesn't work.
  // `ipc.send` doesn't finish. https://github.com/atom/electron/issues/4366
  window.addEventListener('beforeunload', () => {
    ipc.sendSync('set-stats', 'catalog', JSON.stringify(stats));
  }, false);
  // ================ /stats

  ui.setMenu(null);
  window.addEventListener('contextmenu', event => { event.preventDefault(); }, false);
  $window.resize(() => { hideMenu(); }).scroll(() => { hideMenu(); });
  ui.on('blur', () => { hideMenu(); }).on('move', () => { hideMenu(); });

  ipc.on('open', (event, path) => { open(path); });
  ipc.on('choose-open-path', () => { chooseOpenPath(); });

  ipc.on('change-current', (event, prev) => {
    var items, selectedItem, i;
    if ((items = CatalogItem.items).length &&
        (selectedItem = CatalogItem.selectedItem) &&
        (i = items.indexOf(selectedItem)) > -1) {
      i = i + (prev ? -1 : 1);
      if (i >= 0 && i <= items.length - 1) {
        items[i].select();
      }
    }
  });

  ipc.on('ui-opened-closed', (event, uiId, opened) => {
    if (uiId === 'view') { viewOpened = opened; }
  });

  ipc.on('theme-changed', (event, uiId, iTheme) => { updateTheme(iTheme); });

  ipc.send('ui-ready');
}, false);
