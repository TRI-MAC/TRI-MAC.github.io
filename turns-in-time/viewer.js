// Turns in Time viewer.
// index.html = browse: the title card, then the chapters, with arrows and an m/n counter.
// kiosk.html = the story so far (at most 30 s), then the latest chapter for 60 s
// with a countdown bar, then again. Both draw a fixed 1080 x 1920 frame: the
// comic page (1080 x 1800) on top and a 120 px bar below.
(function () {
  "use strict";

  var W = 1080, H = 1920;
  var CHAPTER_SECONDS = 60;
  var INTRO_SECONDS = 3;
  var RECAP_SECONDS = 30;
  var BEAT_MIN = 4.5, BEAT_MAX = 7, MAX_BEATS = 6;
  var FETCH_TIMEOUT_MS = 10000;
  var FADE_MS = 600;

  var frame = document.getElementById("frame");
  var mode = document.body.dataset.mode;
  var reduceMotion = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

  function fit() {
    var s = Math.min(window.innerWidth / W, window.innerHeight / H);
    frame.style.transform = "scale(" + s + ")";
    frame.style.left = (window.innerWidth - W * s) / 2 + "px";
    frame.style.top = (window.innerHeight - H * s) / 2 + "px";
  }
  window.addEventListener("resize", fit);
  fit();

  // ── data ──────────────────────────────────────────────────────────

  function fetchText(url) {
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, FETCH_TIMEOUT_MS) : null;
    var busted = url + (url.indexOf("?") < 0 ? "?" : "&") + "v=" + Date.now();
    return fetch(busted, { cache: "no-store", signal: ctl ? ctl.signal : undefined })
      .then(function (r) {
        if (!r.ok) throw new Error(url + " " + r.status);
        return r.text();
      })
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  // Front matter (key: value lines between --- fences), then "## Name" sections.
  // Tolerates a BOM, CRLF, blank lines before the fence, trailing spaces, quoted
  // values, and headings in any case.
  function parseMarkdown(src) {
    var text = String(src).replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    var meta = {};
    var m = text.match(/^\s*---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
    if (m) {
      m[1].split("\n").forEach(function (line) {
        var i = line.indexOf(":");
        if (i > 0) {
          meta[line.slice(0, i).trim().toLowerCase()] =
            line.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
        }
      });
      text = text.slice(m[0].length);
    }
    var parts = text.split(/^##[ \t]*/m);
    var sections = parts.slice(1).map(function (p) {
      var nl = p.indexOf("\n");
      var name = (nl < 0 ? p : p.slice(0, nl)).trim();
      return { name: name, key: name.toLowerCase(), body: nl < 0 ? "" : p.slice(nl + 1).trim() };
    });
    return { meta: meta, sections: sections };
  }

  function plain(s) {
    return String(s).replace(/\*\*?([^*]+)\*\*?/g, "$1").replace(/\s+/g, " ").trim();
  }

  // "Who: words" lines inside "## Panel N" sections. "Art:" lines are for the
  // artist and are skipped; so are lines without a colon.
  function lettering(sections) {
    var panels = [];
    sections.forEach(function (sec) {
      if (!/^panel\b/.test(sec.key)) return;
      var lines = [];
      sec.body.split("\n").forEach(function (line) {
        var i = line.indexOf(":");
        if (i <= 0) return;
        var who = line.slice(0, i).replace(/^[-*\s]+/, "").trim();
        var words = plain(line.slice(i + 1));
        var k = who.toLowerCase();
        if (!words || k === "art") return;
        lines.push({
          who: who,
          kind: k === "caption" || k === "title" ? "caption" : k === "sfx" ? "sfx" : "speech",
          text: words
        });
      });
      panels.push(lines);
    });
    return panels;
  }

  // "x0 y0 x1 y1" as fractions of the page, or null.
  function box(v) {
    var f = String(v || "").trim().split(/\s+/).map(Number);
    if (f.length !== 4 || f.some(function (x) { return !(x >= 0 && x <= 1); }) || f[2] <= f[0] || f[3] <= f[1]) return null;
    return f;
  }

  function chapterFrom(id, md) {
    var doc = parseMarkdown(md);
    var n = parseInt(id, 10);
    if (!(n > 0)) throw new Error("bad chapter folder " + id);
    return {
      id: id,
      n: n,
      title: plain(doc.meta.title || ""),
      alt: plain(doc.meta.alt || ""),
      effect: (doc.meta.effect || "").toLowerCase(),
      page: "chapters/" + id + "/page.jpg",
      motion: doc.meta.motion ? "chapters/" + id + "/" + doc.meta.motion : null,
      motionBox: box(doc.meta["motion-box"]),
      panels: lettering(doc.sections)
    };
  }

  // One unreadable chapter is dropped; the rest still show.
  function load() {
    return fetchText("chapters/index.json").then(function (src) {
      var ids = JSON.parse(src).chapters;
      if (!Array.isArray(ids)) throw new Error("chapters/index.json has no chapters list");
      return Promise.all(ids.map(function (id) {
        id = String(id);
        return fetchText("chapters/" + id + "/chapter.md")
          .then(function (md) { return chapterFrom(id, md); })
          .catch(function (e) { console.warn("Turns in Time: skipping chapter", id, e); return null; });
      }));
    }).then(function (list) {
      var seen = {};
      return list.filter(function (c) {
        if (!c || seen[c.n]) return false;
        seen[c.n] = true;
        return true;
      }).sort(function (a, b) { return a.n - b.n; });
    });
  }

  // "## 3" or "## 1-5" (the beat shows the last chapter of the range), then
  // the caption. An optional "Focus: x0 y0 x1 y1" line (fractions of the page)
  // names the panel the camera drifts toward.
  function loadRecap() {
    return fetchText("story-so-far.md").then(function (md) {
      return parseMarkdown(md).sections.map(function (sec) {
        var m = sec.name.match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
        if (!m) return null;
        var focus = null, words = [];
        sec.body.split("\n").forEach(function (line) {
          var f = line.match(/^\s*focus\s*:\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*$/i);
          if (f) focus = f.slice(1).map(Number);
          else words.push(line);
        });
        var text = plain(words.join(" "));
        return text ? { n: parseInt(m[2] || m[1], 10), text: text, focus: focus } : null;
      }).filter(Boolean);
    }).catch(function () { return []; });
  }

  // ── drawing ───────────────────────────────────────────────────────

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function releaseVideos(root) {
    root.querySelectorAll("video").forEach(function (v) {
      v.pause();
      v.removeAttribute("src");
      v.load();
    });
  }

  function pageFigure(ch) {
    var fig = el("figure", "page");
    var img = el("img");
    img.src = ch.page;
    img.alt = ch.alt || ("Chapter " + ch.n + ": " + ch.title);
    img.decoding = "async";
    fig.appendChild(img);
    if (ch.motion && !reduceMotion) {
      var v = el("video");
      v.muted = true; v.loop = true; v.playsInline = true; v.preload = "auto";
      v.setAttribute("muted", ""); v.setAttribute("playsinline", ""); v.setAttribute("aria-hidden", "true");
      v.src = ch.motion;
      if (ch.motionBox) {
        // The clip covers only the moving region; it sits on the page there.
        var mb = ch.motionBox;
        v.style.left = (mb[0] * 100) + "%";
        v.style.top = (mb[1] * 100) + "%";
        v.style.width = ((mb[2] - mb[0]) * 100) + "%";
        v.style.height = ((mb[3] - mb[1]) * 100) + "%";
      }
      v.addEventListener("playing", function () { v.classList.add("playing"); });
      v.addEventListener("error", function () { v.remove(); });
      fig.appendChild(v);
    }
    return fig;
  }

  // The lettering is drawn into the page; this copy is for screen readers.
  function letteringText(ch) {
    var box = el("div", "sr-only");
    box.appendChild(el("p", null, "Chapter " + ch.n + ": " + ch.title));
    ch.panels.forEach(function (lines) {
      lines.forEach(function (l) {
        if (l.who.toLowerCase() === "title") return;
        box.appendChild(el("p", null, l.kind === "speech" ? l.who + ": " + l.text
          : l.kind === "sfx" ? "Sound: " + l.text : l.text));
      });
    });
    return box;
  }

  function chapterScreen(ch) {
    var s = el("section", "screen chapter");
    s.setAttribute("aria-label", "Chapter " + ch.n + ": " + ch.title);
    s.appendChild(pageFigure(ch));
    s.appendChild(letteringText(ch));
    if (ch.effect) s.dataset.effect = ch.effect;
    return s;
  }

  // "effect: timeshift" in a chapter's front matter: a chromatic split that
  // resolves into the page. A red-channel copy and a cyan-channel copy, blended
  // with screen over black, add back up to the full image as their offsets close.
  function playEffect(screen) {
    if (reduceMotion || screen.dataset.effect !== "timeshift") return;
    var fig = screen.querySelector(".page");
    var src = fig.querySelector("img").src;
    ["fx-red", "fx-cyan"].forEach(function (c) {
      var copy = el("img", "fx " + c);
      copy.src = src; copy.alt = ""; copy.setAttribute("aria-hidden", "true");
      fig.appendChild(copy);
    });
    fig.appendChild(el("div", "fx fx-dots"));
    fig.classList.add("fx-on");
    setTimeout(function () {
      fig.classList.remove("fx-on");
      fig.querySelectorAll(".fx").forEach(function (e) { e.remove(); });
    }, 1800);
  }

  function show(screen) {
    frame.querySelectorAll(".empty").forEach(function (e) { e.remove(); });
    frame.querySelectorAll(".screen").forEach(function (o) {
      if (o === screen) return;
      o.classList.remove("on");
      releaseVideos(o);
      setTimeout(function () { o.remove(); }, FADE_MS + 100);
    });
    frame.insertBefore(screen, frame.firstChild);
    void screen.offsetWidth;  // commit the start state so the fade runs
    screen.classList.add("on");
    screen.querySelectorAll("video").forEach(function (v) {
      var p = v.play();
      if (p && p.catch) p.catch(function () {});
    });
    playEffect(screen);
  }

  function fail() {
    if (!frame.querySelector(".screen") && !frame.querySelector(".empty")) {
      frame.appendChild(el("div", "empty", "Turns in Time"));
    }
  }

  function bar() {
    var b = frame.querySelector(".bar");
    if (!b) { b = el("div", "bar"); frame.appendChild(b); }
    return b;
  }

  // ── browse view ───────────────────────────────────────────────────

  // Position 0 is the title card; positions 1 to n are the chapters. With no
  // chapter number in the hash, the reader opens on the title card.
  function browse(chapters) {
    var last = chapters.length;
    function fromHash() {
      var n = parseInt(location.hash.slice(1), 10);
      for (var k = 0; k < chapters.length; k++) if (chapters[k].n === n) return k + 1;
      return 0;
    }

    var nav = el("nav", "pager");
    nav.setAttribute("aria-label", "Chapters");
    function arrow(label, d) {
      var b = el("button");
      b.type = "button";
      b.setAttribute("aria-label", label);
      b.title = label;
      b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
      return b;
    }
    var prev = arrow("Previous", "M15 4 7 12l8 8");
    var next = arrow("Next", "M9 4l8 8-8 8");
    var count = el("span", "count");
    count.setAttribute("aria-hidden", "true");
    var live = el("span", "sr-only");
    live.setAttribute("aria-live", "polite");
    nav.appendChild(prev); nav.appendChild(count); nav.appendChild(next); nav.appendChild(live);
    bar().appendChild(nav);

    var i = -1;
    function go(k) {
      k = Math.max(0, Math.min(last, k));
      if (k === i) return;
      i = k;
      if (k === 0) {
        show(titleScreen(false));
        count.textContent = "";
        live.textContent = "Title card";
        history.replaceState(null, "", location.pathname + location.search);
      } else {
        show(chapterScreen(chapters[k - 1]));
        count.textContent = k + "/" + last;
        live.textContent = "Chapter " + k + " of " + last;
        history.replaceState(null, "", "#" + chapters[k - 1].n);
      }
      prev.setAttribute("aria-disabled", String(k === 0));
      next.setAttribute("aria-disabled", String(k === last));
    }
    prev.addEventListener("click", function () { go(i - 1); });
    next.addEventListener("click", function () { go(i + 1); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") go(i - 1);
      else if (e.key === "ArrowRight") go(i + 1);
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(last);
    });
    window.addEventListener("hashchange", function () { go(fromHash()); });
    go(fromHash());
  }

  // ── kiosk view ────────────────────────────────────────────────────

  var fill = null;
  function countdown(seconds) {
    if (!fill) {
      var track = el("div", "countdown");
      track.setAttribute("aria-hidden", "true");
      fill = el("div", "countdown-fill");
      track.appendChild(fill);
      bar().appendChild(track);
    }
    fill.style.transition = "none";
    fill.style.transform = "scaleX(1)";
    void fill.offsetWidth;
    fill.style.transition = "transform " + seconds + "s linear";
    fill.style.transform = "scaleX(0)";
  }

  function wait(seconds) { return new Promise(function (r) { setTimeout(r, seconds * 1000); }); }

  var TITLE_ALT = "Turns in Time. Nami holds up her keys beside a stop sign where three eras meet: " +
    "a dirt road with a horse and wagon, a glowing road over the bay, and today's corner, " +
    "where a lavender car waits with a furball inside.";

  // The title card. The kiosk adds "The story so far" over it.
  function titleScreen(storySoFar) {
    var s = el("section", "screen title-screen");
    s.setAttribute("aria-label", storySoFar ? "Turns in Time: the story so far" : "Turns in Time: title card");
    var img = el("img");
    img.src = "title/title.jpg";
    img.alt = TITLE_ALT;
    s.appendChild(img);
    if (storySoFar) s.appendChild(el("p", "recap-tag", "The story so far"));
    return s;
  }

  function recapScreen(ch, beat, seconds) {
    var s = el("section", "screen chapter recap");
    s.setAttribute("aria-label", "The story so far: chapter " + ch.n);
    var fig = pageFigure(ch);
    s.appendChild(fig);
    s.appendChild(el("p", "recap-caption", beat.text));
    if (beat.focus && !reduceMotion) {
      var f = beat.focus;
      var cx = (f[0] + f[2]) / 2, cy = (f[1] + f[3]) / 2;
      var zoom = Math.min(1.6, Math.max(1, 0.85 / Math.max(f[2] - f[0], f[3] - f[1])));
      fig.style.transformOrigin = (cx * 100) + "% " + (cy * 100) + "%";
      fig.style.transition = "transform " + seconds + "s ease-in-out";
      setTimeout(function () { fig.style.transform = "scale(" + zoom + ")"; }, 50);
    }
    return s;
  }

  // A deploy changes version.txt; the kiosk reloads itself to pick up new code.
  var version = null;
  function checkVersion() {
    return fetchText("version.txt").then(function (v) {
      v = v.trim();
      if (version === null) version = v;
      else if (v && v !== version) location.reload();
    }).catch(function () {});
  }

  function kiosk() {
    var lastGood = null;
    function cycle() {
      return checkVersion()
        .then(function () {
          return Promise.all([load().catch(function () { return lastGood; }), loadRecap()]);
        })
        .then(function (r) {
          var chapters = r[0];
          if (!chapters || !chapters.length) throw new Error("no chapters");
          lastGood = chapters;
          var latest = chapters[chapters.length - 1];
          var byN = {};
          chapters.forEach(function (c) { byN[c.n] = c; });
          var beats = r[1].filter(function (b) { return byN[b.n] && b.n !== latest.n; }).slice(-MAX_BEATS);
          var steps = [];
          if (beats.length) {
            var per = Math.min(BEAT_MAX, Math.max(BEAT_MIN, (RECAP_SECONDS - INTRO_SECONDS) / beats.length));
            var total = INTRO_SECONDS + per * beats.length;
            steps.push(function () {
              show(titleScreen(true));
              countdown(total);
              return wait(INTRO_SECONDS);
            });
            beats.forEach(function (b) {
              steps.push(function () {
                show(recapScreen(byN[b.n], b, per));
                return wait(per);
              });
            });
          }
          steps.push(function () {
            show(chapterScreen(latest));
            countdown(CHAPTER_SECONDS);
            return wait(CHAPTER_SECONDS);
          });
          return steps.reduce(function (p, step) { return p.then(step); }, Promise.resolve());
        });
    }
    function loop() {
      cycle().then(loop, function (e) {
        console.warn("Turns in Time:", e);
        fail();
        setTimeout(loop, 60000);
      });
    }
    loop();
  }

  // ── start ─────────────────────────────────────────────────────────

  // The counter and the recap captions use Bangers; load it before drawing.
  var fontsReady = (document.fonts && document.fonts.load)
    ? document.fonts.load('64px "Bangers"').catch(function () {})
    : Promise.resolve();
  fontsReady.then(function () {
    if (mode === "kiosk") {
      kiosk();
    } else {
      load().then(function (c) { if (c.length) browse(c); else fail(); }, fail);
    }
  });
})();
