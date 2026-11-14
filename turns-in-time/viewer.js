// Turns in Time viewer.
// index.html = browse: the title card, then the chapters, with arrows and an m/n counter.
// kiosk.html = the title card and the story so far (at most 30 s), then the latest
// chapter for 60 s with a countdown bar, then again. Both draw a fixed 1080 x 1920
// frame: the comic page (1080 x 1800) on top and a 120 px bar below.
(function () {
  "use strict";

  var W = 1080, H = 1920;
  var CHAPTER_SECONDS = 60;
  var INTRO_SECONDS = 3;
  var RECAP_SECONDS = 30;
  var BEAT_MIN = 4.5, BEAT_MAX = 7, MAX_BEATS = 6;
  var FETCH_TIMEOUT_MS = 10000;
  var BROWSE_TIMEOUT_MS = 60000;
  var FADE_MS = 600;
  var RELOAD_RETRY_MS = 10 * 60 * 1000;
  var FALLBACK_CHAPTERS = 3;

  // The build this page runs: the ?v= of the script tag. Pages, clips, and the
  // title card carry it too, so a new build never shows a cached old image.
  var RUNNING = (function () {
    var me = document.currentScript;
    try { return me ? new URL(me.src, location.href).searchParams.get("v") : null; } catch (e) { return null; }
  })();
  function asset(path) { return RUNNING ? path + "?v=" + encodeURIComponent(RUNNING) : path; }

  var frame = document.getElementById("frame");
  var mode = document.body.dataset.mode;

  // Reduced motion is read live. When it turns on, clips stop, the timeshift
  // effect ends, and a recap drift holds where it is.
  var motionQuery = window.matchMedia ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  var reduceMotion = !!(motionQuery && motionQuery.matches);
  function onMotionChange() {
    reduceMotion = !!motionQuery.matches;
    if (!reduceMotion) return;
    releaseVideos(frame);
    frame.querySelectorAll("video, .fx").forEach(function (e) { e.remove(); });
    frame.querySelectorAll(".page").forEach(function (f) {
      f.classList.remove("fx-on");
      if (f.style.transition) {
        var held = getComputedStyle(f).transform;
        f.style.transition = "none";
        f.style.transform = held;
      }
    });
  }
  if (motionQuery) {
    if (motionQuery.addEventListener) motionQuery.addEventListener("change", onMotionChange);
    else if (motionQuery.addListener) motionQuery.addListener(onMotionChange);
  }

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
    var text = String(src).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
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
      page: asset("chapters/" + id + "/page.jpg"),
      motion: doc.meta.motion ? asset("chapters/" + id + "/" + doc.meta.motion) : null,
      motionBox: box(doc.meta["motion-box"]),
      panels: lettering(doc.sections)
    };
  }

  function chapterName(ch) { return "Chapter " + ch.n + (ch.title ? ": " + ch.title : ""); }

  // A chapter that fails to load is dropped, unless an earlier load of it is
  // in the cache (the kiosk keeps one); the rest still show.
  var chapterCache = {};
  function load() {
    return fetchText("chapters/index.json").then(function (src) {
      var ids = JSON.parse(src).chapters;
      if (!Array.isArray(ids)) throw new Error("chapters/index.json has no chapters list");
      return Promise.all(ids.map(function (id) {
        id = String(id);
        return fetchText("chapters/" + id + "/chapter.md")
          .then(function (md) { return (chapterCache[id] = chapterFrom(id, md)); })
          .catch(function (e) {
            console.warn("Turns in Time: chapter " + id + " did not load", e);
            return chapterCache[id] || null;
          });
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
    }).catch(function () { return null; });
  }

  // Resolves true when the image loads and decodes within timeoutMs. A
  // download that times out keeps going, so a later try can find it cached.
  function decodes(src, timeoutMs) {
    var img = new Image();
    var ready = new Promise(function (resolve) {
      img.onload = function () {
        if (img.decode) img.decode().then(function () { resolve(true); }, function () { resolve(false); });
        else resolve(true);
      };
      img.onerror = function () { resolve(false); };
    });
    img.src = src;
    var late = wait(timeoutMs / 1000).then(function () { return false; });
    return Promise.race([ready, late]).then(function (ok) {
      img.onload = img.onerror = null;
      return ok;
    });
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

  // withMotion: the chapter's loop plays over its region of the page. Recap
  // beats pass false.
  function pageFigure(ch, withMotion) {
    var fig = el("figure", "page");
    var img = el("img");
    img.src = ch.page;
    img.alt = ch.alt || chapterName(ch);
    img.decoding = "async";
    fig.appendChild(img);
    if (withMotion && ch.motion && ch.motionBox && !reduceMotion) {
      var v = el("video");
      v.muted = true; v.loop = true; v.playsInline = true; v.preload = "auto";
      v.setAttribute("muted", ""); v.setAttribute("playsinline", ""); v.setAttribute("aria-hidden", "true");
      v.src = ch.motion;
      // The clip covers only the moving region; it sits on the page there.
      var mb = ch.motionBox;
      v.style.left = (mb[0] * 100) + "%";
      v.style.top = (mb[1] * 100) + "%";
      v.style.width = ((mb[2] - mb[0]) * 100) + "%";
      v.style.height = ((mb[3] - mb[1]) * 100) + "%";
      v.addEventListener("playing", function () { v.classList.add("playing"); });
      v.addEventListener("error", function () { v.remove(); });
      fig.appendChild(v);
    }
    return fig;
  }

  // The lettering is drawn into the page; this copy is for screen readers.
  function letteringText(ch) {
    var box = el("div", "sr-only");
    box.appendChild(el("p", null, chapterName(ch)));
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
    s.setAttribute("aria-label", chapterName(ch));
    s.appendChild(pageFigure(ch, true));
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
    var first = arrow("Beginning", "M6 4v16M18 4l-8 8 8 8");
    var prev = arrow("Previous", "M15 4 7 12l8 8");
    var next = arrow("Next", "M9 4l8 8-8 8");
    var latest = arrow("Latest chapter", "M18 4v16M6 4l8 8-8 8");
    var count = el("span", "count");
    count.setAttribute("aria-hidden", "true");
    var live = el("span", "sr-only");
    live.setAttribute("aria-live", "polite");
    [first, prev, count, next, latest, live].forEach(function (e) { nav.appendChild(e); });
    bar().appendChild(nav);

    // The counter, the hash, and the buttons follow the position the reader
    // asked for at once. The screen changes when that page has decoded; if it
    // does not load, the screen that is up stays and the counter goes back.
    var shown = -1, wanted = -1, ticket = 0;
    function mark(k) {
      if (k === 0) {
        count.textContent = "";
        live.textContent = "Title card";
        history.replaceState(null, "", location.pathname + location.search);
      } else {
        var ch = chapters[k - 1];
        count.textContent = k + "/" + last;
        live.textContent = chapterName(ch) + ". " + k + " of " + last + ".";
        history.replaceState(null, "", "#" + ch.n);
      }
      first.setAttribute("aria-disabled", String(k === 0));
      prev.setAttribute("aria-disabled", String(k === 0));
      next.setAttribute("aria-disabled", String(k === last));
      latest.setAttribute("aria-disabled", String(k === last));
    }
    function go(k) {
      k = Math.max(0, Math.min(last, k));
      if (k === wanted) return;
      wanted = k;
      mark(k);
      var my = ++ticket;
      if (k === shown) return;  // already up; a load still pending is dropped
      decodes(k === 0 ? asset("title/title.jpg") : chapters[k - 1].page, BROWSE_TIMEOUT_MS).then(function (ok) {
        if (my !== ticket) return;  // the reader has moved on
        if (ok) {
          shown = k;
          show(k === 0 ? titleScreen(false) : chapterScreen(chapters[k - 1]));
          return;
        }
        if (shown < 0 && k !== 0) { go(0); return; }  // the first page failed: open on the title card
        wanted = Math.max(shown, 0);
        mark(wanted);
        if (shown < 0) fail();
        live.textContent = (k === 0 ? "The title card" : chapterName(chapters[k - 1])) + " did not load.";
      });
    }
    first.addEventListener("click", function () { go(0); });
    prev.addEventListener("click", function () { go(wanted - 1); });
    next.addEventListener("click", function () { go(wanted + 1); });
    latest.addEventListener("click", function () { go(last); });
    document.addEventListener("keydown", function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowLeft") go(wanted - 1);
      else if (e.key === "ArrowRight") go(wanted + 1);
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

  // A tag at the left of the bar, before the countdown, so it never covers the page.
  var barTag = null;
  function tag(text) {
    var b = bar();
    if (!barTag) { barTag = el("p", "bar-tag"); b.insertBefore(barTag, b.firstChild); }
    barTag.textContent = text || "";
    b.classList.toggle("tagged", !!text);
  }

  function wait(seconds) { return new Promise(function (r) { setTimeout(r, seconds * 1000); }); }

  var TITLE_ALT = "Turns in Time. Nami holds up her keys where three eras meet: " +
    "a dirt road with a horse and wagon, a glowing road over the bay, and today's corner, " +
    "where a lavender car waits with a furball inside, by the stop sign and the hydrant.";

  // The title card. The kiosk adds "The story so far" over it when recap beats follow.
  function titleScreen(storySoFar) {
    var s = el("section", "screen title-screen");
    s.setAttribute("aria-label", storySoFar ? "Turns in Time: the story so far" : "Turns in Time: title card");
    var img = el("img");
    img.src = asset("title/title.jpg");
    img.alt = TITLE_ALT;
    s.appendChild(img);
    if (storySoFar) s.appendChild(el("p", "recap-tag", "The story so far"));
    return s;
  }

  function recapScreen(ch, beat, seconds) {
    var s = el("section", "screen chapter recap");
    s.setAttribute("aria-label", "The story so far: chapter " + ch.n);
    var fig = pageFigure(ch, false);
    s.appendChild(fig);
    s.appendChild(el("p", "recap-caption", beat.text));
    if (beat.focus && !reduceMotion) {
      var f = beat.focus;
      var cx = (f[0] + f[2]) / 2, cy = (f[1] + f[3]) / 2;
      var zoom = Math.min(1.6, Math.max(1.08, 0.85 / Math.max(f[2] - f[0], f[3] - f[1])));
      fig.style.transformOrigin = (cx * 100) + "% " + (cy * 100) + "%";
      fig.style.transition = "transform " + seconds + "s ease-in-out";
      setTimeout(function () { if (!reduceMotion) fig.style.transform = "scale(" + zoom + ")"; }, 50);
    }
    return s;
  }

  // A deploy writes one value into version.txt and into the ?v= of the script
  // and stylesheet links. When version.txt names another build, the kiosk
  // reloads with ?v=<value>&t=<time>, which gets past a cached copy of the HTML.
  // If that reload still brings the old build (a deploy in progress), it tries
  // again 10 minutes after the reload. Resolves to the new value, or null.
  function newBuild() {
    return fetchText("version.txt").then(function (v) {
      v = v.trim();
      if (!v || !RUNNING || v === RUNNING) return null;
      var q = new URLSearchParams(location.search);
      var t = parseInt(q.get("t"), 10);
      if (q.get("v") === v && Math.abs(Date.now() - t) < RELOAD_RETRY_MS) return null;
      return v;
    }).catch(function () { return null; });
  }

  // What one cycle shows. The latest chapter is the newest one whose page
  // decodes, so a new chapter with a broken page waits and the one before it
  // stays up. Recap beats show only chapters whose pages decode.
  function plan(chapters, recap) {
    var byN = {};
    chapters.forEach(function (c) { byN[c.n] = c; });
    var floor = Math.max(0, chapters.length - FALLBACK_CHAPTERS);
    function newest(k) {
      if (k < floor) return Promise.resolve(null);
      return decodes(chapters[k].page, FETCH_TIMEOUT_MS).then(function (ok) { return ok ? chapters[k] : newest(k - 1); });
    }
    return newest(chapters.length - 1).then(function (latest) {
      if (!latest) return null;
      var beats = recap.filter(function (b) { return byN[b.n] && b.n < latest.n; }).slice(-MAX_BEATS);
      return Promise.all(beats.map(function (b) { return decodes(byN[b.n].page, FETCH_TIMEOUT_MS); })).then(function (ok) {
        return {
          latest: latest,
          beats: beats.filter(function (b, i) { return ok[i]; }).map(function (b) { return { ch: byN[b.n], beat: b }; })
        };
      });
    });
  }

  function kiosk() {
    var chapters = null, recap = null;  // the last good copies
    var next = null;                    // what the next cycle shows
    var newer = null;                   // set when version.txt names another build
    var pending = null;

    // Fetches what the next cycle needs. The latest-chapter step starts it, so
    // the next cycle begins on time; a slow or failed fetch leaves the last
    // good copies in place.
    function refresh() {
      if (!pending) {
        pending = newBuild()
          .then(function (v) {
            newer = v;
            return Promise.all([load().catch(function () { return null; }), loadRecap()]);
          })
          .then(function (r) {
            if (r[0] && r[0].length) chapters = r[0];
            if (r[1]) recap = r[1];
            return chapters ? plan(chapters, recap || []) : null;
          })
          .then(function (p) { if (p) next = p; })
          .catch(function (e) { console.warn("Turns in Time:", e); })
          .then(function () { pending = null; });
      }
      return pending;
    }

    function cycle() {
      if (newer) {
        // Reload only when the page answers, so a dropped network never leaves
        // the kiosk on a browser error page. Otherwise the cycle runs as before.
        var target = location.pathname + "?v=" + encodeURIComponent(newer) + "&t=" + Date.now();
        newer = null;
        return fetchText(target).then(function () {
          location.replace(target + location.hash);
          return new Promise(function () {});  // the page is leaving
        }, function () { return cycle(); });
      }
      if (!next) {
        return refresh().then(function () {
          if (!next) throw new Error("no chapters");
          return cycle();
        });
      }
      var p = next;
      var per = p.beats.length
        ? Math.min(BEAT_MAX, Math.max(BEAT_MIN, (RECAP_SECONDS - INTRO_SECONDS) / p.beats.length))
        : 0;
      // The title card opens every cycle; "The story so far" shows only when beats follow.
      var steps = [function () {
        show(titleScreen(p.beats.length > 0));
        tag(null);
        countdown(INTRO_SECONDS + per * p.beats.length);
        return wait(INTRO_SECONDS);
      }];
      p.beats.forEach(function (b) {
        steps.push(function () {
          show(recapScreen(b.ch, b.beat, per));
          return wait(per);
        });
      });
      steps.push(function () {
        show(chapterScreen(p.latest));
        tag("The latest episode");
        countdown(CHAPTER_SECONDS);
        refresh();
        return wait(CHAPTER_SECONDS);
      });
      return steps.reduce(function (q, step) { return q.then(step); }, Promise.resolve());
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
  Promise.race([fontsReady, new Promise(function (r) { setTimeout(r, 3000); })]).then(function () {
    if (mode === "kiosk") {
      kiosk();
    } else {
      load().then(function (c) { if (c.length) browse(c); else fail(); }, fail);
    }
  });
})();
