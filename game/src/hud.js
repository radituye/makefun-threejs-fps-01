// Readout: every DOM readout in one place. main.js calls the setters; this
// module owns the elements and the formatting, and nothing else. The shop
// menu, the rig bar and the scope overlay are plain DOM, so they cost
// the renderer nothing.
export function buildReadout() {
  const $ = (id) => document.getElementById(id);
  const els = {
    veil: $('overlay'),
    veilTitle: $('overlay-title'),
    veilCopy: $('overlay-copy'),
    go: $('play'),
    sight: $('crosshair'),
    marker: $('hitmarker'),
    vigorNum: $('health-num'),
    vigorBar: $('health-bar'),
    plateNum: $('armor-num'),
    clipNum: $('ammo-mag'),
    spareNum: $('ammo-reserve'),
    gunLabel: $('weapon-name'),
    funds: $('money'),
    clock: $('timer'),
    tally: $('score'),
    dots: $('pips'),
    feed: $('killfeed'),
    flag: $('banner'),
    flagTitle: $('banner-title'),
    flagSub: $('banner-sub'),
    shop: $('buymenu'),
    shopFunds: $('buy-money'),
    channel: $('plantbar'),
    channelFill: $('plant-fill'),
    channelLabel: $('plant-label'),
    fuse: $('spike'),
    fuseClock: $('spike-timer'),
    hurtVeil: $('vignette'),
    lens: $('scope'),
  };
  let markTimer = null;
  let flagTimer = null;

  function flip(el, on) {
    if (el) el.hidden = !on;
  }

  return {
    showVigor(vigor, plating) {
      els.vigorNum.textContent = String(Math.ceil(vigor));
      els.vigorBar.style.width = `${Math.max(0, vigor)}%`;
      els.vigorBar.classList.toggle('low', vigor <= 30);
      els.plateNum.textContent = plating > 0 ? `+${Math.ceil(plating)}` : '';
    },
    showAmmo(clip, spare, label) {
      els.clipNum.textContent = String(clip);
      els.spareNum.textContent = `/ ${spare}`;
      els.gunLabel.textContent = label;
      els.clipNum.parentElement.classList.toggle('empty', clip === 0);
    },
    showFunds(funds) {
      els.funds.textContent = `$${funds}`;
      els.shopFunds.textContent = `$${funds}`;
    },
    showClock(seconds, stage) {
      const s = Math.max(0, Math.ceil(seconds));
      els.clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      els.clock.classList.toggle('buy', stage === 'shop');
    },
    showTally(taken, ceded, roundNo) {
      els.tally.textContent = `R${roundNo}  ${taken} — ${ceded}`;
      let dots = '';
      for (let i = 0; i < 5; i += 1) dots += `<i class="${i < taken ? 'won' : ''}"></i>`;
      dots += '<span>·</span>';
      for (let i = 0; i < 5; i += 1) dots += `<i class="foe ${i < ceded ? 'won' : ''}"></i>`;
      els.dots.innerHTML = dots;
    },
    spreadSight(px) {
      els.sight.style.setProperty('--gap', `${px}px`);
    },
    markHit(head, holdMs) {
      els.marker.classList.add('on');
      els.marker.classList.toggle('head', head);
      clearTimeout(markTimer);
      markTimer = setTimeout(() => els.marker.classList.remove('on', 'head'), holdMs);
    },
    flashHurt() {
      els.hurtVeil.classList.remove('flash');
      // Re-trigger the CSS animation by forcing a reflow.
      void els.hurtVeil.offsetWidth;
      els.hurtVeil.classList.add('flash');
    },
    feedLine(text) {
      const line = document.createElement('div');
      line.textContent = text;
      els.feed.prepend(line);
      while (els.feed.children.length > 5) els.feed.lastChild.remove();
      setTimeout(() => line.remove(), 6000);
    },
    showFlag(title, sub, holdMs = 2600) {
      els.flagTitle.textContent = title;
      els.flagSub.textContent = sub;
      flip(els.flag, true);
      clearTimeout(flagTimer);
      flagTimer = setTimeout(() => flip(els.flag, false), holdMs);
    },
    clearFlag() {
      flip(els.flag, false);
    },
    showShop(on) {
      flip(els.shop, on);
    },
    greyPoor(funds) {
      // Grey out what the player cannot afford; called on every buy.
      const items = els.shop.querySelectorAll('[data-price]');
      for (const item of items) {
        item.classList.toggle('poor', Number(item.dataset.price) > funds);
      }
    },
    showChannel(label, progress) {
      flip(els.channel, true);
      els.channelLabel.textContent = label;
      els.channelFill.style.width = `${Math.round(progress * 100)}%`;
    },
    hideChannel() {
      flip(els.channel, false);
    },
    showFuse(seconds) {
      if (seconds === null) {
        flip(els.fuse, false);
        return;
      }
      flip(els.fuse, true);
      els.fuseClock.textContent = seconds.toFixed(1);
    },
    showLens(on) {
      flip(els.lens, on);
      flip(els.sight, !on);
    },
    openPanel(kind, tally) {
      const words = {
        start: ['TIDELOCK', 'A night freight terminal. Plant the charge at Crane Bay or the Warehouse — or clear the yard. Click to play.'],
        paused: ['Paused', 'Click to keep playing.'],
        dead: ['You are down', 'Your team holds the yard without you. The round plays on.'],
        round: ['Round over', tally ?? ''],
        match: ['Match over', tally ?? ''],
      }[kind] || ['TIDELOCK', ''];
      els.veilTitle.textContent = words[0];
      els.veilCopy.textContent = words[1];
      els.go.textContent = kind === 'start' ? 'Click to play' : 'Continue';
      flip(els.veil, true);
    },
    closePanel() {
      flip(els.veil, false);
    },
    onStart(fn) {
      els.go.addEventListener('click', fn);
    },
    panelOpen() {
      return !els.veil.hidden;
    },
  };
}
