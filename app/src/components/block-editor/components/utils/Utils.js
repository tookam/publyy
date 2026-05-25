export default class Utils {
  static isUnsafeMergeKey (property) {
    return property === '__proto__' ||
           property === 'prototype' ||
           property === 'constructor';
  }

  static isPlainObject (value) {
    if (!value || typeof value !== 'object') {
      return false;
    }

    let prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  /*
   * Deep merge for objects as Object.assign not merge objects properly
   */
  static deepMerge (target, source) {
    if (!Utils.isPlainObject(target)) {
      target = {};
    }

    if (!Utils.isPlainObject(source)) {
      source = {};
    }

    for (let property in source) {
      if (Object.prototype.hasOwnProperty.call(source, property)) {
        if (Utils.isUnsafeMergeKey(property)) {
          continue;
        }

        let sourceProperty = source[property];

        if (Utils.isPlainObject(sourceProperty)) {
          target[property] = Utils.deepMerge(target[property], sourceProperty);
          continue;
        } else if (sourceProperty instanceof Date) {
          target[property] = new Date(sourceProperty.getTime());
          continue;
        }

        target[property] = sourceProperty;
      }
    }

    for (let a = 2, l = arguments.length; a < l; a++) {
      Utils.deepMerge(target, arguments[a]);
    }

    return target;
  }

  /*
   * Run function if it is not invoked since X ms.
   */
  static debounce (func, wait, immediate) {
    var timeout;

    return function () {
      var context = this;
      var args = arguments;
      var later = function () {
        timeout = null;

        if (!immediate) {
          func.apply(context, args);
        }
      };

      var callNow = immediate && !timeout;
      clearTimeout(timeout);

      timeout = setTimeout(later, wait);

      if (callNow) {
        func.apply(context, args);
      }
    };
  }
}
