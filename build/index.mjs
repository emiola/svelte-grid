function noop() { }
function assign(tar, src) {
    // @ts-ignore
    for (const k in src)
        tar[k] = src[k];
    return tar;
}
function run(fn) {
    return fn();
}
function blank_object() {
    return Object.create(null);
}
function run_all(fns) {
    fns.forEach(run);
}
function is_function(thing) {
    return typeof thing === 'function';
}
function safe_not_equal(a, b) {
    return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
}
function create_slot(definition, ctx, fn) {
    if (definition) {
        const slot_ctx = get_slot_context(definition, ctx, fn);
        return definition[0](slot_ctx);
    }
}
function get_slot_context(definition, ctx, fn) {
    return definition[1]
        ? assign({}, assign(ctx.$$scope.ctx, definition[1](fn ? fn(ctx) : {})))
        : ctx.$$scope.ctx;
}
function get_slot_changes(definition, ctx, changed, fn) {
    return definition[1]
        ? assign({}, assign(ctx.$$scope.changed || {}, definition[1](fn ? fn(changed) : {})))
        : ctx.$$scope.changed || {};
}

function append(target, node) {
    target.appendChild(node);
}
function insert(target, node, anchor) {
    target.insertBefore(node, anchor || null);
}
function detach(node) {
    node.parentNode.removeChild(node);
}
function element(name) {
    return document.createElement(name);
}
function text(data) {
    return document.createTextNode(data);
}
function space() {
    return text(' ');
}
function listen(node, event, handler, options) {
    node.addEventListener(event, handler, options);
    return () => node.removeEventListener(event, handler, options);
}
function attr(node, attribute, value) {
    if (value == null)
        node.removeAttribute(attribute);
    else
        node.setAttribute(attribute, value);
}
function children(element) {
    return Array.from(element.childNodes);
}
function set_style(node, key, value, important) {
    node.style.setProperty(key, value, important ? 'important' : '');
}
function toggle_class(element, name, toggle) {
    element.classList[toggle ? 'add' : 'remove'](name);
}
function custom_event(type, detail) {
    const e = document.createEvent('CustomEvent');
    e.initCustomEvent(type, false, false, detail);
    return e;
}

let current_component;
function set_current_component(component) {
    current_component = component;
}
function get_current_component() {
    if (!current_component)
        throw new Error(`Function called outside component initialization`);
    return current_component;
}
function beforeUpdate(fn) {
    get_current_component().$$.before_update.push(fn);
}
function onMount(fn) {
    get_current_component().$$.on_mount.push(fn);
}
function createEventDispatcher() {
    const component = current_component;
    return (type, detail) => {
        const callbacks = component.$$.callbacks[type];
        if (callbacks) {
            // TODO are there situations where events could be dispatched
            // in a server (non-DOM) environment?
            const event = custom_event(type, detail);
            callbacks.slice().forEach(fn => {
                fn.call(component, event);
            });
        }
    };
}

const dirty_components = [];
const binding_callbacks = [];
const render_callbacks = [];
const flush_callbacks = [];
const resolved_promise = Promise.resolve();
let update_scheduled = false;
function schedule_update() {
    if (!update_scheduled) {
        update_scheduled = true;
        resolved_promise.then(flush);
    }
}
function add_render_callback(fn) {
    render_callbacks.push(fn);
}
function flush() {
    const seen_callbacks = new Set();
    do {
        // first, call beforeUpdate functions
        // and update components
        while (dirty_components.length) {
            const component = dirty_components.shift();
            set_current_component(component);
            update(component.$$);
        }
        while (binding_callbacks.length)
            binding_callbacks.pop()();
        // then, once components are updated, call
        // afterUpdate functions. This may cause
        // subsequent updates...
        for (let i = 0; i < render_callbacks.length; i += 1) {
            const callback = render_callbacks[i];
            if (!seen_callbacks.has(callback)) {
                callback();
                // ...so guard against infinite loops
                seen_callbacks.add(callback);
            }
        }
        render_callbacks.length = 0;
    } while (dirty_components.length);
    while (flush_callbacks.length) {
        flush_callbacks.pop()();
    }
    update_scheduled = false;
}
function update($$) {
    if ($$.fragment) {
        $$.update($$.dirty);
        run_all($$.before_update);
        $$.fragment.p($$.dirty, $$.ctx);
        $$.dirty = null;
        $$.after_update.forEach(add_render_callback);
    }
}
const outroing = new Set();
let outros;
function group_outros() {
    outros = {
        r: 0,
        c: [],
        p: outros // parent group
    };
}
function check_outros() {
    if (!outros.r) {
        run_all(outros.c);
    }
    outros = outros.p;
}
function transition_in(block, local) {
    if (block && block.i) {
        outroing.delete(block);
        block.i(local);
    }
}
function transition_out(block, local, detach, callback) {
    if (block && block.o) {
        if (outroing.has(block))
            return;
        outroing.add(block);
        outros.c.push(() => {
            outroing.delete(block);
            if (callback) {
                if (detach)
                    block.d(1);
                callback();
            }
        });
        block.o(local);
    }
}

const globals = (typeof window !== 'undefined' ? window : global);
function outro_and_destroy_block(block, lookup) {
    transition_out(block, 1, 1, () => {
        lookup.delete(block.key);
    });
}
function update_keyed_each(old_blocks, changed, get_key, dynamic, ctx, list, lookup, node, destroy, create_each_block, next, get_context) {
    let o = old_blocks.length;
    let n = list.length;
    let i = o;
    const old_indexes = {};
    while (i--)
        old_indexes[old_blocks[i].key] = i;
    const new_blocks = [];
    const new_lookup = new Map();
    const deltas = new Map();
    i = n;
    while (i--) {
        const child_ctx = get_context(ctx, list, i);
        const key = get_key(child_ctx);
        let block = lookup.get(key);
        if (!block) {
            block = create_each_block(key, child_ctx);
            block.c();
        }
        else if (dynamic) {
            block.p(changed, child_ctx);
        }
        new_lookup.set(key, new_blocks[i] = block);
        if (key in old_indexes)
            deltas.set(key, Math.abs(i - old_indexes[key]));
    }
    const will_move = new Set();
    const did_move = new Set();
    function insert(block) {
        transition_in(block, 1);
        block.m(node, next);
        lookup.set(block.key, block);
        next = block.first;
        n--;
    }
    while (o && n) {
        const new_block = new_blocks[n - 1];
        const old_block = old_blocks[o - 1];
        const new_key = new_block.key;
        const old_key = old_block.key;
        if (new_block === old_block) {
            // do nothing
            next = new_block.first;
            o--;
            n--;
        }
        else if (!new_lookup.has(old_key)) {
            // remove old block
            destroy(old_block, lookup);
            o--;
        }
        else if (!lookup.has(new_key) || will_move.has(new_key)) {
            insert(new_block);
        }
        else if (did_move.has(old_key)) {
            o--;
        }
        else if (deltas.get(new_key) > deltas.get(old_key)) {
            did_move.add(new_key);
            insert(new_block);
        }
        else {
            will_move.add(old_key);
            o--;
        }
    }
    while (o--) {
        const old_block = old_blocks[o];
        if (!new_lookup.has(old_block.key))
            destroy(old_block, lookup);
    }
    while (n)
        insert(new_blocks[n - 1]);
    return new_blocks;
}
function mount_component(component, target, anchor) {
    const { fragment, on_mount, on_destroy, after_update } = component.$$;
    fragment.m(target, anchor);
    // onMount happens before the initial afterUpdate
    add_render_callback(() => {
        const new_on_destroy = on_mount.map(run).filter(is_function);
        if (on_destroy) {
            on_destroy.push(...new_on_destroy);
        }
        else {
            // Edge case - component was destroyed immediately,
            // most likely as a result of a binding initialising
            run_all(new_on_destroy);
        }
        component.$$.on_mount = [];
    });
    after_update.forEach(add_render_callback);
}
function destroy_component(component, detaching) {
    if (component.$$.fragment) {
        run_all(component.$$.on_destroy);
        component.$$.fragment.d(detaching);
        // TODO null out other refs, including component.$$ (but need to
        // preserve final state?)
        component.$$.on_destroy = component.$$.fragment = null;
        component.$$.ctx = {};
    }
}
function make_dirty(component, key) {
    if (!component.$$.dirty) {
        dirty_components.push(component);
        schedule_update();
        component.$$.dirty = blank_object();
    }
    component.$$.dirty[key] = true;
}
function init(component, options, instance, create_fragment, not_equal, prop_names) {
    const parent_component = current_component;
    set_current_component(component);
    const props = options.props || {};
    const $$ = component.$$ = {
        fragment: null,
        ctx: null,
        // state
        props: prop_names,
        update: noop,
        not_equal,
        bound: blank_object(),
        // lifecycle
        on_mount: [],
        on_destroy: [],
        before_update: [],
        after_update: [],
        context: new Map(parent_component ? parent_component.$$.context : []),
        // everything else
        callbacks: blank_object(),
        dirty: null
    };
    let ready = false;
    $$.ctx = instance
        ? instance(component, props, (key, ret, value = ret) => {
            if ($$.ctx && not_equal($$.ctx[key], $$.ctx[key] = value)) {
                if ($$.bound[key])
                    $$.bound[key](value);
                if (ready)
                    make_dirty(component, key);
            }
            return ret;
        })
        : props;
    $$.update();
    ready = true;
    run_all($$.before_update);
    $$.fragment = create_fragment($$.ctx);
    if (options.target) {
        if (options.hydrate) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            $$.fragment.l(children(options.target));
        }
        else {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            $$.fragment.c();
        }
        if (options.intro)
            transition_in(component.$$.fragment);
        mount_component(component, options.target, options.anchor);
        flush();
    }
    set_current_component(parent_component);
}
class SvelteComponent {
    $destroy() {
        destroy_component(this, 1);
        this.$destroy = noop;
    }
    $on(type, callback) {
        const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
        callbacks.push(callback);
        return () => {
            const index = callbacks.indexOf(callback);
            if (index !== -1)
                callbacks.splice(index, 1);
        };
    }
    $set() {
        // overridden by instance, if it has props
    }
}

const debounce = (fn, ms = 0) => {
  let timeoutId;
  return function(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), ms);
  };
};

function getTranslate(str) {
  str = str.slice(10, -3);

  var getIndex = str.indexOf("px, ");

  var x = +str.slice(0, getIndex);

  var y = +str.slice(getIndex + 4);
  return { x, y };
}

function getCordinates(event) {
  const pageX = event.changedTouches ? event.changedTouches[0].pageX : event.pageX;
  const pageY = event.changedTouches ? event.changedTouches[0].pageY : event.pageY;
  return { pageX, pageY };
}

function getRowsCount(items) {
  return Math.max(...items.map(val => val.y + val.h), 1);
}

const getColumnFromBreakpoints = (breakpoints, windowWidth, cols, initCols) => {
  var found = false,
    tempCols = cols;
  if (breakpoints) {
    for (var i = breakpoints.length - 1; i >= 0; i--) {
      const [resolution, cols] = breakpoints[i];

      if (windowWidth <= resolution) {
        found = true;
        tempCols = cols;
        break;
      }
    }
  }

  if (!found) {
    tempCols = initCols;
  }

  return tempCols;
};

const makeMatrix = (rows, cols) => Array.from(Array(rows), () => new Array(cols)); // make 2d array

function findCloseBlocks(items, matrix, curObject) {
      console.log('@ findCloseBlocks')
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
      console.log('@ adjustItem')
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

function getItemById(id, items) {
  const index = items.findIndex(value => value.id === id);

  return {
    index,
    item: items[index],
  };
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

function getContainerHeight(items, yPerPx) {
  return Math.max(getRowsCount(items), 2) * yPerPx;
}

/* src/index.svelte generated by Svelte v3.12.1 */
const { document: document_1, window: window_1 } = globals;

function add_css() {
	var style = element("style");
	style.id = 'svelte-14tbpr7-style';
	style.textContent = "body{overflow:scroll}.svlt-grid-container.svelte-14tbpr7{position:relative}.svlt-grid-item.svelte-14tbpr7{touch-action:none;position:absolute}.svlt-grid-shadow.svelte-14tbpr7{position:absolute}.svlt-grid-resizer.svelte-14tbpr7{user-select:none;width:20px;height:20px;position:absolute;right:0;bottom:0;cursor:se-resize}.svlt-grid-resizer.svelte-14tbpr7::after{content:\"\";position:absolute;right:3px;bottom:3px;width:5px;height:5px;border-right:2px solid rgba(0, 0, 0, 0.4);border-bottom:2px solid rgba(0, 0, 0, 0.4)}";
	append(document_1.head, style);
}

const get_default_slot_changes = ({ item, items, i }) => ({ item: items, index: items });
const get_default_slot_context = ({ item, items, i }) => ({
	item: item,
	index: i
});

function get_each_context(ctx, list, i) {
	const child_ctx = Object.create(ctx);
	child_ctx.item = list[i];
	child_ctx.i = i;
	return child_ctx;
}

// (58:10) {#if item.resizable}
function create_if_block_1(ctx) {
	var div, dispose;

	return {
		c() {
			div = element("div");
			attr(div, "class", "svlt-grid-resizer svelte-14tbpr7");

			dispose = [
				listen(div, "touchstart", ctx.resizeOnMouseDown.bind(this,ctx.item.id)),
				listen(div, "mousedown", ctx.resizeOnMouseDown.bind(this,ctx.item.id))
			];
		},

		m(target, anchor) {
			insert(target, div, anchor);
		},

		p(changed, new_ctx) {
			ctx = new_ctx;
		},

		d(detaching) {
			if (detaching) {
				detach(div);
			}

			run_all(dispose);
		}
	};
}

// (45:2) {#each items as item, i (item.id)}
function create_each_block(key_1, ctx) {
	var div, t, div_style_value, current, dispose;

	const default_slot_template = ctx.$$slots.default;
	const default_slot = create_slot(default_slot_template, ctx, get_default_slot_context);

	var if_block = (ctx.item.resizable) && create_if_block_1(ctx);

	return {
		key: key_1,

		first: null,

		c() {
			div = element("div");

			if (default_slot) default_slot.c();
			t = space();
			if (if_block) if_block.c();

			attr(div, "class", "svlt-grid-item svelte-14tbpr7");
			attr(div, "style", div_style_value = "" + (ctx.useTransform ? `transform: translate(${ctx.item.drag.dragging ? ctx.item.drag.left : (ctx.item.x * ctx.xPerPx) + ctx.gap}px, ${ctx.item.drag.dragging ? ctx.item.drag.top : (ctx.item.y * ctx.yPerPx + ctx.gap)}px);` : '') + ";\n        " + (!ctx.useTransform ? `top: ${ctx.item.drag.dragging ? ctx.item.drag.top : (ctx.item.y * ctx.yPerPx) + ctx.gap}px` : '') + ";\n        " + (!ctx.useTransform ? `left: ${ctx.item.drag.dragging ? ctx.item.drag.left : (ctx.item.x * ctx.xPerPx) + ctx.gap}px` : '') + ";\n        width: " + (ctx.item.resize.resizing ? ctx.item.resize.width : ((ctx.item.w * ctx.xPerPx) - ctx.gap * 2) - (ctx.item.responsive.valueW*ctx.xPerPx)) + "px;\n        height: " + (ctx.item.resize.resizing ? ctx.item.resize.height : (ctx.item.h * ctx.yPerPx) - ctx.gap * 2) + "px;\n        z-index: " + (ctx.item.drag.dragging || ctx.item.resize.resizing ? 3 : 1) + ";\n        opacity: " + (ctx.item.resize.resizing ? 0.5 : 1));

			dispose = [
				listen(div, "mousedown", ctx.item.draggable ? ctx.dragOnMouseDown.bind(this, ctx.item.id) : null),
				listen(div, "touchstart", ctx.item.draggable ? ctx.dragOnMouseDown.bind(this, ctx.item.id) : null)
			];

			this.first = div;
		},

		l(nodes) {
			if (default_slot) default_slot.l(div_nodes);
		},

		m(target, anchor) {
			insert(target, div, anchor);

			if (default_slot) {
				default_slot.m(div, null);
			}

			append(div, t);
			if (if_block) if_block.m(div, null);
			current = true;
		},

		p(changed, new_ctx) {
			ctx = new_ctx;

			if (default_slot && default_slot.p && (changed.$$scope || changed.items)) {
				default_slot.p(
					get_slot_changes(default_slot_template, ctx, changed, get_default_slot_changes),
					get_slot_context(default_slot_template, ctx, get_default_slot_context)
				);
			}

			if (ctx.item.resizable) {
				if (!if_block) {
					if_block = create_if_block_1(ctx);
					if_block.c();
					if_block.m(div, null);
				}
			} else if (if_block) {
				if_block.d(1);
				if_block = null;
			}

			if ((!current || changed.useTransform || changed.items || changed.xPerPx || changed.gap) && div_style_value !== (div_style_value = "" + (ctx.useTransform ? `transform: translate(${ctx.item.drag.dragging ? ctx.item.drag.left : (ctx.item.x * ctx.xPerPx) + ctx.gap}px, ${ctx.item.drag.dragging ? ctx.item.drag.top : (ctx.item.y * ctx.yPerPx + ctx.gap)}px);` : '') + ";\n        " + (!ctx.useTransform ? `top: ${ctx.item.drag.dragging ? ctx.item.drag.top : (ctx.item.y * ctx.yPerPx) + ctx.gap}px` : '') + ";\n        " + (!ctx.useTransform ? `left: ${ctx.item.drag.dragging ? ctx.item.drag.left : (ctx.item.x * ctx.xPerPx) + ctx.gap}px` : '') + ";\n        width: " + (ctx.item.resize.resizing ? ctx.item.resize.width : ((ctx.item.w * ctx.xPerPx) - ctx.gap * 2) - (ctx.item.responsive.valueW*ctx.xPerPx)) + "px;\n        height: " + (ctx.item.resize.resizing ? ctx.item.resize.height : (ctx.item.h * ctx.yPerPx) - ctx.gap * 2) + "px;\n        z-index: " + (ctx.item.drag.dragging || ctx.item.resize.resizing ? 3 : 1) + ";\n        opacity: " + (ctx.item.resize.resizing ? 0.5 : 1))) {
				attr(div, "style", div_style_value);
			}
		},

		i(local) {
			if (current) return;
			transition_in(default_slot, local);
			current = true;
		},

		o(local) {
			transition_out(default_slot, local);
			current = false;
		},

		d(detaching) {
			if (detaching) {
				detach(div);
			}

			if (default_slot) default_slot.d(detaching);
			if (if_block) if_block.d();
			run_all(dispose);
		}
	};
}

// (69:2) {#if shadow.active}
function create_if_block(ctx) {
	var div, div_style_value;

	return {
		c() {
			div = element("div");
			attr(div, "class", "svlt-grid-shadow svelte-14tbpr7");
			attr(div, "style", div_style_value = "" + (ctx.useTransform ? `transform: translate(${ctx.shadow.drag.dragging ? ctx.shadow.drag.left : (ctx.shadow.x * ctx.xPerPx) + ctx.gap}px, ${ctx.shadow.drag.dragging ? ctx.shadow.drag.top : (ctx.shadow.y * ctx.yPerPx + ctx.gap)}px);` : '') + ";\n        " + (!ctx.useTransform ? `top: ${ctx.shadow.drag.dragging ? ctx.shadow.drag.top : (ctx.shadow.y * ctx.yPerPx) + ctx.gap}px` : '') + ";\n        " + (!ctx.useTransform ? `left: ${ctx.shadow.drag.dragging ? ctx.shadow.drag.left : (ctx.shadow.x * ctx.xPerPx) + ctx.gap}px` : '') + ";\n    width:" + (((ctx.shadow.w * ctx.xPerPx) - ctx.gap * 2) - (ctx.shadow.responsive.valueW*ctx.xPerPx)) + "px;\n    height:" + ((ctx.shadow.h * ctx.yPerPx) - ctx.gap * 2) + "px;");
		},

		m(target, anchor) {
			insert(target, div, anchor);
		},

		p(changed, ctx) {
			if ((changed.useTransform || changed.shadow || changed.xPerPx || changed.gap) && div_style_value !== (div_style_value = "" + (ctx.useTransform ? `transform: translate(${ctx.shadow.drag.dragging ? ctx.shadow.drag.left : (ctx.shadow.x * ctx.xPerPx) + ctx.gap}px, ${ctx.shadow.drag.dragging ? ctx.shadow.drag.top : (ctx.shadow.y * ctx.yPerPx + ctx.gap)}px);` : '') + ";\n        " + (!ctx.useTransform ? `top: ${ctx.shadow.drag.dragging ? ctx.shadow.drag.top : (ctx.shadow.y * ctx.yPerPx) + ctx.gap}px` : '') + ";\n        " + (!ctx.useTransform ? `left: ${ctx.shadow.drag.dragging ? ctx.shadow.drag.left : (ctx.shadow.x * ctx.xPerPx) + ctx.gap}px` : '') + ";\n    width:" + (((ctx.shadow.w * ctx.xPerPx) - ctx.gap * 2) - (ctx.shadow.responsive.valueW*ctx.xPerPx)) + "px;\n    height:" + ((ctx.shadow.h * ctx.yPerPx) - ctx.gap * 2) + "px;")) {
				attr(div, "style", div_style_value);
			}
		},

		d(detaching) {
			if (detaching) {
				detach(div);
			}
		}
	};
}

function create_fragment(ctx) {
	var div, each_blocks = [], each_1_lookup = new Map(), t, current, dispose;

	let each_value = ctx.items;

	const get_key = ctx => ctx.item.id;

	for (let i = 0; i < each_value.length; i += 1) {
		let child_ctx = get_each_context(ctx, each_value, i);
		let key = get_key(child_ctx);
		each_1_lookup.set(key, each_blocks[i] = create_each_block(key, child_ctx));
	}

	var if_block = (ctx.shadow.active) && create_if_block(ctx);

	return {
		c() {
			div = element("div");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			t = space();
			if (if_block) if_block.c();
			attr(div, "class", "svlt-grid-container svelte-14tbpr7");
			set_style(div, "height", "" + ctx.ch + "px");
			toggle_class(div, "svlt-grid-transition", !ctx.focuesdItem);
			dispose = listen(window_1, "resize", debounce(ctx.onResize,300));
		},

		m(target, anchor) {
			insert(target, div, anchor);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].m(div, null);
			}

			append(div, t);
			if (if_block) if_block.m(div, null);
			ctx.div_binding(div);
			current = true;
		},

		p(changed, ctx) {
			const each_value = ctx.items;

			group_outros();
			each_blocks = update_keyed_each(each_blocks, changed, get_key, 1, ctx, each_value, each_1_lookup, div, outro_and_destroy_block, create_each_block, t, get_each_context);
			check_outros();

			if (ctx.shadow.active) {
				if (if_block) {
					if_block.p(changed, ctx);
				} else {
					if_block = create_if_block(ctx);
					if_block.c();
					if_block.m(div, null);
				}
			} else if (if_block) {
				if_block.d(1);
				if_block = null;
			}

			if (!current || changed.ch) {
				set_style(div, "height", "" + ctx.ch + "px");
			}

			if (changed.focuesdItem) {
				toggle_class(div, "svlt-grid-transition", !ctx.focuesdItem);
			}
		},

		i(local) {
			if (current) return;
			for (let i = 0; i < each_value.length; i += 1) {
				transition_in(each_blocks[i]);
			}

			current = true;
		},

		o(local) {
			for (let i = 0; i < each_blocks.length; i += 1) {
				transition_out(each_blocks[i]);
			}

			current = false;
		},

		d(detaching) {
			if (detaching) {
				detach(div);
			}

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].d();
			}

			if (if_block) if_block.d();
			ctx.div_binding(null);
			dispose();
		}
	};
}

function instance($$self, $$props, $$invalidate) {


let { useTransform = false, items = [], cols = 0, dragDebounceMs = 350, gap = 0, rowHeight = 150, breakpoints, fillEmpty = true } = $$props;

let container,
  focuesdItem,
  bound,
  xPerPx,
  currentItemIndex,
  getComputedCols,
  documentWidth,
  resizeNoDynamicCalc,
  yPerPx = rowHeight,
  initCols = cols,
  shadow = {
    w: 0,
    h: 0,
    x: 0,
    y: 0,
    active: false,
    id: null,
    responsive: { valueW: 0 },
    min: {},
    max: {}
  },
  ch = getContainerHeight(items, yPerPx);

const dispatch = createEventDispatcher();

const getDocWidth = () => document.documentElement.clientWidth;

function onResize() {

  let w = document.documentElement.clientWidth;

  if(w !== documentWidth) {
    documentWidth = w;

    bound = container.getBoundingClientRect();

    let getCols = getColumnFromBreakpoints(breakpoints,w,cols,initCols);

    getComputedCols = getCols;

    $$invalidate('xPerPx', xPerPx = bound.width / getCols);

    dispatch('resize', {
      cols:getCols,
      xPerPx,
      yPerPx // same as rowHeight
    });

    if(breakpoints) {
    	$$invalidate('items', items = resizeItems(items, getCols));
    }

  }

}


onMount(() => {
  console.log('>>>>>>>>>>>>>>>>>>>>>>>>>>>')
  bound = container.getBoundingClientRect();

  let getCols = getColumnFromBreakpoints(breakpoints, getDocWidth(), cols, initCols);

  getComputedCols = getCols;

  documentWidth = document.documentElement.clientWidth;

  if(breakpoints) {
    $$invalidate('items', items = resizeItems(items, getCols));
  }

  $$invalidate('xPerPx', xPerPx = bound.width / getCols);

  dispatch('mount', {
    cols: getCols,
    xPerPx,
    yPerPx // same as rowHeight
  });

});

// resize

let resizeStartX, resizeStartY, resizeStartWidth, resizeStartHeight;

function resizeOnMouseDown(id, e) {
  e.stopPropagation();

  let {pageX,pageY} = getCordinates(e);

  const { item, index } = getItemById(id, items);

  currentItemIndex = index;

  $$invalidate('focuesdItem', focuesdItem = item);

  cacheItem = {...item};

  resizeNoDynamicCalc = item.h + item.y === getRowsCount(items);

  $$invalidate('shadow', shadow = {...shadow,...focuesdItem,...{active:true}});

  resizeStartX = pageX - bound.x;
  resizeStartY = pageY - bound.y;

  resizeStartWidth = (item.w * xPerPx) - (gap * 2) - (focuesdItem.responsive.valueW * xPerPx);

  resizeStartHeight = (item.h * yPerPx) - (gap * 2);

  getComputedCols = getColumnFromBreakpoints(breakpoints, getDocWidth(), cols, initCols);

  window.addEventListener("mousemove", resizeOnMouseMove, false);
  window.addEventListener("touchmove", resizeOnMouseMove, false);

  window.addEventListener("mouseup", resizeOnMouseUp, false);
  window.addEventListener("touchend", resizeOnMouseUp, false);
}

function resizeOnMouseMove(e) {

  let {pageX,pageY}=getCordinates(e);

  pageX = pageX - bound.x;
  pageY = pageY - bound.y;

  const height = resizeStartHeight + pageY - resizeStartY;
  const width = resizeStartWidth + (pageX - resizeStartX);

  const {responsive:{valueW} } = focuesdItem;

  let wRes = Math.round(width / xPerPx) + valueW;

  const {h:minHeight=1,w:minWidth=1} = focuesdItem.min;
  const {h:maxHeight,w:maxWidth = ((getComputedCols - focuesdItem.x)+valueW)} = focuesdItem.max;

  wRes = Math.min(Math.max(wRes,minWidth),maxWidth);/* min max*/

  let hRes = Math.round(height/yPerPx);
  if(maxHeight) {
    hRes = Math.min(hRes,maxHeight);
  }
  hRes = Math.max(hRes,minHeight);

  $$invalidate('shadow', shadow = {...shadow, ...{w:wRes, h:hRes}});

  let assignItem = items[currentItemIndex];
  $$invalidate('items', items[currentItemIndex] = {
    ...assignItem,
    resize: {
      resizing:true,
      width,
      height
    },
    w:wRes,
    h:hRes
  }, items);

  if (!resizeNoDynamicCalc) {
    debounceRecalculateGridPosition();
  }
}

function resizeOnMouseUp(e) {
  e.stopPropagation();

  let assignItem = items[currentItemIndex];
  $$invalidate('items', items[currentItemIndex] = {
    ...assignItem,
    resize:{
      resizing:false,
      width:0,
      height:0
    }
  }, items);

  window.removeEventListener("mousemove", resizeOnMouseMove, false);
  window.removeEventListener("touchmove", resizeOnMouseMove, false);

  window.removeEventListener("mouseup", resizeOnMouseUp, false);
  window.removeEventListener("touchend", resizeOnMouseUp, false);

  $$invalidate('shadow', shadow = {...shadow, ... {w:0,h:0,x:0,y:0,active:false,id:null,responsive:{valueW:0}}, min:{},max:{} });

  recalculateGridPosition();

  $$invalidate('focuesdItem', focuesdItem = undefined);
  resizeNoDynamicCalc = false;
}

// drag
let dragX = 0,
  dragY = 0;

const debounceRecalculateGridPosition = debounce(recalculateGridPosition, dragDebounceMs);

let cacheItem = {};

function dragOnMouseDown(id, e) {
  e.stopPropagation();
  let {pageX,pageY} = getCordinates(e);

  const { item, index } = getItemById(id, items);

  currentItemIndex = index;


  $$invalidate('focuesdItem', focuesdItem = item);
  cacheItem = {...item};

  $$invalidate('shadow', shadow = { ...shadow, ...item, active: true });



  let { currentTarget } = e;

  let offsetLeft, offsetTop;

  if(useTransform) {
    const { x, y } = getTranslate(currentTarget.style.transform);
    offsetLeft = x;
    offsetTop = y;
  } else {
    offsetLeft = currentTarget.offsetLeft;
    offsetTop = currentTarget.offsetTop;
  }

  pageX = pageX - bound.x;
  pageY = pageY - bound.y;

  dragX = pageX - offsetLeft;

  dragY = pageY - offsetTop;

  getComputedCols = getColumnFromBreakpoints(breakpoints, getDocWidth(), cols, initCols);


  if (item) {
    window.addEventListener("mousemove", dragOnMove, false);
    window.addEventListener("touchmove", dragOnMove, false);

    window.addEventListener("mouseup", dragOnMouseUp, false);
    window.addEventListener("touchend", dragOnMouseUp, false);
  } else {
    console.warn("Can not get item");
  }
}


function dragOnMove(e) {
  e.stopPropagation();

  let {pageX,pageY} = getCordinates(e);

  const y = pageY - bound.y;
  const x = pageX - bound.x;

  let xRes = Math.round((x - dragX) / xPerPx);
  let yRes = Math.round((y - dragY) / yPerPx);

  xRes = Math.max(Math.min(xRes,getComputedCols-(focuesdItem.w- focuesdItem.responsive.valueW)),0);

  yRes = Math.max(yRes, 0);

  let assignItem = items[currentItemIndex];

  $$invalidate('items', items[currentItemIndex] = {
    ...assignItem,
    drag:{
      dragging:true,
      top:y - dragY,
      left:x - dragX
    },
    x:xRes,
    y:yRes
  }, items);

  $$invalidate('shadow', shadow = {...shadow, ...{x:xRes,y:yRes}});

  debounceRecalculateGridPosition();
}

function dragOnMouseUp(e) {
  window.removeEventListener("mousemove", dragOnMove, false);
  window.removeEventListener("touchmove", dragOnMove, false);

  window.removeEventListener("mouseup", dragOnMouseUp, false);
  window.removeEventListener("touchend", dragOnMouseUp, false);

  let assignItem = items[currentItemIndex];
  $$invalidate('items', items[currentItemIndex] = {
    ...assignItem,
    drag: {
      dragging: false,
      top: 0,
      left: 0
    },
  }, items);

  dragX = 0;
  dragY = 0;

  $$invalidate('shadow', shadow = {...shadow, ...{w:0,h:0,x:0,y:0,active:false,id:null}});

  recalculateGridPosition();

  $$invalidate('focuesdItem', focuesdItem = undefined);
}


// Will work on this, need to make code cleaner
function recalculateGridPosition(action) {
  const dragItem = items[currentItemIndex];

  let getCols = getColumnFromBreakpoints(breakpoints, getDocWidth(), cols, initCols);
  let result = moveItem(dragItem, items, getCols, cacheItem);

  if(fillEmpty) {

    result.forEach(value => {
      if (value.id !== dragItem.id) {
        result = result.map($val =>
          $val.id === value.id
            ? {
                ...$val,
                ...findFreeSpaceForItem(
                  makeMatrixFromItemsIgnore(result, [value.id], getRowsCount(result), getCols),
                  value,
                  result
                )
              }
            : $val
        );
      }
    });
  }

  $$invalidate('items', items = result);

  dispatch('adjust', {
    focuesdItem: dragItem
  });

}

beforeUpdate(() => {
  if (!focuesdItem) {
    $$invalidate('ch', ch = getContainerHeight(items, yPerPx));
    if(cols !== initCols) {
      if(bound) {
        $$invalidate('xPerPx', xPerPx = bound.width/cols);
        initCols = cols;
      }
    }
  }
});

	let { $$slots = {}, $$scope } = $$props;

	function div_binding($$value) {
		binding_callbacks[$$value ? 'unshift' : 'push'](() => {
			$$invalidate('container', container = $$value);
		});
	}

	$$self.$set = $$props => {
		if ('useTransform' in $$props) $$invalidate('useTransform', useTransform = $$props.useTransform);
		if ('items' in $$props) $$invalidate('items', items = $$props.items);
		if ('cols' in $$props) $$invalidate('cols', cols = $$props.cols);
		if ('dragDebounceMs' in $$props) $$invalidate('dragDebounceMs', dragDebounceMs = $$props.dragDebounceMs);
		if ('gap' in $$props) $$invalidate('gap', gap = $$props.gap);
		if ('rowHeight' in $$props) $$invalidate('rowHeight', rowHeight = $$props.rowHeight);
		if ('breakpoints' in $$props) $$invalidate('breakpoints', breakpoints = $$props.breakpoints);
		if ('fillEmpty' in $$props) $$invalidate('fillEmpty', fillEmpty = $$props.fillEmpty);
		if ('$$scope' in $$props) $$invalidate('$$scope', $$scope = $$props.$$scope);
	};

	return {
		useTransform,
		items,
		cols,
		dragDebounceMs,
		gap,
		rowHeight,
		breakpoints,
		fillEmpty,
		container,
		focuesdItem,
		xPerPx,
		yPerPx,
		shadow,
		ch,
		onResize,
		resizeOnMouseDown,
		dragOnMouseDown,
		div_binding,
		$$slots,
		$$scope
	};
}

class Index extends SvelteComponent {
	constructor(options) {
		super();
		if (!document_1.getElementById("svelte-14tbpr7-style")) add_css();
		init(this, options, instance, create_fragment, safe_not_equal, ["useTransform", "items", "cols", "dragDebounceMs", "gap", "rowHeight", "breakpoints", "fillEmpty"]);
	}
}

export default Index;
