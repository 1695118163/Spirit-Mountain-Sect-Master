/* ============================================================================
   灵山舆图 · 宋人墨法重绘（2026-09-19 第四版）
   ----------------------------------------------------------------------------
   立意（按 wkh 给的画论）：以现有山势为基础，保留中间高耸主峰、左右两座侧峰、
     山间小径与溪流走向，以及各地标的位置关系；把墨法提到宋画的分量：
       · 主峰以浓墨皴擦出岩石肌理，山体分阴阳两面（一面压重、一面留亮）；
       · 云雾改用淡墨层层晕染（多道横云，由浓至无），求空灵深远；
       · 近处古松盘石、枝干苍劲；远处山峰以淡墨若隐若现；
       · 上部大量留白，飞鸟掠天；黑白灰为主，辅以极淡赭石与花青。
   画面里不再有地名题字、朱印、星盘一类的标识 —— 只留山水。
   降级：本文件未加载时 ui.js 以空串兜底 —— 地图仍可点，只是没背景画。
   ============================================================================ */
(function (g) {
  'use strict';

  var INK3 = 'var(--ms-ink-3)', INK4 = 'var(--ms-ink-4)', INK5 = 'var(--ms-ink-5)',
      INK6 = 'var(--ms-ink-6)', INK7 = 'var(--ms-ink-7)', DAI3 = 'var(--ms-dai-3)',
      PAPER = 'var(--ms-paper-lit)', SEAL = 'var(--cinnabar)',
      ZHE = 'var(--map-zhe)', QING = 'var(--map-qing)', QINGL = 'var(--map-qing-lit)',
      SOLID = 'var(--map-ink-solid)';

  /* 点苔：压在山脊与岩面 */
  function moss(pts, r, op) {
    var out = '<g fill="' + SOLID + '" opacity="' + op + '">';
    for (var i = 0; i < pts.length; i++) {
      out += '<circle cx="' + pts[i][0] + '" cy="' + pts[i][1] + '" r="' + (r + (i % 3) * 0.5).toFixed(1) + '"/>';
    }
    return out + '</g>';
  }

  /* 松针：枝端扇形针簇 */
  function needleFan(cx, cy, baseDeg, len) {
    var L = len || 8.5, out = '<g stroke="' + SOLID + '" stroke-opacity=".42" stroke-width=".65" stroke-linecap="round">';
    for (var i = -2; i <= 2; i++) {
      var a = (baseDeg + i * 20) * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a);
      out += '<path d="M' + cx + ',' + cy + ' L' + (cx + dx * L).toFixed(1) + ',' + (cy + dy * L).toFixed(1) + '"/>' +
             '<path d="M' + cx + ',' + cy + ' L' + (cx + dx * L * 0.62).toFixed(1) + ',' + (cy + dy * L * 0.62).toFixed(1) + '"/>';
    }
    return out + '</g>';
  }

  /* 古松：盘曲主干 + 苍劲折枝 + 三簇针（scale 大者为近景） */
  function pine(x, y, s, op) {
    return '<g transform="translate(' + x + ',' + y + ') scale(' + s + ')" opacity="' + op + '">' +
      '<path d="M3,14 C0,4 5,-3 -4,-10 C-8,-14 -5,-17 -7,-21" fill="none" stroke="' + SOLID + '" ' +
        'stroke-opacity=".62" stroke-width="1.9" stroke-linecap="round"/>' +
      '<path d="M-4,-10 C2,-13 7,-14 11,-18 M-6,-16 C-2,-19 3,-20 7,-23 M-7,-21 C-10,-24 -13,-25 -16,-27" ' +
        'fill="none" stroke="' + SOLID + '" stroke-opacity=".5" stroke-width="1.15" stroke-linecap="round"/>' +
      needleFan(11, -18, -25) + needleFan(7, -23, -95) + needleFan(-16, -27, 200) +
      '</g>';
  }

  /* 竹：三竿一簇 */
  function bamboo(x, y, sc, op) {
    return '<g transform="translate(' + x + ',' + y + ') scale(' + sc + ')" fill="none" stroke="' + SOLID + '" ' +
      'stroke-opacity="' + op + '" stroke-width="1.05" stroke-linecap="round">' +
      '<path d="M0,0 L0,-23 M-5,2 L-5,-16 M5,1 L5,-18"/>' +
      '<path d="M-5,-16 L-1.5,-20 M5,-18 L1.5,-22 M0,-23 L-3,-27 M0,-23 L3,-26.5"/>' +
      '</g>';
  }

  /* 怪石：皴面 */
  function rock(x, y, s, op) {
    return '<g transform="translate(' + x + ',' + y + ') scale(' + s + ')" opacity="' + op + '">' +
      '<path d="M-15,3 C-16,-4 -9,-9 0,-10 C10,-11 16,-5 14,1 C12,6 -13,7 -15,3 Z" ' +
        'fill="' + SOLID + '" opacity=".12" stroke="' + SOLID + '" stroke-opacity=".38" stroke-width="1"/>' +
      '<g fill="none" stroke="' + SOLID + '" stroke-opacity=".3" stroke-width=".8" stroke-linecap="round">' +
        '<path d="M-8,-3 C-7,0 -8,2 -7,5"/><path d="M0,-7 C1,-3 0,0 1,4"/><path d="M7,-4 C8,-1 7,2 8,5"/>' +
      '</g>' +
      '</g>';
  }

  /* ── 竖幅（手机 390x720）── */
  function scene() {
    return '<svg viewBox="0 0 390 720" preserveAspectRatio="none" class="map-svg" aria-hidden="true">' +
      '<defs>' +
        /* 山体阳面：上淡下更淡，留亮 */
        '<linearGradient id="mapart-m1" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="' + SOLID + '" stop-opacity=".25"/>' +
          '<stop offset=".45" stop-color="' + SOLID + '" stop-opacity=".38"/>' +
          '<stop offset="1" stop-color="' + SOLID + '" stop-opacity=".20"/>' +
        '</linearGradient>' +
        /* 山体阴面：压重 */
        '<linearGradient id="mapart-m2" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="' + SOLID + '" stop-opacity=".46"/>' +
          '<stop offset="1" stop-color="' + SOLID + '" stop-opacity=".26"/>' +
        '</linearGradient>' +
        /* 远峰：淡墨偏花青 */
        '<linearGradient id="mapart-m3" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="' + QING + '" stop-opacity=".34"/>' +
          '<stop offset="1" stop-color="' + SOLID + '" stop-opacity=".06"/>' +
        '</linearGradient>' +
      '</defs>' +

      /* ══ 一、天际留白 · 飞鸟 ══ */
      '<g fill="none" stroke="' + SOLID + '" stroke-opacity=".38" stroke-width="1.3" stroke-linecap="round">' +
        '<path d="M108,110 q6,-7 12,0 q6,-7 12,0"/>' +
        '<path d="M74,134 q5,-5 10,0 q5,-5 10,0"/>' +
        '<path d="M146,92 q4,-4 8,0 q4,-4 8,0"/>' +
        '<path d="M66,168 q9,-11 18,0 q9,-11 18,0" stroke-width="1.4" opacity=".8"/>' +
      '</g>' +

      /* ══ 二、远峰三层（淡墨，若隐若现）══ */
      '<path d="M-10,176 C40,148 70,164 108,136 C142,110 168,134 204,112 C238,92 268,116 306,96 ' +
        'C338,80 366,98 400,86 L400,206 L-10,206 Z" fill="' + SOLID + '" opacity=".07"/>' +
      '<path d="M-10,214 C34,190 62,204 100,178 C136,154 166,176 202,156 C240,136 272,160 310,142 ' +
        'C344,126 372,146 400,134 L400,264 L-10,264 Z" fill="' + QING + '" opacity=".13"/>' +
      '<path d="M-10,258 C36,236 66,252 106,228 C144,206 178,230 216,210 C254,190 288,214 326,196 ' +
        'C356,182 380,200 400,190 L400,328 L-10,328 Z" fill="' + SOLID + '" opacity=".16"/>' +
      moss([[70, 208], [96, 196], [140, 184], [188, 166], [236, 162], [286, 148], [330, 146]], 1.7, '.28') +

      /* ══ 三、层云：淡墨层层晕染（由浓至无）══ */
      '<g fill="none" stroke="' + SOLID + '" stroke-linecap="round">' +
        '<path d="M-10,278 C50,270 110,286 176,276 C240,266 300,282 380,274" stroke-opacity=".16" stroke-width="14"/>' +
        '<path d="M-10,304 C56,296 118,310 190,300 C258,290 320,304 400,296" stroke-opacity=".11" stroke-width="18"/>' +
        '<path d="M-10,336 C60,328 124,342 200,332 C270,322 330,336 400,328" stroke-opacity=".08" stroke-width="20"/>' +
      '</g>' +

      /* ══ 四、主峰群：阳面 / 阴面 / 脊线 / 皴擦 / 点苔 ══ */
      /* 左次峰 */
      '<path d="M-10,486 C22,452 46,466 76,420 C98,386 116,404 138,352 ' +
        'C122,428 58,486 -10,486 Z" class="map-ridge" fill="url(#mapart-m1)"/>' +
      '<path d="M138,352 C130,392 116,428 104,452 C130,436 150,404 138,352 Z" fill="url(#mapart-m2)"/>' +
      /* 右次峰 */
      '<path d="M400,478 C370,444 344,458 316,414 C296,382 278,396 258,352 ' +
        'C276,428 334,478 400,478 Z" class="map-ridge" fill="url(#mapart-m1)"/>' +
      '<path d="M258,352 C268,392 284,424 298,448 C272,432 250,400 258,352 Z" fill="url(#mapart-m2)"/>' +
      /* 主峰：阳面（西坡）+ 阴面（东坡） */
      '<path d="M-10,492 C34,452 60,466 96,408 C122,366 142,388 166,350 C182,326 196,336 216,308 ' +
        'C236,280 254,314 278,350 C304,392 336,382 400,426 L400,512 L-10,512 Z" class="map-ridge" fill="url(#mapart-m1)"/>' +
      '<path d="M216,308 C236,280 254,314 278,350 C304,392 336,382 400,426 L400,512 ' +
        'C330,496 264,446 234,382 C224,360 218,332 216,308 Z" fill="url(#mapart-m2)"/>' +
      /* 脊线（山骨）*/
      '<path d="M76,420 C98,386 116,404 138,352" fill="none" stroke="' + SOLID + '" stroke-opacity=".42" ' +
        'stroke-width="1.5" stroke-linecap="round"/>' +
      '<path d="M96,408 C122,366 142,388 166,350 C182,326 196,336 216,308" fill="none" stroke="' + SOLID + '" ' +
        'stroke-opacity=".6" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M216,308 C236,280 254,314 278,350" fill="none" stroke="' + SOLID + '" stroke-opacity=".55" ' +
        'stroke-width="1.8" stroke-linecap="round"/>' +
      '<path d="M258,352 C278,392 296,410 316,414" fill="none" stroke="' + SOLID + '" stroke-opacity=".42" ' +
        'stroke-width="1.5" stroke-linecap="round"/>' +
      /* 短脊：分出峰面 */
      '<g fill="none" stroke="' + SOLID + '" stroke-opacity=".22" stroke-width=".9" stroke-linecap="round">' +
        '<path d="M166,350 C163,362 157,370 155,382"/>' +
        '<path d="M196,332 C193,344 187,352 185,364"/>' +
        '<path d="M236,300 C233,312 227,320 225,332"/>' +
        '<path d="M138,352 C135,364 129,372 127,384"/>' +
        '<path d="M278,350 C281,362 287,370 289,382"/>' +
      '</g>' +
      /* 披麻皴：随山势走长线 */
      '<g fill="none" stroke="' + SOLID + '" stroke-opacity=".3" stroke-width=".9" stroke-linecap="round">' +
        '<path d="M116,414 C126,432 120,448 130,466"/>' +
        '<path d="M136,384 C146,402 140,418 150,436"/>' +
        '<path d="M158,356 C168,374 162,390 172,408"/>' +
        '<path d="M182,334 C192,352 186,368 196,386"/>' +
        '<path d="M206,318 C216,336 210,352 220,370"/>' +
        '<path d="M232,314 C242,332 236,348 246,366"/>' +
        '<path d="M254,332 C264,350 258,366 268,384"/>' +
        '<path d="M276,360 C286,378 280,394 290,412"/>' +
        '<path d="M300,392 C310,410 304,426 314,444"/>' +
        '<path d="M330,414 C340,432 334,448 344,466"/>' +
        '<path d="M88,442 C98,460 92,476 102,494"/>' +
        '<path d="M64,462 C74,480 68,496 78,514"/>' +
        '<path d="M352,436 C362,454 356,470 366,488"/>' +
      '</g>' +
      /* 斧劈皴：下部块状短笔（岩石肌理） */
      '<g fill="none" stroke="' + SOLID + '" stroke-opacity=".22" stroke-width="1.7" stroke-linecap="round">' +
        '<path d="M108,462 L122,474 M128,480 L142,492 M150,486 L164,498"/>' +
        '<path d="M176,470 L190,482 M200,478 L214,490 M226,472 L240,484"/>' +
        '<path d="M252,466 L266,478 M278,462 L292,474 M304,458 L318,470"/>' +
        '<path d="M330,452 L344,464 M356,446 L370,458"/>' +
        '<path d="M82,478 L96,490 M58,494 L72,506"/>' +
      '</g>' +
      /* 点苔：压在山脊两侧 */
      moss([[112, 396], [130, 370], [152, 348], [176, 326], [200, 312], [226, 304], [250, 324],
            [272, 352], [296, 382], [318, 410], [92, 424], [74, 452], [346, 416], [118, 414],
            [160, 370], [208, 340], [262, 362], [300, 400], [86, 456]], 2.1, '.5') +

      /* ══ 五、云锁山腰（纸色横云断山）══ */
      '<g stroke="' + PAPER + '" fill="none" stroke-linecap="round" opacity=".5">' +
        '<path d="M-10,322 C60,315 130,328 210,317 C280,308 340,320 400,311" stroke-width="8" opacity=".7"/>' +
        '<path d="M20,354 C90,347 150,360 226,349 C290,340 348,351 400,344" stroke-width="5.5" opacity=".55"/>' +
      '</g>' +
      '<g fill="none" stroke="' + INK7 + '" stroke-linecap="round" opacity=".5">' +
        '<path d="M-10,322 C60,315 130,328 210,317 C280,308 340,320 400,311" stroke-width="1.2"/>' +
        '<path d="M20,354 C90,347 150,360 226,349 C290,340 348,351 400,344" stroke-width="1"/>' +
      '</g>' +

      /* ══ 六、飞瀑 · 溪流（走向照旧）══ */
      '<g stroke="' + QING + '" fill="none" stroke-linecap="round">' +
        '<path d="M158,352 C154,378 166,398 160,422 C156,438 162,448 158,458" stroke-width="3.4" opacity=".40"/>' +
        '<path d="M162,354 C159,376 170,394 164,416" stroke-width="1.2" opacity=".5"/>' +
        '<path d="M154,360 C151,378 160,394 155,410" stroke-width=".9" opacity=".35"/>' +
      '</g>' +
      '<g fill="none" stroke="' + QINGL + '" stroke-linecap="round" opacity=".5">' +
        '<path d="M146,460 C152,455 164,455 170,460" stroke-width="1.4"/>' +
        '<path d="M142,466 C150,461 166,461 174,466" stroke-width="1.1"/>' +
      '</g>' +
      '<g stroke="' + QING + '" fill="none" stroke-linecap="round">' +
        '<path d="M164,462 C176,486 200,496 214,516 C230,540 254,548 274,566" stroke-width="2.6" opacity=".34"/>' +
        '<path d="M164,462 C176,486 200,496 214,516" stroke-width="4.5" opacity=".16"/>' +
        '<path d="M168,466 C180,488 202,498 216,518" stroke-width=".9" opacity=".4"/>' +
      '</g>' +

      /* ══ 七、山径 · 石阶 · 石灯 · 行人（走向照旧）══ */
      '<path d="M110,346 C146,390 122,424 148,458 C176,494 202,528 226,560" fill="none" stroke="' + SOLID + '" ' +
        'stroke-opacity=".4" stroke-width="1.8" stroke-dasharray="7 6" stroke-linecap="round"/>' +
      '<path d="M64,566 C84,542 78,514 94,490" fill="none" stroke="' + SOLID + '" stroke-opacity=".32" ' +
        'stroke-width="1.5" stroke-dasharray="6 6" stroke-linecap="round"/>' +
      '<g fill="none" stroke="' + SOLID + '" stroke-opacity=".5" stroke-width="1.2" stroke-linecap="round">' +
        '<path d="M166,486 L182,486 M170,494 L186,494 M174,502 L190,502"/>' +
      '</g>' +
      '<g transform="translate(126,466)" fill="none" stroke="' + SOLID + '" stroke-opacity=".5" stroke-width="1.15" ' +
        'stroke-linecap="round">' +
        '<path d="M0,0 L0,-9"/><path d="M-4,-9 L4,-9 L3,-15 L-3,-15 Z"/><path d="M-5.5,-15 L5.5,-15"/>' +
      '</g>' +
      '<g fill="' + SOLID + '" opacity=".42">' +
        '<circle cx="152" cy="452" r="1.7"/>' +
        '<path d="M152,454 L152,461 M149,457 L155,457 M152,461 L149.5,466 M152,461 L154.5,466" ' +
          'stroke="' + SOLID + '" stroke-width="1.1" fill="none" stroke-linecap="round"/>' +
        '<circle cx="160" cy="470" r="1.8"/>' +
        '<path d="M160,472 L160,480 M156.6,475 L163.4,475 M160,480 L157,486 M163,486" ' +
          'stroke="' + SOLID + '" stroke-width="1.1" fill="none" stroke-linecap="round"/>' +
      '</g>' +

      /* ══ 八、沉璧泽 ══ */
      '<path d="M-10,556 C58,538 130,562 206,548 C282,534 342,556 400,544" fill="none" stroke="' + SOLID + '" ' +
        'stroke-opacity=".4" stroke-width="1.6"/>' +
      '<path d="M-10,556 C58,538 130,562 206,548 C282,534 342,556 400,544 L400,724 L-10,724 Z" ' +
        'fill="' + QING + '" opacity=".14"/>' +
      '<g fill="none" stroke="' + QING + '" stroke-width="1.1" opacity=".36" stroke-linecap="round">' +
        '<path d="M36,574 q13,-5 26,0 q13,5 26,0"/>' +
        '<path d="M124,580 q12,-5 24,0 q12,5 24,0"/>' +
        '<path d="M216,572 q12,-5 24,0 q12,5 24,0"/>' +
        '<path d="M300,582 q11,-4 22,0 q11,4 22,0"/>' +
        '<path d="M76,598 q13,-5 26,0 q13,5 26,0"/>' +
        '<path d="M172,602 q12,-4 24,0 q12,4 24,0"/>' +
        '<path d="M262,608 q11,-4 22,0 q11,4 22,0"/>' +
        '<path d="M40,622 q12,-4 24,0 q12,4 24,0"/>' +
        '<path d="M150,634 q12,-4 24,0 q12,4 24,0"/>' +
      '</g>' +
      '<g fill="none" stroke="' + SOLID + '" stroke-opacity=".45" stroke-linecap="round">' +
        '<path d="M146,570 Q171,548 196,570" stroke-width="3"/>' +
        '<path d="M148,564 Q171,545 194,564" stroke-width="1" opacity=".7"/>' +
        '<path d="M171,551 L171,542" stroke-width="1"/>' +
        '<path d="M152,564 L152,576 M190,564 L190,576" stroke-width="1.5" opacity=".85"/>' +
      '</g>' +
      '<g>' +
        '<path d="M78,594 C86,602 112,602 120,594 C112,598 86,598 78,594 Z" fill="' + SOLID + '" opacity=".4"/>' +
        '<path d="M99,593 L99,576" stroke="' + SOLID + '" stroke-opacity=".45" stroke-width="1.1"/>' +
        '<path d="M99,577 L110,588 L99,591 Z" fill="' + SOLID + '" opacity=".2" stroke="' + SOLID + '" ' +
          'stroke-opacity=".45" stroke-width=".8" stroke-linejoin="round"/>' +
      '</g>' +
      '<g>' +
        '<path d="M296,638 C310,631 328,633 338,639 C328,646 306,646 296,638 Z" fill="' + SOLID + '" opacity=".16"/>' +
        '<path d="M304,635 L309,626 M320,633 L325,624" fill="none" stroke="' + SOLID + '" stroke-opacity=".35" stroke-width="1"/>' +
        '<path d="M40,652 C50,647 62,649 70,654 C62,659 48,659 40,652 Z" fill="' + SOLID + '" opacity=".14"/>' +
      '</g>' +
      '<g fill="none" stroke="' + SOLID + '" stroke-opacity=".38" stroke-width=".95" stroke-linecap="round">' +
        '<path d="M28,570 C26,562 30,556 28,548"/>' +
        '<path d="M38,572 C36,564 40,558 38,550"/>' +
        '<path d="M47,571 C45,564 49,558 47,551"/>' +
      '</g>' +

      /* ══ 九、近景：坡地 · 古松盘石 · 村舍 · 灵田 · 竹林 ══ */
      '<path d="M-10,644 C50,626 120,652 190,636 C260,620 330,644 400,630 L400,724 L-10,724 Z" ' +
        'fill="' + SOLID + '" opacity=".16"/>' +
      '<g fill="none" stroke="' + SOLID + '" stroke-opacity=".42" stroke-width="1" opacity=".8">' +
        '<path d="M198,506 C220,500 244,504 264,498"/>' +
        '<path d="M196,513 C218,507 244,511 266,505"/>' +
        '<path d="M194,520 C216,514 244,518 268,512"/>' +
        '<path d="M192,527 C214,521 244,525 270,519"/>' +
      '</g>' +
      '<g opacity=".9">' +
        '<path d="M26,592 L18,600 L46,600 L38,592 Z" fill="' + ZHE + '" stroke="' + SOLID + '" stroke-opacity=".42" stroke-width="1.1" stroke-linejoin="round"/>' +
        '<path d="M21,600 L21,610 M43,600 L43,610 M21,610 L43,610" fill="none" stroke="' + SOLID + '" stroke-opacity=".42" stroke-width="1"/>' +
        '<path d="M52,596 L45,603 L69,603 L62,596 Z" fill="' + ZHE + '" stroke="' + SOLID + '" stroke-opacity=".42" stroke-width="1.1" stroke-linejoin="round"/>' +
        '<path d="M48,603 L48,611 M66,603 L66,611 M48,611 L66,611" fill="none" stroke="' + SOLID + '" stroke-opacity=".42" stroke-width="1"/>' +
        '<path d="M74,600 L74,610 M80,600 L80,610 M86,600 L86,610" fill="none" stroke="' + SOLID + '" stroke-opacity=".3" stroke-width=".9"/>' +
      '</g>' +
      bamboo(62, 534, 1.1, '.5') + bamboo(84, 552, 0.9, '.4') +
      /* 古松盘石：近景最大，枝干苍劲 */
      rock(52, 478, 1.0, '.85') + pine(62, 468, 1.15, '.9') +
      rock(334, 514, 1.05, '.72') + pine(344, 502, 1.15, '.78') +
      rock(88, 670, 1.6, '.65') + pine(98, 654, 1.65, '.68') +
      pine(306, 692, 1.7, '.55') +

      /* ══ 十、山门牌坊 · 幡 · 碑 ══ */
      '<g transform="translate(152,658)">' +
        '<path d="M-31,-15 Q0,-22 31,-15" fill="none" stroke="' + SOLID + '" stroke-opacity=".6" stroke-width="2.4" stroke-linecap="round"/>' +
        '<path d="M-25,-11 L25,-11" stroke="' + SOLID + '" stroke-opacity=".6" stroke-width="2" stroke-linecap="round"/>' +
        '<rect x="-15" y="-21" width="30" height="10" rx="1.5" fill="' + PAPER + '" stroke="' + SOLID + '" stroke-opacity=".6" stroke-width="1.2"/>' +
        '<path d="M-20,-11 L-20,13 M20,-11 L20,13" stroke="' + SOLID + '" stroke-opacity=".6" stroke-width="2.2" stroke-linecap="round"/>' +
        '<path d="M-27,-6 L-20,-11 M27,-6 L20,-11" stroke="' + SOLID + '" stroke-opacity=".42" stroke-width="1.5" stroke-linecap="round"/>' +
      '</g>' +
      '<g fill="none" stroke="' + SOLID + '" stroke-opacity=".4" stroke-width="1.1" stroke-linecap="round">' +
        '<path d="M118,646 L118,668 M118,648 L128,652 L118,657 Z" fill="' + SOLID + '" opacity=".16"/>' +
        '<path d="M186,646 L186,668 M186,648 L176,652 L186,657 Z" fill="' + SOLID + '" opacity=".16"/>' +
      '</g>' +
      '<g transform="translate(196,684)" fill="' + SOLID + '" opacity=".16" stroke="' + SOLID + '" stroke-opacity=".42" stroke-width=".9">' +
        '<rect x="-7" y="-13" width="14" height="17" rx="1.5"/>' +
        '<path d="M-4,-9 L4,-9 M-4,-6 L4,-6 M-4,-3 L1,-3" stroke-width=".7" fill="none"/>' +
      '</g>' +

      '</svg>';
  }

  /* ── 横卷（宽屏 1200x600）：布局照旧（左岸村舍 · 中峰灵山 · 右泽沉璧），墨法换成宋人一路 ── */
  function wide() {
    return '<svg viewBox="0 0 1200 600" preserveAspectRatio="none" class="map-svg" aria-hidden="true">' +
      '<defs>' +
        '<linearGradient id="mapart-w1" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="' + SOLID + '" stop-opacity=".25"/>' +
          '<stop offset=".45" stop-color="' + SOLID + '" stop-opacity=".38"/>' +
          '<stop offset="1" stop-color="' + SOLID + '" stop-opacity=".20"/>' +
        '</linearGradient>' +
        '<linearGradient id="mapart-w2" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="' + SOLID + '" stop-opacity=".46"/>' +
          '<stop offset="1" stop-color="' + SOLID + '" stop-opacity=".26"/>' +
        '</linearGradient>' +
        '<linearGradient id="mapart-w3" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="' + QING + '" stop-opacity=".34"/>' +
          '<stop offset="1" stop-color="' + SOLID + '" stop-opacity=".07"/>' +
        '</linearGradient>' +
      '</defs>' +

      /* ══ 天际留白 · 飞鸟 ══ */
      '<g fill="none" stroke="' + SOLID + '" stroke-opacity=".36" stroke-width="1.3" stroke-linecap="round">' +
        '<path d="M232,112 q6,-7 12,0 q6,-7 12,0"/>' +
        '<path d="M196,134 q5,-5 10,0 q5,-5 10,0"/>' +
        '<path d="M272,96 q4,-4 8,0 q4,-4 8,0"/>' +
        '<path d="M176,160 q9,-11 18,0 q9,-11 18,0" stroke-width="1.4" opacity=".8"/>' +
      '</g>' +

      /* ══ 远峰三层（淡墨，若隐若现）══ */
      '<path d="M-10,214 C40,176 88,196 138,158 C188,122 236,144 286,118 C336,94 384,118 434,100 ' +
        'C484,82 532,106 582,92 C632,78 680,102 730,88 C780,74 828,96 878,84 C928,72 976,92 1026,82 ' +
        'C1076,72 1124,88 1210,76 L1210,252 L-10,252 Z" fill="' + SOLID + '" opacity=".08"/>' +
      '<path d="M-10,262 C34,232 78,248 126,216 C174,186 220,206 268,182 C316,158 362,180 410,162 ' +
        'C458,144 504,166 552,150 C600,134 646,156 694,142 C742,128 788,150 836,138 C884,126 930,146 978,136 ' +
        'C1026,126 1074,142 1210,130 L1210,312 L-10,312 Z" fill="' + QING + '" opacity=".13"/>' +
      '<path d="M-10,320 C40,292 86,306 134,282 C182,258 228,274 276,254 C324,234 370,252 418,236 ' +
        'C466,220 512,238 560,224 C608,210 654,228 702,216 C750,204 796,222 844,212 C892,202 938,218 986,210 ' +
        'C1034,202 1082,216 1210,206 L1210,362 L-10,362 Z" fill="' + SOLID + '" opacity=".16"/>' +
      moss([[138, 200], [196, 176], [248, 160], [306, 142], [358, 132], [414, 122], [470, 130], [524, 118],
            [580, 112], [634, 120], [690, 110], [746, 118], [802, 108], [858, 116], [914, 110], [970, 118],
            [1026, 112], [1082, 116]], 1.8, '.3') +

      /* ══ 层云：淡墨层层晕染 ══ */
      '<g fill="none" stroke="' + SOLID + '" stroke-linecap="round">' +
        '<path d="M-10,296 C90,288 190,302 296,292 C400,282 500,296 610,286 C720,276 830,290 940,282 C1040,275 1140,286 1210,280" stroke-opacity=".15" stroke-width="15"/>' +
        '<path d="M-10,330 C100,322 200,336 310,326 C420,316 520,330 630,320 C740,310 850,324 960,316 C1060,309 1160,320 1210,314" stroke-opacity=".10" stroke-width="19"/>' +
        '<path d="M-10,366 C110,358 210,372 320,362 C430,352 530,366 640,356 C750,346 860,360 970,352 C1070,345 1170,356 1210,350" stroke-opacity=".07" stroke-width="21"/>' +
      '</g>' +

      /* ══ 主峰群：阳面 / 阴面 / 脊线 / 皴擦 / 点苔（山势与旧版一致）══ */
      '<path d="M-10,544 C40,524 90,496 140,472 C200,446 250,432 292,404 ' +
        'C318,398 340,404 352,392 ' +
        'C366,374 384,402 408,428 C432,458 458,466 486,412 ' +
        'C512,364 534,282 552,214 C560,186 564,168 566,150 ' +
        'C572,176 586,226 602,282 C622,352 646,414 672,450 ' +
        'C696,484 722,470 752,444 C788,416 828,382 852,378 C858,372 860,372 862,374 ' +
        'C872,348 892,386 918,420 C950,466 1000,502 1080,522 ' +
        'C1140,534 1180,540 1210,544 L1210,562 L-10,562 Z" class="map-ridge" fill="url(#mapart-w1)"/>' +
      /* 阴面：主峰东坡压重 */
      '<path d="M566,150 C572,176 586,226 602,282 C622,352 646,414 672,450 C696,484 722,470 752,444 ' +
        'C788,416 828,382 852,378 C846,404 824,442 792,470 C750,506 690,520 640,506 ' +
        'C606,496 582,470 578,430 C574,404 570,372 566,340 Z" fill="url(#mapart-w2)" opacity=".8"/>' +
      /* 阴面：两侧次峰压重 */
      '<path d="M352,392 C366,374 384,402 408,428 C432,458 458,466 486,412 ' +
        'C470,446 434,470 396,470 C372,470 356,458 350,438 C346,422 348,406 352,392 Z" fill="url(#mapart-w2)" opacity=".6"/>' +
      '<path d="M862,374 C872,348 892,386 918,420 C950,466 1000,502 1080,522 ' +
        'C1000,514 930,494 890,458 C864,434 854,404 862,374 Z" fill="url(#mapart-w2)" opacity=".6"/>' +
      /* 脊线 */
      '<path d="M292,424 C318,398 340,404 352,392 C366,374 384,402 408,428" fill="none" stroke="' + SOLID + '" ' +
        'stroke-opacity=".42" stroke-width="1.5" stroke-linecap="round"/>' +
      '<path d="M486,412 C512,364 534,282 552,214 C560,186 564,168 566,150" fill="none" stroke="' + SOLID + '" ' +
        'stroke-opacity=".55" stroke-width="1.8" stroke-linecap="round"/>' +
      '<path d="M566,150 C572,176 586,226 602,282 C622,352 646,414 672,450" fill="none" stroke="' + SOLID + '" ' +
        'stroke-opacity=".6" stroke-width="1.9" stroke-linecap="round"/>' +
      '<path d="M752,444 C788,416 828,382 852,378 C858,372 860,372 862,374" fill="none" stroke="' + SOLID + '" ' +
        'stroke-opacity=".42" stroke-width="1.5" stroke-linecap="round"/>' +
      /* 披麻皴 */
      '<g fill="none" stroke="' + SOLID + '" stroke-opacity=".28" stroke-width=".9" stroke-linecap="round">' +
        '<path d="M500,392 C510,412 504,428 514,448"/>' +
        '<path d="M518,330 C528,350 522,366 532,386"/>' +
        '<path d="M536,268 C546,288 540,304 550,324"/>' +
        '<path d="M556,206 C566,228 560,244 570,264"/>' +
        '<path d="M578,196 C588,220 582,238 592,258"/>' +
        '<path d="M604,256 C614,278 608,294 618,314"/>' +
        '<path d="M624,326 C634,346 628,362 638,382"/>' +
        '<path d="M648,398 C658,418 652,434 662,454"/>' +
        '<path d="M684,460 C694,478 688,492 698,510"/>' +
        '<path d="M452,440 C462,458 456,472 466,490"/>' +
        '<path d="M736,470 C746,488 740,502 750,520"/>' +
        '<path d="M300,412 C310,430 304,444 314,462"/>' +
        '<path d="M842,398 C852,416 846,430 856,448"/>' +
      '</g>' +
      /* 斧劈皴 */
      '<g fill="none" stroke="' + SOLID + '" stroke-opacity=".2" stroke-width="1.7" stroke-linecap="round">' +
        '<path d="M512,404 L528,416 M534,424 L550,436 M556,436 L572,448"/>' +
        '<path d="M582,446 L598,458 M606,452 L622,464 M630,462 L646,474"/>' +
        '<path d="M470,436 L484,448 M446,452 L460,464 M424,464 L438,476"/>' +
        '<path d="M700,466 L714,478 M730,474 L744,486 M760,482 L774,494"/>' +
        '<path d="M820,492 L834,504 M860,502 L874,514 M900,512 L914,524"/>' +
        '<path d="M300,468 L314,480 M268,482 L282,494 M238,494 L252,506"/>' +
      '</g>' +
      moss([[508, 380], [540, 356], [572, 336], [604, 328], [636, 348], [668, 374], [700, 400],
            [452, 404], [420, 428], [388, 452], [740, 424], [776, 450], [846, 470], [356, 462],
            [500, 430], [560, 400], [612, 366], [664, 396], [712, 428]], 2.2, '.52') +
      /* 山巅小亭 */
      '<g transform="translate(566,150)">' +
        '<path d="M-14,-2 Q0,-11 14,-2 Z" fill="' + SOLID + '" opacity=".26" stroke="' + SOLID + '" ' +
          'stroke-opacity=".5" stroke-width="1.1" stroke-linejoin="round"/>' +
        '<path d="M-8,-1 L-8,7 M8,-1 L8,7" stroke="' + SOLID + '" stroke-opacity=".6" stroke-width="1.8" stroke-linecap="round"/>' +
        '<path d="M-9,7 L9,7" stroke="' + SOLID + '" stroke-opacity=".42" stroke-width="1.2" stroke-linecap="round"/>' +
      '</g>' +

      /* ══ 云锁山腰 ══ */
      '<g stroke="' + PAPER + '" fill="none" stroke-linecap="round" opacity=".5">' +
        '<path d="M300,342 C420,334 540,348 660,336 C780,324 900,338 1020,328 C1090,322 1150,330 1210,326" stroke-width="8" opacity=".7"/>' +
        '<path d="M360,378 C480,370 600,384 720,372 C840,360 960,374 1080,364" stroke-width="5.5" opacity=".5"/>' +
      '</g>' +
      '<g fill="none" stroke="' + INK7 + '" stroke-linecap="round" opacity=".45">' +
        '<path d="M300,342 C420,334 540,348 660,336 C780,324 900,338 1020,328 C1090,322 1150,330 1210,326" stroke-width="1.2"/>' +
        '<path d="M360,378 C480,370 600,384 720,372 C840,360 960,374 1080,364" stroke-width="1"/>' +
      '</g>' +

      /* ══ 飞瀑 · 溪流 ══ */
      '<g stroke="' + QING + '" fill="none" stroke-linecap="round">' +
        '<path d="M502,322 C498,352 510,376 504,404 C500,422 506,434 502,446" stroke-width="3.4" opacity=".40"/>' +
        '<path d="M506,324 C503,350 514,372 508,398" stroke-width="1.2" opacity=".5"/>' +
        '<path d="M498,330 C495,352 504,372 499,392" stroke-width=".9" opacity=".34"/>' +
      '</g>' +
      '<g fill="none" stroke="' + QINGL + '" stroke-linecap="round" opacity=".5">' +
        '<path d="M490,450 C496,445 508,445 514,450" stroke-width="1.4"/>' +
        '<path d="M486,456 C494,451 510,451 518,456" stroke-width="1.1"/>' +
      '</g>' +
      '<g stroke="' + QING + '" fill="none" stroke-linecap="round">' +
        '<path d="M506,452 C524,478 566,488 596,508 C628,530 680,540 716,552" stroke-width="2.8" opacity=".32"/>' +
        '<path d="M506,452 C524,478 566,488 596,508" stroke-width="4.6" opacity=".15"/>' +
      '</g>' +

      /* ══ 山径 · 石阶 · 石灯 · 行人 ══ */
      '<path d="M494,362 C520,408 492,448 528,480 C560,508 596,528 630,552" fill="none" stroke="' + SOLID + '" ' +
        'stroke-opacity=".4" stroke-width="1.8" stroke-dasharray="7 6" stroke-linecap="round"/>' +
      '<path d="M266,516 C300,494 292,468 316,446" fill="none" stroke="' + SOLID + '" stroke-opacity=".32" ' +
        'stroke-width="1.5" stroke-dasharray="6 6" stroke-linecap="round"/>' +
      '<g fill="none" stroke="' + SOLID + '" stroke-opacity=".5" stroke-width="1.2" stroke-linecap="round">' +
        '<path d="M552,482 L568,482 M556,490 L572,490 M560,498 L576,498"/>' +
      '</g>' +
      '<g transform="translate(468,470)" fill="none" stroke="' + SOLID + '" stroke-opacity=".5" stroke-width="1.15" stroke-linecap="round">' +
        '<path d="M0,0 L0,-9"/><path d="M-4,-9 L4,-9 L3,-15 L-3,-15 Z"/><path d="M-5.5,-15 L5.5,-15"/>' +
      '</g>' +
      '<g fill="' + SOLID + '" opacity=".42">' +
        '<circle cx="536" cy="448" r="1.7"/>' +
        '<path d="M536,450 L536,457 M533,453 L539,453 M536,457 L533.5,462 M536,457 L538.5,462" ' +
          'stroke="' + SOLID + '" stroke-width="1.1" fill="none" stroke-linecap="round"/>' +
        '<circle cx="546" cy="466" r="1.8"/>' +
        '<path d="M546,468 L546,476 M542.6,471 L549.4,471 M546,476 L543,482 M549,482" ' +
          'stroke="' + SOLID + '" stroke-width="1.1" fill="none" stroke-linecap="round"/>' +
      '</g>' +

      /* ══ 沉璧泽 ══ */
      '<path d="M560,510 C700,496 840,518 980,506 C1080,498 1160,510 1210,504" fill="none" stroke="' + SOLID + '" ' +
        'stroke-opacity=".4" stroke-width="1.6"/>' +
      '<path d="M560,510 C700,496 840,518 980,506 C1080,498 1160,510 1210,504 L1210,620 L560,620 Z" ' +
        'fill="' + QING + '" opacity=".14"/>' +
      '<g fill="none" stroke="' + QING + '" stroke-width="1.1" opacity=".34" stroke-linecap="round">' +
        '<path d="M640,530 q13,-5 26,0 q13,5 26,0"/>' +
        '<path d="M780,542 q12,-5 24,0 q12,5 24,0"/>' +
        '<path d="M920,530 q12,-5 24,0 q12,5 24,0"/>' +
        '<path d="M1040,544 q11,-4 22,0 q11,4 22,0"/>' +
        '<path d="M700,558 q13,-5 26,0 q13,5 26,0"/>' +
        '<path d="M870,564 q12,-4 24,0 q12,4 24,0"/>' +
        '<path d="M1000,568 q11,-4 22,0 q11,4 22,0"/>' +
      '</g>' +
      '<g fill="none" stroke="' + SOLID + '" stroke-opacity=".45" stroke-linecap="round">' +
        '<path d="M960,528 Q988,504 1016,528" stroke-width="3"/>' +
        '<path d="M962,522 Q988,502 1014,522" stroke-width="1" opacity=".7"/>' +
        '<path d="M988,508 L988,499" stroke-width="1"/>' +
        '<path d="M966,522 L966,534 M1010,522 L1010,534" stroke-width="1.5" opacity=".85"/>' +
      '</g>' +
      '<g>' +
        '<path d="M636,556 C644,564 670,564 678,556 C670,560 644,560 636,556 Z" fill="' + SOLID + '" opacity=".4"/>' +
        '<path d="M657,555 L657,538" stroke="' + SOLID + '" stroke-opacity=".45" stroke-width="1.1"/>' +
        '<path d="M657,539 L668,550 L657,553 Z" fill="' + SOLID + '" opacity=".2" stroke="' + SOLID + '" ' +
          'stroke-opacity=".45" stroke-width=".8" stroke-linejoin="round"/>' +
      '</g>' +
      '<g>' +
        '<path d="M1080,556 C1094,549 1112,551 1122,557 C1112,564 1090,564 1080,556 Z" fill="' + SOLID + '" opacity=".14"/>' +
        '<path d="M1088,553 L1093,544 M1104,551 L1109,542" fill="none" stroke="' + SOLID + '" stroke-opacity=".32" stroke-width="1"/>' +
      '</g>' +

      /* ══ 左岸：坡地 · 村舍 · 竹林 · 灵田 · 古松盘石 · 芦苇 ══ */
      '<path d="M-10,516 C120,502 260,524 400,512 C470,506 520,514 560,510 L560,620 L-10,620 Z" ' +
        'fill="' + SOLID + '" opacity=".16"/>' +
      '<g opacity=".9">' +
        '<path d="M96,528 L86,538 L120,538 L110,528 Z" fill="' + ZHE + '" stroke="' + SOLID + '" stroke-opacity=".42" stroke-width="1.1" stroke-linejoin="round"/>' +
        '<path d="M90,538 L90,550 M116,538 L116,550 M90,550 L116,550" fill="none" stroke="' + SOLID + '" stroke-opacity=".42" stroke-width="1"/>' +
        '<path d="M130,532 L122,541 L150,541 L142,532 Z" fill="' + ZHE + '" stroke="' + SOLID + '" stroke-opacity=".42" stroke-width="1.1" stroke-linejoin="round"/>' +
        '<path d="M126,541 L126,551 M146,541 L146,551 M126,551 L146,551" fill="none" stroke="' + SOLID + '" stroke-opacity=".42" stroke-width="1"/>' +
        '<path d="M158,538 L158,550 M165,538 L165,550 M172,538 L172,550" fill="none" stroke="' + SOLID + '" stroke-opacity=".3" stroke-width=".9"/>' +
      '</g>' +
      '<g fill="none" stroke="' + SOLID + '" stroke-opacity=".4" stroke-width="1" opacity=".7">' +
        '<path d="M212,492 C240,486 272,490 300,484"/>' +
        '<path d="M210,499 C238,493 272,497 302,491"/>' +
        '<path d="M208,506 C236,500 272,504 304,498"/>' +
      '</g>' +
      bamboo(148, 508, 1.05, '.45') + bamboo(174, 524, 0.85, '.38') +
      '<g fill="none" stroke="' + SOLID + '" stroke-opacity=".32" stroke-width=".95" stroke-linecap="round">' +
        '<path d="M34,522 C32,514 36,508 34,500"/>' +
        '<path d="M44,524 C42,516 46,510 44,502"/>' +
        '<path d="M53,523 C51,516 55,510 53,503"/>' +
      '</g>' +
      rock(290, 560, 1.3, '.6') + pine(302, 546, 1.35, '.66') +
      rock(206, 452, 0.95, '.8') + pine(214, 444, 1.0, '.85') +
      rock(880, 588, 1.4, '.5') + pine(892, 576, 1.45, '.52') +
      pine(1160, 486, 0.95, '.55') +

      /* ══ 山门牌坊 · 幡 · 碑 ══ */
      '<g transform="translate(660,556) scale(.95)">' +
        '<path d="M-31,-15 Q0,-22 31,-15" fill="none" stroke="' + SOLID + '" stroke-opacity=".6" stroke-width="2.4" stroke-linecap="round"/>' +
        '<path d="M-25,-11 L25,-11" stroke="' + SOLID + '" stroke-opacity=".6" stroke-width="2" stroke-linecap="round"/>' +
        '<rect x="-15" y="-21" width="30" height="10" rx="1.5" fill="' + PAPER + '" stroke="' + SOLID + '" stroke-opacity=".6" stroke-width="1.2"/>' +
        '<path d="M-20,-11 L-20,13 M20,-11 L20,13" stroke="' + SOLID + '" stroke-opacity=".6" stroke-width="2.2" stroke-linecap="round"/>' +
      '</g>' +
      '<g fill="none" stroke="' + SOLID + '" stroke-opacity=".4" stroke-width="1.1" stroke-linecap="round">' +
        '<path d="M624,544 L624,568 M624,546 L634,550 L624,555 Z" fill="' + SOLID + '" opacity=".16"/>' +
        '<path d="M696,544 L696,568 M696,546 L686,550 L696,555 Z" fill="' + SOLID + '" opacity=".16"/>' +
      '</g>' +
      '<g transform="translate(706,580)" fill="' + SOLID + '" opacity=".16" stroke="' + SOLID + '" stroke-opacity=".42" stroke-width=".9">' +
        '<rect x="-7" y="-13" width="14" height="17" rx="1.5"/>' +
        '<path d="M-4,-9 L4,-9 M-4,-6 L4,-6 M-4,-3 L1,-3" stroke-width=".7" fill="none"/>' +
      '</g>' +

      '</svg>';
  }

  /* ── 地点符号：具象剪影，沿用 .ms-icon 的 currentColor ── */
  function glyph(id) {
    var open = '<svg viewBox="0 0 24 24" class="ms-glyph" fill="none" stroke="currentColor" ' +
               'stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">';
    var body;
    if (id === 'dannfang') {
      body = '<path d="M6.4,10.6 h11.2 l-1.2,7.6 a1,1 0 0 1 -1,.8 h-6.8 a1,1 0 0 1 -1,-.8 Z"/>' +
             '<path d="M4.8,10.6 h14.4"/><path d="M9.4,7.6 h5.2 l.9,3 h-7 Z"/>' +
             '<path d="M9.6,17.4 L8.6,20 M12,18 L12,20.8 M14.4,17.4 L15.4,20"/>' +
             '<path d="M12,6.2 C11,5 13.2,4.4 12.2,3" opacity=".8" stroke-width="1"/>';
    } else if (id === 'market') {
      body = '<path d="M2.8,11 L12,4.8 L21.2,11 Z"/>' +
             '<path d="M4.8,11 L4.8,20.4 M19.2,11 L19.2,20.4"/>' +
             '<path d="M7.6,20.4 L7.6,14.4 h3.4 v6"/>' +
             '<path d="M13.2,20.4 L13.2,15.6 h3.6 v4.8"/>' +
             '<path d="M2.8,11 L21.2,11" stroke-width="1.1"/>';
    } else if (id === 'arena') {
      body = '<path d="M4,13.4 L4,17.6 h16 v-4.2"/><path d="M3.2,13.4 L20.8,13.4" stroke-width="1.4"/>' +
             '<path d="M7.6,13.4 L7.6,4.4 M16.4,13.4 L16.4,4.4"/>' +
             '<path d="M7.6,4.4 L13.6,7 L7.6,9.6 Z" fill="currentColor" stroke="none" opacity=".85"/>' +
             '<path d="M16.4,4.4 L10.4,7 L16.4,9.6 Z" fill="currentColor" stroke="none" opacity=".85"/>' +
             '<path d="M6.4,20.4 L17.6,20.4" stroke-width="1.1" opacity=".8"/>';
    } else if (id === 'seek') {
      body = '<circle cx="9" cy="8" r="3"/><path d="M4.5,18.5 C5,14 7,12 9,12 C11,12 13,14 13.5,18.5"/>' +
             '<circle cx="17" cy="14" r="3.2"/><path d="M19.4,16.4 L22,19"/>';
    } else {
      return '<svg viewBox="0 0 24 24" class="ms-glyph ms-glyph-mist" fill="currentColor" stroke="none">' +
             '<ellipse cx="9" cy="14.4" rx="6.4" ry="3.6" opacity=".7"/>' +
             '<ellipse cx="14.6" cy="11.6" rx="7" ry="4" opacity=".62"/>' +
             '<ellipse cx="16" cy="15.6" rx="5.6" ry="3.2" opacity=".55"/>' +
             '<ellipse cx="21" cy="18.4" rx="3.4" ry="2" opacity=".45"/>' +
             '<ellipse cx="3.4" cy="18.6" rx="3.6" ry="2" opacity=".45"/>' +
             '</svg>';
    }
    return open + body + '</svg>';
  }

  g.MAPART = { scene: scene, wide: wide, glyph: glyph };   // 微缩直接用同一份 scene/wide，不再另画
})(window);
