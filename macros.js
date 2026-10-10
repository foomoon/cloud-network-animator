// Fun "macros" that drive a <point-cloud-network> through its public API
// (getConfig / setConfig) only.
//
// Each macro is a function (element, options) => {stop()}. stop() ends the
// macro and restores the settings it changed.
//
//   const clock = PointCloudMacros.clock(document.querySelector('point-cloud-network'));
//   clock.stop();
//
// Changing shapeMode / shapeText / shapeScale rebuilds the shape (~40ms), so
// macros change those at most every second or so. Colors, opacity, node size
// and connection distance are cheap enough to animate continuously.
(() => {
  const pick = (obj, keys) => Object.fromEntries(keys.map(k => [k, obj[k]]));
  const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
  const lerp = (a,b,t) => a + (b-a)*t;
  const smoothstep = t => t*t*(3-2*t);
  const pad2 = n => String(n).padStart(2,'0');
  const isTyping = e => e.composedPath()[0].matches?.('input,textarea,select');
  const onCanvas = e => e.composedPath()[0].tagName==='CANVAS';

  // --- Colors ---------------------------------------------------------------

  const hexToRgb = hex => {
    const n = parseInt(hex.slice(1), 16);
    return [(n>>16)&255, (n>>8)&255, n&255];
  };
  const rgbToHex = rgb => '#' + rgb.map(v => Math.round(v).toString(16).padStart(2,'0')).join('');
  const mixHex = (a,b,t) => {
    const ra = hexToRgb(a), rb = hexToRgb(b);
    return rgbToHex(ra.map((v,i) => lerp(v, rb[i], t)));
  };
  function hslToHex(h, s, l){
    const k = n => (n + h/30) % 12;
    const a = s*Math.min(l, 1-l);
    const f = n => l - a*Math.max(-1, Math.min(k(n)-3, 9-k(n), 1));
    return rgbToHex([f(0)*255, f(8)*255, f(4)*255]);
  }
  function hueOf(hex){
    const [r,g,b] = hexToRgb(hex).map(v => v/255);
    const max = Math.max(r,g,b), d = max - Math.min(r,g,b);
    if(!d) return 0;
    const h = max===r ? (g-b)/d % 6 : max===g ? (b-r)/d + 2 : (r-g)/d + 4;
    return (h*60 + 360) % 360;
  }

  // --- Plumbing -------------------------------------------------------------

  // Tracks timers and listeners so a macro's stop() can tear them all down.
  function scope(){
    const timeouts = new Set(), intervals = new Set(), cleanups = [];
    return {
      timeout(fn, ms){
        const id = setTimeout(() => { timeouts.delete(id); fn(); }, ms);
        timeouts.add(id);
        return id;
      },
      interval(fn, ms){
        const id = setInterval(fn, ms);
        intervals.add(id);
        return id;
      },
      on(target, type, fn, opts){
        target.addEventListener(type, fn, opts);
        cleanups.push(() => target.removeEventListener(type, fn, opts));
      },
      add(fn){ cleanups.push(fn); },
      dispose(){
        timeouts.forEach(clearTimeout);
        intervals.forEach(clearInterval);
        cleanups.splice(0).forEach(fn => fn());
      }
    };
  }

  // Defines a macro. `keys` are the settings it changes; stop() restores them.
  // setup(el, options, scope, savedSettings) starts it.
  function define(label, keys, setup, extras={}){
    const run = (el, options={}) => {
      const saved = pick(el.getConfig(), keys);
      const s = scope();
      setup(el, options, s, saved);
      return {
        stop(){
          s.dispose();
          el.setConfig(saved);
        }
      };
    };
    return Object.assign(run, {label}, extras);
  }

  // Returns burst(cfg): applies `cfg` with the point count dropped to
  // `minCount`, then ramps back up to `count`. The new points spawn across the
  // whole area and stream into the shape, spreading evenly over it.
  function burster(el, s, {
    minCount = 30,   // the component's lowest allowed point count
    count = 200,
    holdMs = 350,    // how long to stay at minCount before ramping up
    riseMs = 1200    // duration of the ramp back up to `count`
  } = {}){
    let ramp = 0;
    s.add(() => clearInterval(ramp));
    return cfg => {
      clearInterval(ramp);
      el.setConfig({...cfg, pointCount:minCount});

      const start = performance.now() + holdMs;
      ramp = setInterval(() => {
        const t = clamp((performance.now()-start)/riseMs, 0, 1);
        el.setConfig({pointCount:Math.round(lerp(minCount, count, smoothstep(t)))});
        if(t>=1) clearInterval(ramp);
      }, 40);
    };
  }

  // Scales node size and near-line opacity by (1 + depth * wave(phase)).
  function pulse(el, s, saved, {periodMs, depth, wave}){
    const t0 = performance.now();
    s.interval(() => {
      const w = wave(((performance.now()-t0)/periodMs) % 1);
      el.setConfig({
        nodeScale:saved.nodeScale*(1 + depth*w),
        nearAlpha:saved.nearAlpha*(1 + depth*w)
      });
    }, 33);
  }

  const TEXT_KEYS = ['shapeMode','shapeText','pointCount'];

  // --- Text macros ----------------------------------------------------------

  // Current time (h:mm), with a burst on every minute change.
  const clock = define('Clock', TEXT_KEYS, (el, {hour12=true, ...opts}, s) => {
    const burst = burster(el, s, opts);
    let shown = '';

    const format = d => {
      let h = d.getHours();
      if(hour12) h = h%12 || 12;
      return `${h}:${pad2(d.getMinutes())}`;
    };

    const tick = () => {
      const now = new Date();
      const text = format(now);
      if(text!==shown){
        shown = text;
        burst({shapeMode:'text', shapeText:text});
      }
      // Wake just after the next minute boundary.
      s.timeout(tick, 60000 - now.getSeconds()*1000 - now.getMilliseconds() + 50);
    };
    tick();
  });

  // Cycles through a list of words.
  const words = define('Word rotator', TEXT_KEYS, (el, {
    words = ['HELLO', 'POINT CLOUD', 'NETWORK'],
    intervalMs = 4000,
    ...opts
  }, s) => {
    const burst = burster(el, s, opts);
    let i = 0;
    const next = () => burst({shapeMode:'text', shapeText:words[i++ % words.length]});
    next();
    s.interval(next, intervalMs);
  });

  // Counts down to `to` (a Date, timestamp or date string), then shows `endText`.
  // Text updates every second; bursts happen only when the minute changes.
  const countdown = define('Countdown', TEXT_KEYS, (el, {
    to = Date.now() + 5*60000,
    endText = 'NOW',
    ...opts
  }, s) => {
    const end = new Date(to).getTime();
    const burst = burster(el, s, opts);
    let shownMajor = null;

    // Returns [text, major]; a change in `major` triggers a burst.
    const format = ms => {
      const t = Math.ceil(ms/1000);
      const d = Math.floor(t/86400), h = Math.floor(t%86400/3600);
      const m = Math.floor(t%3600/60), sec = t%60;
      if(d) return [`${d}D ${h}H`, `${d}D ${h}H`];
      if(h) return [`${h}:${pad2(m)}:${pad2(sec)}`, `${h}:${pad2(m)}`];
      return [`${m}:${pad2(sec)}`, `${m}`];
    };

    const tick = () => {
      const remaining = end - Date.now();
      if(remaining<=0){
        burst({shapeMode:'text', shapeText:endText});
        return;
      }
      const [text, major] = format(remaining);
      if(major!==shownMajor){
        shownMajor = major;
        burst({shapeMode:'text', shapeText:text});
      } else {
        el.setConfig({shapeText:text});
      }
      // Wake just after the next whole second of remaining time.
      s.timeout(tick, (remaining % 1000) + 20);
    };
    tick();
  });

  // Shows a value fetched from `source` (a function returning a value or a
  // promise), refreshed every `intervalMs`. Defaults to this repo's GitHub stars.
  const liveNumber = define('Live number', TEXT_KEYS, (el, {
    source = () => fetch('https://api.github.com/repos/foomoon/cloud-network-animator')
      .then(r => { if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(repo => repo.stargazers_count),
    format = n => `★ ${n}`,
    intervalMs = 60000,
    ...opts
  }, s) => {
    const burst = burster(el, s, opts);
    let shown = null, stopped = false;
    s.add(() => { stopped = true; });

    const refresh = async () => {
      try{
        const value = await source();
        if(stopped) return;
        const text = String(format(value));
        if(text!==shown){
          shown = text;
          burst({shapeMode:'text', shapeText:text});
        }
      }catch(err){
        console.warn('liveNumber macro: could not read source', err);
      }
    };
    refresh();
    s.interval(refresh, intervalMs);
  }, {hint:'Shows this repo’s GitHub stars'});

  // Reveals `text` one character at a time. The block text is re-fitted to the
  // area at each step, so early letters start large and shrink as more arrive.
  const typewriter = define('Typewriter', ['shapeMode','shapeText'], (el, {
    text = 'HELLO WORLD',
    charMs = 300,
    holdMs = 2500,
    loop = true
  }, s) => {
    let n = 0;
    const step = () => {
      n++;
      el.setConfig({shapeMode:'text', shapeText:text.slice(0, n)});
      if(n<text.length) s.timeout(step, text[n]===' ' ? 0 : charMs);
      else if(loop) s.timeout(() => { n = 0; step(); }, holdMs);
    };
    step();
  });

  // --- Ambient macros -------------------------------------------------------

  // Cycles through shapes with a burst on each change.
  const shapeTour = define('Shape tour', ['shapeMode','pointCount'], (el, {
    shapes = ['circle','heart','spiral','ring','wave','grid'],
    intervalMs = 6000,
    ...opts
  }, s) => {
    const burst = burster(el, s, opts);
    let i = 0;
    const next = () => burst({shapeMode:shapes[i++ % shapes.length]});
    next();
    s.interval(next, intervalMs);
  });

  // Rotates the point/line color through the hue wheel, starting from the current hue.
  const colorDrift = define('Color drift', ['fgColor'], (el, {
    periodMs = 30000,
    saturation = 0.57,
    lightness = 0.44
  }, s, saved) => {
    const startHue = hueOf(saved.fgColor), t0 = performance.now();
    s.interval(() => {
      const hue = (startHue + (performance.now()-t0)/periodMs*360) % 360;
      el.setConfig({fgColor:hslToHex(hue, saturation, lightness)});
    }, 50);
  });

  // Gently pulses node size and line opacity.
  const breathe = define('Breathe', ['nodeScale','nearAlpha'], (el, {periodMs=4000, depth=0.35}, s, saved) => {
    pulse(el, s, saved, {periodMs, depth, wave:p => Math.sin(p*Math.PI*2)});
  });

  // Heart shape with a lub-dub pulse.
  const heartbeat = define('Heartbeat', ['shapeMode','nodeScale','nearAlpha'], (el, {bpm=66, depth=0.7}, s, saved) => {
    el.setConfig({shapeMode:'heart'});
    const beat = (p, at) => Math.exp(-(((p-at)/0.045)**2));
    pulse(el, s, saved, {periodMs:60000/bpm, depth, wave:p => beat(p, 0.05) + 0.6*beat(p, 0.25)});
  });

  // Dim, slow and blue at night; bright, faster and green by day.
  // dayMs > 0 plays a whole day in that many milliseconds instead of real time.
  const NIGHT = {fgColor:'#4a6fa5', bgColor:'#020409', speed:35, nodeOpacity:0.5};
  const DAY = {fgColor:'#3ccf8e', bgColor:'#06130e', speed:120, nodeOpacity:0.9};
  const dayNight = define('Day / night', Object.keys(DAY), (el, {dayMs=0}, s) => {
    const t0 = Date.now(), now = new Date();
    const startHours = now.getHours() + now.getMinutes()/60;
    let lastSpeed = null;

    const update = () => {
      const hours = dayMs
        ? (startHours + (Date.now()-t0)/dayMs*24) % 24
        : new Date().getHours() + new Date().getMinutes()/60;
      // 0 at 01:00, 1 at 13:00.
      const daylight = (1 - Math.cos((hours-1)/24*Math.PI*2))/2;
      const cfg = {
        fgColor:mixHex(NIGHT.fgColor, DAY.fgColor, daylight),
        bgColor:mixHex(NIGHT.bgColor, DAY.bgColor, daylight),
        nodeOpacity:lerp(NIGHT.nodeOpacity, DAY.nodeOpacity, daylight)
      };
      // Every speed change re-randomizes particle speeds, so only apply big steps.
      const speed = Math.round(lerp(NIGHT.speed, DAY.speed, daylight));
      if(lastSpeed===null || Math.abs(speed-lastSpeed)>=8){
        cfg.speed = lastSpeed = speed;
      }
      el.setConfig(cfg);
    };
    update();
    s.interval(update, dayMs ? 50 : 60000);
  }, {demo:{dayMs:60000}, hint:'Demo plays a full day in one minute'});

  // --- Interactive macros ---------------------------------------------------

  // Click the background (or press `key`) to blast the points out of the shape;
  // they get pulled back in shortly after.
  const explode = define('Explode', ['shapeMode','speed'], (el, {
    outMs = 700,
    boost = 2.4,
    key = ' '
  }, s, saved) => {
    const shape = saved.shapeMode==='free' ? 'heart' : saved.shapeMode;
    el.setConfig({shapeMode:shape});
    let reform = 0;

    const blast = () => {
      clearTimeout(reform);
      el.setConfig({shapeMode:'free', speed:saved.speed*boost});
      reform = s.timeout(() => el.setConfig({shapeMode:shape, speed:saved.speed}), outMs);
    };

    s.on(el, 'pointerdown', e => { if(onCanvas(e)) blast(); });
    if(key){
      s.on(window, 'keydown', e => {
        if(e.key!==key || isTyping(e)) return;
        e.preventDefault();
        blast();
      });
    }
    s.timeout(blast, 600);
  }, {hint:'Click the background or press Space'});

  // Maps scroll progress to a sequence of shapes and a growing point count.
  // Uses page scroll when the page scrolls; otherwise the mouse wheel over the element.
  const scroll = define('Scroll', ['shapeMode','pointCount'], (el, {
    stages = ['circle','heart','spiral','wave'],
    minCount = 40,
    maxCount = 220,
    wheelPx = 3000   // wheel distance for the full range when the page can't scroll
  }, s) => {
    const page = document.scrollingElement;
    const pageScrolls = () => page.scrollHeight > innerHeight + 1;
    let wheelProgress = 0, stage = -1;

    const apply = p => {
      p = clamp(p, 0, 1);
      const i = Math.min(stages.length-1, Math.floor(p*stages.length));
      const cfg = {pointCount:Math.round(lerp(minCount, maxCount, p))};
      if(i!==stage){ stage = i; cfg.shapeMode = stages[i]; }
      el.setConfig(cfg);
    };
    const pageProgress = () => scrollY / (page.scrollHeight - innerHeight);

    s.on(window, 'scroll', () => { if(pageScrolls()) apply(pageProgress()); }, {passive:true});
    s.on(el, 'wheel', e => {
      if(pageScrolls() || !onCanvas(e)) return;
      wheelProgress = clamp(wheelProgress + e.deltaY/wheelPx, 0, 1);
      apply(wheelProgress);
    }, {passive:true});
    apply(pageScrolls() ? pageProgress() : 0);
  }, {hint:'Scroll over the background'});

  // Microphone level drives node size, line reach and line opacity.
  const audio = define('Audio', ['nodeScale','connectionDistance','nearAlpha'], (el, {sensitivity=1}, s, saved) => {
    let stream = null, ctx = null, stopped = false;
    s.add(() => {
      stopped = true;
      stream?.getTracks().forEach(t => t.stop());
      ctx?.close();
    });

    navigator.mediaDevices.getUserMedia({audio:true}).then(media => {
      if(stopped){ media.getTracks().forEach(t => t.stop()); return; }
      stream = media;
      ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(media).connect(analyser);

      const samples = new Float32Array(analyser.fftSize);
      let level = 0;
      s.interval(() => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for(const v of samples) sum += v*v;
        const target = clamp(Math.sqrt(sum/samples.length)*8*sensitivity, 0, 1);
        // Fast attack, slow release.
        level += (target-level)*(target>level ? 0.5 : 0.08);
        el.setConfig({
          nodeScale:saved.nodeScale*(1 + level*1.5),
          connectionDistance:saved.connectionDistance*(1 + level*0.8),
          nearAlpha:saved.nearAlpha*(1 + level)
        });
      }, 33);
    }).catch(err => console.warn('audio macro: microphone unavailable', err));
  }, {hint:'Uses your microphone'});

  window.PointCloudMacros = {
    clock, words, countdown, liveNumber, typewriter,
    shapeTour, colorDrift, breathe, heartbeat, dayNight,
    explode, scroll, audio
  };
})();
