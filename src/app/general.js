'use strict';

/**
 * @param {number} bytes - Bytes.
 * @param {number} [digits] - The number of digits to appear after the decimal point.
 * @param {boolean} [suppress] - Suppress trailer zeros after the decimal point.
 * @returns {Array} - [bytes, unit].
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

module.exports.dateToString = date => `${date.getFullYear()}` +
  `-${('00' + (date.getMonth() + 1)).slice(-2)}` +
  `-${('00' + date.getDate()).slice(-2)}` +
  ` ${('00' + date.getHours()).slice(-2)}` +
  `:${('00' + date.getMinutes()).slice(-2)}` +
  `:${('00' + date.getSeconds()).slice(-2)}`;
