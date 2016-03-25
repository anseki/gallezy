/* eslint strict: [2, "function"] */

window.addEventListener('load', () => {
  'use strict';

  const
    electron = require('electron'),
    remote = electron.remote,
    ipc = electron.ipcRenderer,

    $ = window.$ || window.jQuery,
    keyEvent = require('./key-event.js'),
    general = require('./general.js'),

    META = JSON.parse(ipc.sendSync('get-meta')),
    IMG_RATIO = [0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.4, 1.6, 1.8], // Max: 9 items
    DEFAULT_IMG_RATIO = 4,
    WIN_RATIO = [0.6, 0.7, 0.8, 0.9, 1],
    DEFAULT_WIN_RATIO = 3,
    AUTO_INTERVAL = [500, 1000, 3000, 5000, 10000, 15000, 30000, 180000],
    DEFAULT_AUTO_INTERVAL = 2,
    THEME_CLASS = ['dark', 'light'],
    DEFAULT_THEME_CLASS = 0,
    WIN_RATIO_BASE_LABEL = {
      none: 'Original Size',
      width: 'Based on Width of Window',
      height: 'Based on Height of Window',
      both: 'Based on Both'
    },
    DEFAULT_WIN_RATIO_BASE = 'width',
    LAZY_RENDER_TIME = 50,
    SCROLL_MSPF = 1000 / 60/* FPS */,
    INIT_SCROLL_SPEED = 30/* px/sec */ / 1000 * SCROLL_MSPF, // px/frame
    INIT_SCROLL_SPEED_SHIFT = INIT_SCROLL_SPEED * 2,
    DOUBLE_PRESS_INTERVAL = 800, SHOW_INFO_TIME = 3000,
    ERROR_IMG_URL = './error.svg', ERROR_IMG_WIDTH = 100, ERROR_IMG_HEIGHT = 130;

  var ui = remote.getCurrentWindow(),
    $window = $(window), $body = $('body').plainOverlay(),
    elmView = document.querySelector('html'),
    viewWidth, viewHeight, viewScrollWidth, viewScrollHeight, layoutTimer,
    $container = $('#container'), $img = $('img', $container),
    $bBoxPad = $('svg', '#bound-box'), bBoxPad = $bBoxPad.get(0),
    $panel = $('#panel'), $label = $('#label'),
    $area = $('#area'), $size = $('#size'), $mtime = $('#mtime'), $progress = $('#progress-bar'),
    isBusyOn = false, menuShown = false,
    stats = {}, commands, menuItems, commandDisabled = {},
    curImgRatioEnabled = false, curRotate, curSizeProps = {},
    scrolling, scrollSpeed, scrollSpeedShift, lastShift, scrollTimer, curScrollLeft, curScrollTop,
    autoTimer, showInfoTimer,

    /**
     * @typedef {Object} curItem
     * @property {string} path - Image file path.
     * @property {string} url - Image file URL.
     * @property {number} mtime - Modified Time. (primitive value)
     * @property {number} size - File size.
     * @property {number} width - Width of image.
     * @property {number} height - Height of image.
     * @property {string} label - Label text to show.
     * @property {number} fileNum - Current file number.
     * @property {number} filesLen - Number of files.
     * @property {boolean} loaded - Image was loaded.
     * @property {boolean} error - Image loading failed. (from catalog)
     * @property {boolean} finished - Image loading finished regardless of errors.
     */
    curItem,

    rotateController = (() => {
      var lastDeg, deg360, running;

      // Update `transform` without effect.
      function forceTransform(transform) {
        $img.addClass('effect-disabled');
        if (transform) { $img.css('transform', transform); }
        $img.get(0).offsetWidth; /* force reflow */ // eslint-disable-line no-unused-expressions
        $img.removeClass('effect-disabled');
      }

      $img.on('transitionend', event => {
        if (event.originalEvent.propertyName === 'transform') {
          if (deg360) {
            forceTransform('none'); // reset
            deg360 = false;
          }
          running = false;
        }
      });

      return {
        rotate: (deg, disableEffect) => {
          if (disableEffect) {
            forceTransform(deg ? `rotate(${deg}deg)` : 'none');
            running = deg360 = false;
          } else {
            let transform;
            rotateController.finish();
            if (lastDeg === 270 && deg === 0) {
              transform = 'rotate(360deg)'; // rotate 270 > 0 replace 270 > 360
              deg360 = true;
            } else {
              transform = deg ? `rotate(${deg}deg)` : 'none';
              deg360 = false;
            }
            $img.css('transform', transform);
            running = true;
          }
          lastDeg = deg;
        },

        finish: () => {
          if (!running) { return; }
          if (deg360) {
            forceTransform('none'); // reset
            deg360 = false;
          } else {
            forceTransform();
          }
          running = false;
        }
      };
    })();

  function nextAutoTask(cb) {
    clearTimeout(autoTimer);
    if (cb) { autoTimer = setTimeout(cb, AUTO_INTERVAL[stats.autoInterval]); }
  }

  /**
   * @param {boolean|null} start - true: Start scrolling, false: Stop and init scrolling
   * @returns {boolean} started - true: Scrolling was started, false: it was finished or no scroll-length
   */
  function scroll(start) {
    var maxScrollLeft, maxScrollTop, actScrollLeft, actScrollTop;
    clearTimeout(scrollTimer);

    actScrollLeft = $window.scrollLeft();
    actScrollTop = $window.scrollTop();

    if (start === false) {
      scrollSpeed = INIT_SCROLL_SPEED;
      scrollSpeedShift = INIT_SCROLL_SPEED_SHIFT;
      lastShift = 0;
      scrolling = false;
      return false;
    } else if (start) {
      if (scrolling) {
        let now = Date.now();
        if (now - lastShift < DOUBLE_PRESS_INTERVAL) { // boost
          scrollSpeedShift *= 3;
        }
        lastShift = now;
        scrollSpeed += scrollSpeedShift;
      } else {
        curScrollLeft = actScrollLeft;
        curScrollTop = actScrollTop;
      }
    }

    maxScrollLeft = viewScrollWidth - viewWidth;
    maxScrollTop = viewScrollHeight - viewHeight;
    if (curScrollLeft >= maxScrollLeft && curScrollTop >= maxScrollTop) {
      if (stats.auto) {
        nextAutoTask(() => { ipc.send('change-current'); });
      }
      return scroll(false);
    }

    if (Math.abs(actScrollLeft - curScrollLeft) > scrollSpeed * 10 ||
        Math.abs(actScrollTop - curScrollTop) > scrollSpeed * 10) {
      // It seems that the user scrolled.
      return scroll(false);
    }

    scrolling = true;
    curScrollLeft += scrollSpeed;
    curScrollTop += scrollSpeed;
    if (curScrollLeft > maxScrollLeft) { curScrollLeft = maxScrollLeft; }
    if (curScrollTop > maxScrollTop) { curScrollTop = maxScrollTop; }
    $window.scrollLeft(curScrollLeft);
    $window.scrollTop(curScrollTop);
    scrollTimer = setTimeout(scroll, SCROLL_MSPF);
    return true;
  }

  function forward() {
    if (!scroll(true)) {
      // Cancel task that might have been registered by `scroll`, and go next immediately.
      nextAutoTask();
      ipc.send('change-current');
    }
  }

  function initViewSize() {
    viewWidth = elmView.clientWidth;
    viewHeight = elmView.clientHeight;
    viewScrollWidth = elmView.scrollWidth;
    viewScrollHeight = elmView.scrollHeight;
  }

  function hideMenu() {
    if (menuShown) { $body.contextMenuCommon('hide'); }
  }

  function busy(bOn, ignoreComplete) {
    var op = (bOn = !!bOn) ? 'show' : 'hide';
    if (bOn !== isBusyOn) {
      isBusyOn = bOn;
      if (isBusyOn) { hideMenu(); scroll(false); }
      $body.contextMenuCommon(!isBusyOn) // true: enable, false: disable
        .plainOverlay(op, isBusyOn ? null : ignoreComplete);
    }
  }

  /**
   * Set CSS props based on current `stats`, `curImgRatioEnabled` and `curRotate`.
   * @param {boolean|null} omitFix - Avoid adjusting for scroll bar.
   * @param {boolean|null} omitInitViewSize - `omitFix` must be `true`, aboid call `initViewSize`.
   * @param {boolean|null} disableEffect - Disable rotate effect.
   * @returns {void}
   */
  function setImgSize(omitFix, omitInitViewSize, disableEffect) {

    // [obj.A, obj.B] = [obj.B, obj.A];
    function exchangeProps(obj, propA, propB) {
      var pass = obj[propA];
      obj[propA] = obj[propB];
      obj[propB] = pass;
    }

    var sizeProps = {}, exWH, updateProps, viewResized;

    /*
      Don't use maxWidth/Height to reduce update styles.
    */
    // winRatio mode and winRatioBase === 'none'
    sizeProps.width = sizeProps.height = sizeProps.bBox_width = sizeProps.bBox_height = 'auto';
    // sizeProps.objectFit = 'fill';
    sizeProps.transform = 'none';
    sizeProps.unscaleWidth = curItem.width;
    sizeProps.unscaleHeight = curItem.height;

    if (curRotate) {
      sizeProps.transform = `rotate(${curRotate}deg)`;
      if (curRotate % 180 !== 0) { // Exchange width and height
        exWH = true;
        exchangeProps(sizeProps, 'unscaleWidth', 'unscaleHeight');
      }
    }

    if (curImgRatioEnabled) {
      sizeProps.width = sizeProps.bBox_width = `${curItem.width * IMG_RATIO[stats.imgRatio]}px`;
      if (exWH) { exchangeProps(sizeProps, 'bBox_width', 'bBox_height'); }

    // winRatio mode
    // `viewWidth/Height * <RATIO>` works as `vw/vh` of view area (not view-port).
    } else if (stats.winRatioBase === 'width') {
      let lenValue = viewWidth * WIN_RATIO[stats.winRatio],
        prop = exWH ? 'height' : 'width';
      if (stats.avoidEnlarge && lenValue > curItem[prop]) { lenValue = curItem[prop]; }
      sizeProps[prop] = sizeProps.bBox_width = `${lenValue}px`;

    } else if (stats.winRatioBase === 'height') {
      let lenValue = viewHeight * WIN_RATIO[stats.winRatio],
        prop = exWH ? 'width' : 'height';
      if (stats.avoidEnlarge && lenValue > curItem[prop]) { lenValue = curItem[prop]; }
      sizeProps[prop] = sizeProps.bBox_height = `${lenValue}px`;

    } else if (stats.winRatioBase === 'both') {
      // `objectFit` seems not high-performance.
      let propRefWidth = exWH ? 'height' : 'width',
        propRefHeight = exWH ? 'width' : 'height',
        rateWinWidth = viewWidth * WIN_RATIO[stats.winRatio] / curItem[propRefWidth],
        rateWinHeight = viewHeight * WIN_RATIO[stats.winRatio] / curItem[propRefHeight],
        rate = Math.min(rateWinWidth, rateWinHeight);
      if (stats.avoidEnlarge && rate > 1) { rate = 1; }
      sizeProps.width = sizeProps[`bBox_${propRefWidth}`] = `${curItem.width * rate}px`;
      // sizeProps.objectFit = stats.avoidEnlarge ? 'scale-down' : 'contain';
    }

    // $img
    if (Object.keys((updateProps =
        ['width', 'height'/* , 'objectFit' */, 'transform'].reduce((props, prop) => {
          if (sizeProps[prop] !== curSizeProps[prop]) {
            props[prop] = curSizeProps[prop] = sizeProps[prop];
          }
          return props;
        }, {}))).length) {
      if (updateProps.transform) {
        delete updateProps.transform; // This is used to detect changing.
        rotateController.rotate(curRotate, disableEffect);
      }
      $img.css(updateProps);
    }
    // bBoxPad
    if (sizeProps.unscaleWidth !== curSizeProps.unscaleWidth ||
        sizeProps.unscaleHeight !== curSizeProps.unscaleHeight) {
      bBoxPad.setAttribute('viewBox', '0 0' +
        ` ${curSizeProps.unscaleWidth = sizeProps.unscaleWidth}` +
        ` ${curSizeProps.unscaleHeight = sizeProps.unscaleHeight}`);
      bBoxPad.setAttribute('width', sizeProps.unscaleWidth);
      bBoxPad.setAttribute('height', sizeProps.unscaleHeight);
      // force reflow, for width/height: `auto`.
      $bBoxPad.css('display', 'none');
      bBoxPad.offsetWidth; // eslint-disable-line no-unused-expressions
      $bBoxPad.css('display', '');
      viewResized = true;
    }
    // $bBoxPad
    if (Object.keys((updateProps =
        ['width', 'height'].reduce((props, prop) => {
          var prefixed = `bBox_${prop}`;
          if (sizeProps[prefixed] !== curSizeProps[prefixed]) {
            props[prop] = curSizeProps[prefixed] = sizeProps[prefixed];
          }
          return props;
        }, {}))).length) {
      $bBoxPad.css(updateProps);
      viewResized = true;
    }

    if (viewResized) {
      if (!omitFix) {
        clearTimeout(layoutTimer);
        layoutTimer = setTimeout(() => {
          initViewSize();
          setImgSize(true);
        }, LAZY_RENDER_TIME); // bug? interval is needed.
      } else if (!omitInitViewSize) {
        initViewSize();
      }
    }
  }

  /**
   * @param {boolean|null} imgRatioEnabled - imgRatio-MODE.
   * @param {number|boolean|null} size - true: ratio-up, false: ratio-down, number: ratio-index
   * @param {string|null} winRatioBase - (winRatio-MODE only) Key of winRatioBase.
   * @param {boolean|null} avoidEnlarge - (winRatio-MODE only) Don't up scale.
   * @param {boolean|null} byMenuValue - Don't update value of menu.
   * @param {boolean|null} disableEffect - Disable rotate effect.
   * @returns {number} size - imgRatio or winRatio
   */
  function updateSize(imgRatioEnabled, size, winRatioBase, avoidEnlarge, byMenuValue, disableEffect) {
    /*
      Target values by mode:
        !imgRatioEnabled  : winRatio, winRatioBase, avoidEnlarge
        imgRatioEnabled   : imgRatio
    */
    if (typeof imgRatioEnabled !== 'boolean') { imgRatioEnabled = curImgRatioEnabled; }
    if (typeof size !== 'number') {
      let newSize = stats[imgRatioEnabled ? 'imgRatio' : 'winRatio'];
      if (typeof size === 'boolean') { newSize = newSize + (size ? 1 : -1); }
      size = newSize;
    }

    if (imgRatioEnabled) {
      if (size > IMG_RATIO.length - 1) {
        size = IMG_RATIO.length - 1;
      } else if (size < 0) {
        size = 0;
      }
      if (imgRatioEnabled !== curImgRatioEnabled || size !== stats.imgRatio) {
        curImgRatioEnabled = imgRatioEnabled;
        stats.imgRatio = size;
        if (!byMenuValue) {
          $body.contextMenuCommon('value', 'imgRatioEnabled', curImgRatioEnabled);
          $body.contextMenuCommon('value', 'imgRatio', size);
        }
        commandDisabled.imgRatioUp = size >= IMG_RATIO.length - 1;
        commandDisabled.imgRatioDown = size <= 0;
        commandDisabled.winRatio = true;
      }
    } else {
      if (size > WIN_RATIO.length - 1) {
        size = WIN_RATIO.length - 1;
      } else if (size < 0) {
        size = 0;
      }
      if (winRatioBase == null) { winRatioBase = stats.winRatioBase; } // eslint-disable-line eqeqeq
      if (avoidEnlarge == null) { avoidEnlarge = stats.avoidEnlarge; } // eslint-disable-line eqeqeq
      if (imgRatioEnabled !== curImgRatioEnabled || size !== stats.winRatio ||
          winRatioBase !== stats.winRatioBase || avoidEnlarge !== stats.avoidEnlarge) {
        curImgRatioEnabled = imgRatioEnabled;
        stats.winRatio = size;
        stats.winRatioBase = winRatioBase;
        stats.avoidEnlarge = avoidEnlarge;
        if (!byMenuValue) {
          $body.contextMenuCommon('value', 'imgRatioEnabled', curImgRatioEnabled);
          $body.contextMenuCommon('value', 'winRatio', size);
          $body.contextMenuCommon('value', 'winRatioBase', winRatioBase);
          $body.contextMenuCommon('value', 'avoidEnlarge', avoidEnlarge);
        }
        commandDisabled.winRatio = false;
        commandDisabled.winRatioScale = winRatioBase === 'none';
      }
    }

    if (curItem) { setImgSize(null, null, disableEffect); }

    return curImgRatioEnabled ? stats.imgRatio : stats.winRatio;
  }

  /**
   * @param {boolean} rotate - new rotate.
   * @param {boolean} [avoidUpdateSize] - Don't call `updateSize`.
   * @returns {number} rotate - deg
   */
  function updateRotate(rotate, avoidUpdateSize) {
    if ((curRotate = typeof rotate === 'number' ? rotate : (curRotate + 90)) >= 360) { curRotate = 0; }
    if (!avoidUpdateSize) { updateSize(); }
    return curRotate;
  }

  /**
   * @param {boolean} auto - `auto` mode or not.
   * @param {boolean} [byMenuValue] - Don't update value of menu.
   * @returns {boolean} auto
   */
  function updateAuto(auto, byMenuValue) {
    if (auto !== stats.auto) {
      stats.auto = auto;
      nextAutoTask(auto && !scrolling ? forward : null);
      if (!byMenuValue) { $body.contextMenuCommon('value', 'auto', auto); }
      commandDisabled.autoInterval = !auto;
    }
    return stats.auto;
  }

  /**
   * @param {number} autoInterval - autoInterval index
   * @param {boolean} [byMenuValue] - Don't update value of menu.
   * @returns {number} autoInterval
   */
  function updateAutoInterval(autoInterval, byMenuValue) {
    if (autoInterval > AUTO_INTERVAL.length - 1) {
      autoInterval = AUTO_INTERVAL.length - 1;
    } else if (autoInterval < 0) {
      autoInterval = 0;
    }

    if (autoInterval !== stats.autoInterval) {
      stats.autoInterval = autoInterval;
      if (!byMenuValue) { $body.contextMenuCommon('value', 'autoInterval', autoInterval); }
    }
    return stats.autoInterval;
  }

  /**
   * @param {boolean} showInfo - show path or not.
   * @param {boolean} [byMenuValue] - Don't update value of menu.
   * @returns {boolean} showInfo
   */
  function updateShowInfo(showInfo, byMenuValue) {
    if (showInfo !== stats.showInfo) {
      clearTimeout(showInfoTimer);
      $panel[(stats.showInfo = showInfo) ? 'addClass' : 'removeClass']('show-info');
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

  function open(item) {
    function setInfo() {
      $label.text(`${curItem.fileNum}/${curItem.filesLen} - ${curItem.label}`);
      $area.text(`${general.numToString(curItem.width)} x ${general.numToString(curItem.height)} px`);
      {
        let bytes = general.bytesToString(curItem.size, 1, true);
        $size.text(`${bytes[0]} ${bytes[1]}`);
        $size.attr('title', bytes[0] !== curItem.size ? `${general.numToString(curItem.size)} B` : '');
      }
      $mtime.text(general.dateToString(new Date(curItem.mtime)));
      $progress.css('width', `${curItem.fileNum / curItem.filesLen * 100}%`);
      ui.setTitle(`${curItem.fileNum}/${curItem.filesLen} - ${curItem.label} - ${META.winTitle.view}`);
    }

    if (!open.setupImg) { // emulate static var
      $img.on('load error', event => {
        if ($img.attr('src') !== curItem.url && !curItem.error) { return; }
        nextAutoTask(); // Cancel task
        $body.plainOverlay('scrollLeft', 0).plainOverlay('scrollTop', 0);

        if (event.type === 'error') {
          if (curItem.error) { window.close(); } // App might be broken.
          console.error('[ERROR] %s', curItem.path); // Is there no way to get an error information?
          curItem.error = true;
          $img.attr('src', ERROR_IMG_URL);
          return;
        } else if (!curItem.error) {
          curItem.loaded = true;
        }
        curItem.finished = true;
        if (curItem.error) {
          curItem.width = ERROR_IMG_WIDTH;
          curItem.height = ERROR_IMG_HEIGHT;
        }

        setInfo();
        $body.one('plainoverlayhide', () => {
          initViewSize();
          updateRotate(0, true);
          updateSize(stats.forceImgRatio, null, null, null, null, true);

          if (!stats.showInfo) {
            clearTimeout(showInfoTimer);
            $panel.addClass('show-info');
            showInfoTimer = setTimeout(() => { $panel.removeClass('show-info'); }, SHOW_INFO_TIME);
          }
          if (stats.auto) { nextAutoTask(forward); }
        });
        busy(false, true);
      });
      open.setupImg = true;
    }

    if (curItem && curItem.url === item.url) { // Update info
      ['mtime', 'size', 'label', 'fileNum', 'filesLen']
        .forEach(prop => { curItem[prop] = item[prop]; });
      setInfo();
      return;
    }
    nextAutoTask(); // Cancel task
    busy(true);
    rotateController.finish();

    curItem = item;
    curItem.loaded = curItem.finished = false;
    curItem.error = !!curItem.error; // passed value
    $img.attr('src', curItem.error ? ERROR_IMG_URL : curItem.url);
  }

  initViewSize();

  // ================ App Menu & Commands
  commands = {
    openFolder: {
      eventMatch: event => event.which === 79 && event.modKeyOnlyCtrl,
      handle: () => { ipc.send('choose-open-path'); }
    },
    forward: {
      eventMatch: event => event.which === 32 && !event.modKey,
      handle: forward
    },
    next: {
      eventMatch: event => event.which === 32 && event.modKeyOnlyCtrl,
      handle: () => {
        nextAutoTask(); // Cancel task
        ipc.send('change-current');
      }
    },
    prev: {
      eventMatch: event => event.which === 32 && event.modKeyOnlyShift,
      handle: () => {
        nextAutoTask(); // Cancel task
        ipc.send('change-current', true);
      }
    },
    auto: {
      eventMatch: event => event.which === 32 && !event.altKey && event.ctrlKey && event.shiftKey,
      handle: () => { updateAuto(!$body.contextMenuCommon('value', 'auto')); }
    },
    imgRatioEnabled: {
      eventMatch: event => event.which === 96 && !event.modKey,
      handle: () => { updateSize(!$body.contextMenuCommon('value', 'imgRatioEnabled')); },
      disabled: () => !curItem || !curItem.finished
    },
    imgRatioUp: {
      eventMatch: event => event.which === 187 && event.modKeyOnlyShift ||
                      event.which === 107 && !event.modKey,
      handle: () => { updateSize(true, true); },
      disabled: () => commandDisabled.imgRatioUp || !curItem || !curItem.finished
    },
    imgRatioDown: {
      eventMatch: event => event.which === 189 && !event.modKey ||
                      event.which === 109 && !event.modKey,
      handle: () => { updateSize(true, false); },
      disabled: () => commandDisabled.imgRatioDown || !curItem || !curItem.finished
    },
    rotate: {
      eventMatch: event => event.which === 82 && !event.modKey,
      handle: () => { updateRotate(); },
      disabled: () => !curItem || !curItem.finished
    },
    fullScreen: {
      eventMatch: event => event.which === 122 && !event.modKey,
      handle: () => { updateFullScreen(); }
    },
    switchUi: {
      eventMatch: event => event.which === 9 && !event.modKey,
      handle: () => { ipc.send('focus-ui', 'catalog'); }
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
    s01: {type: 'cm_seperator'},
    forward: {
      label: [$('<span title="Make scrolling speed higher if it is scrolling.' +
        ' And make it more if the key is pressed at short intervals.">Scroll or' +
        ' <span class="context-menu-accesskey">N</span>ext Image</span>'), 'Space'],
      callback: commands.forward.handle,
      accesskey: 'n'
    },
    next: {
      label: ['Next Image', 'Ctrl+Space'],
      callback: commands.next.handle
    },
    prev: {
      label: ['Previous Image', 'Shift+Space'],
      callback: commands.prev.handle,
      accesskey: 'p'
    },
    auto: {
      type: 'checkbox',
      label: [$('<span title="Start scrolling and change to next image automatically.">' +
        'Auto<span class="context-menu-accesskey">m</span>atic</span>'), 'Ctrl+Shift+Space'],
      callback: () => { updateAuto($body.contextMenuCommon('value', 'auto'), true); },
      accesskey: 'm'
    },
    autoInterval: {
      label: 'Interval of Automatic',
      disabled: () => commandDisabled.autoInterval,
      items: {}
    },
    s02: {type: 'cm_seperator'},
    imgSize: {
      label: 'Image Size',
      accesskey: 's',
      items: {}
    },
    rotate: {
      label: ['Rotate Image', 'R'],
      callback: commands.rotate.handle,
      disabled: () => !curItem || !curItem.finished,
      accesskey: 'r'
    },
    showInfo: {
      type: 'checkbox',
      label: 'Show Information',
      callback: () => { updateShowInfo($body.contextMenuCommon('value', 'showInfo'), true); },
      disabled: () => !curItem || !curItem.finished,
      accesskey: 'i'
    },
    s03: {type: 'cm_seperator'},
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
    s04: {type: 'cm_seperator'},
    switchUi: {
      label: ['Switch Window', 'Tab'],
      callback: commands.switchUi.handle
    },
    exit: {
      label: ['Exit Viewer', 'Alt+F4'],
      callback: commands.exit.handle,
      accesskey: 'x'
    }
  };

  AUTO_INTERVAL.forEach((autoInterval, i) => {
    menuItems.autoInterval.items[`autoIntervalIndex${i}`] = {
      type: 'radio',
      radiogroup: 'autoInterval',
      label: `${autoInterval / 1000} seconds`,
      callback: () => { updateAutoInterval(i, true); },
      disabled: () => commandDisabled.autoInterval
    };
  });

  ['none', 'width', 'height', 'both'].forEach(key => {
    menuItems.imgSize.items[key] = {
      type: 'radio',
      radiogroup: 'winRatioBase',
      value: key,
      label: WIN_RATIO_BASE_LABEL[key],
      callback: () => {
        updateSize(false, null, $body.contextMenuCommon('value', 'winRatioBase'), null, true);
      },
      disabled: () => commandDisabled.winRatio || !curItem || !curItem.finished
    };
  });

  menuItems.imgSize.items.s01 = {type: 'cm_seperator'};
  WIN_RATIO.forEach((size, i) => {
    menuItems.imgSize.items[`winRatioIndex${i}`] = {
      type: 'radio',
      radiogroup: 'winRatio',
      label: `${size * 100}%`,
      callback: () => { updateSize(false, i, null, null, true); },
      disabled: () => commandDisabled.winRatio || commandDisabled.winRatioScale ||
        !curItem || !curItem.finished
    };
  });

  menuItems.imgSize.items.s02 = {type: 'cm_seperator'};
  menuItems.imgSize.items.avoidEnlarge = {
    type: 'checkbox',
    label: 'Don\'t Enlarge',
    callback: () => {
      updateSize(false, null, null, $body.contextMenuCommon('value', 'avoidEnlarge'), true);
    },
    disabled: () => commandDisabled.winRatio || commandDisabled.winRatioScale ||
      !curItem || !curItem.finished
  };

  menuItems.imgSize.items.s03 = {type: 'cm_seperator'};
  menuItems.imgSize.items.imgRatioEnabled = {
    type: 'checkbox',
    label: ['Specific Scale', '0'],
    callback: () => {
      updateSize($body.contextMenuCommon('value', 'imgRatioEnabled'), null, null, null, true);
    },
    disabled: () => !curItem || !curItem.finished,
    accesskey: 'c'
  };

  menuItems.imgSize.items.imgRatio = {
    label: 'Scale',
    disabled: () => !curItem || !curItem.finished,
    items: {
      imgRatioUp: {
        label: ['Upsize', '+'],
        callback: commands.imgRatioUp.handle,
        disabled: () => commandDisabled.imgRatioUp || !curItem || !curItem.finished,
        accesskey: 'u'
      },
      imgRatioDown: {
        label: ['Downsize', '-'],
        callback: commands.imgRatioDown.handle,
        disabled: () => commandDisabled.imgRatioDown || !curItem || !curItem.finished,
        accesskey: 'd'
      },
      s01: {type: 'cm_seperator'}
    }
  };

  IMG_RATIO.forEach((size, i) => {
    var commandId = `imgRatioIndex${i}`;
    commands[commandId] = {
      eventMatch: event => event.which === 49 + i && !event.modKey ||
                      event.which === 97 + i && !event.modKey,
      handle: () => { updateSize(true, i); },
      disabled: () => !curItem || !curItem.finished
    };
    menuItems.imgSize.items.imgRatio.items[commandId] = {
      type: 'radio',
      radiogroup: 'imgRatio',
      label: [`${size * 100}%`, i + 1],
      callback: commands[commandId].handle, // `byMenuValue`:false to update `imgRatioEnabled`
      disabled: () => !curItem || !curItem.finished,
      accesskey: i + 1 + ''
    };
  });

  menuItems.imgSize.items.forceImgRatio = {
    type: 'checkbox',
    label: $('<span title="[Specific Scale] is used for other images also if this checkbox' +
      ' is checked.">Use this Scale <span class="context-menu-accesskey">A</span>lways</span>'),
    callback: () => {
      stats.forceImgRatio = $body.contextMenuCommon('value', 'forceImgRatio');
    },
    disabled: () => !curItem || !curItem.finished,
    accesskey: 'a'
  };

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
      show: () => { menuShown = true; },
      hide: () => { menuShown = false; }
    }
  });
  // ================ /App Menu & Commands

  // ================ stats
  {
    let rawStats = JSON.parse(ipc.sendSync('get-stats', 'view'));
    stats.imgRatio = typeof rawStats.imgRatio === 'number' && IMG_RATIO[rawStats.imgRatio] ?
      rawStats.imgRatio : DEFAULT_IMG_RATIO;
    stats.winRatio = typeof rawStats.winRatio === 'number' && WIN_RATIO[rawStats.winRatio] ?
      rawStats.winRatio : DEFAULT_WIN_RATIO;
    stats.winRatioBase = typeof rawStats.winRatioBase === 'string' &&
      WIN_RATIO_BASE_LABEL[rawStats.winRatioBase] ? rawStats.winRatioBase : DEFAULT_WIN_RATIO_BASE;
    stats.avoidEnlarge = typeof rawStats.avoidEnlarge === 'boolean' ? rawStats.avoidEnlarge : true;
    stats.forceImgRatio = typeof rawStats.forceImgRatio === 'boolean' ? rawStats.forceImgRatio : false;
    // Call `updateSize` to update menu and img
    curImgRatioEnabled = null; // force update
    updateSize(!stats.forceImgRatio); // And `updateSize(stats.forceImgRatio)` is called by 1st `open`
    // Update menu
    $body.contextMenuCommon('value', 'forceImgRatio', stats.forceImgRatio);

    stats.auto = updateAuto(typeof rawStats.auto === 'boolean' ? rawStats.auto : false);
    nextAutoTask(); // Cancel task
    stats.autoInterval = updateAutoInterval(
      typeof rawStats.autoInterval === 'number' && AUTO_INTERVAL[rawStats.autoInterval] ?
        rawStats.autoInterval : DEFAULT_AUTO_INTERVAL);

    stats.showInfo = updateShowInfo(
      typeof rawStats.showInfo === 'boolean' ? rawStats.showInfo : false);
    stats.theme = updateTheme(
      typeof rawStats.theme === 'number' && THEME_CLASS[rawStats.theme] ?
        rawStats.theme : DEFAULT_THEME_CLASS);
  }
  // `ui.on('close')` doesn't work.
  // `ipc.send` doesn't finish. https://github.com/atom/electron/issues/4366
  window.addEventListener('beforeunload', () => {
    ipc.sendSync('set-stats', 'view', JSON.stringify(stats));
  }, false);
  // ================ /stats

  ui.setMenu(null);
  window.addEventListener('contextmenu', event => { event.preventDefault(); }, false);
  $window.resize(() => {
    hideMenu();
    initViewSize();
    if (curItem && !curImgRatioEnabled && stats.winRatioBase !== 'none') {
      // Make `setImgSize` adjust it at only the end of resizing.
      setImgSize(true, true);
      clearTimeout(layoutTimer);
      layoutTimer = setTimeout(() => { setImgSize(); }, LAZY_RENDER_TIME);
    }
  }).scroll(() => { hideMenu(); });
  ui.on('blur', () => { hideMenu(); }).on('move', () => { hideMenu(); });

  ipc.on('open', (event, item) => { open(JSON.parse(item)); });

  ipc.on('theme-changed', (event, uiId, iTheme) => { updateTheme(iTheme); });

  ipc.send('ui-ready');
}, false);
