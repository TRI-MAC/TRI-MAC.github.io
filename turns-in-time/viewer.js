// Turns in Time viewer.
// index.html = browse: the title card, then the chapters, with arrows and an m/n counter.
// kiosk.html = the title card and the story so far (at most 30 s), then the latest
// chapter for 60 s with a countdown bar, then again.
// overview.html = the story so far one time, then the latest chapter; after that the
// reader switches between the two with buttons. Its bar is above the page.
// All three draw a fixed 1080 x 1920 frame: the comic page (1080 x 1800) and a 120 px bar.
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
  var OVERVIEW_RETRY_MS = 15000;
  var SECOND_TRY_MS = 2000;
  var OVERVIEW_PAGE_WAIT_MS = 10 * 60 * 1000;
  var RECAP_TRIES = 3;
  var TAB_FONT_PX = 52, TAB_FONT_MIN_PX = 22;

  // The build this page runs: the ?v= of the script tag. Pages, clips, and the
  // title card carry it too, so a new build never shows a cached old image.
  var RUNNING = (function () {
    var me = document.currentScript;
    try { return me ? new URL(me.src, location.href).searchParams.get("v") : null; } catch (e) { return null; }
  })();
  function asset(path) { return RUNNING ? path + "?v=" + encodeURIComponent(RUNNING) : path; }

  var frame = document.getElementById("frame");
  var mode = document.body.dataset.mode;

  // A camera start or a screen cleanup that is due goes through later().
  // While the overview is paused, the time left on each one is kept, and it
  // runs out after the pause ends. Only the overview pauses.
  var held = false, jobs = [];
  function later(fn, ms) {
    var job = { left: ms, since: 0, timer: null };
    job.run = function () {
      job.since = Date.now();
      job.timer = setTimeout(function () {
        jobs.splice(jobs.indexOf(job), 1);
        fn();
      }, job.left);
    };
    jobs.push(job);
    if (!held) job.run();
  }
  function setHeld(on) {
    if (on === held) return;
    held = on;
    jobs.forEach(function (job) {
      if (!on) { job.run(); return; }
      if (job.timer === null) return;  // made during a pause: not started yet
      clearTimeout(job.timer);
      job.timer = null;
      job.left = Math.max(0, job.left - (Date.now() - job.since));
    });
  }

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
        if (!r.ok) {
          var e = new Error(url + " " + r.status);
          e.status = r.status;
          throw e;
        }
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
  // loadWhole: true when the last load() got every chapter the index names.
  // loadNewest: the highest chapter number the last index names.
  var chapterCache = {};
  var loadWhole = false;
  var loadNewest = 0;
  function load() {
    return fetchText("chapters/index.json").then(function (src) {
      var ids = JSON.parse(src).chapters;
      if (!Array.isArray(ids)) throw new Error("chapters/index.json has no chapters list");
      loadNewest = ids.reduce(function (m, id) {
        var n = parseInt(id, 10);
        return n > m ? n : m;
      }, 0);
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
      loadWhole = list.every(Boolean);
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
  function parseRecap(md) {
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
  }

  // "through: N" in the recap's front matter: the last chapter the recap
  // covers, or null. The publisher writes "through: N - 1" with chapter N.
  function recapThrough(md) {
    var n = parseInt(parseMarkdown(md).meta.through, 10);
    return n >= 0 ? n : null;
  }

  // The kiosk's copy: null when the file does not load, so the last good copy stays.
  function loadRecap() {
    return fetchText("story-so-far.md").then(parseRecap).catch(function () { return null; });
  }

  // Resolves true when the image loads and decodes within timeoutMs. A
  // download that times out keeps going, so a later try can find it cached.
  // With keep, the decoded image is stored there under its URL.
  function decodes(src, timeoutMs, keep) {
    if (keep && keep[src]) return Promise.resolve(true);
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
      if (ok && keep) keep[src] = img;
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
  // picture: an image already decoded, to use in place of a new one.
  function pageFigure(ch, withMotion, picture) {
    var fig = el("figure", "page");
    var img = picture || el("img");
    if (!picture) img.src = ch.page;
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

  function chapterScreen(ch, picture) {
    var s = el("section", "screen chapter");
    s.setAttribute("aria-label", chapterName(ch));
    s.appendChild(pageFigure(ch, true, picture));
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
    later(function () {
      fig.classList.remove("fx-on");
      fig.querySelectorAll(".fx").forEach(function (e) { e.remove(); });
    }, 1800);
  }

  function show(screen) {
    frame.querySelectorAll(".empty").forEach(function (e) { e.remove(); });
    frame.querySelectorAll(".screen").forEach(function (o) {
      if (o === screen) return;
      o.classList.remove("on");
      o.setAttribute("aria-hidden", "true");  // it is on its way out
      releaseVideos(o);
      later(function () { o.remove(); }, FADE_MS + 100);
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

  // The title card. The kiosk adds "The story so far" over it when recap beats follow;
  // the overview shows that tag in its bar instead (tagInBar). picture: an image
  // already loaded, to use in place of a new one.
  function titleScreen(storySoFar, tagInBar, picture) {
    var s = el("section", "screen title-screen");
    s.setAttribute("aria-label", storySoFar ? "Turns in Time: the story so far" : "Turns in Time: title card");
    var img = picture || el("img");
    if (!picture) img.src = asset("title/title.jpg");
    img.alt = TITLE_ALT;
    s.appendChild(img);
    if (storySoFar && !tagInBar) s.appendChild(el("p", "recap-tag", "The story so far"));
    return s;
  }

  function recapScreen(ch, beat, seconds, picture) {
    var s = el("section", "screen chapter recap");
    s.setAttribute("aria-label", "The story so far: chapter " + ch.n);
    var fig = pageFigure(ch, false, picture);
    s.appendChild(fig);
    s.appendChild(el("p", "recap-caption", beat.text));
    if (beat.focus && !reduceMotion) {
      var f = beat.focus;
      var cx = (f[0] + f[2]) / 2, cy = (f[1] + f[3]) / 2;
      var zoom = Math.min(1.6, Math.max(1.08, 0.85 / Math.max(f[2] - f[0], f[3] - f[1])));
      fig.style.transformOrigin = (cx * 100) + "% " + (cy * 100) + "%";
      fig.style.transition = "transform " + seconds + "s ease-in-out";
      later(function () { if (!reduceMotion) fig.style.transform = "scale(" + zoom + ")"; }, 50);
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
  // stays up. Recap beats show only chapters whose pages decode. Each page
  // gets timeoutMs to load. whole: true when no page or recap chapter had to
  // be left out. keep: where the decoded pages are stored. depth: how many
  // chapters back to look for a page that loads (FALLBACK_CHAPTERS unless given).
  function plan(chapters, recap, timeoutMs, keep, depth) {
    var byN = {};
    chapters.forEach(function (c) { byN[c.n] = c; });
    var floor = Math.max(0, chapters.length - (depth || FALLBACK_CHAPTERS));
    function newest(k) {
      if (k < floor) return Promise.resolve(null);
      return decodes(chapters[k].page, timeoutMs, keep).then(function (ok) { return ok ? chapters[k] : newest(k - 1); });
    }
    return newest(chapters.length - 1).then(function (latest) {
      if (!latest) return null;
      var named = recap.filter(function (b) { return b.n < latest.n; });
      var beats = named.filter(function (b) { return byN[b.n]; }).slice(-MAX_BEATS);
      return Promise.all(beats.map(function (b) { return decodes(byN[b.n].page, timeoutMs, keep); })).then(function (ok) {
        return {
          latest: latest,
          beats: beats.filter(function (b, i) { return ok[i]; }).map(function (b) { return { ch: byN[b.n], beat: b }; }),
          whole: latest === chapters[chapters.length - 1] && ok.every(Boolean) &&
            recap.every(function (b) { return byN[b.n]; })
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
            return chapters ? plan(chapters, recap || [], FETCH_TIMEOUT_MS) : null;
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

  // ── paper margin ──────────────────────────────────────────────────

  // A chapter page is drawn with a paper margin around its panels. This finds
  // it on a decoded image: for each edge, the distance in image pixels to the
  // ink of the panel border, or 0 when that edge has no margin of plain
  // paper. Returns { w, h, l, t, r, b }, or null when the image cannot be read.
  function paperMargin(img) {
    try {
      var w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) return null;
      var c = document.createElement("canvas");
      c.width = w; c.height = h;
      var g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      var D = Math.max(8, Math.round(w * 0.045)), N = 15;
      // strip: the D pixels next to one edge, which is len pixels long.
      // at(i, d): the pixel offset at position i along the edge and
      // depth d from it.
      function side(strip, len, at) {
        var q = strip.data;
        function sum(i, d) { var k = at(i, d) * 4; return q[k] + q[k + 1] + q[k + 2]; }
        // On N lines across the middle of the edge: the depth at which
        // paper, at least two pixels of it, gives way to ink at once.
        var found = [];
        for (var n = 0; n < N; n++) {
          var i = Math.round((0.15 + 0.7 * (n + 0.5) / N) * len);
          for (var d = 0; d < D - 4; d++) {
            if (sum(i, d) >= 600) continue;  // paper
            if (d >= 2 && Math.min(sum(i, d), sum(i, d + 1), sum(i, d + 2), sum(i, d + 3)) < 260) found.push(d);
            break;
          }
        }
        if (found.length < N * 0.6) return 0;
        found.sort(function (a, b) { return a - b; });
        var mid = found[found.length >> 1];
        var near = found.filter(function (d) { return Math.abs(d - mid) <= 3; }).length;
        if (near < N * 0.6) return 0;
        // Every pixel of the strip up to that depth, corner to corner,
        // must be paper: a mark of any size there (lettering, a stroke
        // that reaches the edge) means the edge is not trimmed.
        for (var e = 0; e < mid - 1; e++) {
          for (var j = 0; j < len; j++) {
            if (sum(j, e) < 600) return 0;
          }
        }
        // Two pixels into the border's ink, so no soft paper edge is left.
        return mid + 2;
      }
      var top = g.getImageData(0, 0, w, D), bottom = g.getImageData(0, h - D, w, D);
      var left = g.getImageData(0, 0, D, h), right = g.getImageData(w - D, 0, D, h);
      return {
        w: w, h: h,
        t: side(top, w, function (i, d) { return d * w + i; }),
        b: side(bottom, w, function (i, d) { return (D - 1 - d) * w + i; }),
        l: side(left, h, function (i, d) { return i * D + d; }),
        r: side(right, h, function (i, d) { return i * D + (D - 1 - d); })
      };
    } catch (e) {
      return null;
    }
  }

  // Sizes the page so its paper margin falls outside the screen: the panel
  // border then meets the screen's edges. m is what paperMargin() found. A
  // page that is not the screen's shape stays as it is.
  function trim(screen, m) {
    var fig = screen.querySelector(".page");
    if (!fig || !m || !(m.l || m.t || m.r || m.b)) return screen;
    if (Math.abs((m.w / m.h) / (W / (H - 120)) - 1) > 0.005) return screen;
    var kx = m.w / (m.w - m.l - m.r), ky = m.h / (m.h - m.t - m.b);
    fig.style.inset = "auto";
    fig.style.left = (-m.l / m.w * kx * 100) + "%";
    fig.style.top = (-m.t / m.h * ky * 100) + "%";
    fig.style.width = (kx * 100) + "%";
    fig.style.height = (ky * 100) + "%";
    fig.classList.add("trimmed");
    return screen;
  }

  // ── overview view ─────────────────────────────────────────────────

  // The title card comes up at once, before the chapters load. Then the story
  // so far plays one time, with its tag and the countdown in the bar, and ends
  // on the latest chapter. From then on the bar holds two buttons, and the
  // reader switches between the story so far and the latest chapter; nothing
  // advances unless the reader asks. A pause button holds whatever moves: the
  // steps, the countdown, the camera, and the chapter's clip. With reduced
  // motion, or with no recap beats, the first play is skipped. The page never
  // reloads itself.
  function overview() {
    var p = null;        // what plan() found: the latest chapter and the recap beats
    var kept = {};       // page URL -> the image plan() decoded, held so a screen's picture is there at once
    var trims = {};      // page URL -> its paper margin
    var playing = false; // true while the story so far plays
    var ticket = 0;      // a newer choice drops the steps an older one still has
    var auto = false;    // true while the first, automatic play runs
    var recapTries = 0, recapGot = null;  // the recap, once it has loaded (or is known to be missing)
    var through = null;       // the loaded recap's "through" value, or null when it has none
    var recapOld = false;     // true when an index names a later release than the loaded recap
    var recapMissed = false;  // true after one 404 for the recap; a second one is believed
    var lastChapters = null;  // the last chapters that loaded, with their index's newest number
    var secondTry = false;
    var tabs = null, storyTab = null, latestTab = null, live = null, pauseBtn = null;

    // One step timer, which counts only the time that is not paused.
    var paused = false, stepLeft = 0, stepSince = 0, stepTimer = null, stepDone = null;
    function runStep() {
      stepSince = Date.now();
      stepTimer = setTimeout(function () {
        var done = stepDone;
        stepDone = null;
        done();
      }, stepLeft);
    }
    function hold(seconds, done) {
      clearTimeout(stepTimer);
      stepLeft = seconds * 1000;
      stepDone = done;
      if (!paused) runStep();
    }
    function dropStep() {
      clearTimeout(stepTimer);
      stepDone = null;
    }

    var ICON_PAUSE = "M8 5v14M16 5v14", ICON_PLAY = "M8 5v14l11-7z";
    // The button is for the story so far. On the latest chapter it is gray
    // and does nothing.
    function drawPause() {
      if (!pauseBtn) return;
      var label = paused ? "Resume" : "Pause";
      pauseBtn.setAttribute("aria-label", label);
      pauseBtn.title = label;
      pauseBtn.setAttribute("aria-disabled", String(!playing));
      pauseBtn.querySelector("path").setAttribute("d", paused ? ICON_PLAY : ICON_PAUSE);
    }
    // Transitions and animations stop where they are and go on from there.
    function setPaused(on) {
      if (on === paused) return;
      paused = on;
      setHeld(on);
      if (stepDone) {
        if (on) {
          clearTimeout(stepTimer);
          stepLeft = Math.max(0, stepLeft - (Date.now() - stepSince));
        } else {
          runStep();
        }
      }
      if (frame.getAnimations) {
        frame.getAnimations({ subtree: true }).forEach(function (a) {
          if (on && a.playState === "running") a.pause();
          else if (!on && a.playState === "paused") a.play();
        });
      }
      frame.querySelectorAll(".screen.on video").forEach(function (v) {
        if (on) { v.pause(); return; }
        var q = v.play();
        if (q && q.catch) q.catch(function () {});
      });
      drawPause();
    }
    function pauseButton() {
      pauseBtn = el("button", "pause");
      pauseBtn.type = "button";
      pauseBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=""/></svg>';
      pauseBtn.addEventListener("click", function () { if (playing) setPaused(!paused); });
      bar().appendChild(pauseBtn);
      drawPause();
    }

    // A choice by the reader ends a pause.
    function tab(label, act) {
      var b = el("button", null, label);
      b.type = "button";
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", function () {
        setPaused(false);
        if (b.getAttribute("aria-pressed") !== "true") act();
      });
      return b;
    }

    // The labels shrink until the bar holds them, for a font wider than Bangers.
    function fitTabs() {
      if (!tabs) return;
      var size = TAB_FONT_PX, b = bar();
      var cs = getComputedStyle(b);
      var room = b.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      function need() {
        return tabs.offsetWidth + (pauseBtn ? pauseBtn.offsetWidth + parseFloat(cs.columnGap || 0) : 0);
      }
      tabs.style.fontSize = size + "px";
      while (size > TAB_FONT_MIN_PX && need() > room) {
        size -= 2;
        tabs.style.fontSize = size + "px";
      }
    }

    // The two buttons take the place of the tag once the first play is over.
    function controls() {
      if (tabs || !p.beats.length) return;
      tabs = el("nav", "tabs");
      tabs.setAttribute("aria-label", "Overview");
      storyTab = tab("The story so far", story);
      latestTab = tab("The latest episode", latest);
      live = el("span", "sr-only");
      live.setAttribute("aria-live", "polite");
      [storyTab, latestTab, live].forEach(function (e) { tabs.appendChild(e); });
      var b = bar();
      b.insertBefore(tabs, b.firstChild);
      b.classList.add("tabbed");
      fitTabs();
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitTabs);
    }

    function mark(which) {
      if (!tabs) return;
      storyTab.setAttribute("aria-pressed", String(which === "story"));
      latestTab.setAttribute("aria-pressed", String(which === "latest"));
      bar().classList.toggle("playing", which === "story" && !reduceMotion);
      live.textContent = which === "story" ? "The story so far" : "The latest episode. " + chapterName(p.latest) + ".";
    }

    // The picture for a screen: a copy of the decoded page, or the decoded
    // image itself when a copy is not complete at once.
    function picture(src) {
      var k = kept[src];
      if (!k) return null;
      var copy = k.cloneNode(false);
      return copy.complete && copy.naturalWidth ? copy : k;
    }

    function latest() {
      ++ticket;
      dropStep();
      auto = false;
      playing = false;
      setPaused(false);
      drawPause();
      tag(null);
      controls();
      mark("latest");
      show(trim(chapterScreen(p.latest, picture(p.latest.page)), trims[p.latest.page]));
    }

    // The title card, then the recap beats, then the latest chapter. With
    // reduced motion the frames are still and the countdown stays off.
    function story() {
      var my = ++ticket;
      var per = Math.min(BEAT_MAX, Math.max(BEAT_MIN, (RECAP_SECONDS - INTRO_SECONDS) / p.beats.length));
      var steps = [{ screen: function () { return titleScreen(true, true, titleCopy()); }, seconds: INTRO_SECONDS }];
      p.beats.forEach(function (b) {
        steps.push({ screen: function () { return trim(recapScreen(b.ch, b.beat, per, picture(b.ch.page)), trims[b.ch.page]); }, seconds: per });
      });
      playing = true;
      drawPause();
      mark("story");
      if (!reduceMotion) countdown(INTRO_SECONDS + per * p.beats.length);
      (function next(i) {
        if (my !== ticket) return;
        if (i === steps.length) { latest(); return; }
        show(steps[i].screen());
        hold(steps[i].seconds, function () { next(i + 1); });
      })(0);
    }

    // [] when there is no recap file: a 404, seen twice, since the first one
    // is checked on the second try. Another failure may pass, so it is tried
    // again with the rest of the start; after RECAP_TRIES the overview goes
    // on without a recap. A recap that is older than the index (recapOld) is
    // fetched again, and it stays in use when that fetch fails.
    function recap() {
      if (recapGot && !recapOld) return Promise.resolve(recapGot);
      if (recapTries >= RECAP_TRIES) return Promise.resolve(recapGot || []);
      recapTries++;
      return fetchText("story-so-far.md").then(function (md) {
        through = recapThrough(md);
        recapOld = recapMissed = false;
        return (recapGot = parseRecap(md));
      }, function (e) {
        if (recapGot) return recapGot;
        if (e && e.status === 404) {
          if (recapMissed) return (recapGot = []);
          recapMissed = true;
          return [];
        }
        if (recapTries >= RECAP_TRIES) return [];
        throw e;
      });
    }

    // The chapters that loaded, with their index's newest number. When a
    // later load fails, or its index is from an earlier release, the last
    // one that worked stands in, never as whole.
    function chapters() {
      return load().then(function (list) {
        if (!list.length) throw new Error("no chapters");
        if (lastChapters && lastChapters.newest > loadNewest) throw new Error("an older index");
        return (lastChapters = { list: list, newest: loadNewest, whole: loadWhole });
      }).catch(function (e) {
        if (!lastChapters) throw e;
        return { list: lastChapters.list, newest: lastChapters.newest, whole: false };
      });
    }

    // Just after a new chapter deploys, the index and the recap can be a
    // release apart: the recap's "through" is then not the index's newest
    // chapter less one. More than 0: the recap is the older file. Less: the
    // index is.
    function behind(c) {
      return through === null ? 0 : c.newest - 1 - through;
    }

    // A page gets OVERVIEW_PAGE_WAIT_MS to load: the title card is already
    // up, so on a slow link the overview waits for the newest page. Only a
    // page that fails makes an older chapter stand in.
    // One load of the chapters and the recap, and the plan made from them.
    // whole: nothing the index and the recap name had to be left out, the two
    // files are from one release, and a missing recap has been checked twice.
    // Each try fetches the index. An older recap is fetched again: at once
    // when it was kept from an earlier try, on the next try when this try
    // fetched it.
    function attempt() {
      var tries = recapTries;
      return Promise.all([chapters(), recap()]).then(function (r) {
        if (behind(r[0]) <= 0) return r;
        recapOld = true;
        if (recapTries !== tries) return r;
        return recap().then(function (again) { return [r[0], again]; });
      }).then(function (r) {
        var c = r[0], apart = behind(c);
        return plan(c.list, r[1], OVERVIEW_PAGE_WAIT_MS, kept, c.list.length).then(function (found) {
          if (!found) throw new Error("no chapter page loaded");
          var unsure = recapMissed && !recapGot && c.newest > 1;
          return { found: found, whole: c.whole && found.whole && apart === 0 && !unsure };
        });
      });
    }
    // The later chapter wins; then the later try, unless its recap is shorter.
    function better(a, b) {
      if (b.latest.n !== a.latest.n) return b.latest.n > a.latest.n ? b : a;
      return b.beats.length >= a.beats.length ? b : a;
    }

    // The limits, by design: when something did not load, there is one second
    // try, and then the overview shows what it has for the rest of the visit.
    // With nothing to show, it tries again every OVERVIEW_RETRY_MS.
    function start() {
      attempt().then(function (a) {
        if (a.whole || secondTry) return a.found;
        secondTry = true;
        return wait(SECOND_TRY_MS / 1000).then(attempt).then(
          function (b) { return better(a.found, b.found); },
          function () { return a.found; });
      }).then(function (found) {
        Object.keys(kept).forEach(function (src) {
          if (!(src in trims)) trims[src] = paperMargin(kept[src]);
        });
        p = found;
        if (p.beats.length) pauseButton();
        if (reduceMotion || !p.beats.length) {
          latest();
        } else {
          auto = true;
          tag("The story so far");
          story();
        }
      }).catch(function (e) {
        console.warn("Turns in Time:", e);
        setTimeout(start, OVERVIEW_RETRY_MS);
      });
    }

    // Reduced motion turned on: the automatic play stops on the latest
    // chapter. A play the reader asked for goes on with still frames, and a
    // pause in it stays. Turned off on the latest chapter: its clip comes back.
    function onReduce() {
      if (!p) return;
      if (reduceMotion) {
        if (auto) latest();
        else bar().classList.remove("playing");
      } else if (!playing) {
        latest();
      }
      drawPause();
    }
    if (motionQuery) {
      if (motionQuery.addEventListener) motionQuery.addEventListener("change", onReduce);
      else if (motionQuery.addListener) motionQuery.addListener(onReduce);
    }

    // Held for the visit, so the title card's picture is there for a replay.
    var titlePicture = new Image();
    titlePicture.src = asset("title/title.jpg");
    function titleCopy() {
      if (!(titlePicture.complete && titlePicture.naturalWidth)) return null;
      var copy = titlePicture.cloneNode(false);
      return copy.complete && copy.naturalWidth ? copy : titlePicture;
    }

    show(titleScreen(false));
    start();
  }

  // ── start ─────────────────────────────────────────────────────────

  // The counter and the recap captions use Bangers; load it before drawing.
  var fontsReady = (document.fonts && document.fonts.load)
    ? document.fonts.load('64px "Bangers"').catch(function () {})
    : Promise.resolve();
  Promise.race([fontsReady, new Promise(function (r) { setTimeout(r, 3000); })]).then(function () {
    if (mode === "kiosk") {
      kiosk();
    } else if (mode === "overview") {
      overview();
    } else {
      load().then(function (c) { if (c.length) browse(c); else fail(); }, fail);
    }
  });
})();
