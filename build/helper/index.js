(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
  typeof define === 'function' && define.amd ? define(factory) :
  (global = global || self, global.gridHelper = factory());
}(this, function () { 'use strict';

  function getRowsCount(items) {
    return Math.max(...items.map(val => val.y + val.h), 1);
  }

  const makeMatrix = (rows, cols) => Array.from(Array(rows), () => new Array(cols)); // make 2d array

  function makeMatrixFromItems(items, _row = getRowsCount(items), _col) {
    let matrix = makeMatrix(_row, _col);
    for (var i = 0; i < items.length; i++) {
      const value = items[i];
      const {
        x,
        y,
        w,
        h,
        responsive: { valueW },
      } = value;

      for (var j = y; j < y + h; j++) {
        const row = matrix[j];
        for (var k = x; k < x + (w - valueW); k++) {
          row[k] = value;
        }
      }
    }
    return matrix;
  }

  function findCloseBlocks(items, matrix, curObject) {
    const {
      w,
      h,
      x,
      y,
      responsive: { valueW },
    } = curObject;
    const tempR = matrix.slice(y, y + h);
    let result = []; // new Set()
    for (var i = 0; i < tempR.length; i++) {
      let tempA = tempR[i].slice(x, x + (w - valueW));
      result = [...result, ...tempA.map(val => val && val.id).filter(val => val)];
    }
    return [...result.filter((item, pos) => result.indexOf(item) == pos)];
    // return [...new Set(result)];
  }

  function makeMatrixFromItemsIgnore(
    items,
    ignoreList,
    _row, //= getRowsCount(items)
    _col,
  ) {
    let matrix = makeMatrix(_row, _col);
    for (var i = 0; i < items.length; i++) {
      const value = items[i];
      const {
        x,
        y,
        w,
        h,
        id,
        responsive: { valueW },
      } = value;

      if (ignoreList.indexOf(id) === -1) {
        for (var j = y; j < y + h; j++) {
          const row = matrix[j];
          if (row) {
            for (var k = x; k < x + (w - valueW); k++) {
              row[k] = value;
            }
          }
        }
      }
    }
    return matrix;
  }

  function findItemsById(closeBlocks, items) {
    return items.filter(value => closeBlocks.indexOf(value.id) !== -1);
  }

  function adjustItem(matrix, item, items = [], cols) {
    const { w: width } = item;

    let valueW = item.responsive.valueW;
    for (var i = 0; i < matrix.length; i++) {
      const row = matrix[i];
      for (var j = 0; j < row.length; j++) {
        const empty = row.findIndex(val => val === undefined); // super dirty to check (empty for undefined)
        if (empty !== -1) {
          var z = row.slice(empty);
          var n = z.length;
          for (var x = 0; x < z.length; x++) {
            if (z[x] !== undefined) {
              n = x;
              break;
            }
          } // super dirty to check (empty for undefined)

          valueW = Math.max(width - n, 0);

          return {
            y: i,
            x: empty,
            responsive: { valueW },
          };
        }
      }
    }

    valueW = Math.max(width - cols, 0);
    return {
      y: getRowsCount(items),
      x: 0,
      responsive: { valueW },
    };
  }

  function resizeItems(items, col, rows = getRowsCount(items)) {
    let matrix = makeMatrix(rows, col);
    items.forEach((item, index) => {
      let ignore = items.slice(index + 1).map(val => val.id);
      let position = adjustItem(matrix, item, items, col);

      items = items.map(value => (value.id === item.id ? { ...item, ...position } : value));

      matrix = makeMatrixFromItemsIgnore(items, ignore, getRowsCount(items), col);
    });

    return items;
  }

  function findFreeSpaceForItem(matrix, item, items = []) {
    const cols = matrix[0].length;
    let xNtime = cols - (item.w - item.responsive.valueW);

    for (var i = 0; i < matrix.length; i++) {
      const row = matrix[i];
      for (var j = 0; j < xNtime + 1; j++) {
        const sliceA = row.slice(j, j + (item.w - item.responsive.valueW));
        const empty = sliceA.every(val => val === undefined);
        if (empty) {
          const isEmpty = matrix.slice(i, i + item.h).every(a => a.slice(j, j + (item.w - item.responsive.valueW)).every(n => n === undefined));

          if (isEmpty) {
            return { y: i, x: j };
          }
        }
      }
    }

    return {
      y: getRowsCount(items),
      x: 0,
    };
  }

  function assignPosition(item, position, value) {
    return value.id === item.id ? { ...item, ...position } : value;
  }

  const replaceItem = (item, cachedItem, value) => (value.id === item.id ? cachedItem : value);

  function moveItem($item, items, cols, originalItem) {
    let matrix = makeMatrixFromItemsIgnore(items, [$item.id], getRowsCount(items), cols);

    const closeBlocks = findCloseBlocks(items, matrix, $item);
    let closeObj = findItemsById(closeBlocks, items);

    const statics = closeObj.find(value => value.static);

    if (statics) {
      if (originalItem) {
        return items.map(replaceItem.bind(null, $item, originalItem));
      }
    }

    matrix = makeMatrixFromItemsIgnore(items, closeBlocks, getRowsCount(items), cols);

    let tempItems = items;

    let tempCloseBlocks = closeBlocks;

    let exclude = [];

    closeObj.forEach(item => {
      let position = findFreeSpaceForItem(matrix, item, tempItems);

      exclude.push(item.id);

      if (position) {
        tempItems = tempItems.map(assignPosition.bind(null, item, position));
        let getIgnoreItems = tempCloseBlocks.filter(value => exclude.indexOf(value) === -1);

        matrix = makeMatrixFromItemsIgnore(tempItems, getIgnoreItems, getRowsCount(items), cols);
      }
    });

    return tempItems;
  }

  function makeItem(item) {
    return {
      drag: {
        top: null,
        left: null,
        dragging: false,
      },
      resize: {
        width: null,
        height: null,
        resizing: false,
      },
      responsive: {
        valueW: 0,
      },
      static: false,
      resizable: !item.static,
      draggable: !item.static,
      min: { ...item.min },
      max: { ...item.max },
      ...item,
    };
  }

  const gridHelp = {
    findSpaceForItem(item, items, cols) {
      let matrix = makeMatrixFromItems(items, getRowsCount(items), cols);

      let position = findFreeSpaceForItem(matrix, item, items);
      return position;
    },

    appendItem(item, items, cols) {
      return moveItem(item, [...items, ...[item]], cols);
    },

    resizeItems(items, col, rows) {
      return resizeItems(items, col, rows);
    },

    item(obj) {
      return makeItem(obj);
    },
  };

  return gridHelp;

}));
