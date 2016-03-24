'use strict';

/**
 * Parse KeyboardEvent and add properties to it.
 * @param {KeyboardEvent} event - Original KeyboardEvent object.
 * @returns {KeyboardEvent} event
 */
module.exports = event => {
  event.modKey = event.altKey || event.ctrlKey || event.shiftKey;
  /* eslint-disable no-multi-spaces */
  event.modKeyOnlyAlt =      event.altKey   && !event.ctrlKey   && !event.shiftKey;
  event.modKeyOnlyCtrl =    !event.altKey   &&  event.ctrlKey   && !event.shiftKey;
  event.modKeyOnlyShift =   !event.altKey   && !event.ctrlKey   &&  event.shiftKey;
  /* eslint-enable no-multi-spaces */
  return event;
};
