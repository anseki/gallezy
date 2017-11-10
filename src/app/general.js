'use strict';

const
  THEME_CLASS = ['dark', 'light'],
  DEFAULT_THEME_CLASS = 0;

function key2label(key) {
  return key.split(/\s|\-|_/)
    .map(word => `${word[0].toUpperCase()}${word.slice(1)}`).join(' ');
}

/**
 * @param {number} bytes - Bytes.
 * @param {number} [digits] - The number of digits to appear after the decimal point.
 * @param {boolean} [suppress] - Suppress trailer zeros after the decimal point.
 * @returns {Array} [bytes, unit].
 */
module.exports.bytesToString = (bytes, digits, suppress) => {
  const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  var i, num;
  if (bytes === 0) {
    i = 0;
    num = 0;
  } else {
    i = Math.floor(Math.log(bytes) / Math.log(1024));
    num = (bytes / Math.pow(1024, i));
  }
  num = num.toFixed(typeof digits === 'number' ? digits : 1);
  return [suppress ? parseFloat(num) : num, UNITS[i]];
};

module.exports.numToString = num => (num + '').replace(/(\d)(?=(?:\d{3})+(?!\d))/g, '$1,');

module.exports.dateToString = date =>
  `${date.getFullYear()}` +
  `-${('00' + (date.getMonth() + 1)).slice(-2)}` +
  `-${('00' + date.getDate()).slice(-2)}` +
  ` ${('00' + date.getHours()).slice(-2)}` +
  `:${('00' + date.getMinutes()).slice(-2)}` +
  `:${('00' + date.getSeconds()).slice(-2)}`;

module.exports.THEME_CLASS = THEME_CLASS;
module.exports.DEFAULT_THEME_CLASS = DEFAULT_THEME_CLASS;

// implement `updateTheme`
module.exports.updateTheme = (theme, byMenuValue, stats, $body) => {
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
};

module.exports.addThemeMenuItems = (menuItems, commands, stats, $body, ipc) => {
  THEME_CLASS.forEach((theme, i) => {
    var commandId = `themeIndex${i}`;
    commands[commandId] = {handle: () => {
      module.exports.updateTheme(i, false, stats, $body);
      ipc.send('theme-changed', i);
    }};
    menuItems[commandId] = {
      type: 'radio',
      radiogroup: 'theme',
      label: key2label(theme),
      callback: () => {
        module.exports.updateTheme(i, true, stats, $body);
        ipc.send('theme-changed', i);
      }
    };
  });
};

// implement `updateFullScreen`
module.exports.updateFullScreen = (fullScreen, byMenuValue, $body, ui) => {
  var curFullScreen = ui.isFullScreen(); // stats is updated by main.js
  if (fullScreen == null) { fullScreen = !curFullScreen; } // eslint-disable-line eqeqeq
  if (fullScreen !== curFullScreen) {
    ui.setFullScreen(fullScreen);
    if (!byMenuValue) { $body.contextMenuCommon('value', 'fullScreen', fullScreen); }
  }
  return fullScreen;
};

module.exports.fileDrop = drop => {
  document.addEventListener('dragover', event => {
    event.stopPropagation();
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, true);

  document.addEventListener('drop', event => {
    event.stopPropagation();
    event.preventDefault();
    drop(event.dataTransfer.files[0] ? event.dataTransfer.files[0].path : null);
  }, true);
};
