// Fun "macros" that drive a <point-cloud-network> through its public API
// (getConfig / setConfig) only.
//
// Each macro is a function (element, options) => {stop()}. stop() ends the
// macro and restores the settings it changed.
//
//   const clock = PointCloudMacros.clock(document.querySelector('point-cloud-network'));
//   clock.stop();
(() => {
  const pick = (obj, keys) => Object.fromEntries(keys.map(k => [k, obj[k]]));
  const smoothstep = t => t*t*(3-2*t);

  // Shows the current time (h:mm) as block text. On every minute change the
  // point count drops to `minCount`, then ramps back up to `count`. The new
  // points spawn across the whole area and stream into the digits, which also
  // spreads them evenly over the new shape.
  function clock(el, {
    hour12 = true,
    minCount = 30,   // the component's lowest allowed point count
    count = 200,
    holdMs = 350,    // how long to stay at minCount before ramping up
    riseMs = 1200    // duration of the ramp back up to `count`
  } = {}){
    const saved = pick(el.getConfig(), ['shapeMode','shapeText','pointCount']);
    let minuteTimer = 0, rampTimer = 0, shown = '';

    const format = d => {
      let h = d.getHours();
      if(hour12) h = h%12 || 12;
      return `${h}:${String(d.getMinutes()).padStart(2,'0')}`;
    };

    function burst(text){
      clearInterval(rampTimer);
      el.setConfig({shapeMode:'text', shapeText:text, pointCount:minCount});

      const start = performance.now() + holdMs;
      rampTimer = setInterval(() => {
        const t = Math.min(1, Math.max(0, (performance.now()-start)/riseMs));
        el.setConfig({pointCount:Math.round(minCount + (count-minCount)*smoothstep(t))});
        if(t>=1) clearInterval(rampTimer);
      }, 40);
    }

    function tick(){
      const now = new Date();
      const text = format(now);
      if(text!==shown){
        shown = text;
        burst(text);
      }
      // Wake just after the next minute boundary.
      const msToNextMinute = 60000 - now.getSeconds()*1000 - now.getMilliseconds();
      minuteTimer = setTimeout(tick, msToNextMinute + 50);
    }

    tick();

    return {
      stop(){
        clearTimeout(minuteTimer);
        clearInterval(rampTimer);
        el.setConfig(saved);
      }
    };
  }
  clock.label = 'Clock';

  window.PointCloudMacros = {clock};
})();
