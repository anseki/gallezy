
'use strict';

const
  electron = require('electron'),
  app = electron.app,
  BrowserWindow = electron.BrowserWindow,
  ipc = electron.ipcMain,

  pathUtil = require('path'),

  DEFAULT_CATALOG_WIDTH = 600,
  META = (() => {
    var META = require('./package.json');
    META.winTitle = {catalog: `Catalog - ${META.title}`, view: `View - ${META.title}`};
    // META.icon = pathUtil.join(__dirname, 'icon.png');
    META.icon32 = pathUtil.join(__dirname, 'icon-app-32.png');
    return META;
  })(),
  STATS_PATH = pathUtil.join(__dirname, '../stats.json'),
  URL = {
    /* eslint-disable no-path-concat */
    catalog: 'file://' + __dirname + '/catalog.html',
    view: 'file://' + __dirname + '/view.html'
    /* eslint-enable no-path-concat */
  };

var ui = {}, stats, uiReadyCb = {};

/**
 * Get UI Window.
 * @param {string} uiId - UI Window ID.
 * @param {Function} ready - Callback that is called when UI is ready.
 * @returns {BrowserWindow} ui - UI Window.
 */
function getUi(uiId, ready) {
  var statsUi = stats.ui[uiId];
  if (ui[uiId]) {
    if (ui[uiId].isMinimized()) { ui[uiId].restore(); }
    if (ready) { ready(ui[uiId]); }
  } else {
    let targetUi = (ui[uiId] = new BrowserWindow({
      x: statsUi.x,
      y: statsUi.y,
      width: statsUi.width,
      height: statsUi.height,
      show: false, // Hide constructing
      title: META.winTitle[uiId],
      minWidth: 400,
      minHeight: 320
    }));
    targetUi.webContents.openDevTools(); // [DEBUG]
    if (statsUi.max) {
      targetUi.maximize();
    } else if (statsUi.full) {
      targetUi.setFullScreen(true);
    }

    targetUi.on('close', () => {
      if (ui[uiId]) {
        statsUi.max = statsUi.full = false;
        if (targetUi.isMinimized()) {
          targetUi.restore(); // It might be maximized or full-screened after it's restored.
        }
        if (targetUi.isMaximized()) {
          statsUi.max = true;
          targetUi.unmaximize();
        } else if (targetUi.isFullScreen()) {
          statsUi.full = true;
          targetUi.setFullScreen(false);
        }
        let bounds = targetUi.getBounds();
        statsUi.x = bounds.x;
        statsUi.y = bounds.y;
        statsUi.width = bounds.width;
        statsUi.height = bounds.height;

        // `ui-opened-closed` event
        Object.keys(ui).forEach(id => {
          if (id !== uiId && ui[id]) {
            ui[id].webContents.send('ui-opened-closed', uiId, false);
          }
        });

        ui[uiId] = targetUi = null;
      }
    });

    if (ready) { (uiReadyCb[uiId] = uiReadyCb[uiId] || []).push(ready); }
    targetUi.webContents.loadURL(URL[uiId]);
  }
  return ui[uiId];
}

function loadStats() {
  var rawStats = {},
    stats = {ui: {catalog: {}, view: {}}},
    workArea = electron.screen.getPrimaryDisplay().workArea,
    // default UI stats
    defaultStats = {
      catalog: {
        x: 0,
        y: 0,
        width: DEFAULT_CATALOG_WIDTH,
        height: workArea.height,
        max: false,
        full: false
      }
    };
  defaultStats.view = {
    x: defaultStats.catalog.width,
    y: 0,
    width: workArea.width - defaultStats.catalog.width,
    height: workArea.height,
    max: false,
    full: false
  };

  try {
    rawStats = require(STATS_PATH);
  } catch (error) { /* ignore */ }

  Object.keys(defaultStats).forEach(uiId => {
    var statsUi = stats.ui[uiId],
      rawStatsUi = (rawStats.ui || {})[uiId] || {};
    Object.keys(defaultStats[uiId]).forEach(statKey => {
      statsUi[statKey] = typeof defaultStats[uiId][statKey] === typeof rawStatsUi[statKey] ?
        rawStatsUi[statKey] : defaultStats[uiId][statKey];
    });
  });

  // `stats` must have properties as all UIs.
  stats.catalog = rawStats.catalog || {};
  stats.view = rawStats.view || {};
  return stats;
}

app.on('ready', () => {
  stats = loadStats();
  electron.Menu.setApplicationMenu(null);

  ipc.on('ui-ready', event => {
    var uiSender = BrowserWindow.fromWebContents(event.sender),
      uiId = Object.keys(ui).find(id => uiSender === ui[id]);

    uiSender.show();
    // `ready` callbacks that were passed to `getUi` method.
    if (uiReadyCb[uiId] && uiReadyCb[uiId].length) {
      uiReadyCb[uiId].forEach(cb => { cb(uiSender); });
      uiReadyCb[uiId] = [];
    }
    // `ui-opened-closed` event
    Object.keys(ui).forEach(id => {
      if (id !== uiId && ui[id]) {
        ui[id].webContents.send('ui-opened-closed', uiId, true);
      }
    });
  });

  // getter/setter
  ipc.on('get-meta', event => { event.returnValue = JSON.stringify(META); });
  ipc.on('get-stats', (event, uiId) => { event.returnValue = JSON.stringify(stats[uiId]); });
  ipc.on('set-stats', (event, uiId, uiStats) => {
    stats[uiId] = JSON.parse(uiStats);
    // `ipc.send` doesn't finish. https://github.com/atom/electron/issues/4366
    event.returnValue = true;
  });

  ipc.on('focus-ui', (event, uiId) => {
    if (ui[uiId]) {
      if (ui[uiId].isMinimized()) { ui[uiId].restore(); } // It might be necessary in some environment.
      ui[uiId].focus();
    }
  });

  ipc.on('theme-changed', (event, iTheme) => {
    var uiSender = BrowserWindow.fromWebContents(event.sender),
      uiId = Object.keys(ui).find(id => uiSender === ui[id]);
    Object.keys(stats).forEach(id => {
      if (id !== 'ui' && id !== uiId) {
        if (ui[id]) {
          ui[id].webContents.send('theme-changed', uiId, iTheme);
        } else {
          stats[id].theme = iTheme;
        }
      }
    });
  });

  // ================ API for catalog
  ipc.on('catalog', (event, path) => {
    getUi('catalog', ui => {
      ui.focus();
      ui.webContents.send('open', path);
    });
  });

  ipc.on('choose-open-path', () => {
    getUi('catalog', ui => {
      ui.webContents.send('choose-open-path');
    });
  });

  ipc.on('change-current', (event, prev) => {
    getUi('catalog', ui => {
      ui.webContents.send('change-current', prev);
    });
  });
  // ================ /API for catalog

  // ================ API for view
  ipc.on('view', (event, item, exist) => {
    if (!exist) {
      getUi('view', ui => {
        ui.focus();
        ui.webContents.send('open', item);
      });
    } else if (ui.view) {
      ui.view.webContents.send('open', item);
    }
  });
  // ================ /API for view

  // Init
  getUi('catalog', ui => {
    if (process.argv[2]) {
      ui.webContents.send('open', process.argv[2]);
    }
  }).on('close', () => {
    // `app.quit()` doesn't wait for closing process of others.
    if (ui.view) { ui.view.close(); }
  });
});

app.on('before-quit', () => {
  try {
    require('fs').writeFileSync(STATS_PATH, JSON.stringify(stats));
  } catch (error) { /* ignore */ }
});
