// HUD: every DOM readout in one place. main.js calls the setters; this
// module owns the elements and the formatting, and nothing else. The buy
// menu, the plant bar and the scope overlay are plain DOM, so they cost
// the renderer nothing.
export function createHud() {
  const $ = (id) => document.getElementById(id);
  const els = {
    overlay: $('overlay'),
    overlayTitle: $('overlay-title'),
    overlayCopy: $('overlay-copy'),
    play: $('play'),
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    healthNum: $('health-num'),
    healthBar: $('health-bar'),
    armorNum: $('armor-num'),
    ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'),
    weaponName: $('weapon-name'),
    money: $('money'),
    timer: $('timer'),
    score: $('score'),
    pips: $('pips'),
    killfeed: $('killfeed'),
    banner: $('banner'),
    bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'),
    buymenu: $('buymenu'),
    buyMoney: $('buy-money'),
    plantbar: $('plantbar'),
    plantFill: $('plant-fill'),
    plantLabel: $('plant-label'),
    spike: $('spike'),
    spikeTimer: $('spike-timer'),
    vignette: $('vignette'),
    scope: $('scope'),
  };
  let hitTimer = null;
  let bannerTimer = null;

  function setVisible(el, on) {
    if (el) el.hidden = !on;
  }

  return {
    setHealth(health, armor) {
      els.healthNum.textContent = String(Math.ceil(health));
      els.healthBar.style.width = `${Math.max(0, health)}%`;
      els.healthBar.classList.toggle('low', health <= 30);
      els.armorNum.textContent = armor > 0 ? `+${Math.ceil(armor)}` : '';
    },
    setAmmo(mag, reserve, name) {
      els.ammoMag.textContent = String(mag);
      els.ammoReserve.textContent = `/ ${reserve}`;
      els.weaponName.textContent = name;
      els.ammoMag.parentElement.classList.toggle('empty', mag === 0);
    },
    setMoney(money) {
      els.money.textContent = `$${money}`;
      els.buyMoney.textContent = `$${money}`;
    },
    setTimer(seconds, phase) {
      const s = Math.max(0, Math.ceil(seconds));
      els.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      els.timer.classList.toggle('buy', phase === 'buy');
    },
    setScore(wins, losses, round) {
      els.score.textContent = `R${round}  ${wins} — ${losses}`;
      let pips = '';
      for (let i = 0; i < 5; i += 1) pips += `<i class="${i < wins ? 'won' : ''}"></i>`;
      pips += '<span>·</span>';
      for (let i = 0; i < 5; i += 1) pips += `<i class="foe ${i < losses ? 'won' : ''}"></i>`;
      els.pips.innerHTML = pips;
    },
    setCrosshairSpread(px) {
      els.crosshair.style.setProperty('--gap', `${px}px`);
    },
    hitMarker(head, holdMs) {
      els.hitmarker.classList.add('on');
      els.hitmarker.classList.toggle('head', head);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => els.hitmarker.classList.remove('on', 'head'), holdMs);
    },
    damageFlash() {
      els.vignette.classList.remove('flash');
      // Re-trigger the CSS animation by forcing a reflow.
      void els.vignette.offsetWidth;
      els.vignette.classList.add('flash');
    },
    killfeed(text) {
      const line = document.createElement('div');
      line.textContent = text;
      els.killfeed.prepend(line);
      while (els.killfeed.children.length > 5) els.killfeed.lastChild.remove();
      setTimeout(() => line.remove(), 6000);
    },
    banner(title, sub, holdMs = 2600) {
      els.bannerTitle.textContent = title;
      els.bannerSub.textContent = sub;
      setVisible(els.banner, true);
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => setVisible(els.banner, false), holdMs);
    },
    hideBanner() {
      setVisible(els.banner, false);
    },
    showBuy(on) {
      setVisible(els.buymenu, on);
    },
    setBuyAfford(money, prices) {
      // Grey out what the player cannot afford; called on every buy.
      const items = els.buymenu.querySelectorAll('[data-price]');
      for (const item of items) {
        item.classList.toggle('poor', Number(item.dataset.price) > money);
      }
    },
    showPlant(label, progress) {
      setVisible(els.plantbar, true);
      els.plantLabel.textContent = label;
      els.plantFill.style.width = `${Math.round(progress * 100)}%`;
    },
    hidePlant() {
      setVisible(els.plantbar, false);
    },
    setSpike(seconds) {
      if (seconds === null) {
        setVisible(els.spike, false);
        return;
      }
      setVisible(els.spike, true);
      els.spikeTimer.textContent = seconds.toFixed(1);
    },
    setScope(on) {
      setVisible(els.scope, on);
      setVisible(els.crosshair, !on);
    },
    showOverlay(kind, score) {
      const copy = {
        start: ['TIDELOCK', 'A night freight terminal. Plant the spike at Crane Bay or the Warehouse — or clear the yard. Click to play.'],
        paused: ['Paused', 'Click to keep playing.'],
        dead: ['You are down', 'Your team holds the yard without you. The round plays on.'],
        round: ['Round over', score ?? ''],
        match: ['Match over', score ?? ''],
      }[kind] || ['TIDELOCK', ''];
      els.overlayTitle.textContent = copy[0];
      els.overlayCopy.textContent = copy[1];
      els.play.textContent = kind === 'start' ? 'Click to play' : 'Continue';
      setVisible(els.overlay, true);
    },
    hideOverlay() {
      setVisible(els.overlay, false);
    },
    onPlay(fn) {
      els.play.addEventListener('click', fn);
    },
    overlayVisible() {
      return !els.overlay.hidden;
    },
  };
}
