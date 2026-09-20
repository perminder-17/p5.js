// ye poora addon hai jo canvas ko keyboard + screen reader se chalne layak banata hai
function canvasNavigation(p5, fn, lifecycles) {
  // SVG elements banane ke liye namespace URL (browser ka rule hai)
  const SVG_NS = 'http://www.w3.org/2000/svg';
  // poora circle radians me (2 * PI), arc ke hisab ke liye
  const TAU = Math.PI * 2;

  // itne se zyada items ho to list mat karo, ek summary bana do
  const MAX_NODES = 50;

  // focus ring ka rang
  const RING_COLOR = 'red';

  // har sketch ka apna data store - pehli baar me bana do, baad me wahi lautao
  function state(inst) {
    if (!inst._nav) {
      inst._nav = {
        // is frame me jo items bane wo yahan jama hote hain
        buffer: [],
        // khule hue groups ka stack (beginAccessibleGroup ke liye)
        stack: [],
        // accessibleLabel() ka rakha hua label, agli drawing ka intezar karta hai
        pending: null,
        // true matlab frame poora ho chuka, agla item naya frame shuru karega
        sealed: true,
        // final tree ke top-level items
        roots: [],
        // key se current frame ka node dhundhne ka map
        byKey: new Map(),
        // abhi kis item pe focus hai (uski key)
        focusKey: null,
        // aria-live region - jo isme likho wahi SR bolta hai
        live: null,
        // focus ring dikhane wala overlay div
        overlay: null,
        // overlay ke andar ka svg
        svg: null,
        // svg ke andar wala ring path
        ringPath: null
      };
    }
    return inst._nav;
  }

  // === public function: canvas navigation chalu karo ===
  fn.canvasAccessible = function () {
    state(this);
    // p5 ka accessibility system on karo
    this._addAccsOutput();
    // apna flag on karo taaki hooks ko pata ho ki hum active hain
    this._accessibleOutputs.nav = true;
    // screen reader ke liye DOM setup kar do
    _ensureDOM(this);
  };

  // === public function: agli drawing ka naam set karo ===
  fn.accessibleLabel = function (label, options = {}) {
    // bas pending me rakh do, agli shape/text isse utha legi
    state(this).pending = Object.assign({ label }, options);
  };

  // === public function: SR se kuch bhi turant bulwao ===
  fn.announce = function (text) {
    _say(state(this), String(text));
  };

  // === public function: yahan se aage ki drawings ko ek group me daalo ===
  fn.beginAccessibleGroup = function (label) {
    const s = state(this);
    // accessibleLabel() ki pending cheezein (label/activate) group pe bhi lagti hain
    const node = _applyPending(s, _node('group', label || 'group'));
    // tree me daalo, aur stack pe bhi - aage ki drawings iske andar jayengi
    _push(s, node);
    s.stack.push(node);
  };

  // === public function: group band karo ===
  fn.endAccessibleGroup = function () {
    // stack se utar gaya = ab cheezein iske andar nahi jayengi
    state(this).stack.pop();
  };

  // naya frame shuru karna ho to purana buffer khali kar do
  function _startFrameIfNeeded(s) {
    if (s.sealed) {
      s.buffer = [];
      s.stack = [];
      s.sealed = false;
    }
  }

  // naya item tree me daalo - group khula hai to uske andar, warna top pe
  function _push(s, node) {
    _startFrameIfNeeded(s);
    const parent = s.stack[s.stack.length - 1];
    if (parent) {
      parent.children.push(node);
    } else {
      s.buffer.push(node);
    }
  }

  // har node ka ek jaisa khaka - jo alag ho wo extra me aata hai
  function _node(role, label, extra = {}) {
    const base = {
      key: null, role, label, d: '',
      bbox: null, matrix: null, children: []
    };
    return Object.assign(base, extra);
  }

  // accessibleLabel() ne jo pending rakha tha, usse is node pe laga do
  function _applyPending(s, node) {
    const p = s.pending;
    // pending ek hi baar chalta hai, isliye turant khali karo
    s.pending = null;
    if (!p) return node;
    // user ka label auto wale label ko replace karta hai
    if (p.label) node.label = p.label;
    if (p.role) node.role = p.role;
    // user ki di hui key item ki pehchan pin karti hai
    if (p.key) node.authorKey = p.key;
    // activate function diya hai to ye item button jaisa ban gaya
    if (typeof p.activate === 'function') {
      node.activate = p.activate;
      if (!p.role) node.role = 'button';
    }
    return node;
  }

  // canvas pe abhi jo scale/rotate/translate laga hai, wo matrix nikalo
  // taaki focus ring bhi usi hisab se ghume/bade
  function _matrix(renderer) {
    const ctx = renderer && renderer.drawingContext;
    if (!ctx || typeof ctx.getTransform !== 'function') return null;
    let m;
    try {
      m = ctx.getTransform();
    } catch (e) {
      return null;
    }
    // retina screens pe pixel density ka hisab hata do
    const d = renderer._pixelDensity || 1;
    return [m.a / d, m.b / d, m.c / d, m.d / d, m.e / d, m.f / d];
  }

  // number ko 2 decimal tak chhota karo (SVG path saaf rahe)
  function _round(n) {
    return Math.round(n * 100) / 100;
  }

  // har shape ke liye SVG path banao - yahi path focus ring banata hai
  function _shapePath(type, a) {
    const r = _round;
    switch (type) {
      case 'ellipse':
      case 'circle':
      case 'arc': {
        // center aur radius nikalo
        const cx = a[0] + a[2] / 2;
        const cy = a[1] + a[3] / 2;
        const rx = Math.abs(a[2] / 2);
        const ry = Math.abs(a[3] / 2);
        if (type === 'arc') {
          // arc ke start/end angle se pie-slice jaisa path banao
          const s = a[4];
          const e = a[5];
          const x1 = cx + rx * Math.cos(s);
          const y1 = cy + ry * Math.sin(s);
          const x2 = cx + rx * Math.cos(e);
          const y2 = cy + ry * Math.sin(e);
          const large = Math.abs(e - s) % TAU > Math.PI ? 1 : 0;
          return (
            `M ${r(cx)} ${r(cy)} L ${r(x1)} ${r(y1)} ` +
            `A ${r(rx)} ${r(ry)} 0 ${large} 1 ${r(x2)} ${r(y2)} Z`
          );
        }
        // circle/ellipse ke liye 2 arc jodkar poora ghera
        return (
          `M ${r(cx - rx)} ${r(cy)} ` +
          `a ${r(rx)} ${r(ry)} 0 1 0 ${r(rx * 2)} 0 ` +
          `a ${r(rx)} ${r(ry)} 0 1 0 ${r(-rx * 2)} 0 Z`
        );
      }
      case 'rectangle':
      case 'square':
        // seedha chaukor path
        return `M ${r(a[0])} ${r(a[1])} h ${r(a[2])} v ${r(a[3])} h ${r(-a[2])} Z`;
      case 'triangle':
        // teen points jodo
        return (
          `M ${r(a[0])} ${r(a[1])} L ${r(a[2])} ${r(a[3])} ` +
          `L ${r(a[4])} ${r(a[5])} Z`
        );
      case 'quadrilateral':
        // chaar points jodo
        return (
          `M ${r(a[0])} ${r(a[1])} L ${r(a[2])} ${r(a[3])} ` +
          `L ${r(a[4])} ${r(a[5])} L ${r(a[6])} ${r(a[7])} Z`
        );
      case 'line':
        // do points ke beech seedhi lakeer
        return `M ${r(a[0])} ${r(a[1])} L ${r(a[2])} ${r(a[3])}`;
      case 'point':
        // point itna chhota hota hai, uske liye 5px ka gol ghera
        return (
          `M ${r(a[0] - 5)} ${r(a[1])} a 5 5 0 1 0 10 0 a 5 5 0 1 0 -10 0 Z`
        );
      default:
        return '';
    }
  }

  // kuch points ka bounding box (sabko gherne wala chaukor) nikalo
  function _bboxOfPoints(pts) {
    const xs = pts.map(p => p[0]);
    const ys = pts.map(p => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  // har shape ka bounding box - ring aur position batane ke kaam aata hai
  function _shapeBBox(type, a) {
    switch (type) {
      case 'ellipse':
      case 'circle':
      case 'arc':
      case 'rectangle':
      case 'square':
        // in sab me x,y,w,h seedha args me hote hain
        return {
          x: Math.min(a[0], a[0] + a[2]),
          y: Math.min(a[1], a[1] + a[3]),
          w: Math.abs(a[2]),
          h: Math.abs(a[3])
        };
      case 'triangle':
        return _bboxOfPoints([[a[0], a[1]], [a[2], a[3]], [a[4], a[5]]]);
      case 'quadrilateral':
        return _bboxOfPoints([
          [a[0], a[1]], [a[2], a[3]], [a[4], a[5]], [a[6], a[7]]
        ]);
      case 'line':
        return _bboxOfPoints([[a[0], a[1]], [a[2], a[3]]]);
      case 'point':
        // point ke aas paas 10x10 ka box
        return { x: a[0] - 5, y: a[1] - 5, w: 10, h: 10 };
      default:
        return null;
    }
  }

  // item asli me screen pe kahan hai - transform (rotate/scale) laga ke batao
  function _screenBounds(node) {
    if (!node.bbox) return null;
    const m = node.matrix || [1, 0, 0, 1, 0, 0];
    const { x, y, w, h } = node.bbox;
    // box ke charo kono pe matrix lagao, phir unka naya box nikalo
    return _bboxOfPoints(
      [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => [
        m[0] * px + m[2] * py + m[4],
        m[1] * px + m[3] * py + m[5]
      ])
    );
  }

  // group ka box = uske saare bachchon ko gherne wala box
  function _fillGroupBounds(nodes) {
    for (const node of nodes) {
      if (!node.children.length) continue;
      // pehle andar ke groups ka hisab karo
      _fillGroupBounds(node.children);
      // pehle se path hai to kuch mat karo
      if (node.d) continue;
      let box = null;
      // har bachche ka box milakar bada box banao
      for (const child of node.children) {
        const cb = _screenBounds(child);
        if (!cb) continue;
        box = box
          ? _bboxOfPoints([
            [Math.min(box.x, cb.x), Math.min(box.y, cb.y)],
            [Math.max(box.x + box.w, cb.x + cb.w),
              Math.max(box.y + box.h, cb.y + cb.h)]
          ])
          : cb;
      }
      if (box) {
        // thoda sa padding do taaki ring cheezon se chipke nahi
        const pad = 6;
        node.bbox = {
          x: box.x - pad, y: box.y - pad,
          w: box.w + pad * 2, h: box.h + pad * 2
        };
        node.matrix = [1, 0, 0, 1, 0, 0];
        node.d = _rectPath(node.bbox);
      }
    }
  }

  // ek box ka simple chaukor SVG path
  function _rectPath(b) {
    const r = _round;
    return `M ${r(b.x)} ${r(b.y)} h ${r(b.w)} v ${r(b.h)} h ${r(-b.w)} Z`;
  }

  // jab bhi circle/rect/triangle waghera draw ho (decorator se aata hai)
  function _shapeNode(inst, type, args, color) {
    const s = state(inst);
    _push(s, _applyPending(s, _node('shape', `${color} ${type}`, {
      d: _shapePath(type, args),
      bbox: _shapeBBox(type, args),
      matrix: _matrix(inst._renderer)
    })));
  }

  // jab bhi text() draw ho - string khud hi label ban jati hai
  function _textNode(inst, str, bounds, renderer) {
    const s = state(inst);
    let label = String(str).replace(/\s+/g, ' ').trim();
    // khali string ka item mat banao
    if (!label) {
      s.pending = null;
      return;
    }
    // bahut lamba text ho to kaat do
    if (label.length > 120) label = label.slice(0, 117) + '…';
    _push(s, _applyPending(s, _node('text', label, {
      d: bounds ? _rectPath(bounds) : '',
      bbox: bounds || null,
      matrix: _matrix(renderer)
    })));
  }

  // jab model() se 3D geometry draw ho
  // textToModel() ki string geometry pe chipki hoti hai, wahi label banti hai
  function _geometryNode(inst, geom) {
    const s = state(inst);
    const src = geom && geom.accessibleLabel;
    const label =
      src ? String(src) : geom && geom.gid ? `model ${geom.gid}` : 'model';
    const node = _node(src ? 'text' : 'model', label);

    // ring ke liye: 3D box ke 8 kone screen pe utaro, unka 2D box hi ring hai
    try {
      const { min: c, max: M } = geom.calculateBoundingBox();
      const box = _bboxOfPoints(
        [
          [c.x, c.y, c.z], [M.x, c.y, c.z], [c.x, M.y, c.z], [M.x, M.y, c.z],
          [c.x, c.y, M.z], [M.x, c.y, M.z], [c.x, M.y, M.z], [M.x, M.y, M.z]
        ].map(([x, y, z]) => {
          const p = inst.worldToScreen(new p5.Vector(x, y, z));
          return [p.x, p.y];
        })
      );
      if (isFinite(box.w) && box.w > 0 && isFinite(box.h) && box.h > 0) {
        node.bbox = box;
        node.d = _rectPath(box);
        node.matrix = [1, 0, 0, 1, 0, 0];
      }
    } catch (e) {}

    _push(s, _applyPending(s, node));
  }

  // === decorators: p5 ke functions bahar se lapeto, core files chhede bina ===

  // shapes: _accsOutput ko haath se lapeto - registerDecorator '_' se shuru
  // hone wale naam skip kar deta hai, isliye wahi kaam yahan khud kiya hai
  const _origAccsOutput = fn._accsOutput;
  fn._accsOutput = function (f, args) {
    if (this._accessibleOutputs && this._accessibleOutputs.nav) {
      // wahi naam-normalization jo _accsOutput khud karta hai
      let type = f;
      if (f === 'ellipse' && args[2] === args[3]) type = 'circle';
      else if (f === 'rectangle' && args[2] === args[3]) type = 'square';
      const colors = this.ingredients.colors;
      _shapeNode(this, type, args,
        type === 'line' || type === 'point' ? colors.stroke : colors.fill);
    }
    return _origAccsOutput.call(this, f, args);
  };

  // text(): renderer ka text lapeto, bounds ring ke liye nikal lo
  p5.registerDecorator('p5.Renderer.prototype.text', function (target) {
    return function (str, x, y, w, h) {
      const inst = this._pInst;
      if (inst && inst._accessibleOutputs && inst._accessibleOutputs.nav) {
        let bounds = null;
        try {
          bounds = this.textBounds(str, x, y, w, h);
        } catch (e) {
          bounds = null;
        }
        _textNode(inst, str, bounds, this);
      }
      return target.call(this, str, x, y, w, h);
    };
  });

  // model(): geometry draw hui tabhi item banta hai
  p5.registerDecorator('p5.prototype.model', function (target) {
    return function (...args) {
      if (this._accessibleOutputs && this._accessibleOutputs.nav) {
        _geometryNode(this, args[0]);
      }
      return target.apply(this, args);
    };
  });

  // textToModel(): apni string geometry pe chipka do, draw pe label banegi
  p5.registerDecorator('p5.Font.prototype.textToModel', function (target) {
    return function (str, ...rest) {
      const geom = target.call(this, str, ...rest);
      if (geom) geom.accessibleLabel = String(str);
      return geom;
    };
  });

  // har item ko ek stable key do - taaki animation me bhi item 'wahi' rahe
  // user ki key ho to wahi, warna role + kitni baar aaya (jaise 'shape|1')
  function _assignKeys(nodes, seen) {
    for (const node of nodes) {
      if (node.authorKey) {
        node.key = `@${node.authorKey}`;
      } else {
        const n = (seen.get(node.role) || 0) + 1;
        seen.set(node.role, n);
        node.key = `${node.role}|${n}`;
      }
    }
  }

  // items limit se zyada ho to baaki ki sirf ginti batao
  function _applyBudget(nodes) {
    if (nodes.length <= MAX_NODES) return nodes;
    const kept = nodes.slice(0, MAX_NODES);
    kept.push(_node('summary', `${nodes.length - MAX_NODES} more items`, {
      key: 'nav|overflow'
    }));
    return kept;
  }

  // frame khatam - buffer ko final tree bana do (har draw ke baad chalta hai)
  function _seal(inst) {
    const s = state(inst);
    if (!inst._accessibleOutputs || !inst._accessibleOutputs.nav) return;

    let roots = s.buffer;
    // groups ke boxes bharo
    _fillGroupBounds(roots);
    // zyada items ho to summary banao
    roots = _applyBudget(roots);
    // sabko keys do
    _assignKeys(roots, new Map());

    // key -> node ka map (focus wapas milane ke liye)
    s.byKey = new Map();
    for (const node of roots) s.byKey.set(node.key, node);
    // focused item ab exist nahi karta to focus reset
    if (s.focusKey && !s.byKey.has(s.focusKey)) s.focusKey = null;

    s.roots = roots;
    // seal laga do - agla item naya frame shuru karega
    s.sealed = true;

    _ensureDOM(inst);
    _drawRing(inst);
  }

  // focus ring ka overlay: page ke upar tairta ek chhota svg, taaki ring
  // banane ke liye canvas ke pixels chhedne na paden
  function _createRingOverlay(s) {
    const overlay = document.createElement('div');
    // ring sirf dekhne ki cheez hai, SR isse ignore kare
    overlay.setAttribute('aria-hidden', 'true');
    // jagah aur size _positionOverlay() bharta hai, dikhane se theek pehle
    overlay.style.cssText =
      'position:fixed;pointer-events:none;z-index:2147483000;display:none';

    const svg = document.createElementNS(SVG_NS, 'svg');
    // overflow visible taaki moti stroke kinare pe kate nahi
    svg.style.cssText = 'display:block;width:100%;height:100%;overflow:visible';

    // ek hi path - har focus pe iska d aur transform badal dete hain
    const ring = document.createElementNS(SVG_NS, 'path');
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', RING_COLOR);
    ring.setAttribute('stroke-width', '3');
    ring.setAttribute('stroke-linejoin', 'round');
    // shape scale ho to bhi stroke utni hi moti dikhe
    ring.setAttribute('vector-effect', 'non-scaling-stroke');

    svg.appendChild(ring);
    overlay.appendChild(svg);
    document.body.appendChild(overlay);

    s.overlay = overlay;
    s.svg = svg;
    s.ringPath = ring;
  }

  // canvas + live region + overlay ka one-time setup
  function _ensureDOM(inst) {
    const s = state(inst);
    const canvas = inst.canvas;
    // canvas nahi hai ya pehle se setup ho chuka to kuch mat karo
    if (!canvas || s.live) return;

    // canvas ko Tab se focus hone layak banao; role=application se browser/SR
    // ko bolo ki arrow keys wo na khaye - hum khud handle karenge
    canvas.setAttribute('tabindex', '0');
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-label', 'Canvas');

    // aria-live region: jo text isme daalo, SR wahi bolta hai - na kam na zyada
    const live = document.createElement('div');
    // polite = bina interrupt-chime ke bole
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    // screen pe invisible, par SR ke liye maujood
    live.style.cssText =
      'position:absolute;width:1px;height:1px;overflow:hidden;' +
      'clip:rect(0 0 0 0);white-space:nowrap';
    document.body.appendChild(live);
    s.live = live;

    _createRingOverlay(s);

    // keyboard aur focus ke listeners lagao
    canvas.addEventListener('keydown', ev => _onKey(inst, ev));
    // click hua to us jagah wale item pe focus le jao
    canvas.addEventListener('click', ev => {
      const r = canvas.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const y = ev.clientY - r.top;
      const roots = state(inst).roots;
      // aakhri wala sabse upar draw hota hai, isliye ulta dhundo
      for (let i = roots.length - 1; i >= 0; i--) {
        const b = _screenBounds(roots[i]);
        if (b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
          _focusNode(inst, roots[i]);
          return;
        }
      }
    });
    // focus canvas se hata to position aur ring reset
    canvas.addEventListener('focusout', () => {
      s.focusKey = null;
      _drawRing(inst);
    });
    // page scroll/resize ho to ring canvas ke upar hi bani rahe
    window.addEventListener('scroll', () => _positionOverlay(inst), true);
    window.addEventListener('resize', () => _positionOverlay(inst));
  }

  // kisi item pe jao (null = wapas canvas pe)
  function _focusNode(inst, node) {
    state(inst).focusKey = node ? node.key : null;
    _drawRing(inst);
    _announce(inst, node);
  }

  // live region me text daalo - SR wahi bolta hai
  function _say(s, text) {
    if (!s.live) return;
    // same text dobara set karne pe SR chup rehta hai - nbsp jod ke jagao
    s.live.textContent = s.live.textContent === text ? text + '\u00A0' : text;
  }

  // label live region me likho (SR wahi bolta hai) + 'p5navigate' event bhejo
  function _announce(inst, node) {
    const label = node ? node.label : 'Canvas';
    _say(state(inst), label);
    inst.canvas.dispatchEvent(
      new CustomEvent('p5navigate', {
        detail: { role: node ? node.role : 'canvas', label },
        bubbles: true
      })
    );
  }

  // abhi kaunsa item focused hai, uska node lautao
  function _current(inst) {
    const s = state(inst);
    return s.focusKey ? s.byKey.get(s.focusKey) || null : null;
  }

  // saara keyboard handling yahan hai
  function _onKey(inst, ev) {
    // feature off hai to kuch mat karo
    if (!inst._accessibleOutputs || !inst._accessibleOutputs.nav) return;
    // shortcut keys (cmd/ctrl/alt wale) browser ke liye chhod do
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;

    // group ek hi item hai - navigation sirf top-level items pe chalti hai
    const list = state(inst).roots;
    const node = _current(inst);
    const i = node ? list.indexOf(node) : -1;
    let handled = true;

    switch (ev.key) {
      case 'ArrowDown':
        // agla item, ya list khatam ho to pehla
        _focusNode(inst, list[i + 1] || list[0]);
        break;
      case 'ArrowUp':
        // pichhla item, ya pehle se wapas canvas pe
        _focusNode(inst, i <= 0 ? null : list[i - 1]);
        break;
      case 'Home':
        // seedha pehle item pe
        _focusNode(inst, list[0]);
        break;
      case 'End':
        // seedha aakhri item pe
        _focusNode(inst, list[list.length - 1]);
        break;
      case 'Enter':
      case ' ':
        // button hai to uska function chalao
        if (node && node.activate) node.activate.call(inst, node);
        else if (!node) _focusNode(inst, list[0]);
        break;
      case 'Escape':
        // sab chhod ke wapas canvas pe
        _focusNode(inst, null);
        break;
      default:
        // baaki keys sketch ke liye chhod do
        handled = false;
    }

    if (handled) {
      // humne handle kiya to browser/sketch tak mat jaane do
      ev.preventDefault();
      ev.stopPropagation();
    }
  }

  // overlay ko canvas ke exact upar rakho (scroll/resize pe bhi)
  function _positionOverlay(inst) {
    const s = state(inst);
    if (!s.overlay || !inst.canvas) return;
    const r = inst.canvas.getBoundingClientRect();
    s.overlay.style.left = `${r.left}px`;
    s.overlay.style.top = `${r.top}px`;
    s.overlay.style.width = `${r.width}px`;
    s.overlay.style.height = `${r.height}px`;
    // svg ka coordinate system canvas ke barabar rakho
    s.svg.setAttribute('viewBox', `0 0 ${inst.width} ${inst.height}`);
  }

  // focused item ke gird ring banao
  function _drawRing(inst) {
    const s = state(inst);
    if (!s.overlay) return;
    const node = _current(inst);
    // kuch focused nahi ya path hi nahi - to ring chhupa do
    if (!node || !node.d) {
      s.overlay.style.display = 'none';
      return;
    }
    _positionOverlay(inst);
    s.overlay.style.display = 'block';
    // item ka transform ring pe bhi lagao (rotate/scale match kare)
    const m = node.matrix || [1, 0, 0, 1, 0, 0];
    s.ringPath.setAttribute('transform', `matrix(${m.join(' ')})`);
    // ring ko item ka shape do
    s.ringPath.setAttribute('d', node.d);
  }

  // setup ke baad tree seal karo (setup-only sketches ke liye)
  lifecycles.postsetup = function () {
    if (this._accessibleOutputs && this._accessibleOutputs.nav) _seal(this);
  };

  // har draw ke baad bhi
  lifecycles.postdraw = function () {
    if (this._accessibleOutputs && this._accessibleOutputs.nav) _seal(this);
  };
}

export default canvasNavigation;

// script tag se load ho to apne aap addon register kar do
if (typeof p5 !== 'undefined') {
  p5.registerAddon(canvasNavigation);
}
