'use strict';

/* Mesure, dans la page, ce que le panneau laisse atteindre de lui-même.
   Le panneau vit dans un plateau carré, donc borné : il doit tenir dedans
   quand c'est possible, et rester intégralement atteignable sinon. */
function mesurePanneau() {
  var o = document.getElementById('overlay');
  var p = document.getElementById('panel');
  var cta = document.getElementById('playBtn');
  var ro = o.getBoundingClientRect(), rp = p.getBoundingClientRect();
  var rc = cta.getBoundingClientRect();
  var reste = p.scrollHeight - p.clientHeight;      // ce qu'il reste à défiler
  return {
    overlay: Math.round(ro.height),
    panneau: Math.round(rp.height),
    contenu: p.scrollHeight,
    depassement: Math.round(rp.bottom - ro.bottom),
    scrollMax: reste,
    // L'invariant : le panneau ne sort jamais du plateau, quelles que soient
    // les polices du visiteur. Ce que le plateau ne peut pas montrer, le
    // panneau le fait défiler chez lui.
    borne: rp.top >= ro.top - 2 && rp.bottom <= ro.bottom + 2,
    // Tout tient sans avoir à faire défiler quoi que ce soit.
    entier: reste <= 2,
    // Le bouton principal est visible, ou le devient en défilant.
    ctaAtteignable: rc.top >= rp.top - 2 &&
                    (rc.bottom <= rp.bottom + 2 || rc.bottom - rp.bottom <= reste + 2)
  };
}

var fs = require('fs');
var path = require('path');
var harness = require('../lib/harness');

module.exports = {
  name: 'Plateforme, hall et profil commun',
  run: async function (server) {
    var h = await harness.open(server);
    var t = harness.checker();
    var check = t.check.bind(t);
    var page = h.page;
    var errors = h.errors;


      console.log('\n[Hall]');
      await page.goto(h.hub());
      await page.waitForTimeout(300);
      const cards = await page.$$eval('.game-card', els => els.map(e => ({ name: e.querySelector('.game-name').textContent, href: e.getAttribute('href') })));
      check('les quinze jeux sont listés', cards.length === 15, cards.map(c => c.name).join(' / '));
      check('les liens pointent vers la coquille', cards.every(c => /jeu\.html\?id=/.test(c.href)), cards.map(c => c.href).join(' '));
      const profile = await page.$$eval('#profile .tile-value', e => e.map(x => x.textContent));
      check('profil commun affiché', profile.length === 4, profile.join(' | '));
    check('l\'accroche compte les jeux elle-même',
          /^15 jeux/.test(await page.textContent('.hall-tagline')),
          await page.textContent('.hall-tagline'));
      await page.screenshot({ path: h.shot('p1-hall') });

      t.section('Le hall défile');
    // Le catalogue s'allonge à chaque jeu : sur un écran court, il faut
    // pouvoir atteindre la dernière carte.
    var court = await h.newPage({ viewport: { width: 390, height: 600 } });
    await court.goto(h.hub());
    await court.waitForTimeout(300);
    var mesure = await court.evaluate(function () {
      return { contenu: document.documentElement.scrollHeight,
               ecran: document.documentElement.clientHeight };
    });
    check('le contenu dépasse l\'écran', mesure.contenu > mesure.ecran,
          mesure.contenu + 'px pour ' + mesure.ecran + 'px');
    // Faire défiler d'une distance fixe vieillit mal : le catalogue s'allonge
    // à chaque jeu. On défile de toute la hauteur qui dépasse.
    await court.mouse.wheel(0, mesure.contenu - mesure.ecran + 200);
    await court.waitForTimeout(250);
    check('la page défile', (await court.evaluate(function () { return window.scrollY; })) > 100,
          await court.evaluate(function () { return window.scrollY; }));
    check('la dernière carte devient visible',
          await court.$eval('.game-card:last-child', function (el) {
            var r = el.getBoundingClientRect();
            return r.top < window.innerHeight && r.bottom > 0;
          }));
    /* Le corps de page est un conteneur flex : son rembourrage bas n'entre pas
       dans la zone défilable. Sans marge portée par le contenu lui-même, le
       dernier jeu et le pied se retrouvent collés au bord de la fenêtre. */
    var bas = await court.evaluate(function () {
      var cards = document.querySelectorAll('.game-card');
      var last = cards[cards.length - 1].getBoundingClientRect();
      var foot = document.querySelector('.hall-foot').getBoundingClientRect();
      return {
        souslePied: Math.round(window.innerHeight - foot.bottom),
        entreCarteEtPied: Math.round(foot.top - last.bottom),
        piedEntier: foot.bottom <= window.innerHeight + 1,
        carteEntiere: last.bottom <= window.innerHeight + 1
      };
    });
    check('en bas de page, le pied et la dernière carte tiennent en entier',
          bas.piedEntier && bas.carteEntiere, JSON.stringify(bas));
    check('le pied n\'est pas collé au bord de la fenêtre', bas.souslePied >= 16,
          bas.souslePied + 'px sous le pied');
    check('la dernière carte ne touche pas le pied', bas.entreCarteEtPied >= 12,
          bas.entreCarteEtPied + 'px entre la carte et le pied');
    await court.close();

    var jeu = await h.newPage({ viewport: { width: 390, height: 600 } });
    await jeu.goto(h.url('snake'));
    await jeu.waitForTimeout(300);
    await jeu.mouse.wheel(0, 600);
    await jeu.waitForTimeout(200);
    check('une page de jeu, elle, ne défile pas',
          (await jeu.evaluate(function () { return window.scrollY; })) === 0);
    await jeu.close();

    t.section('L\'ordre du catalogue');
    /* Chaque jeu ajouté s'inscrivait avant le dernier du registre, si bien que
       Neon 2048 avait dérivé jusqu'au bout de la liste. Le README, lui, gardait
       le bon ordre : on confronte les deux plutôt que d'attendre qu'on le
       remarque à l'œil. */
    var noms = await page.$$eval('.game-card .game-name', function (els) {
      return els.map(function (e) { return e.textContent.trim(); });
    });
    var readme = fs.readFileSync(path.join(harness.ROOT, 'README.md'), 'utf8');
    var attendus = [];
    readme.split('\n').some(function (ligne) {
      var m = ligne.match(/^\|[^|]*\*\*(Neon [^*]+)\*\*\s*\|/);
      if (m) { attendus.push(m[1].trim()); return false; }
      return attendus.length > 0;      // le tableau fini, on arrête
    });
    check('le README décrit bien les ' + noms.length + ' jeux', attendus.length === noms.length,
          attendus.length + ' lignes de tableau pour ' + noms.length + ' cartes');
    check('le hall les présente dans le même ordre que le README',
          noms.join(' · ') === attendus.join(' · '),
          noms.join(' · ') + '\n           README : ' + attendus.join(' · '));

    // Nombre impair de jeux : le dernier ne doit pas laisser un demi-rang vide.
    var large = await h.newPage({ viewport: { width: 1100, height: 1100 } });
    await large.goto(h.hub());
    await large.waitForTimeout(300);
    var rangs = await large.evaluate(function () {
      var nav = document.getElementById('games');
      var cartes = Array.prototype.map.call(nav.children, function (c) {
        var r = c.getBoundingClientRect();
        return { y: Math.round(r.top), w: Math.round(r.width) };
      });
      var dernier = cartes[cartes.length - 1];
      var seul = cartes.filter(function (c) { return c.y === dernier.y; }).length === 1;
      return {
        colonnes: getComputedStyle(nav).gridTemplateColumns.split(' ').length,
        largeurNav: Math.round(nav.getBoundingClientRect().width),
        dernierSeul: seul,
        dernierLarge: dernier.w,
        cartes: cartes.length
      };
    });
    check('le hall passe bien à deux colonnes sur grand écran', rangs.colonnes === 2, rangs.colonnes);
    check('la dernière rangée ne laisse pas de vide',
          !rangs.dernierSeul || rangs.dernierLarge > rangs.largeurNav * 0.9,
          rangs.cartes + ' jeux, dernière carte ' + rangs.dernierLarge + 'px sur ' + rangs.largeurNav);
    await large.close();

    t.section('Les règles, déclarées et atteignables');
    /* Chaque jeu doit savoir expliquer ses propres règles : c'est le manifeste
       qui les porte, comme il porte ses succès et ses réglages. */
    await page.goto(h.hub());
    await page.waitForTimeout(300);
    var regles = await page.evaluate(function () {
      return (window.GameRegistry || []).map(function (entry) {
        var m = (window.Games || {})[entry.id] || {};
        var r = m.rules;
        return {
          id: entry.id,
          nom: m.name,
          a: !!r,
          but: !!(r && typeof r.goal === 'string' && r.goal.length > 15),
          comment: !!(r && r.how && r.how.length >= 3),
          marque: !!(r && r.scoring && r.scoring.length >= 1),
          vides: r ? [].concat(r.how || [], r.scoring || [])
                       .filter(function (l) { return typeof l !== 'string' || l.length < 15; }).length : 0
        };
      });
    });
    var sansRegles = regles.filter(function (r) { return !r.a; });
    var incomplets = regles.filter(function (r) { return r.a && !(r.but && r.comment && r.marque); });
    var bavures = regles.filter(function (r) { return r.vides > 0; });
    check('les ' + regles.length + ' jeux déclarent leurs règles', sansRegles.length === 0,
          sansRegles.map(function (r) { return r.id; }).join(', ') || undefined);
    check('chacune a un but, au moins trois points de règle et un barème',
          incomplets.length === 0, incomplets.map(function (r) { return r.id; }).join(', ') || undefined);
    check('aucune ligne vide ou bâclée', bavures.length === 0,
          bavures.map(function (r) { return r.id + ' (' + r.vides + ')'; }).join(', ') || undefined);

    // Et le « i » du bandeau les ouvre, sur n'importe quel jeu.
    var echantillon = ['snake', 'cells', 'tower'];
    for (var g = 0; g < echantillon.length; g++) {
      var onglet = await h.newPage({ viewport: { width: 390, height: 740 } });
      await onglet.goto(h.url(echantillon[g]));
      await onglet.waitForTimeout(350);
      var bouton = await onglet.$eval('#infoBtn', function (el) {
        return el.getBoundingClientRect().width > 0;
      }).catch(function () { return false; });
      await onglet.click('#infoBtn');
      await onglet.waitForTimeout(200);
      var vu = await onglet.evaluate(function () {
        var box = document.getElementById('sheetTabs');
        return {
          ouvert: !document.getElementById('sheet').hidden,
          actif: (document.querySelector('.tab.is-active') || {}).textContent,
          but: (document.querySelector('.rule-goal') || {}).textContent || '',
          puces: document.querySelectorAll('.rule-list li').length,
          // Cinq onglets : sur un écran étroit ils doivent passer à la ligne,
          // pas disparaître dans un défilement que rien n'annonce.
          tousVisibles: Array.prototype.every.call(box.children, function (b) {
            var r = b.getBoundingClientRect(), bx = box.getBoundingClientRect();
            return r.left >= bx.left - 1 && r.right <= bx.right + 1 &&
                   r.top >= bx.top - 1 && r.bottom <= bx.bottom + 1;
          })
        };
      });
      check(echantillon[g] + ' : le bouton « i » est là et ouvre les règles',
            bouton && vu.ouvert && vu.actif === 'Règles', vu.actif);
      check(echantillon[g] + ' : le but et les points de règle sont rendus',
            vu.but.length > 15 && vu.puces >= 6, vu.puces + ' puces');
      check(echantillon[g] + ' : les cinq onglets restent tous visibles', vu.tousVisibles);
      await onglet.close();
    }

    t.section('Le panneau tient dans le plateau');
    /* Le panneau est enfermé dans un plateau carré, donc plafonné : dans sa
       forme la plus longue — fin de partie, avec difficultés ET tableau de
       score — il doit rester entièrement atteignable, sur écran court comme
       sur grand écran. Il a déjà été rogné net une fois. */
    var ecrans = [[390, 600], [520, 940], [751, 820], [900, 700]];
    for (var v = 0; v < ecrans.length; v++) {
      var vue = { width: ecrans[v][0], height: ecrans[v][1] };
      var onglet = await h.newPage({ viewport: vue });
      await onglet.goto(h.url('2048'));
      await onglet.waitForTimeout(300);

      var m = await onglet.evaluate(mesurePanneau);
      var tailleMenu = 'panneau ' + m.panneau + 'px dans ' + m.overlay + 'px';
      check(vue.width + '×' + vue.height + ' : le menu ne sort pas du plateau',
            m.borne, tailleMenu);
      check(vue.width + '×' + vue.height + ' : le menu tient sans défiler',
            m.entier, tailleMenu + ', défilement ' + m.scrollMax + 'px');

      // Grille pleine et bloquée : la partie se termine au coup suivant.
      await onglet.click('#playBtn');
      await onglet.waitForTimeout(150);
      await onglet.evaluate(function () {
        window.__neon2048.setGrid([2,4,2,4, 4,2,4,2, 2,4,2,4, 4,2,4,2]);
      });
      await onglet.keyboard.press('ArrowRight');
      await onglet.waitForTimeout(600);

      var fin = await onglet.evaluate(mesurePanneau);
      var taille = 'panneau ' + fin.panneau + 'px dans ' + fin.overlay +
                   'px, contenu ' + fin.contenu + 'px, défilement ' + fin.scrollMax + 'px';
      check(vue.width + '×' + vue.height + ' : le panneau de fin ne sort pas du plateau',
            fin.borne, taille);
      check(vue.width + '×' + vue.height + ' : le bouton de reprise est atteignable',
            fin.ctaAtteignable, taille);
      // Sur un plateau assez haut, il ne doit même pas falloir défiler.
      if (fin.overlay >= 480) {
        check(vue.width + '×' + vue.height + ' : le panneau de fin tient sans défiler',
              fin.entier, taille);
      }

      /* Les polices du visiteur ne sont pas les nôtres : on refait la mesure
         avec un texte volontairement plus haut, pour que « ça tient » ne
         dépende pas du rendu de cette machine. */
      await onglet.addStyleTag({ content:
        '.panel, .panel * { line-height: 1.9 !important; letter-spacing: 0.3px !important; }' });
      await onglet.waitForTimeout(120);
      var gonfle = await onglet.evaluate(mesurePanneau);
      check(vue.width + '×' + vue.height + ' : même avec un texte plus haut, rien ne déborde',
            gonfle.borne && gonfle.ctaAtteignable,
            'panneau ' + gonfle.panneau + 'px dans ' + gonfle.overlay +
            'px, contenu ' + gonfle.contenu + 'px');
      // La barre d'outils reste utilisable pendant que le panneau est affiché.
      var barre = await onglet.evaluate(function () {
        var b = document.getElementById('restartBtn').getBoundingClientRect();
        var dessus = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return dessus ? dessus.id || dessus.className : 'rien';
      });
      check(vue.width + '×' + vue.height + ' : la barre d\'outils reste cliquable',
            barre === 'restartBtn', 'au-dessus du bouton : ' + barre);
      await onglet.close();
    }

    console.log('\n[Snake via la coquille]');
      await page.click('.game-card:has-text("Snake")');
      await page.waitForTimeout(500);
      check('titre du jeu posé par le manifeste', (await page.textContent('#title')) === 'Neon Snake', await page.textContent('#title'));
      check('légende du Snake rendue', (await page.$$('.legend span')).length === 4);
      check('aide clavier avec touche stylée', (await page.$$('.hint kbd')).length === 1);
      const snakeState = await page.evaluate(() => window.__neonSnake.snapshot());
      check('le jeu est prêt', snakeState.state === 'menu' && snakeState.cols > 0, snakeState.cols + ' cases');
      await page.click('#playBtn');
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(400);
      check('le Snake tourne', (await page.evaluate(() => window.__neonSnake.snapshot())).state === 'playing');
      await page.screenshot({ path: h.shot('p2-snake') });

      console.log('\n[2048 via la coquille]');
      await page.goto(h.url('2048'));
      await page.waitForTimeout(500);
      check('titre 2048', (await page.textContent('#title')) === 'Neon 2048', await page.textContent('#title'));
      check('pas de légende pour ce jeu', await page.isHidden('#legend'));
      const diffs = await page.$$eval('#difficulty .choice', e => e.map(x => x.textContent));
      check('difficultés du manifeste 2048', diffs.join(',') === 'Classique,Serré,Large,Zen', diffs.join(','));
      await page.click('#playBtn');
      await page.waitForTimeout(300);
      let s = await page.evaluate(() => window.__neon2048.snapshot());
      check('deux tuiles au départ', s.tiles === 2, s.tiles + ' tuiles');
      check('grille 4 × 4 en classique', s.size === 4);

      // Un coup réel : on vise une fusion garantie.
      await page.evaluate(() => window.__neon2048.setGrid([2,2,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]));
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(400);
      s = await page.evaluate(() => window.__neon2048.snapshot());
      check('fusion : 2 + 2 = 4', s.grid[0] === 4, 'case 0 = ' + s.grid[0]);
      check('score crédité de la fusion', s.score === 4, s.score);
      check('meilleure tuile suivie', s.maxTile === 4, s.maxTile);
      check('succès « Première fusion » débloqué', s.unlocked.includes('firstMerge'), s.unlocked.join(','));
      check('une tuile est apparue', s.tiles === 2, s.tiles + ' tuiles');
      await page.screenshot({ path: h.shot('p3-2048') });

      console.log('\n[Le contrat commun]');
      await page.click('#statsBtn');
      await page.waitForTimeout(200);
      const tiles = await page.$$eval('.tile-label', e => e.map(x => x.textContent));
      check('les stats parlent le vocabulaire de 2048',
            tiles.includes('Coups joués') && tiles.includes('Fusions') && tiles.includes('Meilleure tuile'),
            tiles.join(', '));
      await page.click('.tab:has-text("Skins")');
      await page.waitForTimeout(150);
      const skins = await page.$$eval('.skin strong', e => e.map(x => x.textContent));
      check('palettes de 2048 proposées', skins.join(',') === 'Néon,Classique,Océan,Braise,Arc-en-ciel', skins.join(','));
      await page.click('.tab:has-text("Réglages")');
      await page.waitForTimeout(150);
      const fields = await page.$$eval('.field-label', e => e.map(x => x.textContent));
      check('réglages propres à 2048 + thème commun',
            fields.includes('Objectif') && fields.includes('Nouvelles tuiles') && fields.includes('Thème'),
            fields.join(', '));
      await page.screenshot({ path: h.shot('p4-2048-reglages') });

      console.log('\n[Cloisonnement des données]');
      const keys = await page.evaluate(() => Object.keys(localStorage).filter(k => k.indexOf('neon:') === 0).sort());
      check('chaque jeu écrit dans son espace', keys.some(k => k.indexOf('neon:2048:') === 0), keys.join(', '));
      check('aucun mélange avec le Snake', !keys.some(k => k.indexOf('neon:snake:totals') === 0 && false));

      // Le thème est partagé : changé dans 2048, il doit suivre dans le hall.
      await page.click('.sheet-body .choice:has-text("Crépuscule")');
      await page.waitForTimeout(150);
      await page.goto(h.hub());
      await page.waitForTimeout(300);
      check('thème partagé repris par le hall', await page.getAttribute('html', 'data-theme') === 'dusk',
            await page.getAttribute('html', 'data-theme'));


    check('aucune erreur JS', errors.length === 0, errors.join(' | ') || undefined);
    await h.browser.close();
    return t.fails;
  }
};
