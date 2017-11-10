'use strict';

const $ = window.$ || window.jQuery,
  pathUtil = require('path'),
  keyEvent = require('./key-event.js'),
  general = require('./general.js'),

  SCROLL_DUR = 200,
  TOLERANCE = 10, // for calculated position by browser
  LAZY_RESIZE_TIME = 300,
  SHEAF_LOAD_ITEMS = 16,
  DEFAULT_SORT_BY = [
    {key: 'dirPath', desc: false},
    {key: 'name', desc: false},
    {key: 'area', desc: true},
    {key: 'width', desc: true},
    {key: 'height', desc: true},
    {key: 'extension', desc: false},
    {key: 'mtime', desc: true},
    {key: 'size', desc: true}
  ],
  ERROR_IMG_URL = './error.svg';

var
  items = [], selectedItem, onItemSelected, lines, // lines[y][x] = item
  thumbSize = 200, listView = false, showInfo = false, keyDisabled = false, sortBy,
  viewWidth, viewHeight, resizeTimer,
  $container, $window, $body, elmView;

/**
 * @typedef {Object} sortKeys
 * @property {string} name - From file stats.
 * @property {string} extension - From file stats.
 * @property {string} dirPath - From file stats.
 * @property {Date} mtime - From file stats.
 * @property {number} size - From file stats.
 * @property {number} width - From image loading.
 * @property {number} height - From image loading.
 * @property {number} area - From image loading.
 */

/**
 * @class
 * @property {string} path - Image file path.
 * @property {string} url - Image file URL.
 * @property {Date} mtime - Modified Time.
 * @property {number} size - File size.
 * @property {number} width - Width of image. It is set by `load` method.
 * @property {number} height - Height of image. It is set by `load` method.
 * @property {string} label - Label text to show.
 * @property {jQuery} $elm - Item element.
 * @property {jQuery} $img - <img> element.
 * @property {jQuery} $label - Label element.
 * @property {jQuery} $mtime - Info-`mtime` element.
 * @property {jQuery} $size - Info-`size` element.
 * @property {jQuery} $area - Info-`area` element.
 * @property {Object} bBox - Relative to the view. (width, height, left, right, top, bottom)
 * @property {Object} axis - x: col, y: line 0-based
 * @property {sortKeys} sortKeys - sortKeys object.
 * @property {boolean} selected - Item being selected.
 * @property {boolean} loaded - Image was loaded.
 * @property {boolean} error - Image loading failed.
 * @property {boolean} finished - Image loading finished regardless of errors.
 * @param {Stats} stats - `Stats` object of image file that was returned by statsFilelist.
 * @param {string} basePath - Resolved path to directory.
 */
function CatalogItem(stats, basePath) {
  this.path = stats.fullPath;
  this.url = 'file:///' + encodeURIComponent(stats.fullPath);
  this.mtime = stats.mtime;
  this.size = stats.size;
  this.label = pathUtil.relative(basePath, stats.fullPath);
  this.sortKeys = {
    name: stats.name,
    extension: stats.extension,
    // Make separators be upside in sort.
    dirPath: stats.dirPath.substr(basePath.length).replace(/\/|\\/g, '\t'),
    mtime: stats.mtime,
    size: stats.size
  };
  this.$img = $('<img/>');
  this.$label = $('<div class="label"/>').text(this.label);

  this.$mtime = $(`<div class="info mtime">${general.dateToString(stats.mtime)}</div>`);
  {
    let bytes = general.bytesToString(stats.size, 1, true),
      numParts = (bytes[0] + '').split('.');
    this.$size = $('<div class="info size"' +
      `${bytes[0] !== stats.size ? ` title="${general.numToString(stats.size)} B"` : ''}>` +
      `<span>${numParts[0]}</span>` +
      `<span>${numParts.length >= 2 ? `.${numParts[1]}` : ''}</span><span>${bytes[1]}</span></div>`);
  }
  this.$area = $('<div class="info area"/>');

  this.$elm = $('<div class="item"/>')
    .append(this.$img, this.$label, this.$area, this.$size, this.$mtime).appendTo($container)
    .click(() => { this.select(); });
}

function updateBBox() {
  // `item.bBox` relative to the view
  var offsetLeft = $window.scrollLeft(),
    offsetTop = $window.scrollTop(),
    lastItemTop = -thumbSize * 2,
    x, y = -1;
  lines = [];

  if (!items.length) { return; }
  items.forEach(item => {
    var bBox = item.$elm.get(0).getBoundingClientRect();
    item.bBox = {
      width: bBox.width,
      height: bBox.height,
      left: bBox.left + offsetLeft,
      right: bBox.right + offsetLeft,
      top: bBox.top + offsetTop,
      bottom: bBox.bottom + offsetTop
    };

    if (!listView && Math.abs(item.bBox.top - lastItemTop) < TOLERANCE) { // next col
      x++;
    } else { // next line
      x = 0;
      y++;
      lines[y] = [];
    }
    item.axis = {x: x, y: y};
    lines[y][x] = item;
    lastItemTop = item.bBox.top;
  });
}

/**
 * @param {number} [size] - Thumbnail size. If it is in list-view mode, this is ignored, and size is reset.
 * @returns {CatalogItem} Current instance.
 */
CatalogItem.prototype.setThumbSize = function(size) {
  if (listView) {
    this.$elm.css({width: '', height: ''});
  } else {
    this.$elm.css({width: size + 'px', height: size + 'px'});
    this.$label[size < 150 ? 'addClass' : 'removeClass']('small');
  }
  return this;
};

CatalogItem.prototype.select = function(ignoreView) {
  if (selectedItem !== this) {
    if (selectedItem) {
      selectedItem.$elm.removeClass('selected');
      selectedItem.selected = false;
    }
    (selectedItem = this).$elm.addClass('selected');
    selectedItem.selected = true;
  }

  if (!ignoreView) {
    // Scroll in to view.
    let scrollLeft = $window.scrollLeft(),
      scrollTop = $window.scrollTop(),
      scrollLeftNew = scrollLeft, scrollTopNew = scrollTop;

    if (scrollLeftNew < selectedItem.bBox.right - viewWidth) {
      scrollLeftNew = selectedItem.bBox.right - viewWidth;
    }
    if (scrollLeftNew > selectedItem.bBox.left) { // give priority to left
      scrollLeftNew = selectedItem.bBox.left;
    }

    if (scrollTopNew < selectedItem.bBox.bottom - viewHeight) {
      scrollTopNew = selectedItem.bBox.bottom - viewHeight;
    }
    if (scrollTopNew > selectedItem.bBox.top) { // give priority to top
      scrollTopNew = selectedItem.bBox.top;
    }

    if (scrollLeftNew !== scrollLeft || scrollTopNew !== scrollTop) {
      $body.stop().animate({scrollLeft: scrollLeftNew, scrollTop: scrollTopNew},
        {duration: SCROLL_DUR, queue: false});
    }
  }

  if (onItemSelected) { onItemSelected(this); }
  return this;
};

CatalogItem.prototype.load = function(bOn, url, orgWidth, orgHeight, cbLoaded) {
  var that = this;

  function done(event) {
    that.$img.off('load error', done); // similar to `one()`, but it catches both event types.
    if (event.type === 'load') {
      that.loaded = true;
      that.width = that.sortKeys.width = orgWidth;
      that.height = that.sortKeys.height = orgHeight;
      that.sortKeys.area = orgWidth * orgHeight;
      that.$area.html(`<span>${general.numToString(that.width)} x</span>` +
        `<span>${general.numToString(that.height)} px</span>`);
    } else {
      that.setError();
    }
    that.finished = true;
    if (cbLoaded) { cbLoaded(that, url); }
  }

  that.loaded = that.error = that.finished = false;
  if (bOn) {
    that.$img.on('load error', done);
    that.$img.attr('src', url);
  } else {
    that.$img.attr('src', '');
  }
  return that;
};

CatalogItem.prototype.setError = function() {
  console.error('[ERROR] %s', this.path); // Is there no way to get an error information?
  this.error = true;
  this.width = this.height = this.sortKeys.width = this.sortKeys.height = this.sortKeys.area = 0;
  this.$area.html('<span>0 x</span><span>0 px</span>');
  this.$img.attr('src', ERROR_IMG_URL);
  return this;
};

CatalogItem.setThumbSize = size => {
  thumbSize = size;
  if (!items.length) { return; }
  items.forEach(item => { item.setThumbSize(thumbSize); });
  if (!listView) {
    updateBBox();
    (selectedItem || items[0]).select(); // to scroll.
  }
};

CatalogItem.setViewType = list => {
  listView = list;
  $container[listView ? 'addClass' : 'removeClass']('list');
  if (!items.length) { return; }
  items.forEach(item => { item.setThumbSize(thumbSize); });
  updateBBox();
  (selectedItem || items[0]).select(); // to scroll.
};

CatalogItem.setShowInfo = show => {
  showInfo = show;
  $container[showInfo ? 'addClass' : 'removeClass']('show-info');
};

CatalogItem.clear = () => {
  items.forEach(item => {
    item.$elm.remove();
    item.$elm = item.$img = item.$label = null;
  });
  items = [];
  lines = [];
  $container.empty();
  selectedItem = null;
};

CatalogItem.addFiles = (files, basePath, maxThumbSize, ignoreView, cbDone) => {
  const LEN_ITEMS_BEFORE = items.length;
  var iItem = LEN_ITEMS_BEFORE - 1, lenItemsAfter,
    loadingItems = 0, loadedItems = LEN_ITEMS_BEFORE, buffers = [], iBuffer, $progress;

  function loadItems() {
    iBuffer = -1;
    while (++iBuffer < SHEAF_LOAD_ITEMS && ++iItem < lenItemsAfter) {
      buffers[iBuffer].img.item = items[iItem]; // ref
      buffers[iBuffer].img.src = items[iItem].url;
      loadingItems++;
    }
  }

  function itemLoaded(item, url) {
    if (url) { URL.revokeObjectURL(url); }
    loadedItems++;
    $progress.text(`${Math.round(
      (loadedItems - LEN_ITEMS_BEFORE) / (lenItemsAfter - LEN_ITEMS_BEFORE) * 100)}%`);
    if (--loadingItems <= 0) {
      if (loadedItems >= lenItemsAfter) {
        buffers.forEach(buffer => { buffer.img = buffer.canvas = buffer.ctx = null; });
        buffers = null;
        window.gc();
        CatalogItem.sort(null, null, ignoreView);
        $progress.removeClass('show');
        cbDone();
      } else {
        loadItems();
      }
    }
  }

  function imgLoaded(event) {
    var img = event.target,
      canvas = img.buffer.canvas,
      ctx = img.buffer.ctx,
      item = img.item,
      orgWidth = img.width, orgHeight = img.height,
      ratio = maxThumbSize / Math.max(orgWidth, orgHeight),
      thumbWidth = orgWidth * ratio,
      thumbHeight = orgHeight * ratio;

    canvas.width = thumbWidth;
    canvas.height = thumbHeight;
    ctx.clearRect(0, 0, thumbWidth, thumbHeight);
    ctx.drawImage(img, 0, 0, thumbWidth, thumbHeight);
    canvas.toBlob(blob => {
      item.load(true, URL.createObjectURL(blob), orgWidth, orgHeight, itemLoaded);
    });
  }

  function imgError(event) {
    var item = event.target.item;
    item.setError().finished = true;
    itemLoaded(item);
  }

  basePath = pathUtil.resolve(basePath);
  files.forEach(
    stats => { items.push((new CatalogItem(stats, basePath)).setThumbSize(thumbSize)); });
  lenItemsAfter = items.length;
  {
    let i;
    for (i = 0; i < SHEAF_LOAD_ITEMS; i++) {
      let img = new Image(),
        canvas = document.createElement('canvas'),
        ctx = canvas.getContext('2d');
      buffers[i] = {
        img: img,
        canvas: canvas,
        ctx: ctx
      };
      img.buffer = buffers[i]; // ref
      img.addEventListener('load', imgLoaded, false);
      img.addEventListener('error', imgError, false);
    }
  }
  $progress = $('#progress').text('0%').addClass('show');
  loadItems();
};

CatalogItem.sort = (key, desc, ignoreView) => {
  if (key != null) { // eslint-disable-line eqeqeq
    sortBy = sortBy.reduce((sortBy, keyOrder) => {
      if (keyOrder.key !== key) { sortBy.push(keyOrder); }
      return sortBy;
    }, [{key: key, desc: desc}]);
  }

  if (!items.length) { return sortBy; }

  items.sort((a, b) => {
    var cmp;
    sortBy.some(keyOrder => {
      var keyA = a.sortKeys[keyOrder.key], keyB = b.sortKeys[keyOrder.key];
      cmp = (keyA > keyB ? 1 : keyA < keyB ? -1 : 0) * (keyOrder.desc ? -1 : 1);
      return cmp !== 0;
    });
    return cmp;
  });
  items.forEach(item => { item.$elm.appendTo($container); });

  updateBBox();
  (selectedItem || items[0]).select(ignoreView); // to scroll.
  return sortBy;
};

CatalogItem.resetSortBy = () => {
  sortBy = JSON.parse(JSON.stringify(DEFAULT_SORT_BY));
  return sortBy;
};

CatalogItem.keyDisabled = disabled => {
  keyDisabled = disabled;
};

CatalogItem.onItemSelected = cb => {
  onItemSelected = cb;
};

CatalogItem.init = ($itemsContainer, $documentBody, $documentWindow) => {

  function containerResized() {
    viewWidth = elmView.clientWidth;
    viewHeight = elmView.clientHeight;
    if (!items.length) { return; }
    updateBBox();
    (selectedItem || items[0]).select(); // to scroll.
  }

  $container = $itemsContainer;
  $body = $documentBody;
  $window = $documentWindow;
  elmView = document.querySelector('html'); // window has no clientWidth/Height
  viewWidth = elmView.clientWidth;
  viewHeight = elmView.clientHeight;

  $window.resize(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(containerResized, LAZY_RESIZE_TIME);
  });

  $(document).keydown(event => {
    var selectedAxis, maxY;

    function getPrevLineItem(axis) {
      var prevLine = lines[axis.y - 1];
      return prevLine[axis.x <= prevLine.length - 1 ?
        axis.x : prevLine.length - 1];
    }

    function getNextLineItem(axis) {
      var nextLine = lines[axis.y + 1];
      return nextLine[axis.x <= nextLine.length - 1 ?
        axis.x : nextLine.length - 1];
    }

    if (!items.length || keyDisabled || keyEvent(event).modKey) { return; }
    if (!selectedItem) { items[0].select(true); }
    selectedAxis = selectedItem.axis;
    maxY = lines.length - 1;

    switch (event.which) { // eslint-disable-line default-case
      case 37: // Left
        if (selectedAxis.x > 0) {
          lines[selectedAxis.y][selectedAxis.x - 1].select();
          event.preventDefault();
        } else if (selectedAxis.y > 0) {
          let prevLine = lines[selectedAxis.y - 1];
          prevLine[prevLine.length - 1].select();
          event.preventDefault();
        }
        break;
      case 39: // Right
        if (selectedAxis.x < lines[selectedAxis.y].length - 1) {
          lines[selectedAxis.y][selectedAxis.x + 1].select();
          event.preventDefault();
        } else if (selectedAxis.y < maxY) {
          lines[selectedAxis.y + 1][0].select();
          event.preventDefault();
        }
        break;
      case 38: // Up
        if (selectedAxis.y > 0) {
          getPrevLineItem(selectedAxis).select();
          event.preventDefault();
        }
        break;
      case 40: // Down
        if (selectedAxis.y < maxY) {
          getNextLineItem(selectedAxis).select();
          event.preventDefault();
        }
        break;
      case 33: // PageUp
        if (selectedAxis.y > 0) {
          let topEdge;
          if (selectedAxis.y === 1 ||
              (topEdge = $window.scrollTop()) + viewHeight < selectedItem.bBox.bottom ||
              topEdge > selectedItem.bBox.top) {
            getPrevLineItem(selectedAxis).select();
          } else { // `selected` is shown in view. y >= 2
            let items = [], y = selectedAxis.y, existsNext;
            while (y > 0) {
              let prevLineItem = getPrevLineItem({x: selectedAxis.x, y: y});
              items.push(prevLineItem);
              if (prevLineItem.bBox.top < topEdge) {
                existsNext = true;
                break;
              }
              y--;
            }
            if (items.length >= 2) { // select a longest distance item in view.
              items[items.length - (existsNext ? 2 : 1)].select();
            } else if (items[0].bBox.bottom > topEdge) { // part of item is shown in view.
              items[0].select();
            } else {
              existsNext = false;
              while (y > 0) {
                let prevLineItem = getPrevLineItem({x: selectedAxis.x, y: y});
                items.push(prevLineItem);
                if (prevLineItem.bBox.top < topEdge - viewHeight) {
                  existsNext = true;
                  break;
                }
                y--;
              }
              items[items.length - (existsNext ? 2 : 1)].select();
            }
          }
          event.preventDefault();
        }
        break;
      case 34: // PageDown
        if (selectedAxis.y < maxY) {
          let bottomEdge;
          if (selectedAxis.y === maxY - 1 ||
              (bottomEdge = $window.scrollTop() + viewHeight) < selectedItem.bBox.bottom ||
              bottomEdge - viewHeight > selectedItem.bBox.top) {
            getNextLineItem(selectedAxis).select();
          } else { // `selected` is shown in view. y <= maxY - 2
            let items = [], y = selectedAxis.y, existsNext;
            while (y < maxY) {
              let nextLineItem = getNextLineItem({x: selectedAxis.x, y: y});
              items.push(nextLineItem);
              if (nextLineItem.bBox.bottom > bottomEdge) {
                existsNext = true;
                break;
              }
              y++;
            }
            if (items.length >= 2) { // select a longest distance item in view.
              items[items.length - (existsNext ? 2 : 1)].select();
            } else if (items[0].bBox.top < bottomEdge) { // part of item is shown in view.
              items[0].select();
            } else {
              existsNext = false;
              while (y < maxY) {
                let nextLineItem = getNextLineItem({x: selectedAxis.x, y: y});
                items.push(nextLineItem);
                if (nextLineItem.bBox.bottom > bottomEdge + viewHeight) {
                  existsNext = true;
                  break;
                }
                y++;
              }
              items[items.length - (existsNext ? 2 : 1)].select();
            }
          }
          event.preventDefault();
        }
        break;
      case 36: // Home
        if (selectedItem !== items[0]) {
          items[0].select();
          event.preventDefault();
        }
        break;
      case 35: // End
        if (selectedItem !== items[items.length - 1]) {
          items[items.length - 1].select();
          event.preventDefault();
        }
        break;
    }
  });
};

CatalogItem.resetSortBy();
Object.defineProperty(CatalogItem, 'items', {get: () => items});
Object.defineProperty(CatalogItem, 'sortBy',
  {get: () => sortBy, set: newSortBy => { sortBy = newSortBy; }});
Object.defineProperty(CatalogItem, 'selectedItem', {get: () => selectedItem || items[0].select()});

module.exports = CatalogItem;
